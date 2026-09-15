import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protectSuperAdmin } from "../middleware/platformAuth.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { ownerStepUp } from "../services/privacyPhase4Service.js";
import { backupDashboard, launchRecoveryJob, queueBackup, queueRestoreDrill } from "../services/backupRecoveryService.js";

const router = asyncRouter(); router.use(protectSuperAdmin);
const limit = rateLimit({ windowMs: 30*60000, max: 8, store:createRateLimitStore("backup-recovery-owner"), keyGenerator:req=>`owner:${req.superAdmin.id}`, standardHeaders:true, legacyHeaders:false });
const wrap = work => async(req,res)=>{try{await work(req,res);}catch(error){res.status(error.status||500).json({message:publicErrorMessage(error,"Unable to complete backup operation.")});}};
const id=value=>{if(!mongoose.isValidObjectId(value))throw Object.assign(new Error("Invalid backup ID."),{status:400});return value;};
const audit=(req,event,metadata={})=>logSecurityEvent(req,{event,outcome:"success",actorType:"superadmin",actorId:req.superAdmin.id,metadata});

router.get("/",wrap(async(req,res)=>res.json(await backupDashboard())));
router.post("/backups",limit,wrap(async(req,res)=>{
 await ownerStepUp(req.superAdmin.id,req.body?.password);
 const record=await queueBackup({trigger:"manual",requestedBy:req.superAdmin.id});
 audit(req,"database_backup_queued",{requestId:String(record._id)}); void launchRecoveryJob("backup", record._id);
 res.status(202).json({id:record._id,status:record.status,message:"Encrypted backup queued. Refresh the dashboard to track completion."});
}));
router.post("/backups/:id/restore-drills",limit,wrap(async(req,res)=>{
 await ownerStepUp(req.superAdmin.id,req.body?.password);
 if(req.body?.confirmation!=="RESTORE TO DISPOSABLE DATABASE")return res.status(400).json({message:"Type RESTORE TO DISPOSABLE DATABASE exactly. Production restore is not available here."});
 const drill=await queueRestoreDrill(id(req.params.id),req.superAdmin.id);
 audit(req,"database_restore_drill_queued",{requestId:String(drill._id)}); void launchRecoveryJob("restore drill", drill._id);
 res.status(202).json({id:drill._id,status:drill.status,targetDatabase:drill.targetDatabase,message:"Disposable restore drill queued. Production data will not be overwritten."});
}));
export default router;
