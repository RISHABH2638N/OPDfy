import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { csvCell } from "../utils/httpSafety.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { newDisplayCredential, decryptDisplayKey } from "../utils/displayKeyCrypto.js";
import express from "express";
import User, { WEEK_DAYS } from "../models/User.js";
import Token from "../models/Token.js";
import Appointment from "../models/Appointment.js";
import Consultation from "../models/Consultation.js";
import bcrypt from "bcryptjs";
import { protect, requireRole } from "../middleware/auth.js";
import { DEPARTMENTS, normalizeDepartment } from "../utils/departments.js";
import { emitOperationalUpdate } from "../services/realtimeService.js";
import WaitingLoungeDisplay from "../models/WaitingLoungeDisplay.js";
import ActivityLog from "../models/ActivityLog.js";
import Tenant from "../models/Tenant.js";
import Feedback from "../models/Feedback.js";
import QueueReservation from "../models/QueueReservation.js";
import { getClinicOperations, getClinicOperationsSnapshot, hospitalLocalDateTime, validateClinicOperationsInput } from "../utils/clinicOperations.js";
import { cleanDoctorBillingProfile, getClinicBilling, validateClinicBillingInput } from "../utils/billing.js";
import { validateImageDataUrl, externalAssetUrlAllowed } from "../utils/imageValidation.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { cleanClinicLegalVerification, cleanDoctorProfessionalVerification, effectiveVerificationStatus } from "../utils/legalVerification.js";

const router = asyncRouter();
router.use(protect, requireRole("admin"));

router.get("/legal-verification", async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId).select("name legalVerification").lean();
  if (!tenant) return res.status(404).json({ message: "Clinic not found." });
  return res.json({ legalVerification: { ...(tenant.legalVerification || {}), status: effectiveVerificationStatus(tenant.legalVerification || {}) } });
});

router.put("/legal-verification", async (req, res) => {
  try {
    const clean = cleanClinicLegalVerification(req.body);
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    const at = new Date();
    const history = tenant.legalVerification?.events || [];
    if (history.length >= 50) return res.status(409).json({ message: "Verification history is full. Contact platform support before resubmitting." });
    tenant.legalVerification = { ...clean, status: "submitted", submittedAt: at, reviewedAt: null, reviewedBy: null, reviewNote: "", reviewEvidenceReference: "", events: [...history, { status: "submitted", at, actorType: "clinic_admin", actorId: String(req.user.id), note: "Clinic registration details submitted for platform review.", evidenceReference: clean.evidenceReference }] };
    await tenant.save();
    logSecurityEvent(req, { event: "clinic_legal_verification_submitted", outcome: "success", actorType: "staff", actorId: req.user.id, tenantId: tenant._id, metadata: { status: "submitted" } });
    return res.json({ message: "Clinic registration details submitted for platform review.", legalVerification: { ...tenant.legalVerification.toObject(), status: effectiveVerificationStatus(tenant.legalVerification) } });
  } catch (error) {
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to submit clinic registration details.") });
  }
});


const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;
const MAX_LOGO_VALUE_LENGTH = 220000;

function cleanBrandingInput(body = {}) {
  const cleanText = (value, max) => String(value || "").trim().slice(0, max);
  const displayName = cleanText(body.displayName, 120);
  const shortName = cleanText(body.shortName, 40);
  const address = cleanText(body.address, 240);
  const website = cleanText(body.website, 180);
  const contactEmail = cleanText(body.contactEmail, 160).toLowerCase();
  const contactPhone = cleanText(body.contactPhone, 40);
  const waitingLoungeWelcome = cleanText(body.waitingLoungeWelcome, 180);
  const footerText = cleanText(body.footerText, 240);
  const primaryColor = cleanText(body.primaryColor, 7) || "#0f766e";
  const accentColor = cleanText(body.accentColor, 7) || "#14b8a6";
  const logoUrl = String(body.logoUrl || "").trim();

  if (!HEX_COLOR_PATTERN.test(primaryColor) || !HEX_COLOR_PATTERN.test(accentColor)) {
    throw Object.assign(new Error("Brand colors must use 6-digit hex values such as #0f766e."), { status: 400 });
  }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw Object.assign(new Error("Enter a valid clinic contact email."), { status: 400 });
  }
  if (website && !HTTP_URL_PATTERN.test(website)) {
    throw Object.assign(new Error("Website must start with http:// or https://."), { status: 400 });
  }
  if (logoUrl.length > MAX_LOGO_VALUE_LENGTH) {
    throw Object.assign(new Error("Clinic logo is too large. Keep uploaded logo under about 150 KB."), { status: 400 });
  }
  if (logoUrl) {
    if (HTTP_URL_PATTERN.test(logoUrl)) {
      if (!externalAssetUrlAllowed(logoUrl)) {
        throw Object.assign(new Error("External clinic logo host is not allowed in production. Upload the logo or allow its host explicitly."), { status: 400 });
      }
    } else {
      const imageCheck = validateImageDataUrl(logoUrl, { maxBytes: 160000 });
      if (!imageCheck.ok) throw Object.assign(new Error(imageCheck.message), { status: 400 });
    }
  }

  return {
    displayName, shortName, logoUrl, address, website, contactEmail, contactPhone,
    primaryColor, accentColor, waitingLoungeWelcome, footerText,
  };
}

router.get("/clinic-branding", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId)
      .select("name slug contactEmail contactPhone settings")
      .lean();
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    const branding = tenant.settings?.branding || {};
    return res.json({
      clinic: {
        name: tenant.name,
        slug: tenant.slug,
        displayName: tenant.settings?.displayName || tenant.name,
        shortName: branding.shortName || "",
        logoUrl: branding.logoUrl || "",
        address: branding.address || "",
        website: branding.website || "",
        contactEmail: tenant.contactEmail || "",
        contactPhone: tenant.contactPhone || "",
        primaryColor: branding.primaryColor || "#0f766e",
        accentColor: branding.accentColor || "#14b8a6",
        waitingLoungeWelcome: branding.waitingLoungeWelcome || "Welcome. Please watch the screen for your token.",
        footerText: branding.footerText || "",
      },
    });
  } catch (error) {
    console.error("ADMIN CLINIC BRANDING GET:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load clinic branding." });
  }
});

router.put("/clinic-branding", async (req, res) => {
  try {
    const branding = cleanBrandingInput(req.body);
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });

    tenant.contactEmail = branding.contactEmail;
    tenant.contactPhone = branding.contactPhone;
    tenant.settings = tenant.settings || {};
    tenant.settings.displayName = branding.displayName;
    tenant.settings.branding = {
      shortName: branding.shortName,
      logoUrl: branding.logoUrl,
      address: branding.address,
      website: branding.website,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      waitingLoungeWelcome: branding.waitingLoungeWelcome,
      footerText: branding.footerText,
    };
    await tenant.save();

    return res.json({
      message: "Clinic branding saved.",
      clinic: {
        name: tenant.name,
        slug: tenant.slug,
        displayName: tenant.settings.displayName || tenant.name,
        ...(typeof tenant.settings.branding?.toObject === "function" ? tenant.settings.branding.toObject() : tenant.settings.branding),
        contactEmail: tenant.contactEmail || "",
        contactPhone: tenant.contactPhone || "",
      },
    });
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ message: error.message });
    }
    console.error("ADMIN CLINIC BRANDING SAVE:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to save clinic branding." });
  }
});


