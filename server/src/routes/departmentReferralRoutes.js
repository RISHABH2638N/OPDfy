import { safeDiagnostic } from "../utils/privacySafeLog.js";
import mongoose from "mongoose";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protect, requireRole } from "../middleware/auth.js";
import { protectPatient } from "../middleware/patientAuth.js";
import DepartmentReferral from "../models/DepartmentReferral.js";
import Consultation from "../models/Consultation.js";
import Token from "../models/Token.js";
import User from "../models/User.js";
import { normalizeDepartment } from "../utils/departments.js";
import { getDoctorAvailability } from "../utils/doctorAvailability.js";
import { assertQueueAcceptingArrivals } from "../utils/clinicOperations.js";
import { createQueueToken } from "../services/queueTokenService.js";
import { quoteVisitFee, preparePayment, attachPaymentToToken } from "../utils/billing.js";
import { databaseTransaction } from "../utils/databaseTransaction.js";
import { emitOperationalUpdate, emitQueueUpdate, emitPatientTokenUpdate, emitPatientReferralUpdate } from "../services/realtimeService.js";

const router = asyncRouter();
const validId = (id) => mongoose.isValidObjectId(id);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = (value) => String(value?._id || value || "");
const clean = (value, max) => String(value || "").trim().slice(0, max);
const handle = (error, res) => {
  if (res.headersSent) return;
  if (error?.code === 11000 || error?.name === "VersionError") {
    return res.status(409).json({ message: "This referral has already been processed. Refresh and try again." });
  }
  const status = error?.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) console.error("Department referral error:", safeDiagnostic(error));
  return res.status(status).json({ message: status === 500 ? "Unable to process department referral." : error.message });
};

const populate = (query) => query
  .populate("patient", "name patientId")
  .populate("fromDoctor", "name department")
  .populate("toDoctor", "name department")
  .populate("sourceToken", "tokenNumber department status")
  .populate("targetToken", "tokenNumber department status arrivalStatus assignedDoctor");

async function broadcast(req, token = null) {
  const io = req.app.get("io");
  emitOperationalUpdate(io, ["queue", "appointments", "analytics", "referrals"]);
  if (!token) return;
  emitPatientTokenUpdate(io, token.patient, token);
  const queue = await Token.find({ isArchived: { $ne: true } })
    .select("tokenNumber department status urgency -_id")
    .sort({ department: 1, tokenNumber: 1 }).lean();
  emitQueueUpdate(io, queue);
}

// Only doctors registered in this clinic can be selected.
router.get("/doctors", protect, requireRole("doctor"), async (req, res) => {
  const doctors = await User.find({ role: "doctor" })
    .select("name department doctorSchedule").sort({ department: 1, name: 1 }).lean();
  res.json({ doctors: doctors.map(({ _id, name, department, doctorSchedule }) => ({
    _id, name, department, availability: getDoctorAvailability({ doctorSchedule }),
  })) });
});

// A source doctor may refer an active encounter or an already completed consultation.
router.post("/", protect, requireRole("doctor"), async (req, res) => {
  try {
    const { tokenId, doctorId } = req.body;
    const reason = clean(req.body.reason, 2000);
    if (!validId(tokenId) || !validId(doctorId) || !reason) throw fail("Select a token, target doctor and referral reason.");
    const token = await Token.findById(tokenId);
    if (!token || !token.patient || id(token.assignedDoctor) !== req.user.id ||
        normalizeDepartment(token.department) !== req.user.department ||
        !["called", "completed"].includes(token.status)) {
      throw fail("Only the treating doctor can refer their called or completed encounter.", 403);
    }
    const target = await User.findOne({ _id: doctorId, role: "doctor" }).select("name department").lean();
    if (!target || id(target._id) === req.user.id ||
        normalizeDepartment(target.department) === normalizeDepartment(token.department)) {
      throw fail("Choose another department and a doctor registered in this clinic.");
    }
    const consultation = await Consultation.findOne({ token: token._id }).select("_id").lean();
    const referral = await DepartmentReferral.create({
      tenantId: req.tenantId, patient: token.patient, sourceToken: token._id,
      sourceConsultation: consultation?._id || null, fromDoctor: req.user.id,
      fromDepartment: token.department, toDoctor: target._id,
      toDepartment: target.department, reason,
      priority: req.body.priority === "urgent" ? "urgent" : "routine",
    });
    res.locals.auditDescriptor = { module: "Referral", action: "DOCTOR_REFERRAL_CREATED", summary: `Referral ${referral._id} created for ${token.department} to ${target.department}.` };
    res.status(201).json({ referral });
    emitPatientReferralUpdate(req.app.get("io"), referral.patient);
    try { await broadcast(req); } catch (error) { console.error("Referral broadcast failed:", safeDiagnostic(error)); }
  } catch (error) { handle(error, res); }
});

