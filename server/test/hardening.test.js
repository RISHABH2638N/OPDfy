import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import SecurityEvent from "../src/models/SecurityEvent.js";
import { base32, totp, verifyTotp } from "../src/utils/totp.js";
import { onlineReservationLimit } from "../src/services/queueReservationService.js";
import { sensitiveAccessAudit, sensitiveAccessDescriptor } from "../src/middleware/sensitiveAccessAudit.js";
import { logSecurityEvent, securityAuditHealth } from "../src/utils/securityEvents.js";
import { createRealtimeAdmission } from "../src/services/realtimeAdmission.js";

test("TOTP matches RFC 6238 SHA-1 vectors and rejects reused time steps", () => {
 const secret=base32(Buffer.from("12345678901234567890"));
 for(const [seconds,expected] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]])
  assert.equal(totp(secret,{time:seconds*1000,digits:8}),expected);
 const time=1234567890000,counter=Math.floor(time/30000),code=totp(secret,{time});
 assert.equal(verifyTotp(secret,code,{now:time}),counter);
 assert.equal(verifyTotp(secret,code,{now:time,lastCounter:counter}),null);
 assert.equal(verifyTotp(secret,"000",{now:time}),null);
});
test("zero capacity is closed and missing per-doctor capacity inherits without overwriting zero", () => {
 const old=process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR;
 try{ delete process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR;assert.equal(onlineReservationLimit(),70);
 process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR="0";assert.equal(onlineReservationLimit(),0);
 assert.equal(onlineReservationLimit({onlineReservationCapacity:5}),5);
 process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR="-1";assert.throws(()=>onlineReservationLimit(),/not configured/);
 }finally{if(old===undefined)delete process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR;else process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR=old;}
});
test("read audit includes previously omitted and self-access routes but excludes public queues",()=>{
 for(const path of ["/api/tokens/private","/api/reception/appointments/today","/api/patient-auth/me","/api/patients/me/history"])
  assert.ok(sensitiveAccessDescriptor(path));
 assert.equal(sensitiveAccessDescriptor("/api/tokens"),null);
});
test("denied reads retain safe actor/status context without patient or query contents",async t=>{
 const events=[];t.mock.method(SecurityEvent,"create",async value=>{events.push(value);return value;});
 const res=new EventEmitter();res.statusCode=403;
 sensitiveAccessAudit({method:"GET",originalUrl:"/api/reception/appointments/today?patientName=PRIVATE",user:{id:"staff",role:"doctor"},tenantId:null},res,()=>{});
 res.emit("finish");await new Promise(r=>setImmediate(r));
 assert.equal(events[0].outcome,"blocked");assert.equal(events[0].actorType,"staff");
 assert.equal(events[0].metadata.status,403);assert.equal(JSON.stringify(events).includes("PRIVATE"),false);
});
test("audit persistence failures are observable and cannot fail a clinical response",async t=>{
 const previous=securityAuditHealth();t.mock.method(SecurityEvent,"create",async()=>{throw Object.assign(new Error("PRIVATE record"),{code:"DB_OFFLINE"});});
 await assert.doesNotReject(logSecurityEvent({}, {event:"local_test",outcome:"failure"}));
 const current=securityAuditHealth();assert.equal(current.failures,previous.failures+1);
 assert.equal(current.lastFailureCode,"DB_OFFLINE");assert.equal(current.pending,0);
 assert.equal(JSON.stringify(current).includes("PRIVATE"),false);
});
test("local socket admission rejects excess before shared storage work and releases failed handshakes",async()=>{
 let queries=0;const store={async acquire(){queries++;return true;},async release(){},async renew(){}};
 const quota=createRealtimeAdmission({resolveIp:req=>req.address,store,limits:{perIp:1,total:2,attempts:10,leaseMs:90000,windowMs:60000}});
 const req={address:"same-network"};const allow=request=>new Promise(resolve=>quota.allow(request,(_error,ok)=>resolve(ok)));
 try{assert.equal(await allow(req),true);assert.equal(await allow({address:"same-network"}),false);assert.equal(queries,1);
 const engine=new EventEmitter();engine.request=req;engine.close=()=>engine.emit("close");quota.connected(engine);engine.emit("close");
 assert.equal(await allow({address:"same-network"}),true);assert.equal(queries,2);
 }finally{await quota.close();assert.equal(quota.snapshot().active,0);}
});


test("production MFA encryption keys cannot reuse JWT keys or weak placeholders", () => {
 const names=["JWT_SECRET","SUPER_ADMIN_JWT_SECRET","QR_JWT_SECRET","DISPLAY_KEY_ENCRYPTION_SECRET"];
 const env={...process.env,NODE_ENV:"production",MONGO_URI:"mongodb://127.0.0.1:1/synthetic-unused",CLIENT_URL:"https://local-test.example.invalid",DEFAULT_TENANT_SLUG:"",TRUST_PROXY_HOPS:"0",PLATFORM_MFA_REQUIRED:"false"};
 for(const key of names)env[key]=crypto.randomBytes(32).toString("hex");
 for(const value of [env.JWT_SECRET,"a".repeat(32),"replace-this-with-a-generated-secret"]){
  env.PLATFORM_MFA_ENCRYPTION_SECRET=value;
  const result=spawnSync(process.execPath,["--input-type=module","-e",'import { validateRuntimeEnv } from "./src/utils/runtimeConfig.js"; validateRuntimeEnv();'],{cwd:new URL("../",import.meta.url),env,encoding:"utf8"});
  assert.notEqual(result.status,0);
 }
});