/* =========================================================
   OPD BILLING SETTINGS + DOCTOR FEES
========================================================= */
router.get("/billing-settings", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select("settings.billing").lean();
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    return res.json({ settings: getClinicBilling(tenant) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load OPD billing settings." });
  }
});

router.put("/billing-settings", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    tenant.settings = tenant.settings || {};
    tenant.settings.billing = validateClinicBillingInput(req.body);
    await tenant.save();
    emitOperationalUpdate(req.app.get("io"), ["settings", "billing", "staff"]);
    return res.json({ message: "OPD billing rules saved.", settings: getClinicBilling(tenant) });
  } catch (error) {
    return res.status(400).json({ message: publicErrorMessage(error, "Unable to save OPD billing settings.") });
  }
});

router.patch("/users/:id/billing-profile", async (req, res) => {
  try {
    const doctor = await User.findById(req.params.id);
    if (!doctor || doctor.role !== "doctor") return res.status(404).json({ message: "Doctor account not found." });
    doctor.billingProfile = cleanDoctorBillingProfile(req.body);
    await doctor.save();
    emitOperationalUpdate(req.app.get("io"), ["staff", "billing", "appointments", "reservations"]);
    return res.json({
      message: `Fee profile saved for Dr. ${doctor.name}.`,
      doctor: { _id: doctor._id, name: doctor.name, department: doctor.department, billingProfile: doctor.billingProfile },
    });
  } catch (error) {
    return res.status(400).json({ message: publicErrorMessage(error, "Unable to save doctor fee profile.") });
  }
});

router.get("/revenue", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select("timezone").lean();
    const today = hospitalLocalDateTime(tenant).date;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : today;
    if (from > to) return res.status(400).json({ message: "From date cannot be after To date." });
    if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 > 366) return res.status(400).json({ message: "Revenue range is limited to 1 year." });
    const department = String(req.query.department || "").trim();
    const doctorId = String(req.query.doctorId || "").trim();
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T23:59:59.999Z`);
    const filter = { "billing.status": { $in: ["paid", "waived", "refunded"] }, "billing.paidAt": { $gte: start, $lte: end } };
    if (department && DEPARTMENTS.includes(department)) filter.department = department;
    if (doctorId && /^[a-f\d]{24}$/i.test(doctorId)) filter.assignedDoctor = doctorId;

    const tokens = await Token.find(filter)
      .select("tokenNumber patientName department assignedDoctor queueSource billing createdAt")
      .populate({ path: "assignedDoctor", select: "name department" })
      .sort({ "billing.paidAt": -1 })
      .lean();
    const paid = tokens.filter((item) => item.billing?.status === "paid");
    const refunded = tokens.filter((item) => item.billing?.status === "refunded");
    const paidAmount = paid.reduce((sum, item) => sum + Number(item.billing?.paidAmount || 0), 0);
    const refundedAmount = refunded.reduce((sum, item) => sum + Number(item.billing?.paidAmount || 0), 0);
    const collected = paidAmount + refundedAmount;
    const methods = { cash: 0, upi: 0, card: 0, other: 0 };
    for (const item of paid) if (methods[item.billing?.method] !== undefined) methods[item.billing.method] += Number(item.billing?.paidAmount || 0);

    const pendingAppointmentFilter = { appointmentDate: { $gte: from, $lte: to }, status: "booked", "billing.status": "pending", "billing.quotedAmount": { $gt: 0 } };
    const pendingReservationFilter = { reservationDate: { $gte: from, $lte: to }, status: "reserved", "billing.status": "pending", "billing.quotedAmount": { $gt: 0 } };
    if (department && DEPARTMENTS.includes(department)) { pendingAppointmentFilter.department = department; pendingReservationFilter.department = department; }
    if (doctorId && /^[a-f\d]{24}$/i.test(doctorId)) { pendingAppointmentFilter.doctor = doctorId; pendingReservationFilter.doctor = doctorId; }
    const [pendingAppointments, pendingReservations] = await Promise.all([
      Appointment.find(pendingAppointmentFilter).select("billing.quotedAmount").lean(),
      QueueReservation.find(pendingReservationFilter).select("billing.quotedAmount").lean(),
    ]);
    const pendingItems = [...pendingAppointments, ...pendingReservations];
    const pendingAmount = pendingItems.reduce((sum, item) => sum + Number(item.billing?.quotedAmount || 0), 0);

    const byDoctorMap = new Map();
    const byDepartmentMap = new Map();
    for (const item of paid) {
      const doctorName = item.assignedDoctor?.name || "Unassigned";
      const doctorKey = String(item.assignedDoctor?._id || "unassigned");
      const d = byDoctorMap.get(doctorKey) || { doctorId: doctorKey, doctorName, department: item.department, patients: 0, revenue: 0 };
      d.patients += 1; d.revenue += Number(item.billing?.paidAmount || 0); byDoctorMap.set(doctorKey, d);
      const dep = byDepartmentMap.get(item.department) || { department: item.department, patients: 0, revenue: 0 };
      dep.patients += 1; dep.revenue += Number(item.billing?.paidAmount || 0); byDepartmentMap.set(item.department, dep);
    }
    return res.json({
      range: { from, to },
      summary: { collected, refunded: refundedAmount, net: paidAmount, pendingAmount, pendingCount: pendingItems.length, paidPatients: paid.length, waivedPatients: tokens.filter((item) => item.billing?.status === "waived").length, methods },
      byDoctor: [...byDoctorMap.values()].sort((a,b)=>b.revenue-a.revenue),
      byDepartment: [...byDepartmentMap.values()].sort((a,b)=>b.revenue-a.revenue),
      payments: tokens.slice(0, 250),
    });
  } catch (error) {
    console.error("ADMIN REVENUE:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load revenue analytics." });
  }
});

router.patch("/payments/:tokenId/refund", async (req, res) => {
  try {
    const token = await Token.findById(req.params.tokenId);
    if (!token) return res.status(404).json({ message: "Paid OPD visit not found." });
    if (token.billing?.status !== "paid") return res.status(409).json({ message: "Only a paid visit can be marked refunded." });
    const reason = String(req.body.reason || "").trim().slice(0, 240);
    if (!reason) return res.status(400).json({ message: "Refund reason is required." });
    token.billing.status = "refunded"; token.billing.refundedAt = new Date(); token.billing.refundReason = reason;
    await token.save();
    logSecurityEvent(req, { event: "payment_refund", outcome: "success", actorType: "staff", actorId: req.user.id, tenantId: req.tenantId, metadata: { tokenId: String(token._id) } });
    emitOperationalUpdate(req.app.get("io"), ["billing", "analytics"]);
    return res.json({ message: `Receipt ${token.billing.receiptNumber || ""} marked refunded.`, token });
  } catch (error) {
    return res.status(500).json({ message: "Unable to mark refund." });
  }
});

/* =========================================================
   CLINIC OPERATING HOURS + DAILY QUEUE LIFECYCLE
========================================================= */
router.get("/operations-settings", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select("timezone settings.operations").lean();
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    return res.json({ settings: getClinicOperations(tenant), status: getClinicOperationsSnapshot(tenant) });
  } catch (error) {
    console.error("ADMIN OPERATIONS SETTINGS GET:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load clinic operating settings." });
  }
});

router.put("/operations-settings", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    const current = getClinicOperations(tenant);
    const cleaned = validateClinicOperationsInput({ ...current, ...req.body });
    tenant.settings = tenant.settings || {};
    tenant.settings.operations = {
      ...cleaned,
      queueState: current.queueState,
      queueStateDate: current.queueStateDate,
      queueOpenedAt: current.queueOpenedAt,
      queueClosedAt: current.queueClosedAt,
      queueClosedReason: current.queueClosedReason,
    };
    await tenant.save();
    emitOperationalUpdate(req.app.get("io"), ["settings", "queue", "appointments"]);
    return res.json({
      message: "Clinic operating hours and booking rules saved.",
      settings: getClinicOperations(tenant),
      status: getClinicOperationsSnapshot(tenant),
    });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ message: error.message });
    return res.status(500).json({ message: "Unable to save clinic operating settings." });
  }
});

router.post("/queue-lifecycle/open", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    const local = hospitalLocalDateTime(tenant);
    tenant.settings = tenant.settings || {};
    const current = getClinicOperations(tenant);
    tenant.settings.operations = { ...current, queueState: "open", queueStateDate: local.date, queueOpenedAt: new Date(), queueClosedAt: null, queueClosedReason: "" };
    await tenant.save();
    emitOperationalUpdate(req.app.get("io"), ["queue", "appointments", "settings"]);
    return res.json({ message: "Today's OPD queue is open for new arrivals.", status: getClinicOperationsSnapshot(tenant) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to open today's queue." });
  }
});

router.post("/queue-lifecycle/close", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    const local = hospitalLocalDateTime(tenant);
    const current = getClinicOperations(tenant);
    const reason = String(req.body.reason || "Front desk closed for new arrivals.").trim().slice(0, 240);
    tenant.settings = tenant.settings || {};
    tenant.settings.operations = { ...current, queueState: "closed", queueStateDate: local.date, queueClosedAt: new Date(), queueClosedReason: reason };
    await tenant.save();
    emitOperationalUpdate(req.app.get("io"), ["queue", "appointments", "settings"]);
    return res.json({ message: "Today's OPD queue is closed for new arrivals. Existing consultations can continue.", status: getClinicOperationsSnapshot(tenant) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to close today's queue." });
  }
});


function sendCsv(res, filename, rows) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`);
}

