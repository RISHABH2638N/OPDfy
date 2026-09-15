import mongoose from "mongoose";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protect, requireRole } from "../middleware/auth.js";
import ClinicalConsent from "../models/ClinicalConsent.js";
import Patient from "../models/Patient.js";
import User from "../models/User.js";
import { appendConsentEvent, cleanConsentRequest, effectiveConsentStatus } from "../utils/clinicalConsent.js";
import { createPatientNotification } from "../services/notificationService.js";
import { logSecurityEvent } from "../utils/securityEvents.js";

const router = asyncRouter();
router.use(protect, requireRole("admin", "doctor", "receptionist"));

const safeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function staffView(consent) {
  const value = typeof consent.toObject === "function" ? consent.toObject() : consent;
  return { ...value, effectiveStatus: effectiveConsentStatus(value) };
}

router.get("/patients", async (req, res) => {
  const search = String(req.query.q || "").trim().slice(0, 80);
  const query = search ? { $or: [
    { name: { $regex: safeRegex(search), $options: "i" } },
    { patientId: { $regex: safeRegex(search), $options: "i" } },
    { email: { $regex: safeRegex(search), $options: "i" } },
    { phone: { $regex: safeRegex(search), $options: "i" } },
  ] } : {};
  const patients = await Patient.find(query).select("_id patientId name").sort({ updatedAt: -1 }).limit(25).lean();
  return res.json({ patients });
});

router.get("/", async (req, res) => {
  const query = {};
  if (req.query.patientId) {
    if (!mongoose.isValidObjectId(req.query.patientId)) return res.status(400).json({ message: "Invalid patient identifier." });
    query.patient = req.query.patientId;
  }
  const allowedStatuses = ["pending", "patient_acknowledged", "active", "declined", "withdrawn", "cancelled"];
  if (req.query.status && allowedStatuses.includes(String(req.query.status))) query.status = req.query.status;
  const consents = await ClinicalConsent.find(query)
    .populate("patient", "name patientId")
    .populate("doctor", "name department prescriptionProfile.qualification prescriptionProfile.designation")
    .populate("requestedBy", "name role")
    .populate("staffReview.reviewedBy", "name role")
    .sort({ createdAt: -1 }).limit(100).lean();
  return res.json({ consents: consents.map(staffView) });
});

router.post("/", requireRole("admin", "doctor"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.body.patientId)) return res.status(400).json({ message: "Choose a valid patient." });
    const patient = await Patient.findById(req.body.patientId).select("_id name").lean();
    if (!patient) return res.status(404).json({ message: "Patient not found in this clinic." });
    const clean = cleanConsentRequest(req.body);
    let doctorId = req.user.role === "doctor" ? req.user.id : null;
    if (req.user.role === "admin" && req.body.doctorId) {
      if (!mongoose.isValidObjectId(req.body.doctorId)) return res.status(400).json({ message: "Invalid doctor." });
      const doctor = await User.findOne({ _id: req.body.doctorId, role: "doctor" }).select("_id").lean();
      if (!doctor) return res.status(404).json({ message: "Doctor not found in this clinic." });
      doctorId = doctor._id;
    }
    const at = new Date();
    const consent = await ClinicalConsent.create({
      tenantId: req.tenantId, patient: patient._id, requestedBy: req.user.id, doctor: doctorId,
      ...clean, noticeVersion: "clinical-consent-v1", status: "pending",
      events: [{ action: "requested", actorType: "staff", actorId: req.user.id, actorRole: req.user.role, note: "Consent request issued to patient.", at }],
    });
    await createPatientNotification({
      patientId: patient._id, type: "clinical_consent_requested", title: "Consent review requested",
      message: `${req.user.name} requested your review of “${clean.title}”. Open Treatment Consent in your clinic portal.`,
      metadata: { consentId: consent._id, category: clean.category }, dedupeKey: `clinical-consent:${consent._id}:requested`, io: req.app.get("io"),
    });
    logSecurityEvent(req, { event: "clinical_consent_requested", outcome: "success", actorType: "staff", actorId: req.user.id, tenantId: req.tenantId, metadata: { category: clean.category } });
    const populated = await ClinicalConsent.findById(consent._id).populate("patient", "name patientId").populate("doctor", "name department").populate("requestedBy", "name role").lean();
    return res.status(201).json({ message: "Consent request sent to the patient.", consent: staffView(populated) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to create consent request.") });
  }
});

router.patch("/:id/review", requireRole("admin", "doctor"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid consent identifier." });
    const consent = await ClinicalConsent.findById(req.params.id);
    if (!consent) return res.status(404).json({ message: "Consent request not found." });
    if (effectiveConsentStatus(consent) === "expired") return res.status(409).json({ message: "This consent request has expired." });
    if (consent.patientDecision?.actorType !== "guardian" || consent.status !== "patient_acknowledged") return res.status(409).json({ message: "Only a pending guardian acknowledgement requires authority review." });
    if (req.body.guardianAuthorityChecked !== true || req.body.questionsAnswered !== true) return res.status(400).json({ message: "Confirm guardian authority and that questions were answered." });
    const note = String(req.body.note || "").trim();
    if (note.length < 10 || note.length > 1000) return res.status(400).json({ message: "Witness note must be between 10 and 1000 characters." });
    consent.staffReview = { reviewedBy: req.user.id, reviewedAt: new Date(), guardianAuthorityChecked: true, questionsAnswered: true, note };
    consent.status = "active";
    appendConsentEvent(consent, { action: "guardian_reviewed", actorType: "staff", actorId: req.user.id, actorRole: req.user.role, note });
    await consent.save();
    await createPatientNotification({ patientId: consent.patient, type: "clinical_consent_activated", title: "Consent review completed", message: `Your acknowledgement for “${consent.title}” was reviewed by clinic staff.`, metadata: { consentId: consent._id }, dedupeKey: `clinical-consent:${consent._id}:guardian-reviewed`, io: req.app.get("io") });
    logSecurityEvent(req, { event: "clinical_consent_guardian_reviewed", outcome: "success", actorType: "staff", actorId: req.user.id, tenantId: req.tenantId });
    return res.json({ message: "Guardian acknowledgement reviewed and activated.", consent: staffView(consent) });
  } catch (error) { return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to review consent.") }); }
});

router.patch("/:id/cancel", requireRole("admin", "doctor"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid consent identifier." });
    const consent = await ClinicalConsent.findById(req.params.id);
    if (!consent) return res.status(404).json({ message: "Consent request not found." });
    if (!["pending", "patient_acknowledged"].includes(consent.status)) return res.status(409).json({ message: "This consent can no longer be cancelled." });
    const reason = String(req.body.reason || "").trim();
    if (reason.length < 5 || reason.length > 500) return res.status(400).json({ message: "Cancellation reason must be between 5 and 500 characters." });
    consent.status = "cancelled";
    appendConsentEvent(consent, { action: "cancelled", actorType: "staff", actorId: req.user.id, actorRole: req.user.role, note: reason });
    await consent.save();
    await createPatientNotification({ patientId: consent.patient, type: "clinical_consent_cancelled", title: "Consent request cancelled", message: `The clinic cancelled “${consent.title}”.`, metadata: { consentId: consent._id }, dedupeKey: `clinical-consent:${consent._id}:cancelled`, io: req.app.get("io") });
    return res.json({ message: "Consent request cancelled.", consent: staffView(consent) });
  } catch (error) { return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to cancel consent.") }); }
});

export default router;
