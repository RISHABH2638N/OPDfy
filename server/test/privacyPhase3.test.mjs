import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
process.env.JWT_SECRET ||= "test-only-privacy-phase3-hmac-key-not-production";
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const ID = { patient:"aaaaaaaaaaaaaaaaaaaaaaaa", other:"bbbbbbbbbbbbbbbbbbbbbbbb", tenant:"cccccccccccccccccccccccc", wrong:"dddddddddddddddddddddddd", owner:"eeeeeeeeeeeeeeeeeeeeeeee", case:"ffffffffffffffffffffffff" };
const validId = value => typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
const query = value => ({ select(){return this;},lean(){return this;},session(){return this;},sort(){return this;},then(resolve,reject){return Promise.resolve(value).then(resolve,reject);} });
async function load(name,dependencies,globals={}) {
 const context=vm.createContext({console,Buffer,process,setTimeout,AbortSignal,...globals});
 const module=new vm.SourceTextModule(read(name),{context});
 await module.link(async specifier=>{
  if(!(specifier in dependencies))throw Error(`Unexpected dependency: ${specifier}`);
  const exports=dependencies[specifier];
  return new vm.SyntheticModule(["default",...Object.keys(exports).filter(k=>k!=="default")],function(){
   this.setExport("default",exports.default??exports);
   for(const [k,v] of Object.entries(exports))if(k!=="default")this.setExport(k,v);
  },{context});
 });
 await module.evaluate();return module.namespace;
}
const get=(obj,path)=>path.split(".").reduce((v,k)=>v?.[k],obj);
function match(doc,filter){return Object.entries(filter).every(([k,v])=>{
 const actual=get(doc,k);
 if(v&&typeof v==="object"&&!(v instanceof Date)&&!Array.isArray(v)){
  if("$in" in v)return v.$in.some(x=>String(x)===String(actual));
  if("$ne" in v)return actual!==v.$ne;
  if("$lt" in v)return Number(actual)<Number(v.$lt);
  if("$lte" in v)return Number(actual)<=Number(v.$lte);
  if("$gt" in v)return Number(actual)>Number(v.$gt);
  if("$gte" in v)return Number(actual)>=Number(v.$gte);
  if("$exists" in v)return (actual!==undefined)===v.$exists;
 }
 return String(actual)===String(v);
});}
function set(obj,path,value){const parts=path.split(".");let current=obj;for(const p of parts.slice(0,-1))current=current[p]??={};current[parts.at(-1)]=value;}
function unset(obj,path){const parts=path.split(".");let current=obj;for(const p of parts.slice(0,-1))current=current?.[p];if(current)delete current[parts.at(-1)];}
function apply(doc,update){for(const [k,v] of Object.entries(update.$set||{}))set(doc,k,v);for(const [k,v] of Object.entries(update.$inc||{}))set(doc,k,(get(doc,k)||0)+v);for(const k of Object.keys(update.$unset||{}))unset(doc,k);for(const [k,v] of Object.entries(update.$push||{}))(doc[k]??=[]).push(v);return doc;}
function guardianMatch(doc,filter){
 if(filter._id && String(doc._id)!==String(filter._id))return false;
 if(filter.patient && String(doc.patient)!==String(filter.patient))return false;
 if(filter.guardianEmail && doc.guardianEmail!==filter.guardianEmail)return false;
 if(filter.status){const allowed=filter.status.$in;if(allowed?!allowed.includes(doc.status):doc.status!==filter.status)return false;}
 if(filter["verification.hash"] && doc.verification?.hash!==filter["verification.hash"])return false;
 if(filter["verification.nonce"] && doc.verification?.nonce!==filter["verification.nonce"])return false;
 const expiry=filter["verification.expiresAt"];
 if(expiry?.$gt && !(Number(doc.verification?.expiresAt)>Number(expiry.$gt)))return false;
 if(expiry?.$lte && !(Number(doc.verification?.expiresAt)<=Number(expiry.$lte)))return false;
 const attempts=filter["verification.attempts"];
 if(attempts?.$lt!==undefined && !(Number(doc.verification?.attempts)<Number(attempts.$lt)))return false;
 return true;
}
function fixture(){
 let currentTenant=null,linked=true,next=0,request=null,incident=null,notificationComplete=false;
 const guardians=[],emails=[],corrections=[],policies=[],reviews=[];
 const mongoose={isValidObjectId:validId,Types:{ObjectId:class{constructor(value){this.value=value;}toString(){return this.value;}}},connection:{transaction:async work=>work({}),db:{collection(name){assert.equal(name,"tenants");return{findOne:async filter=>String(filter._id)===ID.tenant?{_id:ID.tenant,slug:"clinic-a"}:null};}}}};
 const Guardian={
  findOne:filter=>query(guardians.find(x=>guardianMatch(x,filter))||null),
  async create(items){return items.map(item=>{const doc={_id:ID.case,status:"pending_email",...item};guardians.push(doc);return doc;});},
  findOneAndUpdate(filter,update){const doc=guardians.find(x=>guardianMatch(x,filter));return query(doc?apply(doc,update):null);},
  async updateOne(filter,update){const doc=guardians.find(x=>guardianMatch(x,filter));if(doc)apply(doc,update);return{matchedCount:doc?1:0};},
 };
 const Request={
  async create(items){const doc={_id:ID.case,status:"pending",...items[0],async save(){return this;}};request=doc;return[doc];},
  findOne:filter=>query(request&&match(request,filter)?request:null),
 };
 const Correction={async create(items){const doc={_id:ID.case,...items[0]};corrections.push(doc);return[doc];}};
 const Policy={findOneAndUpdate(filter,update){const doc=policies.find(x=>match(x,filter));return query(doc?apply(doc,update):null);}};
 const Incident={findById:id=>query(incident&&String(incident._id)===String(id)?incident:null)};
 const dependencies={
  "node:crypto":{default:crypto},mongoose:{default:mongoose},bcryptjs:{default:{compare:async(password,hash)=>password==="correct-password"&&hash==="stored-hash"}},
  "../models/GlobalPatient.js":{default:{}},"../models/PrivacyGuardianCase.js":{default:Guardian},"../models/PrivacyRequest.js":{default:Request},"../models/PrivacyCorrectionReview.js":{default:Correction},"../models/PrivacyRetentionPolicy.js":{default:Policy},"../models/PrivacyIncident.js":{default:Incident},
  "../models/Patient.js":{default:{exists:async filter=>linked&&currentTenant===ID.tenant&&filter.globalPatientId===ID.patient&&!!filter["identityLink.method"]?.$in}},
  "../models/SuperAdmin.js":{default:{findOne:()=>query({_id:ID.owner,passwordHash:"stored-hash",status:"active"})}},
  "../utils/sendEmail.js":{sendEmail:async mail=>{emails.push(mail);}},
  "./privacyRequestService.js":{consumePrivacyChallenge:async(patient,type,otp,work)=>{assert.equal(type,"correction");assert.equal(otp,"123456");return work({});}},
  "./privacyPhase4Service.js":{notificationReadiness:async()=>({complete:notificationComplete})},
  "./tenantExecutionContext.js":{runWithTenant:async(id,work)=>{currentTenant=id;try{return await work();}finally{currentTenant=null;}}},
 };
 return{dependencies,guardians,emails,corrections,policies,reviews,setLinked:value=>linked=value,setNotificationComplete:value=>notificationComplete=value,setRequest:value=>request=value,setIncident:value=>incident=value,createIncident:()=>{incident={_id:ID.case,category:"confirmed_data_breach",status:"open",notificationDecision:"pending",events:[],async save(){return this;}};return incident;}};
}
const minor={_id:ID.patient,email:"child@example.invalid",dateOfBirth:new Date("2015-01-01")};

