import crypto from "node:crypto";
import mongoose from "mongoose";
import GlobalPatient from "../models/GlobalPatient.js";
import PrivacyRequest from "../models/PrivacyRequest.js";
import PrivacyExportGrant from "../models/PrivacyExportGrant.js";
import PrivacyConsentEvent from "../models/PrivacyConsentEvent.js";
import { consumePrivacyChallenge } from "./privacyRequestService.js";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const common = ["_id", "createdAt", "updatedAt"];
const specs = Object.freeze([
  ["patients", ["patientId", "name", "email", "phone", "dateOfBirth", "gender", "bloodGroup", "allergies", "medicalHistory", "currentMedications", "pastSurgeries", "emergencyContact", "profileCompleted"]],
  ["tokens", ["tokenNumber", "patientId", "patientName", "phone", "department", "assignedDoctor", "appointment", "referral", "reservation", "queueSource", "status", "urgency", "arrivalStatus", "calledAt", "completedAt", "billing", "queueControl", "isArchived"]],
  ["appointments", ["patientId", "patientName", "phone", "doctor", "doctorName", "department", "appointmentDate", "startTime", "endTime", "reason", "bookingSource", "status", "token", "followUpConsultation", "checkedInAt", "cancelledAt", "cancellationReason", "missedAt", "rescheduledAt", "rescheduleHistory", "billing"]],
  ["queuereservations", ["patientId", "patientName", "phone", "department", "doctor", "doctorName", "urgency", "reservationDate", "status", "token", "billing", "checkedInAt", "cancelledAt", "expiredAt"]],
  ["consultations", ["token", "doctor", "department", "symptoms", "diagnosis", "prescription", "medicines", "testsRecommended", "labReferral", "advice", "notes", "followUpDate", "printDesk", "completedAt"]],
  ["departmentreferrals", ["sourceToken", "sourceConsultation", "fromDoctor", "fromDepartment", "toDoctor", "toDepartment", "reason", "priority", "status", "targetToken", "acceptedAt", "cancelledAt", "completedAt"]],
  ["followupplans", ["consultation", "doctor", "department", "doctorName", "dueDate", "status", "appointment", "completedConsultation", "completedAt", "cancelledAt"]],
  ["feedbacks", ["doctor", "consultation", "token", "department", "rating", "comment"]],
  ["notifications", ["type", "title", "message", "readAt", "emailSentAt"]],
]);
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const MAX_ROWS = 1000;
const MAX_BYTES = 8 * 1024 * 1024;

export async function preparePrivacyExport(patient, otp) {
  const secret = crypto.randomBytes(32).toString("base64url");
  const request = await consumePrivacyChallenge(patient, "access", otp, async (session) => {
    let existing = await PrivacyRequest.findOne({ patient: patient._id, type: "access", status: { $in: ["pending", "in_review"] } }).session(session);
    if (!existing) {
      [existing] = await PrivacyRequest.create([{ patient: patient._id, type: "access",
        details: "Verified self-service personal-data export.", verifiedAt: new Date() }], { session });
    }
    await PrivacyExportGrant.create([{ patient: patient._id, request: existing._id,
      tokenHash: hash(secret), expiresAt: new Date(Date.now() + 5 * 60000) }], { session });
    return existing;
  });
  return { token: secret, expiresIn: 300, requestId: String(request._id) };
}

async function boundedCollection(db, collection, filter, fields) {
  const projection = Object.fromEntries([...common, ...fields].map(k => [k, 1]));
  const rows = await db.collection(collection).find(filter, { projection }).limit(MAX_ROWS + 1).toArray();
  if (rows.length > MAX_ROWS) throw fail("Your records exceed the self-service export limit. Request a secure assisted export.", 413);
  return rows;
}

// Only an existing, positively verified membership can authorize clinic records.
// Contact-email matches and unclassified historical links are never sufficient.
export async function buildPrivacyExport(patientId) {
  const db = mongoose.connection.db;
  const account = await GlobalPatient.findOne({ _id: patientId, status: "active" }).lean();
  if (!account) throw fail("Account unavailable.", 401);
  const links = await boundedCollection(db, "patients", { globalPatientId: account._id },
    ["tenantId", "identityLink.method", "patientId"]);
  const trusted = links.filter(p => ["verified_global_registration", "clinic_verified_claim"].includes(p.identityLink?.method));
  const unverified = links.length - trusted.length;
  const tenants = await boundedCollection(db, "tenants", { _id: { $in: trusted.map(p => p.tenantId) } },
    ["name", "slug", "contactEmail"]);
  const tenantMap = new Map(tenants.map(t => [String(t._id), t]));
  const clinics = [];
  for (const link of trusted) {
    const tenant = tenantMap.get(String(link.tenantId));
    if (!tenant) throw fail("A linked clinic could not be verified. Request an assisted export.", 409);
    const collections = {};
    for (const [name, fields] of specs) {
      const filter = name === "patients"
        ? { _id: link._id, tenantId: link.tenantId, globalPatientId: account._id }
        : { tenantId: link.tenantId, patient: link._id };
      collections[name] = await boundedCollection(db, name, filter, fields);
    }
    clinics.push({ clinic: pick(tenant, ["_id", "name", "slug", "contactEmail"]), records: collections });
  }
  const consents = await boundedCollection(db, "privacyconsentevents", { patient: account._id },
    ["purpose", "version", "decision", "noticeVersion", "language", "recordedAt"]);
  const exported = {
    format: "opd-smart-queue-personal-data-v1",
    generatedAt: new Date().toISOString(),
    scope: "Authenticated global account and positively verified clinic memberships only.",
    limitations: {
      unverifiedClinicMemberships: unverified,
      notice: "Historical or unverified clinic records require an assisted identity review. This export is not a complete legal disclosure or a certified medical record. Contact support for additional records, processing information or corrections.",
    },
    account: pick(account, ["_id", "email", "name", "phone", "dateOfBirth", "gender", "bloodGroup", "allergies", "medicalHistory", "currentMedications", "pastSurgeries", "emergencyContact", "profileCompleted", "profileUpdatedAt", "createdAt", "updatedAt"]),
    consents, clinics,
  };
  const body = JSON.stringify(exported, null, 2);
  if (Buffer.byteLength(body, "utf8") > MAX_BYTES) throw fail("Your records exceed the self-service export limit. Request a secure assisted export.", 413);
  return body;
}

export async function consumePrivacyExport(patient, token, build = buildPrivacyExport) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw fail("Invalid download authorization.", 401);
  const grant = await PrivacyExportGrant.findOneAndUpdate({
    patient: patient._id, tokenHash: hash(token), consumedAt: null, expiresAt: { $gt: new Date() },
  }, { $set: { consumedAt: new Date() } }, { new: true });
  if (!grant) throw fail("Download authorization expired or already used. Verify again.", 409);
  // Fail closed on a changed account. No data is persisted to a public directory.
  const body = await build(patient._id);
  const active = await GlobalPatient.findOne({ _id: patient._id, status: "active" }).select("+tokenVersion").lean();
  if (!active || Number(active.tokenVersion || 0) !== Number(patient.tokenVersion || 0))
    throw fail("Account changed during export. Please verify again.", 409);
  await PrivacyRequest.updateOne({ _id: grant.request, patient: patient._id, type: "access",
    status: { $in: ["pending", "in_review"] } }, { $set: {
    status: "in_review", resolution: "A limited self-service personal-data export was generated. Any additional access, processing-information, disputed-identity or medical-record requests remain subject to review.",
    reviewedAt: new Date(), execution: { kind: "data_export", completedAt: new Date() },
  } });
  return body;
}