router.get("/", protect, requireRole("doctor", "receptionist", "admin"), async (req, res) => {
  const filter = {};
  if (req.user.role === "doctor") filter.$or = [{ fromDoctor: req.user.id }, { toDoctor: req.user.id }];
  if (req.query.status && ["pending", "accepted", "cancelled", "completed"].includes(req.query.status)) filter.status = req.query.status;
  const referrals = await populate(DepartmentReferral.find(filter).sort({ createdAt: -1 }).limit(100)).lean();
  // Keep private clinical details out of the reception and admin workspaces.
  for (const referral of referrals) {
    if (req.user.role !== "doctor") {
      delete referral.reason;
    } else if (id(referral.fromDoctor) !== req.user.id) {
      const target = referral.targetToken;
      if (!target || target.status !== "called" ||
          id(target.assignedDoctor) !== req.user.id) delete referral.reason;
    }
  }
  res.json({ referrals });
});

// Source doctor may cancel an unaccepted referral; accepted visits are not silently deleted.
router.post("/:id/cancel", protect, requireRole("doctor"), async (req, res) => {
  try {
    if (!validId(req.params.id)) throw fail("Invalid referral.");
    const referral = await DepartmentReferral.findOneAndUpdate(
      { _id: req.params.id, fromDoctor: req.user.id, status: "pending" },
      { $set: { status: "cancelled", cancelledAt: new Date() } }, { new: true });
    if (!referral) throw fail("Only your pending referral can be cancelled.", 409);
    res.locals.auditDescriptor = { module: "Referral", action: "DOCTOR_REFERRAL_CANCELLED", summary: `Referral ${referral._id} cancelled.` };
    res.json({ referral });
    emitPatientReferralUpdate(req.app.get("io"), referral.patient);
    try { await broadcast(req); } catch (error) { console.error("Referral broadcast failed:", safeDiagnostic(error)); }
  } catch (error) { handle(error, res); }
});

router.get("/:id/quote", protect, requireRole("receptionist"), async (req, res) => {
  try {
    if (!validId(req.params.id)) throw fail("Invalid referral.");
    const referral = await DepartmentReferral.findOne({ _id: req.params.id, status: "pending" });
    if (!referral) throw fail("Pending referral not found.", 404);
    const doctor = await User.findOne({ _id: referral.toDoctor, role: "doctor" })
      .select("department billingProfile").lean();
    if (!doctor || doctor.department !== referral.toDepartment) throw fail("Target doctor is unavailable.", 409);
    const quote = await quoteVisitFee({ doctor, tenant: req.tenant, department: referral.toDepartment,
      patientId: referral.patient, visitType: "consultation" });
    res.json({ quote });
  } catch (error) { handle(error, res); }
});