router.get("/export", async (req, res) => {
  try {
    const type = String(req.query.type || "appointments");
    const tenant = await Tenant.findById(req.tenantId).select("timezone").lean();
    const today = hospitalLocalDateTime(tenant).date;
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fromDate || "")) ? String(req.query.fromDate) : today;
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.toDate || "")) ? String(req.query.toDate) : today;
    if (fromDate > toDate) return res.status(400).json({ message: "From date cannot be after To date." });
    const start = new Date(`${fromDate}T00:00:00.000Z`);
    const end = new Date(`${toDate}T23:59:59.999Z`);
    if ((end - start) / 86400000 > 366) return res.status(400).json({ message: "Export range is limited to 1 year." });

    if (type === "appointments") {
      const items = await Appointment.find({ appointmentDate: { $gte: fromDate, $lte: toDate } }).sort({ appointmentDate: 1, startTime: 1 }).lean();
      const rows = [["Date","Time","Patient ID","Patient","Phone","Department","Doctor","Source","Status","Cancellation reason","Reschedules"]];
      items.forEach((item) => rows.push([item.appointmentDate,item.startTime,item.patientId,item.patientName,item.phone,item.department,item.doctorName,item.bookingSource,item.status,item.cancellationReason || "",item.rescheduleCount || 0]));
      return sendCsv(res, `appointments-${fromDate}-to-${toDate}.csv`, rows);
    }

    const tokens = await Token.find({ createdAt: { $gte: start, $lte: end } })
      .populate({ path: "assignedDoctor", select: "name" })
      .sort({ createdAt: 1 }).lean();
    if (type === "patients") {
      const rows = [["Created","Patient ID","Patient","Phone","Token","Department","Doctor","Source","Urgency","Arrival","Status"]];
      tokens.forEach((item) => rows.push([item.createdAt?.toISOString?.() || item.createdAt,item.patientId,item.patientName,item.phone,item.tokenNumber,item.department,item.assignedDoctor?.name || "",item.queueSource,item.urgency,item.arrivalStatus,item.status]));
      return sendCsv(res, `patient-visits-${fromDate}-to-${toDate}.csv`, rows);
    }
    if (type === "doctor-performance") {
      const doctors = new Map();
      tokens.forEach((item) => {
        const key = String(item.assignedDoctor?._id || "unassigned");
        if (!doctors.has(key)) doctors.set(key, { name: item.assignedDoctor?.name || "Unassigned", total: 0, completed: 0, skipped: 0, emergency: 0 });
        const row = doctors.get(key); row.total += 1; if (item.status === "completed") row.completed += 1; if (item.status === "skipped") row.skipped += 1; if (item.urgency === "emergency") row.emergency += 1;
      });
      const rows = [["Doctor","Total visits","Completed","Skipped","Emergency","Completion rate"]];
      [...doctors.values()].forEach((item) => rows.push([item.name,item.total,item.completed,item.skipped,item.emergency,item.total ? `${Math.round(item.completed * 100 / item.total)}%` : "0%"]));
      return sendCsv(res, `doctor-performance-${fromDate}-to-${toDate}.csv`, rows);
    }
    if (type === "payments") {
      const paymentTokens = tokens.filter((item) => ["paid", "waived", "refunded"].includes(item.billing?.status));
      const rows = [["Paid at","Receipt","Patient ID","Patient","Token","Department","Doctor","Source","Method","Quoted amount","Paid amount","Discount","Status","Refund reason"]];
      paymentTokens.forEach((item) => rows.push([item.billing?.paidAt?.toISOString?.() || item.billing?.paidAt || "",item.billing?.receiptNumber || "",item.patientId,item.patientName,item.tokenNumber,item.department,item.assignedDoctor?.name || "",item.queueSource,item.billing?.method || "",item.billing?.quotedAmount || 0,item.billing?.paidAmount || 0,item.billing?.discountAmount || 0,item.billing?.status || "",item.billing?.refundReason || ""]));
      return sendCsv(res, `payments-${fromDate}-to-${toDate}.csv`, rows);
    }
    return res.status(400).json({ message: "Unknown export type." });
  } catch (error) {
    console.error("ADMIN CSV EXPORT:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to generate CSV export." });
  }
});


const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanScheduleInput(input = {}) {
  const rawDays = Array.isArray(input.workingDays) ? input.workingDays : [];
  const workingDays = WEEK_DAYS.filter((day) => rawDays.includes(day));

  const startTime = String(input.startTime || "").trim();
  const endTime = String(input.endTime || "").trim();
  const roomNumber = String(input.roomNumber || "").trim().slice(0, 50);

  const unavailableDates = [
    ...new Set(
      (Array.isArray(input.unavailableDates) ? input.unavailableDates : [])
        .map((value) => String(value || "").trim())
        .filter((value) => DATE_PATTERN.test(value))
    ),
  ].sort();

  if (!workingDays.length) {
    throw Object.assign(new Error("Select at least one working day."), { status: 400 });
  }

  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
    throw Object.assign(new Error("Start and end time must be valid HH:mm values."), { status: 400 });
  }

  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (endTotal <= startTotal) {
    throw Object.assign(new Error("End time must be later than start time."), { status: 400 });
  }

  return {
    workingDays,
    startTime,
    endTime,
    isOnBreak: Boolean(input.isOnBreak),
    roomNumber,
    unavailableDates,
  };
}



