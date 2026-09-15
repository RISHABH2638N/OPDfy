import crypto from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import GlobalPatient from "../models/GlobalPatient.js";
import GlobalPatientOtp from "../models/GlobalPatientOtp.js";
import Patient from "../models/Patient.js";
import Tenant from "../models/Tenant.js";
import PrivacyRequest from "../models/PrivacyRequest.js";
import PrivacyVerification from "../models/PrivacyVerification.js";
import PrivacyExportGrant from "../models/PrivacyExportGrant.js";
import PrivacyClosureReview from "../models/PrivacyClosureReview.js";
import PrivacyConsentEvent from "../models/PrivacyConsentEvent.js";
import SuperAdmin from "../models/SuperAdmin.js";
import { revokeSocketSessions } from "../utils/sessionTokens.js";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const oid = value => mongoose.isValidObjectId(value);
const policyVersion = () => String(process.env.PRIVACY_RETENTION_POLICY_VERSION || "").trim();
const canExecute = () => process.env.PRIVACY_ERASURE_ENABLED === "true" && /^[a-zA-Z0-9._-]{8,80}$/.test(policyVersion());
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

export async function closureInventory(patientId, session = null) {
  let accountQuery = GlobalPatient.findById(patientId).select("_id status closedAt +tokenVersion +privacyRevision").lean();
  if (session) accountQuery = accountQuery.session(session);
  const account = await accountQuery;
  if (!account) throw fail("Account not found.", 404);
  const db = mongoose.connection.db;
  const options = session ? { session } : {};
  const links = await db.collection("patients").find({ globalPatientId: account._id }, options)
    .project({ _id: 1, tenantId: 1, identityLink: 1 }).toArray();
  const byTenant = new Map();
  for (const link of links) {
    if (!link.tenantId) throw fail("A patient membership has no clinic ownership. Manual review is required.", 409);
    const key = String(link.tenantId);
    if (!byTenant.has(key)) byTenant.set(key, { tenantId: link.tenantId, patients: [] });
    byTenant.get(key).patients.push(link);
  }
  const clinics = [];
  for (const entry of byTenant.values()) {
    const ids = entry.patients.map(p => p._id);
    const scope = { tenantId: entry.tenantId, patient: { $in: ids } };
    const count = (collection, filter = {}) => db.collection(collection).countDocuments({ ...scope, ...filter }, options);
    const [tokens, appointments, reservations, referrals, followups] = await Promise.all([
      count("tokens", { status: { $in: ["waiting", "called"] }, isArchived: { $ne: true } }),
      count("appointments", { status: { $in: ["booked", "checked_in"] } }),
      count("queuereservations", { status: "reserved" }),
      count("departmentreferrals", { status: { $in: ["pending", "accepted"] } }),
      count("followupplans", { status: { $in: ["pending", "scheduled"] } }),
    ]);
    let tenantQuery = Tenant.findById(entry.tenantId).select("name slug").lean();
    if (session) tenantQuery = tenantQuery.session(session);
    const tenant = await tenantQuery;
    clinics.push({ tenantId: entry.tenantId, slug: tenant?.slug || "", name: tenant?.name || "Unavailable historical clinic",
      unavailable: !tenant,
      memberships: ids.length, unverifiedMemberships: entry.patients.filter(p => !["verified_global_registration", "clinic_verified_claim"].includes(p.identityLink?.method)).length,
      active: { tokens, appointments, reservations, referrals }, openFollowUps: followups });
  }
  clinics.sort((a, b) => String(a.tenantId).localeCompare(String(b.tenantId)));
  return { account, clinics, hasActiveVisits: clinics.some(c => Object.values(c.active).some(n => n > 0)) };
}

export async function getClosureReview(requestId, patientId) {
  if (!oid(requestId)) throw fail("Invalid request ID.");
  const request = await PrivacyRequest.findOne({ _id: requestId, patient: patientId, type: "erasure" }).lean();
  if (!request) throw fail("Erasure request not found.", 404);
  const inventory = await closureInventory(patientId);
  const approvals = await PrivacyClosureReview.find({ request: request._id, patient: patientId }).lean();
  return {
    request: { id: request._id, type: request.type, status: request.status, createdAt: request.createdAt },
    inventory: {
      account: { status: inventory.account.status, closedAt: inventory.account.closedAt || null },
      clinics: inventory.clinics, hasActiveVisits: inventory.hasActiveVisits,
    },
    approvals: approvals.map(a => ({ id: a._id, tenantId: a.tenantId, decision: a.decision,
      legalBasis: a.legalBasis, reviewedAt: a.reviewedAt })),
    executionEnabled: canExecute(), policyVersion: policyVersion() || null,
  };
}

export async function approveClinicRetention({ requestId, tenantId, reviewerId, legalBasis, evidenceReference }) {
  if (!oid(requestId) || !oid(tenantId)) throw fail("Invalid request or clinic ID.");
  if (typeof legalBasis !== "string" || legalBasis.trim().length < 20 || legalBasis.length > 1200 ||
      typeof evidenceReference !== "string" || evidenceReference.trim().length < 5 || evidenceReference.length > 240)
    throw fail("Provide the approved retention basis and a documented clinic review reference.");
  const request = await PrivacyRequest.findOne({ _id: requestId, type: "erasure", status: { $in: ["pending", "in_review"] } }).lean();
  if (!request) throw fail("Open erasure request not found.", 404);
  const inventory = await closureInventory(request.patient);
  if (!inventory.clinics.some(c => String(c.tenantId) === String(tenantId))) throw fail("This patient has no linked record in your clinic.", 403);
  const existing = await PrivacyClosureReview.findOne({ request: request._id, tenantId });
  if (existing) throw fail("A clinic review already exists. Contact privacy support to resolve a disputed decision.", 409);
  const [review] = await PrivacyClosureReview.create([{ request: request._id, patient: request.patient, tenantId,
    decision: "retain_clinical_records", legalBasis: legalBasis.trim(), evidenceReference: evidenceReference.trim(),
    reviewedBy: reviewerId, reviewedAt: new Date() }]);
  return review;
}