// Reception accepts a referral after confirming arrival and handling the fee.
// A separate target token preserves the original consultation and original token.
router.post("/:id/accept", protect, requireRole("receptionist"), async (req, res) => {
  try {
    if (!validId(req.params.id)) throw fail("Invalid referral.");
    const result = await databaseTransaction(async () => {
      const referral = await DepartmentReferral.findOne({ _id: req.params.id, status: "pending" });
      if (!referral) throw fail("Referral is no longer pending.", 409);
      assertQueueAcceptingArrivals(req.tenant);
      const doctor = await User.findOne({ _id: referral.toDoctor, role: "doctor" }).select("name department doctorSchedule billingProfile").lean();
      if (!doctor || normalizeDepartment(doctor.department) !== referral.toDepartment) throw fail("Target doctor is no longer assigned to this department.", 409);
      const availability = getDoctorAvailability(doctor);
      if (!availability.isAvailable) throw fail(availability.reason || "Target doctor is unavailable.", 409);
      const source = await Token.findById(referral.sourceToken);
      if (!source || id(source.patient) !== id(referral.patient) ||
          id(source.assignedDoctor) !== id(referral.fromDoctor)) throw fail("Referral source is no longer valid.", 409);
      if (source.status !== "completed") throw fail("Complete the source consultation before issuing the destination token.", 409);
      const quote = await quoteVisitFee({
        doctor, tenant: req.tenant, department: referral.toDepartment,
        patientId: referral.patient, visitType: "consultation",
      });
      const payment = preparePayment({
        quotedAmount: quote.amount,
        payment: {
          method: req.body.method,
          paidAmount: req.body.paidAmount,
          overrideReason: req.body.overrideReason,
          transactionReference: req.body.transactionReference,
        },
        tenant: req.tenant, actorId: req.user.id,
      });
      const existing = await Token.findOne({ patient: referral.patient, isArchived: false,
        status: { $in: ["waiting", "called"] } });
      if (existing) throw fail("Patient already has an active token. Complete the current visit before accepting the referral.", 409);
      const patient = await mongoose.model("Patient").findById(referral.patient).select("name patientId phone").lean();
      if (!patient) throw fail("Patient profile no longer exists.", 409);
      const targetToken = await createQueueToken({
        tenantId: req.tenantId, patient: patient._id, patientId: patient.patientId || source.patientId,
        patientName: patient.name || source.patientName, phone: patient.phone || source.phone || "",
        department: referral.toDepartment, assignedDoctor: doctor._id, referral: referral._id, queueSource: "walk_in",
        status: "waiting", arrivalStatus: "arrived", urgency: "normal",
      });
      await attachPaymentToToken(targetToken, payment, quote.feeType);

      referral.status = "accepted";
      referral.targetToken = targetToken._id;
      referral.acceptedBy = req.user.id;
      referral.acceptedAt = new Date();
      await referral.save();
      return { referral, token: targetToken };
    });
    res.locals.auditDescriptor = { module: "Referral", action: "RECEPTION_REFERRAL_ACCEPTED", summary: `Referral ${result.referral._id} accepted; target token #${result.token.tokenNumber} in ${result.token.department}.` };
    res.status(201).json({ referral: { _id: result.referral._id, status: result.referral.status,
      targetToken: result.token._id }, token: result.token });
    emitPatientReferralUpdate(req.app.get("io"), result.referral.patient);
    try { await broadcast(req, result.token); } catch (error) { console.error("Referral broadcast failed:", safeDiagnostic(error)); }
  } catch (error) { handle(error, res); }
});

// Receiving doctors can read referral details only after the patient is actively called
// to their workstation. The source doctor can review their own clinical referral.
router.get("/:id/clinical", protect, requireRole("doctor"), async (req, res) => {
  try {
    if (!validId(req.params.id)) throw fail("Invalid referral.");
    const referral = await DepartmentReferral.findById(req.params.id);
    if (!referral) throw fail("Referral not found.", 404);
    if (id(referral.fromDoctor) !== req.user.id) {
      const token = referral.targetToken && await Token.findById(referral.targetToken);
      if (id(referral.toDoctor) !== req.user.id || !token || token.status !== "called" ||
          id(token.assignedDoctor) !== req.user.id || token.isArchived) {
        throw fail("Clinical referral is available only to the actively treating doctor.", 403);
      }
    }
    const sourceConsultation = await Consultation.findOne({ token: referral.sourceToken })
          .select("symptoms diagnosis prescription medicines testsRecommended advice followUpDate createdAt")
          .lean();
    res.json({ referral, sourceConsultation });
  } catch (error) { handle(error, res); }
});

// Patient-owned referral summary; never accept a patient ID from the browser.
router.get("/patient/me", protectPatient, async (req, res) => {
  const referrals = await populate(DepartmentReferral.find({ patient: req.patient._id })
    .sort({ createdAt: -1 }).limit(50)).lean();
  res.json({ referrals });
});

export default router;