const DEFAULT_PRESCRIPTION_TEMPLATE = {
  title: "Prescription",
  headerNote: "",
  footerNote: "Please follow the treating physician's instructions.",
  watermarkText: "",
  showLogo: true,
  showClinicContact: true,
  showPatientId: true,
  showPatientAgeGender: true,
  showToken: true,
  showSymptoms: true,
  showDiagnosis: true,
  showTests: true,
  showAdvice: true,
  showFollowUp: true,
  showDoctorRegistration: true,
  showSignatureLine: true,
  watermarkEnabled: true,
};

function cleanPrescriptionTemplate(input = {}) {
  const cleanText = (value, max) => String(value || "").trim().slice(0, max);
  const bool = (key) => input[key] === undefined ? DEFAULT_PRESCRIPTION_TEMPLATE[key] : Boolean(input[key]);
  return {
    title: cleanText(input.title, 80) || "Prescription",
    headerNote: cleanText(input.headerNote, 180),
    footerNote: cleanText(input.footerNote, 240),
    watermarkText: cleanText(input.watermarkText, 60),
    showLogo: bool("showLogo"), showClinicContact: bool("showClinicContact"),
    showPatientId: bool("showPatientId"), showPatientAgeGender: bool("showPatientAgeGender"),
    showToken: bool("showToken"), showSymptoms: bool("showSymptoms"),
    showDiagnosis: bool("showDiagnosis"), showTests: bool("showTests"),
    showAdvice: bool("showAdvice"), showFollowUp: bool("showFollowUp"),
    showDoctorRegistration: bool("showDoctorRegistration"), showSignatureLine: bool("showSignatureLine"),
    watermarkEnabled: bool("watermarkEnabled"),
  };
}

router.get("/prescription-template", async (req, res) => {
  try {
    const [tenant, doctors] = await Promise.all([
      Tenant.findById(req.tenantId).select("name contactEmail contactPhone settings").lean(),
      User.find({ role: "doctor" }).select("name department prescriptionProfile professionalVerification").sort({ name: 1 }).lean(),
    ]);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    return res.json({
      template: { ...DEFAULT_PRESCRIPTION_TEMPLATE, ...(tenant.settings?.prescriptionTemplate || {}) },
      doctors,
    });
  } catch (error) {
    console.error("ADMIN PRESCRIPTION TEMPLATE GET:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load prescription template." });
  }
});

router.put("/prescription-template", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    tenant.settings = tenant.settings || {};
    tenant.settings.prescriptionTemplate = cleanPrescriptionTemplate(req.body);
    await tenant.save();
    emitOperationalUpdate(req.app.get("io"), ["settings"]);
    return res.json({ message: "Prescription template saved.", template: tenant.settings.prescriptionTemplate });
  } catch (error) {
    console.error("ADMIN PRESCRIPTION TEMPLATE SAVE:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to save prescription template." });
  }
});

router.patch("/users/:id/prescription-profile", async (req, res) => {
  try {
    const doctor = await User.findById(req.params.id);
    if (!doctor || doctor.role !== "doctor") return res.status(404).json({ message: "Doctor account not found." });
    const cleanText = (value, max) => String(value || "").trim().slice(0, max);
    const signatureDataUrl = String(req.body.signatureDataUrl || "").trim();
    const signatureCheck = validateImageDataUrl(signatureDataUrl, { maxBytes: 160000 });
    if (!signatureCheck.ok) {
      return res.status(400).json({ message: signatureCheck.message });
    }
    const oldProfile = doctor.prescriptionProfile?.toObject?.() || doctor.prescriptionProfile || {};
    doctor.prescriptionProfile = {
      qualification: cleanText(req.body.qualification, 120),
      specialization: cleanText(req.body.specialization, 120),
      registrationNumber: cleanText(req.body.registrationNumber, 80),
      designation: cleanText(req.body.designation, 120),
      signatureDataUrl,
    };
    const registrationChanged = oldProfile.qualification !== doctor.prescriptionProfile.qualification || oldProfile.registrationNumber !== doctor.prescriptionProfile.registrationNumber;
    if (registrationChanged && doctor.professionalVerification?.status === "clinic_reviewed") {
      doctor.professionalVerification.status = "submitted";
      doctor.professionalVerification.reviewedAt = null;
      doctor.professionalVerification.reviewedBy = null;
      doctor.professionalVerification.reviewNote = "Professional details changed; clinic review is required again.";
      doctor.professionalVerification.events = [
        ...(doctor.professionalVerification.events || []).slice(-49),
        { status: "submitted", at: new Date(), actorId: String(req.user.id), note: "Qualification or registration number changed; prior clinic review invalidated.", evidenceReference: doctor.professionalVerification.evidenceReference || "profile-change" },
      ];
    }
    await doctor.save();
    emitOperationalUpdate(req.app.get("io"), ["staff", "settings"]);
    return res.json({ message: `Prescription profile saved for Dr. ${doctor.name}.`, doctor: { _id: doctor._id, name: doctor.name, department: doctor.department, prescriptionProfile: doctor.prescriptionProfile, professionalVerification: { ...(doctor.professionalVerification?.toObject?.() || doctor.professionalVerification || {}), status: effectiveVerificationStatus(doctor.professionalVerification || {}) } } });
  } catch (error) {
    console.error("ADMIN DOCTOR PRESCRIPTION PROFILE:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to save doctor prescription profile." });
  }
});

router.patch("/users/:id/professional-verification", async (req, res) => {
  try {
    const doctor = await User.findById(req.params.id);
    if (!doctor || doctor.role !== "doctor") return res.status(404).json({ message: "Doctor account not found." });
    if (!doctor.prescriptionProfile?.qualification || !doctor.prescriptionProfile?.registrationNumber) {
      return res.status(409).json({ message: "Save the doctor's qualification and registration number before reviewing registration evidence." });
    }
    const clean = cleanDoctorProfessionalVerification(req.body);
    const decision = String(req.body.decision || "submitted");
    if (!["submitted", "clinic_reviewed", "rejected"].includes(decision)) return res.status(400).json({ message: "Invalid professional verification decision." });
    if (decision === "clinic_reviewed" && req.body.confirmed !== true) return res.status(400).json({ message: "Confirm that the clinic reviewed the original registration evidence." });
    const note = String(req.body.reviewNote || "").trim();
    if (["clinic_reviewed", "rejected"].includes(decision) && (note.length < 10 || note.length > 1000)) return res.status(400).json({ message: "Review note must be between 10 and 1000 characters." });
    const history = doctor.professionalVerification?.events || [];
    if (history.length >= 50) return res.status(409).json({ message: "Professional verification history is full. Preserve it before opening a continuation review." });
    const at = new Date();
    doctor.professionalVerification = {
      ...clean, status: decision, submittedAt: doctor.professionalVerification?.submittedAt || at,
      reviewedAt: decision === "submitted" ? null : at, reviewedBy: decision === "submitted" ? null : req.user.id,
      reviewNote: note, events: [...history, { status: decision, at, actorId: String(req.user.id), note: note || "Professional registration details submitted.", evidenceReference: clean.evidenceReference }],
    };
    await doctor.save();
    logSecurityEvent(req, { event: "doctor_professional_verification_reviewed", outcome: "success", actorType: "staff", actorId: req.user.id, tenantId: req.tenantId, metadata: { status: decision } });
    const professionalVerification = { ...doctor.professionalVerification.toObject(), status: effectiveVerificationStatus(doctor.professionalVerification) };
    emitOperationalUpdate(req.app.get("io"), ["staff", "settings", "appointments"]);
    return res.json({ message: decision === "clinic_reviewed" ? `Registration evidence marked as clinic reviewed for Dr. ${doctor.name}.` : decision === "rejected" ? `Registration evidence rejected for Dr. ${doctor.name}.` : `Registration details submitted for Dr. ${doctor.name}.`, doctor: { _id: doctor._id, professionalVerification } });
  } catch (error) {
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to review doctor registration.") });
  }
});

