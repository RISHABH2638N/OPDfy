import mongoose from "mongoose";
import PrivacyRequest from "../models/PrivacyRequest.js";
import Patient from "../models/Patient.js";
import GlobalPatient from "../models/GlobalPatient.js";
import Tenant from "../models/Tenant.js";
import { runWithTenant } from "./tenantExecutionContext.js";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, min, max, label) => {
  const result = String(value || "").trim();
  if (result.length < min || result.length > max) throw fail(`${label} must be between ${min} and ${max} characters.`);
  return result;
};

export function validateIdentityReviewDecision(input = {}) {
  const decision = String(input.decision || "");
  if (!["verified", "rejected"].includes(decision)) throw fail("Choose verified or rejected.");
  return {
    decision,
    evidenceReference: text(input.evidenceReference, 5, 240, "Evidence reference"),
    reviewNote: text(input.reviewNote, 20, 1200, "Review note"),
  };
}

export async function validateIdentityReviewRequest(patient, input, session = null) {
  if (input.type !== "identity_review") return;
  if (!input.clinicSlug) throw fail("Choose the clinic whose patient identity needs review.");
  let tenantQuery = Tenant.findOne({ slug: input.clinicSlug, status: "active" }).select("_id slug").lean();
  if (session) tenantQuery = tenantQuery.session(session);
  const tenant = await tenantQuery;
  if (!tenant) throw fail("The selected clinic is unavailable. Choose an active clinic or contact support.", 409);
  const options = session ? { session } : {};
  const membership = await mongoose.connection.db.collection("patients").findOne({
    tenantId: tenant._id,
    globalPatientId: patient._id,
  }, { projection: { _id: 1, identityLink: 1 }, ...options });
  if (!membership) throw fail("No patient record linked to this account was found in the selected clinic.", 403);
  if (["verified_global_registration", "clinic_verified_claim"].includes(membership.identityLink?.method)) {
    throw fail("This clinic patient identity is already verified.", 409);
  }
}

export async function listIdentityReviewRequests({ tenantId, clinicSlug }) {
  const requests = await PrivacyRequest.find({
    type: "identity_review", clinicSlug,
    status: { $in: ["pending", "in_review"] },
  }).sort({ createdAt: -1 }).limit(100).lean();
  const globalIds = requests.map((item) => item.patient);
  const memberships = await runWithTenant(tenantId, () => Patient.find({
    globalPatientId: { $in: globalIds },
  }).select("_id globalPatientId patientId name email phone identityLink").lean());
  const membershipByGlobal = new Map(memberships.map((item) => [String(item.globalPatientId), item]));
  const accounts = await GlobalPatient.find({ _id: { $in: globalIds } }).select("_id name email").lean();
  const accountById = new Map(accounts.map((item) => [String(item._id), item]));
  return requests.flatMap((request) => {
    const membership = membershipByGlobal.get(String(request.patient));
    if (!membership) return [];
    const account = accountById.get(String(request.patient));
    return [{
      id: request._id,
      status: request.status,
      details: request.details,
      createdAt: request.createdAt,
      patient: { id: membership._id, patientId: membership.patientId, name: membership.name, email: membership.email || "", phone: membership.phone || "" },
      account: account ? { name: account.name, email: account.email } : null,
    }];
  });
}

export async function reviewIdentityRequest({ requestId, tenantId, clinicSlug, reviewerId, input }) {
  if (!mongoose.isValidObjectId(requestId)) throw fail("Invalid identity-review request ID.");
  const decision = validateIdentityReviewDecision(input);
  return runWithTenant(tenantId, () => mongoose.connection.transaction(async (session) => {
    const request = await PrivacyRequest.findOne({
      _id: requestId,
      type: "identity_review",
      clinicSlug,
      status: { $in: ["pending", "in_review"] },
    }).session(session);
    if (!request) throw fail("Open identity-review request not found for this clinic.", 404);
    const membership = await Patient.findOne({ globalPatientId: request.patient }).session(session);
    if (!membership) throw fail("The linked patient record is unavailable in this clinic.", 409);
    if (["verified_global_registration", "clinic_verified_claim"].includes(membership.identityLink?.method)) {
      throw fail("This patient identity has already been verified.", 409);
    }
    const reviewedAt = new Date();
    if (decision.decision === "verified") {
      membership.identityLink = { method: "clinic_verified_claim", linkedAt: reviewedAt, reviewedBy: reviewerId };
      await membership.save({ session });
    }
    request.status = decision.decision === "verified" ? "fulfilled" : "rejected";
    request.reviewedAt = reviewedAt;
    request.resolution = decision.decision === "verified"
      ? "The responsible clinic verified the existing patient identity using its documented process."
      : "The responsible clinic rejected the identity claim after review.";
    request.clinicReview = { tenantId, reviewedBy: reviewerId, reviewedAt, ...decision };
    await request.save({ session });
    return { request, membership, ...decision, reviewedAt };
  }));
}
