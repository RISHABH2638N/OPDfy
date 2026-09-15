import crypto from "node:crypto";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protectGlobalPatient } from "../middleware/globalPatientAuth.js";
import { protectSuperAdmin } from "../middleware/platformAuth.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import GlobalPatient from "../models/GlobalPatient.js";
import PrivacyGuardianCase from "../models/PrivacyGuardianCase.js";
import PrivacyRequest from "../models/PrivacyRequest.js";
import PrivacyCorrectionReview from "../models/PrivacyCorrectionReview.js";
import PrivacyRetentionPolicy from "../models/PrivacyRetentionPolicy.js";
import PrivacyIncident from "../models/PrivacyIncident.js";
import { issuePrivacyChallenge } from "../services/privacyRequestService.js";
import { requestGuardianVerification, confirmGuardianEmail, revokeGuardian, guardianPublic, submitStructuredCorrection, resolveCorrection, validateRetentionPolicy, approveRetentionPolicy, validateIncident, appendIncidentEvent, privacyFailure } from "../services/privacyPhase3Service.js";
import { sendSecurityAlert } from "../services/incidentResponseService.js";
const router = asyncRouter();
const handle = (error, res) => res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to process privacy operation.") });
const id = value => { if (!mongoose.isValidObjectId(value)) throw privacyFailure("Invalid case ID."); return value; };
const limit = rateLimit({ windowMs: 15 * 60000, max: 8, store: createRateLimitStore("privacy-phase3"), keyGenerator: req => `patient:${req.globalPatient._id}`, standardHeaders: true, legacyHeaders: false });
const guardianRecipientLimit = rateLimit({ windowMs: 60 * 60000, max: 3, store: createRateLimitStore("privacy-guardian-recipient"), keyGenerator: req => `guardian:${crypto.createHmac("sha256", process.env.JWT_SECRET).update(String(req.body?.guardianEmail || "").trim().toLowerCase()).digest("hex")}`, standardHeaders: true, legacyHeaders: false });
const ownerLimit = rateLimit({ windowMs: 15 * 60000, max: 20, store: createRateLimitStore("privacy-phase3-owner"), keyGenerator: req => `owner:${req.superAdmin.id}`, standardHeaders: true, legacyHeaders: false });
const wrap = work => async (req, res) => { try { await work(req, res); } catch (error) { handle(error, res); } };
const event = (req, name, metadata = {}) => logSecurityEvent(req, { event: name, outcome: "success", actorType: req.superAdmin ? "superadmin" : "patient", actorId: req.superAdmin?.id || req.globalPatient?._id, metadata });

router.get("/guardians", protectGlobalPatient, wrap(async (req,res) => {
 const rows = await PrivacyGuardianCase.find({ patient: req.globalPatient._id }).sort({ createdAt: -1 }).limit(25).lean();
 res.json({ cases: rows.map(guardianPublic), clinicalAccessEnabled: false });
}));
router.post("/guardians", protectGlobalPatient, limit, guardianRecipientLimit, wrap(async (req,res) => {
 const result = await requestGuardianVerification(req.globalPatient, req.body);
 event(req, "privacy_guardian_email_requested", { caseId: String(result.id) }); res.status(201).json(result);
}));
router.post("/guardians/:id/verify", protectGlobalPatient, limit, wrap(async (req,res) => {
 const result = await confirmGuardianEmail(req.globalPatient, id(req.params.id), req.body?.otp);
 event(req, "privacy_guardian_email_verified", { caseId: String(result.id) }); res.json({ case: result, message: "Email verified. The responsible clinic must review parental or legal authority. No medical-record access has been granted." });
}));
router.post("/guardians/:id/revoke", protectGlobalPatient, limit, wrap(async (req,res) => {
 const result = await revokeGuardian(req.globalPatient, id(req.params.id));
 event(req, "privacy_guardian_revoked", { caseId: String(result.id) }); res.json({ case: result });
}));
router.post("/corrections", protectGlobalPatient, limit, wrap(async (req,res) => {
 const request = await submitStructuredCorrection(req.globalPatient, req.body);
 event(req, "privacy_correction_requested", { requestId: String(request._id) }); res.status(201).json({ requestId: request._id, status: request.status, message: "Verified correction request received. The responsible record owner will review the proposed change." });
}));
router.get("/corrections/:id", protectGlobalPatient, wrap(async (req,res) => {
 const request = await PrivacyRequest.findOne({ _id: id(req.params.id), patient: req.globalPatient._id, type: "correction" }).select("+correction.proposedValue").lean();
 if (!request) throw privacyFailure("Correction request not found.",404);
 const review = await PrivacyCorrectionReview.findOne({ request: request._id }).select("decision evidenceReference resolution reviewedAt").lean();
 res.json({ request: { id: request._id, status: request.status, correction: request.correction, resolution: request.resolution }, review });
}));