router.get("/activity-logs", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
    const filter = {};
    const role = String(req.query.role || "").trim();
    const moduleName = String(req.query.module || "").trim();
    const search = String(req.query.search || "").trim().slice(0, 80);

    if (["admin", "doctor", "receptionist"].includes(role)) filter.actorRole = role;
    if (moduleName) filter.module = moduleName;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { actorName: { $regex: escaped, $options: "i" } },
        { summary: { $regex: escaped, $options: "i" } },
        { action: { $regex: escaped, $options: "i" } },
      ];
    }

    const logs = await ActivityLog.find(filter)
      .select("actorName actorRole action module summary method route statusCode targetId createdAt")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const modules = [...new Set(logs.map((item) => item.module).filter(Boolean))].sort();
    return res.json({ logs, modules, retentionDays: Math.max(7, Number(process.env.AUDIT_LOG_RETENTION_DAYS || 90)) });
  } catch (error) {
    console.error("ADMIN ACTIVITY LOGS:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load activity logs." });
  }
});

router.get("/users", async (req, res) => {
  try {
    const users = await User.find()
      .select("-passwordHash")
      .sort({ role: 1, name: 1 })
      .lean();

    res.json(users);
  } catch (error) {
    console.error("ADMIN USERS:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to load staff roster." });
  }
});

router.post("/users", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role = "doctor",
      department = "General OPD",
    } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email and password are required." });
    }
    if (String(password).length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({
        message: "Staff password must be at least 12 characters and include letters and numbers.",
      });
    }

    const normalizedDepartment = normalizeDepartment(department);

    if (!["doctor", "admin", "receptionist"].includes(role)) {
      return res.status(400).json({ message: "Invalid staff role." });
    }

    if (role === "doctor" && !DEPARTMENTS.includes(normalizedDepartment)) {
      return res.status(400).json({
        message: `Invalid department. Choose one of: ${DEPARTMENTS.join(", ")}.`,
      });
    }

    const user = await User.create({
      tenantId: req.tenantId,
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      department: normalizedDepartment,
    });

    emitOperationalUpdate(req.app.get("io"), ["staff", "appointments", "analytics"]);

    res.status(201).json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      doctorSchedule: user.doctorSchedule,
      billingProfile: user.billingProfile,
    });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({
      message: error.code === 11000 ? "Email already exists." : "Unable to create staff account.",
    });
  }
});

/* =========================================================
   UPDATE DOCTOR SCHEDULE / AVAILABILITY
   PATCH /api/admin/users/:id/schedule
========================================================= */
router.patch("/users/:id/schedule", async (req, res) => {
  try {
    const doctor = await User.findById(req.params.id);

    if (!doctor) {
      return res.status(404).json({ message: "Doctor account not found." });
    }

    if (doctor.role !== "doctor") {
      return res.status(400).json({
        message: "Schedules can only be configured for doctor accounts.",
      });
    }

    let schedule;
    try {
      schedule = cleanScheduleInput(req.body);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    doctor.doctorSchedule = schedule;
    await doctor.save();
    emitOperationalUpdate(req.app.get("io"), ["staff", "appointments", "analytics"]);

    return res.json({
      message: `Schedule updated for Dr. ${doctor.name}.`,
      doctor: {
        _id: doctor._id,
        name: doctor.name,
        department: doctor.department,
        doctorSchedule: doctor.doctorSchedule,
      },
    });
  } catch (error) {
    console.error("UPDATE DOCTOR SCHEDULE:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to update doctor schedule." });
  }
});

router.delete("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "Staff account not found." });
    }

    if (!["doctor", "receptionist"].includes(user.role)) {
      return res.status(400).json({
        message: "Administrator accounts cannot be deleted from this roster.",
      });
    }

    if (user.role === "doctor") {
      const today = hospitalDateKey();

      const [activeQueueCount, pendingAppointmentCount] = await Promise.all([
        Token.countDocuments({
          assignedDoctor: user._id,
          isArchived: { $ne: true },
          status: { $in: ["waiting", "called"] },
        }),
        Appointment.countDocuments({
          doctor: user._id,
          appointmentDate: { $gte: today },
          status: { $in: ["booked", "checked_in"] },
        }),
      ]);

      if (activeQueueCount > 0 || pendingAppointmentCount > 0) {
        return res.status(409).json({
          message:
            "Doctor cannot be deleted while active queue patients or current/future appointments are assigned. Resolve or reassign them first.",
          activeQueueCount,
          pendingAppointmentCount,
        });
      }
    }

    await User.deleteOne({ _id: user._id });
    emitOperationalUpdate(req.app.get("io"), ["staff", "appointments", "analytics"]);

    res.json({ message: `${user.name} was deleted successfully.` });
  } catch (error) {
    console.error("DELETE STAFF:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to delete staff account." });
  }
});


const ANALYTICS_TIMEZONE = process.env.HOSPITAL_TIMEZONE || "Asia/Kolkata";

function hospitalDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeyDaysAgo(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return hospitalDateKey(date);
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return (endMs - startMs) / 60000;
}

function roundedAverage(values) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0 && value <= 360);
  if (!valid.length) return 0;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1));
}

