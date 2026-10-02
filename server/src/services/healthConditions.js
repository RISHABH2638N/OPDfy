import mongoose from "mongoose";
import Patient from "../models/Patient.js";

// Codes are stable. Labels may change without changing saved clinical meaning.
export const CONDITION_CATALOG = [
  { code: "diabetes", label: "Diabetes" },
  { code: "hypertension", label: "High blood pressure (hypertension)" },
  { code: "heart_disease", label: "Heart disease" },
  { code: "stroke", label: "Stroke history" },
  { code: "kidney_disease", label: "Chronic kidney disease" },
  { code: "asthma", label: "Asthma" },
  { code: "copd", label: "COPD / chronic breathing condition" },
  { code: "cancer", label: "Cancer" },
  { code: "thyroid", label: "Thyroid disorder" },
  { code: "liver_disease", label: "Chronic liver disease" },
  { code: "other", label: "Other chronic condition" },
];
const validCodes = new Set(CONDITION_CATALOG.map(item => item.code));
export const SMALL_GROUP_THRESHOLD = 5;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function conditionProfile(patient) {
  const profile = patient?.conditionProfile || {};
  return {
    revision: profile.revision || 0,
    declaration: profile.declaration || "undisclosed",
    analyticsConsent: Boolean(profile.analyticsConsent),
    entries: (profile.entries || []).map(item => ({
      code: item.code, status: item.status, verifiedCode: item.verifiedCode || "",
      reviewedAt: item.reviewedAt || null,
    })),
  };
}
function revisionFilter(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) fail("Refresh health conditions and try again.", 409);
  return revision === 0 ? { $or: [{ "conditionProfile.revision": 0 }, { "conditionProfile.revision": { $exists: false } }] }
    : { "conditionProfile.revision": revision };
}
async function updateProfile(patient, revision, patch) {
  const filter = revisionFilter(revision);
  // The patch was derived from this snapshot. A client-supplied newer revision
  // must never authorize writing an older set of declarations or reviews.
  if (revision !== conditionProfile(patient).revision) fail("Health conditions changed. Reload before saving.", 409);
  const updated = await Patient.findOneAndUpdate({ _id: patient._id, tenantId: patient.tenantId, ...filter }, {
    $set: patch, $inc: { "conditionProfile.revision": 1 },
  }, { new: true, runValidators: true });
  if (!updated) fail("Health conditions changed. Reload before saving.", 409);
  return updated;
}
export async function submitConditions(patient, input) {
  const { codes, declaration, analyticsConsent, revision } = input || {};
  if (!Array.isArray(codes) || codes.length > CONDITION_CATALOG.length || codes.some(code => !validCodes.has(code)) || new Set(codes).size !== codes.length)
    fail("Select valid health conditions without duplicates.");
  if (!["conditions", "none", "undisclosed"].includes(declaration) || typeof analyticsConsent !== "boolean" ||
      (declaration === "conditions" ? !codes.length : codes.length > 0)) fail("Choose conditions, none, or prefer not to say.");
  const previous = conditionProfile(patient);
  const changed = previous.declaration !== declaration || previous.entries.map(item => item.code).sort().join() !== [...codes].sort().join();
  const patch = { "conditionProfile.declaration": declaration, "conditionProfile.analyticsConsent": analyticsConsent };
  if (changed) {
    patch["conditionProfile.entries"] = codes.map(code => ({ code, status: "pending" }));
    patch["conditionProfile.reportedAt"] = new Date();
  }
  if (previous.analyticsConsent !== analyticsConsent) patch["conditionProfile.consentUpdatedAt"] = new Date();
  return updateProfile(patient, revision, patch);
}
export async function reviewCondition(patient, token, doctorId, input) {
  const { code, decision, verifiedCode, revision } = input || {};
  if (!["confirmed", "not_confirmed"].includes(decision) || !validCodes.has(code) ||
      (decision === "confirmed" && !validCodes.has(verifiedCode))) fail("Select a valid condition and review decision.");
  const entries = (patient.conditionProfile?.entries || []).map(item => item.toObject ? item.toObject() : { ...item });
  const entry = entries.find(item => item.code === code);
  if (!entry) fail("Reported condition no longer exists. Reload before reviewing.", 409);
  if (decision === "confirmed" && entries.some(item => item.code !== code && item.status === "confirmed" && item.verifiedCode === verifiedCode))
    fail("This condition is already confirmed for this patient.");
  Object.assign(entry, { status: decision, verifiedCode: decision === "confirmed" ? verifiedCode : null,
    reviewedBy: doctorId, reviewedAt: new Date(), reviewToken: token._id });
  return updateProfile(patient, revision, { "conditionProfile.entries": entries });
}
export function conditionRange(query) {
  const { fromDate, toDate, condition = "" } = query;
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!date(fromDate) || !date(toDate) || fromDate > toDate) fail("Choose a valid date range.");
  const start = new Date(`${fromDate}T00:00:00.000Z`), end = new Date(`${toDate}T23:59:59.999Z`);
  if (end - start > 366 * 86400000) fail("Export range is limited to 1 year.");
  if (typeof condition !== "string" || (condition && !validCodes.has(condition))) fail("Select a valid condition.");
  return { fromDate, toDate, condition, start, end };
}
export async function conditionInsights(tenantId, query) {
  const range = conditionRange(query);
  const groups = await Patient.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), "conditionProfile.analyticsConsent": true, privacyContactDisabled: { $ne: true } } },
    { $unwind: "$conditionProfile.entries" },
    { $match: { "conditionProfile.entries.status": "confirmed", "conditionProfile.entries.reviewedAt": { $gte: range.start, $lte: range.end },
      "conditionProfile.entries.verifiedCode": range.condition || { $in: [...validCodes] } } },
    // Distinct patients, not visits; identifiers never leave the database pipeline.
    { $group: { _id: { code: "$conditionProfile.entries.verifiedCode", patient: "$_id" } } },
    { $group: { _id: "$_id.code", count: { $sum: 1 } } },
  ]);
  const counts = new Map(groups.map(item => [item._id, item.count]));
  return { fromDate: range.fromDate, toDate: range.toDate, threshold: SMALL_GROUP_THRESHOLD,
    rows: CONDITION_CATALOG.filter(item => !range.condition || item.code === range.condition).map(item => {
      const count = counts.get(item.code) || 0;
      return { ...item, count: count >= SMALL_GROUP_THRESHOLD ? count : null, suppressed: count < SMALL_GROUP_THRESHOLD };
    }) };
}