// Platform ownership is not clinical authorization. Clinic-record corrections are excluded.
router.get("/admin/corrections", protectSuperAdmin, wrap(async (req,res) => {
 const rows = await PrivacyRequest.find({ type: "correction", "correction.scope": "global_profile", status: { $in: ["pending", "in_review"] } }).sort({ createdAt: -1 }).limit(100).select("patient correction.scope correction.field details status createdAt").lean();
 res.json({ requests: rows.map(r => ({ id:r._id, patient:r.patient, field:r.correction?.field, details:r.details, status:r.status, createdAt:r.createdAt })) });
}));
router.get("/admin/corrections/:id", protectSuperAdmin, wrap(async (req,res) => {
 const request = await PrivacyRequest.findOne({ _id:id(req.params.id), type:"correction", "correction.scope":"global_profile" }).select("+correction.proposedValue").lean();
 if (!request) throw privacyFailure("Global correction request not found.",404);
 res.json({ request:{ id:request._id, patient:request.patient, correction:request.correction, details:request.details, status:request.status } });
}));
router.post("/admin/corrections/:id/resolve", protectSuperAdmin, ownerLimit, wrap(async (req,res) => {
 const request = await PrivacyRequest.findOne({ _id: id(req.params.id), type: "correction", "correction.scope": "global_profile" }).select("patient").lean();
 if (!request) throw privacyFailure("Global correction request not found.",404);
 const review = await resolveCorrection({ requestId: request._id, patientId: request.patient, reviewerId: req.superAdmin.id, role: "superadmin", decision: req.body?.decision, evidenceReference: req.body?.evidenceReference, resolution: req.body?.resolution });
 event(req, "privacy_correction_reviewed", { requestId: String(request._id), decision:review.decision }); res.json({ decision:review.decision, reviewedAt:review.reviewedAt, message:"Review recorded. The evidence must correspond to an actual verified correction or documented no-change decision." });
}));
router.get("/admin/retention", protectSuperAdmin, wrap(async (req,res) => {
 const rows = await PrivacyRetentionPolicy.find({}).sort({ createdAt:-1 }).limit(100).lean();
 res.json({ policies:rows, automaticDeletionEnabled:false });
}));
router.post("/admin/retention", protectSuperAdmin, ownerLimit, wrap(async (req,res) => {
 const input = validateRetentionPolicy(req.body);
 if (input.tenantId) {
  const tenant = await mongoose.connection.db.collection("tenants").findOne({ _id:new mongoose.Types.ObjectId(input.tenantId) }, { projection:{ _id:1 } });
  if (!tenant) throw privacyFailure("Clinic not found.",404);
 }
 const [policy] = await PrivacyRetentionPolicy.create([input]);
 event(req,"privacy_retention_draft_created",{policyId:String(policy._id)}); res.status(201).json({ policy });
}));
router.post("/admin/retention/:id/approve", protectSuperAdmin, ownerLimit, wrap(async (req,res) => {
 const policy = await approveRetentionPolicy(id(req.params.id),req.superAdmin.id,req.body?.password);
 event(req,"privacy_retention_policy_approved",{policyId:String(policy._id)}); res.json({ policy, message:"Policy approval recorded. No deletion schedule or legal retention period was automatically configured." });
}));
router.get("/admin/incidents", protectSuperAdmin, wrap(async (req,res) => {
 const rows = await PrivacyIncident.find({}).select("title category severity source status detectedAt responseDueAt tenantIds estimatedAffectedCount confirmedAffectedCount evidenceLock securityAlert closure createdAt updatedAt").sort({ createdAt:-1 }).limit(100).lean();
 res.json({ incidents:rows });
}));
router.post("/admin/incidents", protectSuperAdmin, ownerLimit, wrap(async (req,res) => {
 const input = validateIncident(req.body);
 if(input.tenantIds.length){const count=await mongoose.connection.db.collection("tenants").countDocuments({_id:{$in:input.tenantIds.map(value=>new mongoose.Types.ObjectId(value))}});if(count!==input.tenantIds.length)throw privacyFailure("One or more affected clinics do not exist.",404);}
 const [incident] = await PrivacyIncident.create([{ ...input, createdBy:req.superAdmin.id, source:"manual", events:[{kind:"created",note:"Incident case opened for assessment.",actor:req.superAdmin.id,actorType:"superadmin"}] }]);
 void sendSecurityAlert(incident);
 event(req,"privacy_incident_created",{incidentId:String(incident._id)});res.status(201).json({id:incident._id,status:incident.status});
}));
router.get("/admin/incidents/:id", protectSuperAdmin, wrap(async (req,res) => {
 const incident = await PrivacyIncident.findById(id(req.params.id)).lean();
 if (!incident) throw privacyFailure("Incident not found.",404);
 res.json({incident});
}));
router.post("/admin/incidents/:id/events", protectSuperAdmin, ownerLimit, wrap(async (req,res) => {
 const incident = await appendIncidentEvent({id:id(req.params.id),actorId:req.superAdmin.id,kind:req.body?.kind,note:req.body?.note,evidenceReference:req.body?.evidenceReference,notificationDecision:req.body?.notificationDecision});
 event(req,"privacy_incident_updated",{incidentId:String(incident._id),kind:req.body?.kind});res.json({id:incident._id,status:incident.status,events:incident.events});
}));
export default router;