/* =========================================================
   ADMIN ANALYTICS + DRILL-DOWN
   GET /api/admin/analytics

   Supports:
   - preset range: 1, 7, 30, 90, 180, 365 days
   - custom startDate/endDate (maximum 366 calendar days)
   - department drill-down
   - doctor drill-down (optionally inside a department)
========================================================= */
router.get("/analytics", async (req, res) => {
  try {
    const todayKey = hospitalDateKey();
    const validDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
    const presetDays = [1, 7, 30, 90, 180, 365];
    const requestedRange = Number(req.query.range || 7);
    let rangeDays = presetDays.includes(requestedRange) ? requestedRange : 7;
    let startKey = dateKeyDaysAgo(rangeDays - 1);
    let endKey = todayKey;

    if (validDateKey(req.query.startDate) && validDateKey(req.query.endDate)) {
      startKey = String(req.query.startDate);
      endKey = String(req.query.endDate);
      if (startKey > endKey) {
        return res.status(400).json({ message: "Analytics start date must be on or before the end date." });
      }
      if (endKey > todayKey) endKey = todayKey;
      const startDate = new Date(`${startKey}T00:00:00.000Z`);
      const endDate = new Date(`${endKey}T00:00:00.000Z`);
      rangeDays = Math.floor((endDate - startDate) / 86400000) + 1;
      if (!Number.isFinite(rangeDays) || rangeDays < 1 || rangeDays > 366) {
        return res.status(400).json({ message: "Custom analytics range can be up to 1 year." });
      }
    }

    const departmentFilter = String(req.query.department || "").trim();
    const doctorIdFilter = String(req.query.doctorId || "").trim();
    const selectedDoctor = doctorIdFilter
      ? await User.findOne({ _id: doctorIdFilter, role: "doctor" }).select("name department doctorSchedule").lean()
      : null;

    if (doctorIdFilter && !selectedDoctor) {
      return res.status(404).json({ message: "Selected doctor was not found in this clinic." });
    }
    if (selectedDoctor && departmentFilter && selectedDoctor.department !== departmentFilter) {
      return res.status(400).json({ message: "Selected doctor does not belong to the selected department." });
    }

    // Fetch a small UTC safety margin, then hospital-local date filtering below.
    const utcSafetyStart = new Date(`${startKey}T00:00:00.000Z`);
    utcSafetyStart.setUTCDate(utcSafetyStart.getUTCDate() - 2);
    const utcSafetyEnd = new Date(`${endKey}T23:59:59.999Z`);
    utcSafetyEnd.setUTCDate(utcSafetyEnd.getUTCDate() + 2);

    const [tokensRaw, appointmentsRaw, consultationsRaw, doctorsRaw, feedbackRaw, reservationsRaw] = await Promise.all([
      Token.find({ createdAt: { $gte: utcSafetyStart, $lte: utcSafetyEnd } })
        .select("department assignedDoctor queueSource status urgency arrivalStatus calledAt completedAt createdAt")
        .populate("assignedDoctor", "name department")
        .lean(),
      Appointment.find({ appointmentDate: { $gte: startKey, $lte: endKey } })
        .select("appointmentDate department doctor doctorName bookingSource status checkedInAt createdAt")
        .lean(),
      Consultation.find({ createdAt: { $gte: utcSafetyStart, $lte: utcSafetyEnd } })
        .select("doctor department createdAt")
        .populate("doctor", "name department")
        .lean(),
      User.find({ role: "doctor" }).select("name department doctorSchedule").lean(),
      Feedback.find({ createdAt: { $gte: utcSafetyStart, $lte: utcSafetyEnd } }).select("doctor department rating createdAt").lean(),
      QueueReservation.find({ reservationDate: { $gte: startKey, $lte: endKey } })
        .select("reservationDate department doctor status checkedInAt createdAt").lean(),
    ]);

    const doctorIdOf = (value) => value?._id ? String(value._id) : value ? String(value) : "";
    const matchesScope = (department, doctor) => {
      if (departmentFilter && String(department || "") !== departmentFilter) return false;
      if (doctorIdFilter && doctorIdOf(doctor) !== doctorIdFilter) return false;
      return true;
    };

    const tokens = tokensRaw.filter((token) => {
      const key = hospitalDateKey(token.createdAt);
      return key >= startKey && key <= endKey && matchesScope(token.department, token.assignedDoctor);
    });
    const appointments = appointmentsRaw.filter((item) => matchesScope(item.department, item.doctor));
    const consultations = consultationsRaw.filter((item) => {
      const key = hospitalDateKey(item.createdAt);
      return key >= startKey && key <= endKey && matchesScope(item.department, item.doctor);
    });
    const feedbackRows = feedbackRaw.filter((item) => {
      const key = hospitalDateKey(item.createdAt);
      return key >= startKey && key <= endKey && matchesScope(item.department, item.doctor);
    });
    const reservations = reservationsRaw.filter((item) => matchesScope(item.department, item.doctor));
    const doctors = doctorsRaw.filter((doctor) => {
      if (departmentFilter && doctor.department !== departmentFilter) return false;
      if (doctorIdFilter && String(doctor._id) !== doctorIdFilter) return false;
      return true;
    });

    const completedTokens = tokens.filter((token) => token.status === "completed");
    const skippedCount = tokens.filter((token) => token.status === "skipped").length;
    const waitDurations = tokens
      .map((token) => minutesBetween(token.createdAt, token.calledAt))
      .filter((value) => value !== null);
    const consultationDurations = completedTokens
      .map((token) => minutesBetween(token.calledAt, token.completedAt))
      .filter((value) => value !== null);

    const noShowCount = tokens.filter((token) => token.arrivalStatus === "no_show").length;
    const appointmentTokens = tokens.filter((token) => token.queueSource === "appointment").length;
    const onlineReservationTokens = tokens.filter((token) => token.queueSource === "reservation").length;
    const walkInTokens = tokens.filter((token) => token.queueSource === "walk_in").length;
    const emergencyCount = tokens.filter((token) => token.urgency === "emergency").length;

    const dailyMap = new Map();
    const cursor = new Date(`${startKey}T00:00:00.000Z`);
    const endDateCursor = new Date(`${endKey}T00:00:00.000Z`);
    while (cursor <= endDateCursor) {
      const key = cursor.toISOString().slice(0, 10);
      dailyMap.set(key, {
        date: key,
        patients: 0,
        completed: 0,
        skipped: 0,
        noShows: 0,
        appointments: 0,
        online: 0,
        walkIns: 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    tokens.forEach((token) => {
      const key = hospitalDateKey(token.createdAt);
      const row = dailyMap.get(key);
      if (!row) return;
      row.patients += 1;
      if (token.status === "completed") row.completed += 1;
      if (token.status === "skipped") row.skipped += 1;
      if (token.arrivalStatus === "no_show") row.noShows += 1;
      if (token.queueSource === "appointment") row.appointments += 1;
      else if (token.queueSource === "reservation") row.online += 1;
      else row.walkIns += 1;
    });

    const departmentMap = new Map();
    tokens.forEach((token) => {
      const department = token.department || "General OPD";
      const row = departmentMap.get(department) || {
        department,
        patients: 0,
        completed: 0,
        skipped: 0,
        noShows: 0,
        waiting: 0,
        appointments: 0,
        online: 0,
        walkIns: 0,
        waitMinutes: [],
        consultationMinutes: [],
      };
      row.patients += 1;
      if (token.status === "completed") row.completed += 1;
      if (token.status === "skipped") row.skipped += 1;
      if (token.arrivalStatus === "no_show") row.noShows += 1;
      if (token.status === "waiting") row.waiting += 1;
      if (token.queueSource === "appointment") row.appointments += 1;
      else if (token.queueSource === "reservation") row.online += 1;
      else row.walkIns += 1;
      const wait = minutesBetween(token.createdAt, token.calledAt);
      const consult = minutesBetween(token.calledAt, token.completedAt);
      if (wait !== null) row.waitMinutes.push(wait);
      if (consult !== null) row.consultationMinutes.push(consult);
      departmentMap.set(department, row);
    });

    const departments = [...departmentMap.values()]
      .map((row) => ({
        department: row.department,
        patients: row.patients,
        completed: row.completed,
        skipped: row.skipped,
        noShows: row.noShows,
        waiting: row.waiting,
        appointments: row.appointments,
        online: row.online,
        walkIns: row.walkIns,
        completionRate: row.patients ? Number(((row.completed / row.patients) * 100).toFixed(1)) : 0,
        averageWaitMinutes: roundedAverage(row.waitMinutes),
        averageConsultationMinutes: roundedAverage(row.consultationMinutes),
      }))
      .sort((a, b) => b.patients - a.patients);

    const doctorMap = new Map(
      doctors.map((doctor) => [
        String(doctor._id),
        {
          doctorId: String(doctor._id),
          doctorName: doctor.name,
          department: doctor.department,
          patients: 0,
          completed: 0,
          skipped: 0,
          noShows: 0,
          waiting: 0,
          called: 0,
          appointments: 0,
          online: 0,
          walkIns: 0,
          waitMinutes: [],
          consultationMinutes: [],
          consultationsRecorded: 0,
          isOnBreak: Boolean(doctor.doctorSchedule?.isOnBreak),
        },
      ])
    );

    tokens.forEach((token) => {
      const doctorId = doctorIdOf(token.assignedDoctor);
      if (!doctorId || !doctorMap.has(doctorId)) return;
      const row = doctorMap.get(doctorId);
      row.patients += 1;
      if (token.status === "completed") row.completed += 1;
      if (token.status === "skipped") row.skipped += 1;
      if (token.arrivalStatus === "no_show") row.noShows += 1;
      if (token.status === "waiting") row.waiting += 1;
      if (token.status === "called") row.called += 1;
      if (token.queueSource === "appointment") row.appointments += 1;
      else if (token.queueSource === "reservation") row.online += 1;
      else row.walkIns += 1;
      const wait = minutesBetween(token.createdAt, token.calledAt);
      const consult = minutesBetween(token.calledAt, token.completedAt);
      if (wait !== null) row.waitMinutes.push(wait);
      if (consult !== null) row.consultationMinutes.push(consult);
    });

    consultations.forEach((consultation) => {
      const doctorId = doctorIdOf(consultation.doctor);
      if (doctorMap.has(doctorId)) doctorMap.get(doctorId).consultationsRecorded += 1;
    });

    const doctorPerformance = [...doctorMap.values()]
      .map((row) => ({
        doctorId: row.doctorId,
        doctorName: row.doctorName,
        department: row.department,
        patients: row.patients,
        completed: row.completed,
        skipped: row.skipped,
        noShows: row.noShows,
        waiting: row.waiting,
        called: row.called,
        appointments: row.appointments,
        online: row.online,
        walkIns: row.walkIns,
        completionRate: row.patients ? Number(((row.completed / row.patients) * 100).toFixed(1)) : 0,
        noShowRate: row.patients ? Number(((row.noShows / row.patients) * 100).toFixed(1)) : 0,
        status: row.isOnBreak ? "break" : row.called > 0 ? "busy" : "available",
        consultationsRecorded: row.consultationsRecorded,
        averageWaitMinutes: roundedAverage(row.waitMinutes),
        averageConsultationMinutes: roundedAverage(row.consultationMinutes),
        isOnBreak: row.isOnBreak,
      }))
      .sort((a, b) => b.completed - a.completed || b.patients - a.patients);

    const appointmentStatus = {
      total: appointments.length,
      booked: appointments.filter((item) => item.status === "booked").length,
      checkedIn: appointments.filter((item) => item.status === "checked_in").length,
      completed: appointments.filter((item) => item.status === "completed").length,
      skipped: appointments.filter((item) => item.status === "skipped").length,
      missed: appointments.filter((item) => item.status === "missed").length,
      cancelled: appointments.filter((item) => item.status === "cancelled").length,
    };

    const averageRating = feedbackRows.length
      ? Number((feedbackRows.reduce((sum, item) => sum + Number(item.rating || 0), 0) / feedbackRows.length).toFixed(1))
      : 0;

    const reservationStats = {
      total: reservations.length,
      reserved: reservations.filter((item) => item.status === "reserved").length,
      checkedIn: reservations.filter((item) => item.status === "checked_in").length,
      cancelled: reservations.filter((item) => item.status === "cancelled").length,
      expired: reservations.filter((item) => item.status === "expired").length,
    };
    reservationStats.checkInRate = reservationStats.total
      ? Number(((reservationStats.checkedIn / reservationStats.total) * 100).toFixed(1))
      : 0;

    // Peak hour is calculated across the selected period, not only today.
    const hourlyMap = new Map(Array.from({ length: 24 }, (_, hour) => [hour, 0]));
    tokens.forEach((token) => {
      const hour = Number(new Intl.DateTimeFormat("en-US", {
        timeZone: ANALYTICS_TIMEZONE,
        hour: "2-digit",
        hour12: false,
      }).format(new Date(token.createdAt))) % 24;
      hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1);
    });
    const hourlyTrend = [...hourlyMap.entries()].map(([hour, patients]) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      patients,
    }));
    const peakHourRow = [...hourlyTrend].sort((a, b) => b.patients - a.patients)[0] || { label: "—", patients: 0 };

    const now = new Date();
    const waitingTokens = tokens.filter((token) => token.status === "waiting");
    const slaBreachCount = waitingTokens.filter((token) => (now.getTime() - new Date(token.createdAt).getTime()) / 60000 > 30).length;
    const emergencyWaiting = waitingTokens.filter((token) => token.urgency === "emergency").length;
    const overloadedDoctors = doctorPerformance.filter((doctor) => doctor.waiting >= 5).length;
    const busiestDepartment = departments[0] || null;
    const peakDay = [...dailyMap.values()].sort((a, b) => b.patients - a.patients)[0] || null;

    return res.json({
      rangeDays,
      period: { startDate: startKey, endDate: endKey, timezone: ANALYTICS_TIMEZONE },
      filters: {
        department: departmentFilter || "",
        doctorId: doctorIdFilter || "",
        doctorName: selectedDoctor?.name || "",
        scopeLabel: selectedDoctor
          ? `Dr. ${selectedDoctor.name}`
          : departmentFilter || "Whole Clinic",
      },
      overview: {
        totalPatients: tokens.length,
        completedPatients: completedTokens.length,
        skippedPatients: skippedCount,
        waitingPatients: tokens.filter((token) => token.status === "waiting").length,
        calledPatients: tokens.filter((token) => token.status === "called").length,
        noShowCount,
        noShowRate: tokens.length ? Number(((noShowCount / tokens.length) * 100).toFixed(1)) : 0,
        completionRate: tokens.length ? Number(((completedTokens.length / tokens.length) * 100).toFixed(1)) : 0,
        skipRate: tokens.length ? Number(((skippedCount / tokens.length) * 100).toFixed(1)) : 0,
        averageWaitMinutes: roundedAverage(waitDurations),
        averageConsultationMinutes: roundedAverage(consultationDurations),
        appointmentPatients: appointmentTokens,
        onlinePatients: onlineReservationTokens,
        walkInPatients: walkInTokens,
        emergencyPatients: emergencyCount,
        emergencyWaiting,
        activeDoctors: doctors.length,
        slaBreachCount,
        overloadedDoctors,
        averageRating,
        feedbackCount: feedbackRows.length,
      },
      appointmentStatus,
      reservationStats,
      hourlyTrend,
      dailyTrend: [...dailyMap.values()],
      departments,
      doctorPerformance,
      insights: {
        busiestDepartment: busiestDepartment?.department || (departmentFilter || "No data yet"),
        busiestDepartmentPatients: busiestDepartment?.patients || 0,
        peakDay: peakDay?.date || endKey,
        peakDayPatients: peakDay?.patients || 0,
        peakHour: peakHourRow.patients ? peakHourRow.label : "—",
        peakHourPatients: peakHourRow.patients,
      },
    });
  } catch (error) {
    console.error("ADMIN ANALYTICS:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load hospital analytics." });
  }
});

