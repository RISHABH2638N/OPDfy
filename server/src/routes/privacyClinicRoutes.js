import mongoose from "mongoose";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protect, requireRole } from "../middleware/auth.js";
import PrivacyRequest from "../models/PrivacyRequest.js";
import GlobalPatient from "../models/GlobalPatient.js";
import { getClosureReview, approveClinicRetention } from "../services/privacyClosureService.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { listIdentityReviewRequests, reviewIdentityRequest } from "../services/privacyIdentityReviewService.js";
const router = asyncRouter();
router.use(protect, requireRole("admin"));
const handle = (error, res) => res.status(error.status || 500).json({
  message: publicErrorMessage(error, "Unable to review privacy request."),
});
async function linkedPatientIds(tenantId) {
  return mongoose.connection.db.collection("patients").distinct("globalPatientId", {
    tenantId, globalPatientId: { $type: "objectId" },
  });
}
router.get("/identity-reviews", async (req, res) => {
  try {
    const requests = await listIdentityReviewRequests({ tenantId: req.tenantId, clinicSlug: req.tenant.slug });
    res.json({ requests });
  } catch (error) { handle(error, res); }
});
router.post("/identity-reviews/:id/review", async (req, res) => {
  try {
    const result = await reviewIdentityRequest({ requestId: req.params.id, tenantId: req.tenantId,
      clinicSlug: req.tenant.slug, reviewerId: req.user.id, input: req.body });
    logSecurityEvent(req, { event: "privacy_patient_identity_reviewed", outcome: "success", actorType: "staff",
      actorId: req.user.id, metadata: { requestId: String(req.params.id), decision: result.decision } });
    res.json({ message: result.decision === "verified"
      ? "Patient identity verified. Treatment acknowledgement and trusted profile synchronization are now available."
      : "Identity claim rejected and recorded.", decision: result.decision, reviewedAt: result.reviewedAt });
  } catch (error) { handle(error, res); }
});
router.get("/requests", async (req, res) => {
  const ids = await linkedPatientIds(req.tenantId);
  const requests = await PrivacyRequest.find({ patient: { $in: ids }, type: "erasure",
    status: { $in: ["pending", "in_review"] } }).sort({ createdAt: -1 }).limit(100).lean();
  const accounts = await GlobalPatient.find({ _id: { $in: requests.map(r => r.patient) } }).select("_id name email").lean();
  const byId = new Map(accounts.map(a => [String(a._id), a]));
  res.json({ requests: requests.map(r => ({ id: r._id, status: r.status, createdAt: r.createdAt,
    patient: byId.get(String(r.patient)) || null })) });
});
async function authorizeClinicRequest(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw Object.assign(new Error("Invalid request ID."), { status: 400 });
  const request = await PrivacyRequest.findOne({ _id: req.params.id, type: "erasure" }).select("patient status").lean();
  if (!request) throw Object.assign(new Error("Request not found."), { status: 404 });
  const linked = await mongoose.connection.db.collection("patients").countDocuments({
    tenantId: req.tenantId, globalPatientId: request.patient,
  });
  if (!linked) throw Object.assign(new Error("Request is not linked to this clinic."), { status: 403 });
  return request;
}
router.get("/requests/:id/closure", async (req, res) => {
  try {
    const request = await authorizeClinicRequest(req);
    const review = await getClosureReview(request._id, request.patient);
    res.json({ request: { id: request._id, status: request.status },
      clinic: review.inventory.clinics.find(c => String(c.tenantId) === String(req.tenantId)),
      approval: review.approvals.find(a => String(a.tenantId) === String(req.tenantId)) || null });
  } catch (error) { handle(error, res); }
});
router.post("/requests/:id/closure-review", async (req, res) => {
  try {
    await authorizeClinicRequest(req);
    const review = await approveClinicRetention({ requestId: req.params.id, tenantId: req.tenantId,
      reviewerId: req.user.id, legalBasis: req.body?.legalBasis, evidenceReference: req.body?.evidenceReference });
    logSecurityEvent(req, { event: "privacy_clinic_retention_reviewed", outcome: "success", actorType: "staff",
      actorId: req.user.id, metadata: { requestId: String(req.params.id) } });
    res.status(201).json({ message: "Clinic retention review recorded. No clinical or financial records were deleted.",
      review: { id: review._id, reviewedAt: review.reviewedAt, decision: review.decision } });
  } catch (error) { handle(error, res); }
});
export default router;
