import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import PrivacyIncident from "../models/PrivacyIncident.js";
import IncidentAffectedPatient from "../models/IncidentAffectedPatient.js";
import IncidentNotificationDelivery from "../models/IncidentNotificationDelivery.js";
import IncidentEvidenceSnapshot from "../models/IncidentEvidenceSnapshot.js";
import PrivacyNotificationRecord from "../models/PrivacyNotificationRecord.js";
import SecurityEvent from "../models/SecurityEvent.js";
import Notification from "../models/Notification.js";
import Patient from "../models/Patient.js";
import Tenant from "../models/Tenant.js";
import SuperAdmin from "../models/SuperAdmin.js";
import { runWithTenant } from "./tenantExecutionContext.js";
import { sendEmail, sendPatientNotificationEmail } from "../utils/sendEmail.js";
import { safeDiagnostic } from "../utils/privacySafeLog.js";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, min, max, label) => {
  const output = String(value || "").trim();
  if (output.length < min || output.length > max) throw fail(`${label} must contain ${min} to ${max} characters.`);
  return output;
};
const hoursBySeverity = { low: 24, medium: 12, high: 6, critical: 6 };
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const htmlEscape = value => String(value || "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character]));

export async function verifyPlatformPassword(ownerId, password) {
  if (!password) throw fail("Fresh platform password is required.", 403);
  const owner = await SuperAdmin.findOne({ _id: ownerId, status: "active" }).select("+passwordHash");
  if (!owner || !(await bcrypt.compare(String(password), owner.passwordHash))) throw fail("Platform step-up verification failed.", 403);
}

export async function sendSecurityAlert(incident) {
  const contact = String(process.env.SECURITY_ALERT_EMAIL || "").trim().toLowerCase();
  const attemptedAt = new Date();
  if (!contact) {
    await PrivacyIncident.updateOne({ _id: incident._id }, { $set: { "securityAlert.status": "not_configured", "securityAlert.lastAttemptAt": attemptedAt }, $inc: { "securityAlert.attempts": 1 } });
    return { status: "not_configured" };
  }
  const clinics = incident.tenantIds?.length || 0;
  try {
    const info = await sendEmail({
      to: contact,
      subject: `[${String(incident.severity).toUpperCase()}] OPDfy security incident ${incident._id}`,
      text: `Incident: ${incident.title}\nSeverity: ${incident.severity}\nDetected: ${incident.detectedAt.toISOString()}\nAffected clinics: ${clinics}\nEstimated affected patients: ${incident.estimatedAffectedCount ?? "under assessment"}\nOpen the protected platform console to investigate. Do not reply with patient or credential data.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px"><h2>OPDfy security alert</h2><p><strong>Severity:</strong> ${htmlEscape(String(incident.severity).toUpperCase())}</p><p><strong>Incident:</strong> ${htmlEscape(incident.title)}</p><p><strong>Detected:</strong> ${htmlEscape(incident.detectedAt.toISOString())}</p><p><strong>Affected clinics:</strong> ${clinics}</p><p><strong>Estimated affected patients:</strong> ${incident.estimatedAffectedCount ?? "Under assessment"}</p><p>Open the protected platform console to investigate. Do not send patient or credential data by email.</p></div>`,
    });
    await PrivacyIncident.updateOne({ _id: incident._id }, { $set: { "securityAlert.status": "sent", "securityAlert.sentAt": new Date(), "securityAlert.lastAttemptAt": attemptedAt, "securityAlert.messageId": String(info?.messageId || "").slice(0, 240) }, $inc: { "securityAlert.attempts": 1 }, $push: { events: { kind: "alerted", note: "Platform security contact alert sent.", actorType: "system", at: new Date() } } });
    return { status: "sent" };
  } catch (error) {
    await PrivacyIncident.updateOne({ _id: incident._id }, { $set: { "securityAlert.status": "failed", "securityAlert.lastAttemptAt": attemptedAt }, $inc: { "securityAlert.attempts": 1 } });
    console.warn("Incident security alert failed:", safeDiagnostic(error));
    return { status: "failed" };
  }
}

export async function createAutomaticIncident({ title, description, severity, tenantIds = [], fingerprint, eventId }) {
  const existing = await PrivacyIncident.findOne({ detectionFingerprint: fingerprint, status: { $ne: "closed" } });
  if (existing) return existing;
  const detectedAt = new Date();
  try {
    const incident = await PrivacyIncident.create({ title, description, category: "security_event", severity, source: "automatic", detectionFingerprint: fingerprint,
      tenantIds: tenantIds.filter(Boolean), detectedAt, responseDueAt: new Date(detectedAt.getTime() + hoursBySeverity[severity] * 3600000),
      events: [{ kind: "detected", note: `Automatic detection rule triggered. Security event reference: ${eventId}.`, evidenceReference: String(eventId || ""), actorType: "system" }] });
    void sendSecurityAlert(incident);
    return incident;
  } catch (error) {
    if (error?.code === 11000) return PrivacyIncident.findOne({ detectionFingerprint: fingerprint, status: { $ne: "closed" } });
    throw error;
  }
}

export async function evaluateSecurityEvent(event) {
  if (!event?._id || event.event === "incident_detection") return;
  const now = new Date();
  const tenant = event.tenantId ? String(event.tenantId) : "platform";
  let rule = null;
  if (["bulk_data_export", "audit_tamper_attempt"].includes(event.event) && event.outcome !== "failure") {
    rule = { key: event.event, severity: "critical", title: "Critical data-access activity detected", description: "A bulk export or evidence-tampering security event requires immediate investigation." };
  } else if (["staff_login", "platform_login", "patient_otp_login"].includes(event.event) && event.outcome === "failure") {
    const from = new Date(now.getTime() - 15 * 60000);
    const count = await SecurityEvent.countDocuments({ event: event.event, outcome: "failure", ip: event.ip, ...(event.tenantId ? { tenantId: event.tenantId } : {}), createdAt: { $gte: from } });
    if (count >= 5) rule = { key: `${event.event}:failed-login:${hash(`${tenant}:${event.ip}:${Math.floor(now.getTime() / 900000)}`)}`, severity: event.event === "platform_login" ? "high" : "medium", title: "Repeated suspicious login attempts", description: `The platform detected ${count} failed ${event.event.replaceAll("_", " ")} attempts from one network within 15 minutes.` };
  } else if (event.event === "authorization_denied" && event.outcome === "blocked") {
    const from = new Date(now.getTime() - 10 * 60000);
    const count = await SecurityEvent.countDocuments({ event: "authorization_denied", outcome: "blocked", actorId: event.actorId, tenantId: event.tenantId, createdAt: { $gte: from } });
    if (count >= 5) rule = { key: `authorization:${hash(`${tenant}:${event.actorId}:${Math.floor(now.getTime() / 600000)}`)}`, severity: "high", title: "Repeated unauthorized access attempts", description: `${count} blocked authorization attempts were detected within 10 minutes.` };
  } else if (event.event === "patient_data_access" && event.outcome === "success" && event.actorId) {
    const from = new Date(now.getTime() - 10 * 60000);
    const count = await SecurityEvent.countDocuments({ event: "patient_data_access", outcome: "success", actorId: event.actorId, tenantId: event.tenantId, createdAt: { $gte: from } });
    if (count >= Number(process.env.INCIDENT_PATIENT_ACCESS_THRESHOLD || 80)) rule = { key: `patient-access:${hash(`${tenant}:${event.actorId}:${Math.floor(now.getTime() / 600000)}`)}`, severity: "high", title: "Unusually high patient-record access", description: `${count} patient-data requests by one staff identity were observed within 10 minutes.` };
  }
  if (!rule) return;
  await createAutomaticIncident({ ...rule, fingerprint: hash(rule.key), tenantIds: event.tenantId ? [event.tenantId] : [], eventId: event._id });
}

export async function lockIncidentEvidence(incidentId, ownerId, input) {
  await verifyPlatformPassword(ownerId, input?.password);
  const reason = clean(input?.reason, 20, 500, "Preservation reason");
  const incident = await PrivacyIncident.findById(incidentId);
  if (!incident) throw fail("Incident not found.", 404);
  if (incident.evidenceLock?.locked) throw fail("Evidence is already preserved.", 409);
  const to = new Date();
  const from = new Date(incident.detectedAt.getTime() - 60 * 60000);
  const events = await SecurityEvent.find({ createdAt: { $gte: from, $lte: to }, tenantId: incident.tenantIds.length ? { $in: incident.tenantIds } : null })
    .select("tenantId actorType actorId event outcome ip route metadata createdAt").sort({ createdAt: 1 }).limit(10000).lean();
  const payload = events.map(item => ({ ...item, _id: String(item._id), tenantId: item.tenantId ? String(item.tenantId) : null }));
  const sha256 = hash(JSON.stringify(payload));
  const snapshot = await IncidentEvidenceSnapshot.create({ incident: incident._id, capturedAt: to, capturedBy: ownerId, range: { from, to }, eventCount: payload.length, payload, sha256, reason });
  incident.evidenceLock = { locked: true, lockedAt: to, lockedBy: ownerId, snapshot: snapshot._id, manifestHash: sha256, reason };
  incident.events.push({ kind: "evidence_locked", note: `Immutable evidence snapshot preserved with ${payload.length} security events.`, evidenceReference: sha256, actor: ownerId, actorType: "superadmin" });
  await incident.save();
  return { lockedAt: to, eventCount: payload.length, sha256 };
}

export async function addAffectedPatients(incidentId, ownerId, input) {
  const incident = await PrivacyIncident.findById(incidentId);
  if (!incident || incident.status === "closed") throw fail("Open incident not found.", 404);
  const tenantId = String(input?.tenantId || "");
  if (!incident.tenantIds.some(id => String(id) === tenantId)) throw fail("Select a clinic already marked as affected by this incident.", 403);
  const patientIds = [...new Set((input?.patientIds || []).map(String))];
  if (!patientIds.length || patientIds.length > 500 || patientIds.some(id => !/^[a-f\d]{24}$/i.test(id))) throw fail("Provide 1 to 500 valid clinic patient IDs.");
  const patients = await runWithTenant(tenantId, () => Patient.find({ _id: { $in: patientIds } }).select("_id").lean());
  if (patients.length !== patientIds.length) throw fail("One or more patient IDs do not belong to the selected clinic.", 403);
  const evidenceReference = clean(input?.evidenceReference, 5, 240, "Evidence reference");
  await IncidentAffectedPatient.bulkWrite(patients.map(patient => ({ updateOne: { filter: { incident: incident._id, tenantId, patientId: patient._id }, update: { $setOnInsert: { addedBy: ownerId, evidenceReference } }, upsert: true } })));
  const count = await IncidentAffectedPatient.countDocuments({ incident: incident._id });
  await PrivacyIncident.updateOne({ _id: incident._id }, { $set: { confirmedAffectedCount: count } });
  return { confirmedAffectedCount: count };
}

export async function updatePatientNoticeTemplate(incidentId, ownerId, input) {
  await verifyPlatformPassword(ownerId, input?.password);
  const template = { subjectEn: clean(input?.subjectEn, 10, 180, "English subject"), messageEn: clean(input?.messageEn, 40, 4000, "English notice"), subjectHi: clean(input?.subjectHi, 10, 180, "Hindi subject"), messageHi: clean(input?.messageHi, 40, 4000, "Hindi notice") };
  const incident = await PrivacyIncident.findOneAndUpdate({ _id: incidentId, status: { $ne: "closed" } }, { $set: { patientNoticeTemplate: template } }, { new: true, runValidators: true });
  if (!incident) throw fail("Open incident not found.", 404);
  return incident.patientNoticeTemplate;
}

export async function sendAffectedPatientNotices(incidentId, ownerId, input, io) {
  await verifyPlatformPassword(ownerId, input?.password);
  const incident = await PrivacyIncident.findById(incidentId);
  if (!incident || incident.status === "closed") throw fail("Open incident not found.", 404);
  const audience = await PrivacyNotificationRecord.findOne({ incident: incident._id, audience: "affected_individuals", status: { $in: ["required", "failed"] } });
  if (!audience) throw fail("Complete the affected-individual legal assessment before sending.", 409);
  const links = await IncidentAffectedPatient.find({ incident: incident._id }).limit(5000).lean();
  if (!links.length) throw fail("Add confirmed affected patients before sending notifications.", 409);
  let sent = 0, failed = 0, skipped = 0;
  for (const link of links) {
    const existing = await IncidentNotificationDelivery.findOne({ incident: incident._id, affectedPatient: link._id });
    if (existing?.inApp?.status === "delivered" && ["sent", "delivered", "skipped"].includes(existing?.email?.status)) { skipped++; continue; }
    const attemptedAt = new Date();
    const patient = await runWithTenant(link.tenantId, () => Patient.findById(link.patientId).select("_id email name privacyContactDisabled").lean());
    if (!patient) { failed++; continue; }
    const language = input?.language === "hi" ? "hi" : "en";
    const title = language === "hi" ? incident.patientNoticeTemplate.subjectHi : incident.patientNoticeTemplate.subjectEn;
    const message = language === "hi" ? incident.patientNoticeTemplate.messageHi : incident.patientNoticeTemplate.messageEn;
    let inAppStatus = "failed", emailStatus = patient.email ? "pending" : "skipped", providerReference = "", failureCode = "";
    try {
      const note = await runWithTenant(link.tenantId, () => Notification.create({ tenantId: link.tenantId, patient: patient._id, type: "security_incident", title, message, metadata: { incidentId: String(incident._id), severity: incident.severity }, dedupeKey: `security-incident:${incident._id}:${patient._id}` }));
      inAppStatus = "delivered"; io?.to(`patient:${patient._id}`).emit("patient:notification", note.toObject());
    } catch (error) { if (error?.code === 11000) inAppStatus = "delivered"; else failureCode = safeDiagnostic(error); }
    if (patient.email) {
      try { const info = await sendPatientNotificationEmail(patient.email, title, message); emailStatus = "sent"; providerReference = String(info?.messageId || "").slice(0, 240); }
      catch (error) { emailStatus = "failed"; failureCode = safeDiagnostic(error); }
    }
    await IncidentNotificationDelivery.findOneAndUpdate({ incident: incident._id, affectedPatient: link._id }, { $set: { tenantId: link.tenantId, patientId: patient._id, language, inApp: { status: inAppStatus, attemptedAt, deliveredAt: inAppStatus === "delivered" ? attemptedAt : null, failureCode }, email: { status: emailStatus, attemptedAt, deliveredAt: null, providerReference, failureCode }, lastAttemptAt: attemptedAt }, $inc: { attempts: 1 } }, { upsert: true, new: true, runValidators: true });
    if (inAppStatus === "delivered" && ["sent", "skipped"].includes(emailStatus)) sent++; else failed++;
  }
  return { total: links.length, sent, failed, skipped };
}

export async function incidentResponseSummary(incidentId) {
  const [incident, affected, deliveries] = await Promise.all([
    PrivacyIncident.findById(incidentId).populate("tenantIds", "name slug").lean(),
    IncidentAffectedPatient.countDocuments({ incident: incidentId }),
    IncidentNotificationDelivery.aggregate([{ $match: { incident: new mongoose.Types.ObjectId(incidentId) } }, { $group: { _id: null, total: { $sum: 1 }, inAppDelivered: { $sum: { $cond: [{ $eq: ["$inApp.status", "delivered"] }, 1, 0] } }, emailSent: { $sum: { $cond: [{ $in: ["$email.status", ["sent", "delivered"]] }, 1, 0] } }, failed: { $sum: { $cond: [{ $or: [{ $eq: ["$inApp.status", "failed"] }, { $eq: ["$email.status", "failed"] }] }, 1, 0] } } } }]),
  ]);
  if (!incident) throw fail("Incident not found.", 404);
  return { incident, affectedPatientCount: affected, delivery: deliveries[0] || { total: 0, inAppDelivered: 0, emailSent: 0, failed: 0 }, countdownMs: incident.responseDueAt ? new Date(incident.responseDueAt).getTime() - Date.now() : null };
}

export async function requestIncidentClosure(incidentId, ownerId, input) {
  await verifyPlatformPassword(ownerId, input?.password);
  const note = clean(input?.note, 20, 2000, "Closure request note");
  const incident = await PrivacyIncident.findOne({ _id: incidentId, status: { $ne: "closed" } });
  if (!incident) throw fail("Open incident not found.", 404);
  if (!incident.evidenceLock?.locked) throw fail("Preserve incident evidence before requesting closure.", 409);
  const notices = await PrivacyNotificationRecord.find({ incident: incident._id, audience: { $in: ["board", "affected_individuals"] } }).lean();
  const complete = ["board", "affected_individuals"].every(a => notices.some(n => n.audience === a && ["not_required", "delivered"].includes(n.status)));
  if (["suspected_data_breach", "confirmed_data_breach"].includes(incident.category) && !complete) throw fail("Complete Board and affected-individual notification decisions before closure.", 409);
  incident.closure = { requestedBy: ownerId, requestedAt: new Date(), requestNote: note, approvedBy: null, approvedAt: null, approvalNote: "", evidenceReference: "" };
  incident.events.push({ kind: "closure_requested", note, actor: ownerId, actorType: "superadmin" });
  await incident.save(); return incident.closure;
}

export async function approveIncidentClosure(incidentId, ownerId, input) {
  await verifyPlatformPassword(ownerId, input?.password);
  const note = clean(input?.note, 20, 2000, "Closure approval note");
  const evidenceReference = clean(input?.evidenceReference, 5, 240, "Closure evidence reference");
  const incident = await PrivacyIncident.findOne({ _id: incidentId, status: { $ne: "closed" } });
  if (!incident?.closure?.requestedBy) throw fail("A closure request is required first.", 409);
  if (String(incident.closure.requestedBy) === String(ownerId)) throw fail("A different active platform administrator must approve closure.", 403);
  incident.closure.approvedBy = ownerId; incident.closure.approvedAt = new Date(); incident.closure.approvalNote = note; incident.closure.evidenceReference = evidenceReference;
  incident.status = "closed";
  incident.events.push({ kind: "closure_approved", note, evidenceReference, actor: ownerId, actorType: "superadmin" });
  incident.events.push({ kind: "closed", note: "Incident closed after independent platform approval.", evidenceReference, actor: ownerId, actorType: "superadmin" });
  await incident.save(); return { status: incident.status, closure: incident.closure };
}

export async function certInPackage(incidentId) {
  const summary = await incidentResponseSummary(incidentId);
  const snapshots = summary.incident.evidenceLock?.snapshot ? await IncidentEvidenceSnapshot.findById(summary.incident.evidenceLock.snapshot).select("capturedAt eventCount sha256 range reason payload").lean() : null;
  const notices = await PrivacyNotificationRecord.find({ incident: incidentId }).select("audience status dueAt deliveredAt evidenceReference legalBasis note reviewedAt").lean();
  const generatedAt = new Date();
  const payload = { packageFormat: "opd-cert-in-incident-package-v1", generatedAt, submissionStatus: "DRAFT_REQUIRES_AUTHORISED_REVIEW", incident: { id: summary.incident._id, title: summary.incident.title, category: summary.incident.category, severity: summary.incident.severity, detectedAt: summary.incident.detectedAt, responseDueAt: summary.incident.responseDueAt, status: summary.incident.status, description: summary.incident.description, affectedClinics: summary.incident.tenantIds.map(t => ({ id: t._id, name: t.name, slug: t.slug })), estimatedAffectedCount: summary.incident.estimatedAffectedCount, confirmedAffectedCount: summary.affectedPatientCount, timeline: summary.incident.events }, evidenceManifest: snapshots, notificationRecords: notices, deliverySummary: summary.delivery, guidance: "Review scope and applicability, attach relevant technical artefacts, then submit through the authorised CERT-In channel. This package is not an automatic statutory filing." };
  return { payload, sha256: hash(JSON.stringify(payload)) };
}

export const incidentFailure = fail;