router.get("/daily", async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const tokens = await Token.find({
      createdAt: { $gte: start },
      isArchived: { $ne: true },
    }).sort({ tokenNumber: 1 });

    res.json(tokens);
  } catch (error) {
    res.status(500).json({ message: "Unable to load daily queue." });
  }
});


/* =========================================================
   ADMIN WAITING LOUNGE DISPLAY MANAGEMENT
   Each clinic can provision independent secure TV links.
========================================================= */

const DISPLAY_LANGUAGES = new Set(["en-IN", "hi-IN"]);

function normalizeDisplayVoice(input = {}) {
  const numericVolume = Number(input.volume);
  return {
    enabled: input.enabled !== false,
    language: DISPLAY_LANGUAGES.has(String(input.language || "")) ? String(input.language) : "en-IN",
    volume: Number.isFinite(numericVolume) ? Math.min(1, Math.max(0.2, numericVolume)) : 1,
  };
}

async function validateDisplayTarget({ department, doctorId }) {
  const normalizedDepartment = String(department || "All Departments").trim() || "All Departments";
  if (normalizedDepartment !== "All Departments" && !DEPARTMENTS.includes(normalizedDepartment)) {
    const error = new Error("Select a valid department for this display.");
    error.status = 400;
    throw error;
  }

  let doctor = null;
  if (doctorId) {
    doctor = await User.findOne({ _id: doctorId, role: "doctor" })
      .select("_id name department doctorSchedule")
      .lean();
    if (!doctor) {
      const error = new Error("Selected doctor was not found in this clinic.");
      error.status = 400;
      throw error;
    }
    if (normalizedDepartment !== "All Departments" && doctor.department !== normalizedDepartment) {
      const error = new Error("Selected doctor does not belong to the chosen department.");
      error.status = 400;
      throw error;
    }
  }

  return { normalizedDepartment, doctor };
}

