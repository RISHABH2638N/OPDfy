import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../src/routes/aiRoutes.js",import.meta.url),"utf8");
async function fixture(decisions){
 const routes=new Map(),calls=[];
 const noop=()=>{};
 const router={post(path,...handlers){routes.set(path,handlers.at(-1));}};
 const deps={
  "../services/privacyConsentService.js":{hasExternalAiConsent:async id=>{assert.equal(id,"own-global-account");return decisions.shift()??false;}},
  "../utils/httpSafety.js":{asyncRouter:()=>router,publicErrorMessage:e=>e.message},
  express:{default:{}},"express-rate-limit":{default:()=>noop},
  "../models/Token.js":{default:{}},"../models/User.js":{default:{}},
  "../middleware/patientAuth.js":{protectPatient:noop},
  "../utils/departments.js":{DEPARTMENTS:["General OPD","Dermatology","Orthopedics","ENT","Cardiology","Pediatrics"]},
  "../utils/doctorAvailability.js":{getDoctorAvailability:noop},
  "../utils/waitTime.js":{getTokenWaitEstimate:noop},
  "../services/notificationService.js":{processQueueNotifications:noop},
  "../services/queueReservationService.js":{createOnlineQueueReservation:noop},
  "../services/realtimeService.js":{emitOperationalUpdate:noop,emitQueueUpdate:noop},
  "../utils/rateLimitStore.js":{createRateLimitStore:()=>({})},
 };
 const context=vm.createContext({console,Buffer,process,AbortSignal,setTimeout,fetch:async(url,options)=>{
  calls.push({url,options});return{ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({department:"Dermatology",urgency:"normal",confidence:0.7,reason:"Skin complaint",redFlags:[],nextStep:"Consult a qualified clinician."})}]}}]})};
 }});
 const module=new vm.SourceTextModule(source,{context});
 await module.link(async name=>{
  if(!(name in deps))throw Error(`Unexpected import ${name}`);
  const exports=deps[name];return new vm.SyntheticModule(["default",...Object.keys(exports).filter(k=>k!=="default")],function(){this.setExport("default",exports.default??exports);for(const[k,v]of Object.entries(exports))if(k!=="default")this.setExport(k,v);},{context});
 });await module.evaluate();
 const invoke=async(input={})=>{
  const req={body:{symptoms:"Mild itchy skin for several days",allowExternalAI:true,...input},globalPatient:{_id:"own-global-account"},patient:{_id:"clinic-patient",dateOfBirth:new Date("1990-01-01"),gender:"Other"}};
  const res={locals:{},status(code){this.statusCode=code;return this;},json(value){this.body=value;return value;}};
  await routes.get("/triage")(req,res);return res;
 };
 return{calls,invoke};
}
test("withdrawn consent blocks outbound Gemini requests while preserving rule-based triage",async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="synthetic-test-key";
 try{const f=await fixture([false]);const res=await f.invoke();assert.equal(f.calls.length,0);assert.equal(res.body.source,"rule-based-fallback");assert.equal(res.body.externalAIUsed,false);assert.equal(res.body.externalAIContacted,false);assert.ok(res.body.triage.department);}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
test("client approval flag alone cannot override absent server consent",async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="synthetic-test-key";
 try{const f=await fixture([false]);await f.invoke({globalPatientId:"another-account",allowExternalAI:true});assert.equal(f.calls.length,0);}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
test("consent revoked between initial check and outbound call prevents disclosure",async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="synthetic-test-key";
 try{const f=await fixture([true,false]);const res=await f.invoke();assert.equal(f.calls.length,0);assert.equal(res.body.externalAIContacted,false);assert.equal(res.body.externalAIUsed,false);}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
test("granted consent and explicit request allow an attributed, minimized external call",async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="synthetic-test-key";
 try{const f=await fixture([true,true]);const res=await f.invoke();assert.equal(f.calls.length,1);assert.equal(res.body.source,"gemini");assert.equal(res.body.externalAIUsed,true);assert.equal(res.body.externalAIContacted,true);const body=f.calls[0].options.body;assert.doesNotMatch(body,/own-global-account|clinic-patient|child@example|another-account/);assert.equal(JSON.parse(body).contents.length,1);}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
test("a missing explicit AI request flag retains built-in triage even with stored consent",async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="synthetic-test-key";
 try{const f=await fixture([true]);const res=await f.invoke({allowExternalAI:false});assert.equal(f.calls.length,0);assert.equal(res.body.externalAIContacted,false);}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
