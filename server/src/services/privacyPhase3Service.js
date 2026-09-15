import crypto from "node:crypto";
import mongoose from "mongoose";
import GlobalPatient from "../models/GlobalPatient.js";
import PrivacyGuardianCase from "../models/PrivacyGuardianCase.js";
import PrivacyRequest from "../models/PrivacyRequest.js";
import PrivacyCorrectionReview from "../models/PrivacyCorrectionReview.js";
import PrivacyRetentionPolicy from "../models/PrivacyRetentionPolicy.js";
import PrivacyIncident from "../models/PrivacyIncident.js";
import { notificationReadiness } from "./privacyPhase4Service.js";
import Patient from "../models/Patient.js";
import SuperAdmin from "../models/SuperAdmin.js";
import bcrypt from "bcryptjs";
import { sendEmail } from "../utils/sendEmail.js";
import { consumePrivacyChallenge } from "./privacyRequestService.js";
import { runWithTenant } from "./tenantExecutionContext.js";

export const privacyFailure = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, min, max, label) => {
 if (typeof value !== "string" || value.trim().length < min || value.length > max) throw privacyFailure(`${label} must contain ${min} to ${max} characters.`);
 return value.trim();
};
const validId = value => mongoose.isValidObjectId(value);
const email = value => {
 const v = String(value || "").trim().toLowerCase();
 if (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw privacyFailure("Enter a valid guardian email.");
 return v;
};
const hashCode = (patient, nonce, code) => crypto.createHmac("sha256", process.env.JWT_SECRET).update(`guardian:${patient}:${nonce}:${code}`).digest("hex");
const safeGuardian = value => ({ id: value._id, guardianName: value.guardianName, guardianEmail: value.guardianEmail, relationship: value.relationship, status: value.status, emailVerifiedAt: value.emailVerifiedAt, reviewedAt: value.reviewedAt, reviewNote: value.reviewNote || "" });
const isMinor = dob => {
 if (!dob) return false;
 const birth = new Date(dob), now = new Date();
 if (Number.isNaN(birth.getTime()) || birth > now) return false;
 let age = now.getUTCFullYear() - birth.getUTCFullYear();
 if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--;
 return age < 18;
};

// Email possession is not parental authority. This workflow records two separate checks.
export async function requestGuardianVerification(patient, input) {
 if (!isMinor(patient.dateOfBirth)) throw privacyFailure("Guardian verification is available for a recorded minor. Contact support if the date of birth needs correction.", 409);
 const guardianEmail = email(input?.guardianEmail);
 if (guardianEmail === patient.email) throw privacyFailure("Use the guardian's own email address.");
 const guardianName = text(input?.guardianName, 2, 120, "Guardian name");
 if (!["parent", "legal_guardian", "other"].includes(input?.relationship)) throw privacyFailure("Select a valid relationship.");
 const existing = await PrivacyGuardianCase.findOne({ patient: patient._id, guardianEmail });
 if (existing && !["rejected", "revoked"].includes(existing.status) && !(existing.status === "pending_email" && existing.verification?.expiresAt <= new Date())) throw privacyFailure("This guardian verification is already in progress or approved.", 409);
 const nonce = crypto.randomBytes(16).toString("hex");
 const code = crypto.randomInt(100000, 1000000).toString();
 const expiresAt = new Date(Date.now() + 300000);
 const verification = { hash: hashCode(patient._id, nonce, code), nonce, expiresAt, attempts: 0 };
 let created;
 if (existing) {
  created = await PrivacyGuardianCase.findOneAndUpdate({ _id: existing._id, status: { $in: ["rejected", "revoked", "pending_email"] }, ...(existing.status === "pending_email" ? { "verification.expiresAt": { $lte: new Date() } } : {}) }, { $set: { guardianName, relationship: input.relationship, status: "pending_email", verification, emailVerifiedAt: null, tenantId: null, evidenceReference: "", reviewNote: "", reviewedBy: null, reviewedAt: null } }, { new: true, runValidators: true });
 } else {
  try { [created] = await PrivacyGuardianCase.create([{ patient: patient._id, guardianEmail, guardianName, relationship: input.relationship, verification }]); } catch (error) { if (error.code === 11000) throw privacyFailure("A guardian verification already exists. Refresh and try again.",409); throw error; }
 }
 if (!created) throw privacyFailure("Guardian verification changed. Refresh and try again.", 409);
 try {
  await sendEmail({ to: guardianEmail, subject: "OPDfy guardian email verification", text: `A guardian verification was requested for a minor's account. Your code is ${code}. It expires in five minutes. If you did not expect this, ignore this email. Email verification alone does not grant access to a patient's records.`, html: `<p>A guardian verification was requested for a minor's account.</p><p>Your verification code is <strong>${code}</strong>. It expires in five minutes.</p><p>Email verification alone does not grant access to medical records. If you did not request this, ignore this email.</p>` });
 } catch (err) {
  await PrivacyGuardianCase.updateOne({ _id: created._id, status: "pending_email", "verification.nonce": nonce }, { $unset: { verification: 1 }, $set: { status: "rejected", reviewNote: "Email delivery could not be completed. Request verification again." } });
  throw err;
 }
 return { id: created._id, expiresIn: 300, message: "Verification code sent to the guardian's email. No clinical access has been granted." };
}
export async function confirmGuardianEmail(patient, id, code) {
 if (!validId(id) || !/^\d{6}$/.test(String(code || ""))) throw privacyFailure("Invalid verification request or code.");
 const record = await PrivacyGuardianCase.findOneAndUpdate({ _id: id, patient: patient._id, status: "pending_email", "verification.expiresAt": { $gt: new Date() }, "verification.attempts": { $lt: 5 } }, { $inc: { "verification.attempts": 1 } }, { new: true }).select("+verification.hash +verification.nonce");
 if (!record?.verification?.hash || !record.verification.nonce) throw privacyFailure("Code expired or attempt limit reached.", 409);
 const supplied = Buffer.from(hashCode(patient._id, record.verification.nonce, String(code)), "hex");
 const expected = Buffer.from(record.verification.hash, "hex");
 if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw privacyFailure("Incorrect verification code.", 401);
 const updated = await PrivacyGuardianCase.findOneAndUpdate({ _id: id, patient: patient._id, status: "pending_email", "verification.hash": record.verification.hash, "verification.expiresAt": { $gt: new Date() } }, { $set: { status: "awaiting_clinic_review", emailVerifiedAt: new Date() }, $unset: { verification: 1 } }, { new: true });
 if (!updated) throw privacyFailure("Verification was already consumed or expired.", 409);
 return safeGuardian(updated);
}
export async function reviewGuardian({ id, tenantId, reviewerId, decision, evidenceReference, reviewNote }) {
 if (!validId(id) || !validId(tenantId) || !validId(reviewerId)) throw privacyFailure("Invalid review identifiers.");
 if (!["verified", "rejected"].includes(decision)) throw privacyFailure("Select a valid review decision.");
 const evidence = text(evidenceReference, 5, 240, "Evidence reference");
 const note = text(reviewNote, 20, 1200, "Review note");
 const record = await PrivacyGuardianCase.findOne({ _id: id, status: "awaiting_clinic_review" }).lean();
 if (!record?.emailVerifiedAt) throw privacyFailure("A verified guardian email is required before clinic review.", 409);
 const linked = await runWithTenant(tenantId, () => Patient.exists({ globalPatientId: record.patient, "identityLink.method": { $in: ["verified_global_registration", "clinic_verified_claim"] } }));
 if (!linked) throw privacyFailure("This patient is not linked to your clinic.", 403);
 const updated = await PrivacyGuardianCase.findOneAndUpdate({ _id: id, status: "awaiting_clinic_review" }, { $set: { status: decision, tenantId, reviewedBy: reviewerId, reviewedAt: new Date(), evidenceReference: evidence, reviewNote: note } }, { new: true, runValidators: true });
 if (!updated) throw privacyFailure("This case has already been reviewed.", 409);
 return safeGuardian(updated);
}
export async function revokeGuardian(patient, id) {
 if (!validId(id)) throw privacyFailure("Invalid guardian case ID.");
 const updated = await PrivacyGuardianCase.findOneAndUpdate({ _id: id, patient: patient._id, status: { $in: ["pending_email", "awaiting_clinic_review", "verified"] } }, { $set: { status: "revoked", reviewedAt: new Date() }, $unset: { verification: 1 } }, { new: true });
 if (!updated) throw privacyFailure("Guardian case unavailable or already closed.", 409);
 return safeGuardian(updated);
}
export const guardianPublic = safeGuardian;

export function validateCorrection(input) {
 const scope = input?.scope;
 if (!["global_profile", "clinic_record"].includes(scope)) throw privacyFailure("Choose the record scope.");
 const field = text(input?.field, 2, 100, "Field");
 if (!/^[a-zA-Z][a-zA-Z0-9.]*$/.test(field)) throw privacyFailure("Invalid field name.");
 const allowedGlobal = ["name", "phone", "dateOfBirth", "gender", "bloodGroup", "allergies", "medicalHistory", "currentMedications", "pastSurgeries", "emergencyContact.name", "emergencyContact.phone"];
 if (scope === "global_profile" && !allowedGlobal.includes(field)) throw privacyFailure("This field requires an assisted correction review.");
 const recordId = scope === "clinic_record" ? text(input?.recordId, 1, 80, "Record reference") : "";
 const clinicSlug = scope === "clinic_record" ? text(input?.clinicSlug, 1, 80, "Clinic slug").toLowerCase() : "";
 if (clinicSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clinicSlug)) throw privacyFailure("Invalid clinic slug.");
 return { scope, field, recordId, clinicSlug, proposedValue: text(input?.proposedValue, 1, 1000, "Requested correction"), reason: text(input?.reason, 10, 1000, "Correction reason") };
}
export async function submitStructuredCorrection(patient, input) {
 const correction = validateCorrection(input);
 const details = `Correction request for ${correction.scope}: ${correction.field}. ${correction.reason}`;
 try { return await consumePrivacyChallenge(patient, "correction", input?.otp, async session => {
  const [request] = await PrivacyRequest.create([{ patient: patient._id, type: "correction", clinicSlug: correction.clinicSlug, details, correction, verifiedAt: new Date() }], { session });
  return request;
 }); } catch (error) { if (error.code === 11000) throw privacyFailure("An open correction request already exists. Review it before submitting another.",409); throw error; }
}
export async function resolveCorrection({ requestId, patientId, tenantId = null, reviewerId, role, decision, evidenceReference, resolution }) {
 if (!["corrected", "no_change", "rejected"].includes(decision)) throw privacyFailure("Invalid correction decision.");
 const evidence = text(evidenceReference, 5, 240, "Evidence reference");
 const note = text(resolution, 20, 2000, "Resolution");
 if (!validId(requestId)) throw privacyFailure("Invalid request ID.");
 return mongoose.connection.transaction(async session => {
  const request = await PrivacyRequest.findOne({ _id: requestId, patient: patientId, type: "correction", status: { $in: ["pending", "in_review"] } }).session(session);
  if (!request) throw privacyFailure("Open correction request not found.", 409);
  if (tenantId) {
   if (request.correction?.scope !== "clinic_record") throw privacyFailure("This correction belongs to the global account.", 403);
   const linked = await runWithTenant(tenantId, () => Patient.exists({ globalPatientId: patientId, "identityLink.method": { $in: ["verified_global_registration", "clinic_verified_claim"] } }));
   if (!linked) throw privacyFailure("The patient is not linked to your clinic.", 403);
   const tenant = await mongoose.connection.db.collection("tenants").findOne({ _id: new mongoose.Types.ObjectId(tenantId) }, { session, projection: { slug: 1 } });
   if (!tenant || tenant.slug !== request.correction?.clinicSlug) throw privacyFailure("This correction belongs to another clinic.", 403);
  } else if (request.correction?.scope !== "global_profile") throw privacyFailure("This correction requires an assisted scope review before resolution.", 409);
  const [review] = await PrivacyCorrectionReview.create([{ request: request._id, patient: patientId, tenantId, decision, evidenceReference: evidence, resolution: note, reviewedBy: reviewerId, reviewedByRole: role }], { session });
  request.status = decision === "rejected" ? "rejected" : "fulfilled";
  request.resolution = note;
  request.reviewedAt = new Date();
  request.reviewedBy = role === "superadmin" ? reviewerId : undefined;
  request.execution = { kind: "correction_review", completedAt: new Date() };
  await request.save({ session });
  return review;
 });
}