function displayPayload(display, oneTimeKey = "") {
  const raw = display?.toObject ? display.toObject() : display;
  const resolvedKey = oneTimeKey || decryptDisplayKey(raw.accessKeyEncrypted) || raw.accessKey || "";
  return {
    _id: raw._id,
    name: raw.name,
    department: raw.department || "All Departments",
    doctor: raw.doctor || null,
    doctorId: raw.doctor?._id ? String(raw.doctor._id) : raw.doctor ? String(raw.doctor) : "",
    voice: raw.voice || { enabled: true, language: "en-IN", volume: 1 },
    isEnabled: raw.isEnabled !== false,
    accessKey: resolvedKey,
    displayPath: resolvedKey ? `/display/${resolvedKey}` : "",
    accessKeyExpiresAt: raw.accessKeyExpiresAt || null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

router.get("/waiting-lounge-displays", async (req, res) => {
  try {
    const displays = await WaitingLoungeDisplay.find()
      .select("+accessKey +accessKeyEncrypted")
      .populate({ path: "doctor", select: "name department doctorSchedule" })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ displays: displays.map(displayPayload) });
  } catch (error) {
    console.error("ADMIN WAITING LOUNGE DISPLAYS:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load waiting lounge displays." });
  }
});

router.post("/waiting-lounge-displays", async (req, res) => {
  try {
    const name = String(req.body.name || "Waiting Lounge TV").trim().slice(0, 80) || "Waiting Lounge TV";
    const { normalizedDepartment, doctor } = await validateDisplayTarget({
      department: req.body.department,
      doctorId: req.body.doctorId,
    });

    const credential = newDisplayCredential(Number(process.env.DISPLAY_KEY_TTL_DAYS || 90));
    const display = await WaitingLoungeDisplay.create({
      tenantId: req.tenantId,
      name,
      accessKeyHash: credential.accessKeyHash,
      accessKeyEncrypted: credential.accessKeyEncrypted,
      accessKeyExpiresAt: credential.accessKeyExpiresAt,
      department: normalizedDepartment,
      doctor: doctor?._id || null,
      voice: normalizeDisplayVoice(req.body.voice),
      isEnabled: req.body.isEnabled !== false,
      lastConfiguredAt: new Date(),
    });

    const withKey = await WaitingLoungeDisplay.findById(display._id)
      .select("+accessKey +accessKeyEncrypted")
      .populate({ path: "doctor", select: "name department doctorSchedule" });
    return res.status(201).json({
      message: "Secure waiting lounge display created.",
      display: displayPayload(withKey),
    });
  } catch (error) {
    console.error("CREATE WAITING LOUNGE DISPLAY:", safeDiagnostic(error));
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to create display.") });
  }
});

router.patch("/waiting-lounge-displays/:id", async (req, res) => {
  try {
    const existing = await WaitingLoungeDisplay.findById(req.params.id).select("+accessKey +accessKeyEncrypted");
    if (!existing) return res.status(404).json({ message: "Waiting lounge display not found." });

    const { normalizedDepartment, doctor } = await validateDisplayTarget({
      department: req.body.department ?? existing.department,
      doctorId: req.body.doctorId === undefined ? existing.doctor : req.body.doctorId,
    });

    existing.name = String(req.body.name ?? existing.name).trim().slice(0, 80) || existing.name;
    existing.department = normalizedDepartment;
    existing.doctor = doctor?._id || null;
    existing.voice = normalizeDisplayVoice(req.body.voice ?? existing.voice);
    if (typeof req.body.isEnabled === "boolean") existing.isEnabled = req.body.isEnabled;
    existing.lastConfiguredAt = new Date();
    await existing.save();

    await existing.populate({ path: "doctor", select: "name department doctorSchedule" });
    return res.json({ message: "Waiting lounge display updated.", display: displayPayload(existing) });
  } catch (error) {
    console.error("UPDATE WAITING LOUNGE DISPLAY:", safeDiagnostic(error));
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to update display.") });
  }
});

router.post("/waiting-lounge-displays/:id/rotate-key", async (req, res) => {
  try {
    const display = await WaitingLoungeDisplay.findById(req.params.id).select("+accessKey +accessKeyEncrypted");
    if (!display) return res.status(404).json({ message: "Waiting lounge display not found." });
    const credential = newDisplayCredential(Number(process.env.DISPLAY_KEY_TTL_DAYS || 90));
    display.accessKey = undefined;
    display.accessKeyHash = credential.accessKeyHash;
    display.accessKeyEncrypted = credential.accessKeyEncrypted;
    display.accessKeyExpiresAt = credential.accessKeyExpiresAt;
    display.lastConfiguredAt = new Date();
    await display.save();
    await display.populate({ path: "doctor", select: "name department doctorSchedule" });
    return res.json({
      message: "Display link regenerated. The previous TV link no longer works.",
      display: displayPayload(display, credential.accessKey),
    });
  } catch (error) {
    console.error("ROTATE WAITING LOUNGE DISPLAY KEY:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to regenerate display link." });
  }
});

router.delete("/waiting-lounge-displays/:id", async (req, res) => {
  try {
    const display = await WaitingLoungeDisplay.findById(req.params.id);
    if (!display) return res.status(404).json({ message: "Waiting lounge display not found." });
    await WaitingLoungeDisplay.deleteOne({ _id: display._id });
    return res.json({ message: "Waiting lounge display removed." });
  } catch (error) {
    console.error("DELETE WAITING LOUNGE DISPLAY:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to remove display." });
  }
});

export default router;
