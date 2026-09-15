import mongoose from "mongoose";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protect, requireRole } from "../middleware/auth.js";
import { runWithTenant } from "../services/tenantExecutionContext.js";
import Patient from "../models/Patient.js";
import PrivacyRequest from "../models/PrivacyRequest.js";
import PrivacyGuardianCase from "../models/PrivacyGuardianCase.js";
import PrivacyRetentionPolicy from "../models/PrivacyRetentionPolicy.js";
import { reviewGuardian, guardianPublic, resolveCorrection, privacyFailure } from "../services/privacyPhase3Service.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
const router=asyncRouter();router.use(protect,requireRole("admin"));
const wrap=work=>async(req,res)=>{try{await work(req,res);}catch(error){res.status(error.status||500).json({message:publicErrorMessage(error,"Unable to review privacy case.")});}};
const oid=value=>{if(!mongoose.isValidObjectId(value))throw privacyFailure("Invalid case ID.");return value;};
async function linkedIds(tenantId){return runWithTenant(tenantId,()=>Patient.distinct("globalPatientId",{globalPatientId:{$type:"objectId"},"identityLink.method":{$in:["verified_global_registration","clinic_verified_claim"]}}));}
router.get("/guardians",wrap(async(req,res)=>{
 const ids=await linkedIds(req.tenantId);
 const cases=await PrivacyGuardianCase.find({patient:{$in:ids},status:"awaiting_clinic_review"}).sort({createdAt:-1}).limit(100).lean();
 res.json({cases:cases.map(c=>({...guardianPublic(c),patient:c.patient}))});
}));
router.post("/guardians/:id/review",wrap(async(req,res)=>{
 const result=await reviewGuardian({id:oid(req.params.id),tenantId:req.tenantId,reviewerId:req.user.id,decision:req.body?.decision,evidenceReference:req.body?.evidenceReference,reviewNote:req.body?.reviewNote});
 logSecurityEvent(req,{event:"privacy_guardian_reviewed",outcome:"success",actorType:"staff",actorId:req.user.id,metadata:{caseId:String(result.id)}});
 res.json({case:result,message:"Authority review recorded. This does not grant login, clinical access or external AI consent."});
}));
router.get("/corrections",wrap(async(req,res)=>{
 const ids=await linkedIds(req.tenantId);
 const rows=await PrivacyRequest.find({patient:{$in:ids},type:"correction","correction.scope":"clinic_record",status:{$in:["pending","in_review"]}}).sort({createdAt:-1}).limit(100).select("patient correction.scope correction.field correction.recordId correction.clinicSlug details status createdAt").lean();
 res.json({requests:rows.filter(r=>r.correction?.clinicSlug===req.tenant.slug).map(r=>({id:r._id,patient:r.patient,field:r.correction.field,recordId:r.correction.recordId,details:r.details,status:r.status,createdAt:r.createdAt}))});
}));
router.get("/corrections/:id",wrap(async(req,res)=>{
 const request=await PrivacyRequest.findOne({_id:oid(req.params.id),type:"correction","correction.scope":"clinic_record", "correction.clinicSlug":req.tenant.slug}).select("+correction.proposedValue").lean();
 if(!request)throw privacyFailure("Correction request not found.",404);
 const linked=await runWithTenant(req.tenantId,()=>Patient.exists({globalPatientId:request.patient,"identityLink.method":{$in:["verified_global_registration","clinic_verified_claim"]}}));
 if(!linked)throw privacyFailure("Patient is not linked to your clinic.",403);
 res.json({request:{id:request._id,patient:request.patient,correction:request.correction,details:request.details,status:request.status}});
}));
router.post("/corrections/:id/resolve",wrap(async(req,res)=>{
 const request=await PrivacyRequest.findOne({_id:oid(req.params.id),type:"correction","correction.scope":"clinic_record","correction.clinicSlug":req.tenant.slug}).select("patient").lean();
 if(!request)throw privacyFailure("Correction request not found.",404);
 const review=await resolveCorrection({requestId:request._id,patientId:request.patient,tenantId:req.tenantId,reviewerId:req.user.id,role:"admin",decision:req.body?.decision,evidenceReference:req.body?.evidenceReference,resolution:req.body?.resolution});
 logSecurityEvent(req,{event:"privacy_correction_reviewed",outcome:"success",actorType:"staff",actorId:req.user.id,metadata:{requestId:String(request._id)}});
 res.json({decision:review.decision,reviewedAt:review.reviewedAt,message:"Documented correction review recorded. Clinical records have not been automatically changed."});
}));
router.get("/retention",wrap(async(req,res)=>{
 const policies=await PrivacyRetentionPolicy.find({scope:"clinic",tenantId:req.tenantId,status:"approved"}).sort({approvedAt:-1}).limit(100).select("category version legalBasis retentionRule trigger backupRule evidenceReference approvedAt").lean();
 res.json({policies});
}));
export default router;