test("guardian verification requires a minor and a distinct, valid guardian email",async()=>{
 const f=fixture(),s=await load("src/services/privacyPhase3Service.js",f.dependencies);
 await assert.rejects(s.requestGuardianVerification({...minor,dateOfBirth:new Date("1990-01-01")},{guardianName:"Parent",guardianEmail:"parent@example.invalid",relationship:"parent"}),e=>e.status===409);
 await assert.rejects(s.requestGuardianVerification(minor,{guardianName:"Parent",guardianEmail:minor.email,relationship:"parent"}),/own email/);
 await assert.rejects(s.requestGuardianVerification(minor,{guardianName:"Parent",guardianEmail:"invalid",relationship:"parent"}),/valid guardian email/);
 assert.equal(f.emails.length,0);
});
test("guardian OTP is hashed, patient-bound, attempt-limited and single-use",async()=>{
 const f=fixture(),s=await load("src/services/privacyPhase3Service.js",f.dependencies);
 const created=await s.requestGuardianVerification(minor,{guardianName:"Parent Example",guardianEmail:"parent@example.invalid",relationship:"parent"});
 assert.equal(f.emails.length,1);assert.equal(f.guardians[0].verification.hash.length,64);
 const otp=f.emails[0].text.match(/\b\d{6}\b/)[0];assert.notEqual(f.guardians[0].verification.hash,otp);
 await assert.rejects(s.confirmGuardianEmail({...minor,_id:ID.other},created.id,otp),e=>e.status===409);
 await assert.rejects(s.confirmGuardianEmail(minor,created.id,otp==="000000"?"111111":"000000"),e=>e.status===401);
 const verified=await s.confirmGuardianEmail(minor,created.id,otp);assert.equal(verified.status,"awaiting_clinic_review");
 assert.equal(f.guardians[0].verification,undefined);
 await assert.rejects(s.confirmGuardianEmail(minor,created.id,otp),e=>e.status===409);
 assert.equal(Number.isFinite(new Date(verified.emailVerifiedAt).getTime()),true);
});
test("guardian approval requires verified email, correct clinic and positively linked identity",async()=>{
 const f=fixture(),s=await load("src/services/privacyPhase3Service.js",f.dependencies);
 const input={id:ID.case,tenantId:ID.tenant,reviewerId:ID.owner,decision:"verified",evidenceReference:"CLINIC-CASE-123",reviewNote:"Relationship and legal authority verified by clinic staff."};
 await assert.rejects(s.reviewGuardian(input),e=>e.status===409);
 f.guardians.push({_id:ID.case,patient:ID.patient,status:"awaiting_clinic_review",emailVerifiedAt:new Date(),guardianEmail:"parent@example.invalid",guardianName:"Parent",relationship:"parent"});
 await assert.rejects(s.reviewGuardian({...input,tenantId:ID.wrong}),e=>e.status===403);
 f.setLinked(false);await assert.rejects(s.reviewGuardian(input),e=>e.status===403);f.setLinked(true);
 const result=await s.reviewGuardian(input);assert.equal(result.status,"verified");
 assert.equal(result.evidenceReference,undefined);
 const revoked=await s.revokeGuardian(minor,ID.case);assert.equal(revoked.status,"revoked");
 assert.equal(f.guardians[0].status,"revoked");
});
test("structured correction validates scope and records a verified request without editing clinical data",async()=>{
 const f=fixture(),s=await load("src/services/privacyPhase3Service.js",f.dependencies);
 assert.throws(()=>s.validateCorrection({scope:"global_profile",field:"tokenVersion",proposedValue:"0",reason:"Please correct the record."}),/assisted correction/);
 assert.throws(()=>s.validateCorrection({scope:"clinic_record",field:"diagnosis",recordId:"c1",clinicSlug:"$other",proposedValue:"a",reason:"Please correct the record."}),/Invalid clinic/);
 const request=await s.submitStructuredCorrection(minor,{scope:"clinic_record",field:"diagnosis",recordId:"c1",clinicSlug:"clinic-a",proposedValue:"Corrected clinical text",reason:"The existing record contains an error.",otp:"123456"});
 assert.equal(request.status,"pending");assert.equal(request.correction.scope,"clinic_record");assert.equal(f.corrections.length,0);
});
test("correction resolution rejects wrong tenant and platform access to clinic-owned records",async()=>{
 const f=fixture(),s=await load("src/services/privacyPhase3Service.js",f.dependencies);
 const request={_id:ID.case,patient:ID.patient,type:"correction",status:"pending",correction:{scope:"clinic_record",clinicSlug:"clinic-a"},async save(){return this;}};f.setRequest(request);
 const input={requestId:ID.case,patientId:ID.patient,reviewerId:ID.owner,role:"admin",decision:"corrected",evidenceReference:"CLINIC-CASE-123",resolution:"The authorized clinician corrected the source record and reviewed the change."};
 await assert.rejects(s.resolveCorrection(input),e=>e.status===409);
 await assert.rejects(s.resolveCorrection({...input,tenantId:ID.wrong}),e=>e.status===403);
 f.setLinked(false);await assert.rejects(s.resolveCorrection({...input,tenantId:ID.tenant}),e=>e.status===403);f.setLinked(true);
 const review=await s.resolveCorrection({...input,tenantId:ID.tenant});assert.equal(review.decision,"corrected");assert.equal(request.status,"fulfilled");assert.equal(request.execution.kind,"correction_review");
 assert.equal(f.corrections.length,1);
 await assert.rejects(s.resolveCorrection({...input,tenantId:ID.tenant}),e=>e.status===409);
});
test("retention policies require explicit scope and fresh owner password; no deletion occurs",async()=>{
 const f=fixture(),s=await load("src/services/privacyPhase3Service.js",f.dependencies);
 const input={scope:"clinic",tenantId:ID.tenant,category:"Clinical records",version:"policy-2026-v1",legalBasis:"Approved applicable clinical retention obligation.",retentionRule:"Retain until the approved legal period and relevant holds expire.",trigger:"Completion of care",backupRule:"Apply approved backup lifecycle after validation.",evidenceReference:"LEGAL-CASE-123"};
 assert.equal(s.validateRetentionPolicy(input).scope,"clinic");
 assert.throws(()=>s.validateRetentionPolicy({...input,tenantId:null}),/clinic ID/);
 assert.throws(()=>s.validateRetentionPolicy({...input,version:"../../bad"}),/Invalid policy version/);
 f.policies.push({_id:ID.case,status:"draft",...input});
 await assert.rejects(s.approveRetentionPolicy(ID.case,ID.owner,"wrong"),e=>e.status===403);
 const approved=await s.approveRetentionPolicy(ID.case,ID.owner,"correct-password");assert.equal(approved.status,"approved");
 assert.equal(approved.approvedBy,ID.owner);
 await assert.rejects(s.approveRetentionPolicy(ID.case,ID.owner,"correct-password"),e=>e.status===409);
});
test("legacy incident event workflow cannot bypass independent closure approval",async()=>{
 const f=fixture(),s=await load("src/services/privacyPhase3Service.js",f.dependencies),incident=f.createIncident();
 const input={id:ID.case,actorId:ID.owner,note:"The privacy team reviewed and documented the relevant incident facts.",evidenceReference:"INCIDENT-CASE-123"};
 await assert.rejects(s.appendIncidentEvent({...input,kind:"closed"}),/independent closure approval/);
 await assert.rejects(s.appendIncidentEvent({...input,kind:"notification_review"}),/notification decision/);
 await s.appendIncidentEvent({...input,kind:"notification_review",notificationDecision:"required"});
 assert.equal(incident.notificationDecision,"required");
 await assert.rejects(s.appendIncidentEvent({...input,kind:"closed"}),/independent closure approval/);
 await assert.rejects(s.appendIncidentEvent({...input,kind:"notification_recorded"}),/separate audience-specific/);
 assert.notEqual(incident.status,"closed");assert.equal(incident.events.length,1);
});
test("incident input rejects invalid dates, counts and tenant identifiers",async()=>{
 const f=fixture(),s=await load("src/services/privacyPhase3Service.js",f.dependencies);
 const input={title:"Suspected exposure",description:"A synthetic incident requiring further investigation.",category:"suspected_data_breach",detectedAt:"2026-09-09T01:00:00Z",tenantIds:[ID.tenant]};
 assert.equal(s.validateIncident(input).category,"suspected_data_breach");
 assert.throws(()=>s.validateIncident({...input,detectedAt:"not-a-date"}),/Invalid detection/);
 assert.throws(()=>s.validateIncident({...input,estimatedAffectedCount:"NaN"}),/Invalid affected-person/);
 assert.throws(()=>s.validateIncident({...input,tenantIds:["bad"]}),/Invalid affected-clinic/);
});
test("privileged routes bind actor and patient identities to authenticated records, not request bodies",async()=>{
 const routes=new Map(),noop=()=>{};
 const router={get(path,...handlers){routes.set(`GET ${path}`,handlers);},post(path,...handlers){routes.set(`POST ${path}`,handlers);}};
 const protectSuperAdmin=function protectSuperAdmin(){};
 const captured=[];
 const Request={findOne:()=>query({_id:ID.case,patient:ID.patient})};
 const deps={
  "node:crypto":{default:crypto},mongoose:{default:{isValidObjectId:validId,Types:{ObjectId:class{constructor(v){this.value=v;}toString(){return this.value;}}},connection:{db:{collection:()=>({findOne:async()=>({_id:ID.tenant})})}}}},
  "express-rate-limit":{default:()=>noop},"../utils/httpSafety.js":{asyncRouter:()=>router,publicErrorMessage:e=>e.message},
  "../middleware/globalPatientAuth.js":{protectGlobalPatient:noop},"../middleware/platformAuth.js":{protectSuperAdmin},
  "../utils/rateLimitStore.js":{createRateLimitStore:()=>({})},"../utils/securityEvents.js":{logSecurityEvent:noop},
  "../models/GlobalPatient.js":{default:{}},"../models/PrivacyGuardianCase.js":{default:{}},"../models/PrivacyRequest.js":{default:Request},"../models/PrivacyCorrectionReview.js":{default:{}},"../models/PrivacyRetentionPolicy.js":{default:{}},"../models/PrivacyIncident.js":{default:{}},
  "../services/privacyRequestService.js":{issuePrivacyChallenge:noop},
  "../services/incidentResponseService.js":{sendSecurityAlert:noop},
  "../services/privacyPhase3Service.js":{requestGuardianVerification:noop,confirmGuardianEmail:noop,revokeGuardian:noop,guardianPublic:noop,submitStructuredCorrection:noop,resolveCorrection:async args=>{captured.push(args);return{decision:"corrected",reviewedAt:new Date()};},validateRetentionPolicy:noop,approveRetentionPolicy:noop,validateIncident:noop,appendIncidentEvent:async args=>{captured.push(args);return{_id:ID.case,status:"triage",events:[]};},privacyFailure:(message,status=400)=>Object.assign(Error(message),{status})},
 };
 await load("src/routes/privacyPhase3Routes.js",deps);
 const correction=routes.get("POST /admin/corrections/:id/resolve");assert.equal(correction[0],protectSuperAdmin);
 const req={params:{id:ID.case},superAdmin:{id:ID.owner},body:{patientId:ID.other,reviewerId:ID.other,role:"patient",requestId:ID.other,decision:"corrected",evidenceReference:"CASE-12345",resolution:"The authorized record change was reviewed and verified."}};
 const res={status(){return this;},json(value){this.body=value;return value;}};
 await correction.at(-1)(req,res);assert.equal(captured[0].patientId,ID.patient);assert.equal(captured[0].reviewerId,ID.owner);assert.equal(captured[0].role,"superadmin");assert.equal(captured[0].requestId,ID.case);
 const incident=routes.get("POST /admin/incidents/:id/events");assert.equal(incident[0],protectSuperAdmin);
 await incident.at(-1)({...req,body:{actorId:ID.other,id:ID.other,kind:"triage",note:"The authorized incident was reviewed."}},res);
 assert.equal(captured[1].actorId,ID.owner);assert.equal(captured[1].id,ID.case);
});