export function validateRetentionPolicy(input) {
 if (!["platform", "clinic"].includes(input?.scope)) throw privacyFailure("Invalid policy scope.");
 const tenantId = input.scope === "clinic" ? input.tenantId : null;
 if (tenantId && !validId(tenantId)) throw privacyFailure("Invalid clinic ID.");
 if (input.scope === "clinic" && !tenantId) throw privacyFailure("A clinic scope requires a clinic ID.");
 const category = text(input.category, 3, 100, "Data category");
 const version = text(input.version, 3, 80, "Policy version");
 if (!/^[a-zA-Z0-9._-]+$/.test(version)) throw privacyFailure("Invalid policy version.");
 return { scope: input.scope, tenantId, category, version, legalBasis: text(input.legalBasis, 20, 2000, "Legal basis"), retentionRule: text(input.retentionRule, 20, 2000, "Retention rule"), trigger: text(input.trigger, 5, 500, "Retention trigger"), backupRule: text(input.backupRule, 10, 1000, "Backup rule"), evidenceReference: text(input.evidenceReference, 5, 240, "Evidence reference") };
}
export async function approveRetentionPolicy(id, ownerId, password) {
 if (!validId(id) || typeof password !== "string" || !password) throw privacyFailure("Fresh platform password is required.");
 const owner = await SuperAdmin.findOne({ _id: ownerId, status: "active" }).select("+passwordHash");
 if (!owner || !(await bcrypt.compare(password, owner.passwordHash))) throw privacyFailure("Platform step-up verification failed.", 403);
 const updated = await PrivacyRetentionPolicy.findOneAndUpdate({ _id: id, status: "draft" }, { $set: { status: "approved", approvedBy: ownerId, approvedAt: new Date() } }, { new: true });
 if (!updated) throw privacyFailure("Draft policy unavailable or already approved.", 409);
 return updated;
}
export function validateIncident(input) {
 if (!["suspected_data_breach", "confirmed_data_breach", "security_event", "privacy_complaint"].includes(input?.category)) throw privacyFailure("Invalid incident category.");
 const detectedAt = new Date(input.detectedAt);
 if (Number.isNaN(detectedAt.getTime()) || detectedAt > new Date()) throw privacyFailure("Invalid detection time.");
 const tenantIds = input.tenantIds || [];
 if (!Array.isArray(tenantIds) || tenantIds.length > 25 || tenantIds.some(id => !validId(id))) throw privacyFailure("Invalid affected-clinic selection.");
 const count = input.estimatedAffectedCount == null ? null : Number(input.estimatedAffectedCount);
 if (count !== null && (!Number.isSafeInteger(count) || count < 0 || count > 1000000000)) throw privacyFailure("Invalid affected-person estimate.");
 const severity = ["low", "medium", "high", "critical"].includes(input?.severity) ? input.severity : "medium";
 const responseHours = Number(input?.responseHours ?? ({ low:24, medium:12, high:6, critical:6 }[severity]));
 if (!Number.isSafeInteger(responseHours) || responseHours < 1 || responseHours > 168) throw privacyFailure("Response countdown must be between 1 and 168 hours.");
 return { title: text(input.title, 5, 180, "Incident title"), description: text(input.description, 20, 2000, "Incident description"), category: input.category, severity, detectedAt, responseDueAt: new Date(detectedAt.getTime() + responseHours * 3600000), tenantIds, estimatedAffectedCount: count };
}
export async function appendIncidentEvent({ id, actorId, kind, note, evidenceReference, notificationDecision }) {
 if (!validId(id) || !["triage", "containment", "notification_review", "notification_recorded", "reopened"].includes(kind)) throw privacyFailure("Invalid incident action. Use the independent closure approval workflow to close an incident.");
 const value = text(note, 20, 2000, "Incident note");
 const evidence = evidenceReference ? text(evidenceReference, 5, 240, "Evidence reference") : "";
 if (["notification_review", "notification_recorded"].includes(kind) && !evidence) throw privacyFailure("A documented legal review or notification reference is required.");
 if (kind === "notification_review" && !["required", "not_required"].includes(notificationDecision)) throw privacyFailure("Record the responsible reviewer's notification decision.");
 return mongoose.connection.transaction(async session => {
  const incident = await PrivacyIncident.findById(id).session(session);
  if (!incident) throw privacyFailure("Incident not found.",404);
  if (incident.events.length >= 500) throw privacyFailure("Incident history reached its safe document limit. Preserve it and open a linked continuation case.",409);
  if (kind === "reopened" ? incident.status !== "closed" : incident.status === "closed") throw privacyFailure("Incident transition is not allowed.",409);
  if (kind === "notification_recorded") throw privacyFailure("Record actual notification delivery in the separate audience-specific notification register.",409);
  if (kind === "notification_recorded" && incident.notificationDecision !== "required") throw privacyFailure("A documented notification-required decision is needed first.",409);
  if (kind === "notification_review") { incident.notificationDecision = notificationDecision; incident.notificationReviewedAt = new Date(); incident.notificationEvidenceReference = evidence; }
  if (kind === "notification_recorded") { incident.notificationDecision = "notified"; incident.notificationReviewedAt = new Date(); incident.notificationEvidenceReference = evidence; }
  incident.status = { triage: "triage", containment: "contained", notification_review: "notification_review", notification_recorded: "notification_review", reopened: "triage" }[kind];
  incident.events.push({ kind, note: value, evidenceReference: evidence, actor: actorId, actorType: "superadmin", at: new Date() });
  await incident.save({ session });
  return incident;
 });
}
