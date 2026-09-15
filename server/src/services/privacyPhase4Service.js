import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import OperationalJobStatus from "../models/OperationalJobStatus.js";
import { maintenanceHealth } from "./operationalJobMonitor.js";
import PrivacyOperationalCheck from "../models/PrivacyOperationalCheck.js";
import PrivacyNotificationRecord from "../models/PrivacyNotificationRecord.js";
import PrivacyIncident from "../models/PrivacyIncident.js";
import PrivacyRetentionPolicy from "../models/PrivacyRetentionPolicy.js";
import SuperAdmin from "../models/SuperAdmin.js";
import { auditRetentionDays } from "../utils/privacySafeLog.js";

export const CHECK_KEYS = Object.freeze(["backup_restore", "database_integrity", "access_review", "dependency_review", "incident_drill", "clinical_regression", "privacy_rights", "legal_signoff", "vendor_review", "monitoring"]);
export const AUDIENCES = Object.freeze(["board", "affected_individuals", "other_authority"]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, min, max, label) => { if (typeof value !== "string" || value.trim().length < min || value.length > max) throw fail(`Invalid ${label}.`); return value.trim(); };
const oid = value => mongoose.isValidObjectId(value);
export async function ownerStepUp(ownerId, password) {
  if (!oid(ownerId) || typeof password !== "string" || !password) throw fail("Fresh platform password required.", 403);
  const owner = await SuperAdmin.findOne({ _id: ownerId, status: "active" }).select("+passwordHash");
  if (!owner || !(await bcrypt.compare(password, owner.passwordHash))) throw fail("Platform step-up verification failed.", 403);
}
export function validateOperationalReview(input) {
  if (!CHECK_KEYS.includes(input?.key) || !["passed", "failed", "waived"].includes(input?.status)) throw fail("Invalid readiness check.");
  const note = text(input.note, 20, 2000, "review note");
  const evidenceReference = text(input.evidenceReference, 5, 240, "evidence reference");
  let expiresAt = null;
  if (input.expiresAt != null && input.expiresAt !== "") {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date() || expiresAt > new Date(Date.now() + 366 * 86400000)) throw fail("Invalid review expiry.");
  }
  if (input.status === "passed" && !expiresAt) throw fail("A passed check requires a future review expiry.");
  return { key: input.key, status: input.status, note, evidenceReference, expiresAt };
}
export async function recordOperationalReview(input, ownerId) {
  const data = validateOperationalReview(input);
  try { return await mongoose.connection.transaction(async session => {
    const previous = await PrivacyOperationalCheck.findOne({ key: data.key }).session(session);
    const next = { status: data.status, note: data.note, evidenceReference: data.evidenceReference, actor: ownerId, at: new Date() };
    if (previous) {
      previous.status = data.status; previous.reviewedAt = next.at; previous.expiresAt = data.expiresAt;
      if (previous.events.length >= 100) throw fail("Review history is full. Preserve the record and use a new evidence register.", 409);
      previous.events.push(next); await previous.save({ session }); return previous;
    }
    const [created] = await PrivacyOperationalCheck.create([{ key: data.key, status: data.status, reviewedAt: next.at, expiresAt: data.expiresAt, events: [next] }], { session });
    return created;
  }); } catch (error) {
    if (error.code === 11000 || error.name === "VersionError") throw fail("Review changed in another request. Refresh and try again.", 409);
    throw error;
  }
}
export function readinessSummary(records, now = new Date()) {
  const byKey = new Map(records.map(r => [r.key, r]));
  const checks = CHECK_KEYS.map(key => {
    const record = byKey.get(key);
    const expired = !record?.expiresAt || new Date(record.expiresAt) <= now;
    return { key, status: record?.status || "pending", expired, reviewedAt: record?.reviewedAt || null, expiresAt: record?.expiresAt || null, ready: record?.status === "passed" && !expired };
  });
  return { ready: checks.every(c => c.ready), checks, automatedCertification: false };
}
export function validateNotificationReview(input) {
  if (!AUDIENCES.includes(input?.audience) || !["required", "not_required", "delivered", "failed"].includes(input?.status)) throw fail("Invalid notification decision.");
  const note = text(input.note, 20, 2000, "notification note");
  const evidenceReference = text(input.evidenceReference, 5, 240, "evidence reference");
  const legalBasis = text(input.legalBasis, 20, 2000, "legal assessment");
  let dueAt = null, deliveredAt = null;
  if (input.dueAt != null && input.dueAt !== "") { dueAt = new Date(input.dueAt); if (Number.isNaN(dueAt.getTime())) throw fail("Invalid notification deadline."); }
  if (input.deliveredAt != null && input.deliveredAt !== "") { deliveredAt = new Date(input.deliveredAt); if (Number.isNaN(deliveredAt.getTime()) || deliveredAt > new Date()) throw fail("Invalid delivery time."); }
  if (["required", "failed"].includes(input.status) && !dueAt) throw fail("Record the legally assessed deadline.");
  if (input.status === "delivered" && !deliveredAt) throw fail("Record actual delivery time and evidence.");
  if (input.status !== "delivered" && deliveredAt) throw fail("Delivery time is only valid for an actual delivery.");
  return { audience: input.audience, status: input.status, dueAt, deliveredAt, note, legalBasis, evidenceReference };
}
export async function recordNotificationReview(incidentId, input, ownerId) {
  if (!oid(incidentId)) throw fail("Invalid incident ID.");
  const data = validateNotificationReview(input);
  try { return await mongoose.connection.transaction(async session => {
    const incident = await PrivacyIncident.findById(incidentId).session(session);
    if (!incident) throw fail("Incident not found.", 404);
    if (incident.status === "closed") throw fail("Reopen the incident before changing notification decisions.", 409);
    const existing = await PrivacyNotificationRecord.findOne({ incident: incident._id, audience: data.audience }).session(session);
    if (!existing && !["required", "not_required"].includes(data.status)) throw fail("Record a legal notification decision before delivery or failure.", 409);
    if (existing && ["delivered", "failed"].includes(data.status) && !["required", "failed"].includes(existing.status)) throw fail("A required notification assessment must precede delivery or failure.", 409);
    if (existing && ["delivered", "failed"].includes(data.status) && !data.dueAt) data.dueAt = existing.dueAt;
    if (existing) {
      if (existing.events.length >= 100) throw fail("Notification history is full. Preserve it and open a linked continuation case.", 409);
      if (existing.status === "delivered" && data.status !== "delivered") throw fail("A delivered notification cannot be erased or downgraded.", 409);
      if (existing.status === "delivered" && data.status === "delivered") throw fail("Delivery already recorded. Open a separate correction case for any discrepancy.", 409);
      existing.events.push({ fromStatus: existing.status, toStatus: data.status, ...data, actor: ownerId, at: new Date() });
      Object.assign(existing, data, { reviewedBy: ownerId, reviewedAt: new Date() });
      await existing.save({ session }); return existing;
    }
    const [record] = await PrivacyNotificationRecord.create([{ incident: incident._id, ...data, reviewedBy: ownerId,
      events: [{ fromStatus: "pending", toStatus: data.status, ...data, actor: ownerId, at: new Date() }] }], { session });
    return record;
  }); } catch (error) {
    if (error.code === 11000 || error.name === "VersionError") throw fail("Notification review changed in another request. Refresh and try again.", 409);
    throw error;
  }
}
export async function notificationReadiness(incidentId) {
  const records = await PrivacyNotificationRecord.find({ incident: incidentId }).lean();
  const byAudience = new Map(records.map(r => [r.audience, r]));
  return { records: records.map(r => ({ audience: r.audience, status: r.status, dueAt: r.dueAt, deliveredAt: r.deliveredAt, evidenceReference: r.evidenceReference, legalBasis: r.legalBasis, note: r.note, reviewedAt: r.reviewedAt })),
    complete: ["board", "affected_individuals"].every(a => ["not_required", "delivered"].includes(byAudience.get(a)?.status)) };
}
export async function operationalSnapshot() {
  const [checks, incidents, policies, jobs] = await Promise.all([
    PrivacyOperationalCheck.find({}).lean(), PrivacyIncident.find({ status: { $ne: "closed" } }).select("_id category status notificationDecision detectedAt").limit(100).lean(),
    PrivacyRetentionPolicy.find({ status: "approved" }).select("scope tenantId category version approvedAt").limit(100).lean(),
    OperationalJobStatus.find({}).lean(),
  ]);
  const readiness = readinessSummary(checks);
  const overdue = await PrivacyNotificationRecord.countDocuments({ status: { $in: ["required", "failed"] }, dueAt: { $lt: new Date() } });
  return { readiness, openIncidentCount: incidents.length, incidentsTruncated: incidents.length === 100, overdueNotificationCount: overdue, approvedPolicyCount: policies.length,
    maintenance: maintenanceHealth(jobs), automaticErasureEnabled: false, securityLogMinimumDays: auditRetentionDays(process.env.SECURITY_LOG_RETENTION_DAYS), productionVerified: false };
}