export async function executeAccountClosure({ requestId, ownerId, password, confirmation, io }) {
  if (!canExecute()) throw fail("Account erasure is disabled until the approved retention policy and production release gates are configured.", 503);
  if (!oid(requestId) || !oid(ownerId)) throw fail("Invalid request or reviewer ID.");
  if (confirmation !== "CLOSE GLOBAL ACCOUNT" || typeof password !== "string" || !password)
    throw fail("Fresh platform password and exact closure confirmation are required.");
  const owner = await SuperAdmin.findOne({ _id: ownerId, status: "active" }).select("+passwordHash +tokenVersion");
  if (!owner || !(await bcrypt.compare(password, owner.passwordHash))) throw fail("Platform step-up verification failed.", 403);
  const result = await mongoose.connection.transaction(async (session) => {
    const request = await PrivacyRequest.findOne({ _id: requestId, type: "erasure", status: { $in: ["pending", "in_review"] } }).session(session);
    if (!request) throw fail("Open erasure request not found.", 409);
    const inventory = await closureInventory(request.patient, session);
    if (inventory.clinics.some(c => c.unavailable))
      throw fail("A historical clinic link is unavailable. Resolve it through a documented manual review before account closure.", 409);
    if (inventory.clinics.some(c => c.unverifiedMemberships > 0))
      throw fail("Historical clinic identity links require verification before account closure.", 409);
    if (inventory.account.status !== "active" || inventory.hasActiveVisits) throw fail("Account closure is blocked by an active visit, booking, reservation or referral. Resolve it through the normal clinic workflow first.", 409);
    const approvals = await PrivacyClosureReview.find({ request: request._id, patient: request.patient }).session(session).lean();
    if (inventory.clinics.some(c => !approvals.some(a => String(a.tenantId) === String(c.tenantId) && a.decision === "retain_clinical_records")))
      throw fail("Every linked clinic must complete its retention review before account closure.", 409);
    const account = await GlobalPatient.findOne({ _id: request.patient, status: "active" }).select("+tokenVersion +privacyRevision").session(session);
    if (!account) throw fail("Account changed during review.", 409);
    const originalEmail = account.email;
    const closedAt = new Date();
    const tombstone = `closed-${String(account._id)}@accounts.invalid`;
    const update = await GlobalPatient.updateOne({ _id: account._id, status: "active", tokenVersion: account.tokenVersion, privacyRevision: Number(account.privacyRevision || 0) === 0 ? { $in: [null, 0] } : account.privacyRevision }, {
      $set: { status: "disabled", email: tombstone, name: "", phone: "", dateOfBirth: null, gender: "", bloodGroup: "",
        allergies: [], medicalHistory: [], currentMedications: [], pastSurgeries: [], emergencyContact: { name: "", phone: "" },
        profileCompleted: false, profileUpdatedAt: closedAt, closedAt, closureRequest: request._id, lastLoginAt: null },
      $inc: { tokenVersion: 1, privacyRevision: 1 },
    }, { session, runValidators: true });
    if (update.matchedCount !== 1) throw fail("Account changed during closure. Review again.", 409);
    // Preserve clinic-owned medical/financial records and their stable historical references.
    // Do not erase, unlink, merge, reassign, or cancel any clinical record here.
    await mongoose.connection.db.collection("patients").updateMany({ globalPatientId: account._id },
      { $set: { privacyContactDisabled: true } }, { session });
    await GlobalPatientOtp.deleteMany({ email: originalEmail }).session(session);
    await PrivacyVerification.deleteMany({ patient: account._id }).session(session);
    await PrivacyExportGrant.deleteMany({ patient: account._id }).session(session);
    await PrivacyConsentEvent.create([{ patient: account._id, purpose: "external_ai", version: await nextConsentVersion(account._id, session),
      decision: "withdrawn", noticeVersion: "external-ai-2026-09-09-v1", language: "en", actor: "system", source: "account-closure" }], { session });
    request.status = "fulfilled";
    request.resolution = "Global account access closed and reusable profile erased. Clinic-owned clinical and financial records remain under their documented retention reviews. Contact privacy support for the retention summary.";
    request.reviewedAt = closedAt;
    request.reviewedBy = ownerId;
    request.execution = { kind: "global_account_closure", completedAt: closedAt, policyVersion: policyVersion(), retainedClinicCount: inventory.clinics.length };
    await request.save({ session });
    return { patientId: account._id, requestId: request._id, closedAt, retainedClinicCount: inventory.clinics.length };
  });
  // Commit first; a failed socket disconnect cannot roll back a completed closure.
  try { revokeSocketSessions(io, "patient", result.patientId); }
  catch (error) { console.error("Account-closure socket revocation failed:", error?.code || error?.name || "ERROR"); }
  return result;
}

async function nextConsentVersion(patientId, session) {
  let query = PrivacyConsentEvent.findOne({ patient: patientId, purpose: "external_ai" }).sort({ version: -1 }).lean().session(session);
  const last = await query;
  return (last?.version || 0) + 1;
}
