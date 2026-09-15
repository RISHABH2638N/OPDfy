import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protectSuperAdmin } from "../middleware/platformAuth.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import PrivacyOperationalCheck from "../models/PrivacyOperationalCheck.js";
import PrivacyNotificationRecord from "../models/PrivacyNotificationRecord.js";
import PrivacyIncident from "../models/PrivacyIncident.js";
import { CHECK_KEYS, ownerStepUp, recordOperationalReview, readinessSummary, recordNotificationReview, notificationReadiness, operationalSnapshot } from "../services/privacyPhase4Service.js";
import { addAffectedPatients, approveIncidentClosure, certInPackage, incidentResponseSummary, lockIncidentEvidence, requestIncidentClosure, sendAffectedPatientNotices, sendSecurityAlert, updatePatientNoticeTemplate } from "../services/incidentResponseService.js";
const router = asyncRouter();
router.use(protectSuperAdmin);
const limit = rateLimit({ windowMs: 15 * 60000, max: 15, store: createRateLimitStore("privacy-phase4-owner"), keyGenerator: req => `owner:${req.superAdmin.id}`, standardHeaders: true, legacyHeaders: false });
const wrap = work => async (req,res) => { try { await work(req,res); } catch(error) { res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to complete operational review.") }); } };
const id = value => { if (!mongoose.isValidObjectId(value)) throw Object.assign(new Error("Invalid incident ID."), { status: 400 }); return value; };
const audit = (req,event,metadata={}) => logSecurityEvent(req,{event,outcome:"success",actorType:"superadmin",actorId:req.superAdmin.id,metadata});
router.get("/readiness",wrap(async(req,res)=>res.json(await operationalSnapshot())));
router.get("/readiness/checks",wrap(async(req,res)=>{
 const records=await PrivacyOperationalCheck.find({}).select("key status reviewedAt expiresAt events").lean();
 res.json({readiness:readinessSummary(records),records});
}));
router.post("/readiness/checks",limit,wrap(async(req,res)=>{
 await ownerStepUp(req.superAdmin.id,req.body?.password);
 const record=await recordOperationalReview(req.body,req.superAdmin.id);
 audit(req,"privacy_readiness_reviewed",{key:record.key,status:record.status});
 res.json({key:record.key,status:record.status,reviewedAt:record.reviewedAt,expiresAt:record.expiresAt});
}));
router.get("/incidents/:id/notifications",wrap(async(req,res)=>{
 const incident=await PrivacyIncident.findById(id(req.params.id)).select("_id").lean();
 if(!incident)return res.status(404).json({message:"Incident not found."});
 res.json(await notificationReadiness(incident._id));
}));
router.post("/incidents/:id/notifications",limit,wrap(async(req,res)=>{
 await ownerStepUp(req.superAdmin.id,req.body?.password);
 const record=await recordNotificationReview(id(req.params.id),req.body,req.superAdmin.id);
 audit(req,"privacy_notification_reviewed",{incidentId:String(req.params.id),audience:record.audience,status:record.status});
 res.json({audience:record.audience,status:record.status,dueAt:record.dueAt,deliveredAt:record.deliveredAt,reviewedAt:record.reviewedAt});
}));
router.get("/incidents/:id/response",wrap(async(req,res)=>res.json(await incidentResponseSummary(id(req.params.id)))));
router.post("/incidents/:id/alert",limit,wrap(async(req,res)=>{
 await ownerStepUp(req.superAdmin.id,req.body?.password);
 const incident=await PrivacyIncident.findById(id(req.params.id)); if(!incident)return res.status(404).json({message:"Incident not found."});
 const result=await sendSecurityAlert(incident); audit(req,"incident_security_alert_retried",{incidentId:String(incident._id),status:result.status}); res.json(result);
}));
router.post("/incidents/:id/evidence-lock",limit,wrap(async(req,res)=>{
 const result=await lockIncidentEvidence(id(req.params.id),req.superAdmin.id,req.body); audit(req,"incident_evidence_locked",{incidentId:String(req.params.id),count:result.eventCount}); res.json(result);
}));
router.post("/incidents/:id/affected-patients",limit,wrap(async(req,res)=>{
 const result=await addAffectedPatients(id(req.params.id),req.superAdmin.id,req.body); audit(req,"incident_affected_patients_scoped",{incidentId:String(req.params.id),count:result.confirmedAffectedCount}); res.json(result);
}));
router.put("/incidents/:id/patient-template",limit,wrap(async(req,res)=>{
 const template=await updatePatientNoticeTemplate(id(req.params.id),req.superAdmin.id,req.body); audit(req,"incident_patient_template_updated",{incidentId:String(req.params.id)}); res.json({template});
}));
router.post("/incidents/:id/patient-notifications/send",limit,wrap(async(req,res)=>{
 const result=await sendAffectedPatientNotices(id(req.params.id),req.superAdmin.id,req.body,req.app.get("io")); audit(req,"incident_patient_notifications_sent",{incidentId:String(req.params.id),count:result.sent}); res.json(result);
}));
router.get("/incidents/:id/cert-in-package",wrap(async(req,res)=>{
 const result=await certInPackage(id(req.params.id));
 res.setHeader("Content-Type","application/json"); res.setHeader("Content-Disposition",`attachment; filename=cert-in-incident-${req.params.id}.json`); res.setHeader("X-Package-SHA256",result.sha256); res.send(JSON.stringify({...result.payload,packageSha256:result.sha256},null,2));
}));
router.post("/incidents/:id/closure-request",limit,wrap(async(req,res)=>{
 const closure=await requestIncidentClosure(id(req.params.id),req.superAdmin.id,req.body); audit(req,"incident_closure_requested",{incidentId:String(req.params.id)}); res.json({closure});
}));
router.post("/incidents/:id/closure-approve",limit,wrap(async(req,res)=>{
 const result=await approveIncidentClosure(id(req.params.id),req.superAdmin.id,req.body); audit(req,"incident_closure_approved",{incidentId:String(req.params.id),status:result.status}); res.json(result);
}));
export default router;
