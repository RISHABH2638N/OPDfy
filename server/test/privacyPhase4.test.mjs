import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const other = "bbbbbbbbbbbbbbbbbbbbbbbb";
const query = value => ({ select(){return this;}, lean(){return this;}, sort(){return this;}, session(){return this;}, then(resolve,reject){return Promise.resolve(value).then(resolve,reject);} });
async function load(name, dependencies = {}, globals = {}) {
  const context = vm.createContext({ console, Buffer, process, setTimeout, clearTimeout, ...globals });
  const module = new vm.SourceTextModule(read(name), { context });
  await module.link(async specifier => {
    if (!(specifier in dependencies)) throw Error(`Unexpected import: ${specifier}`);
    const exports = dependencies[specifier];
    return new vm.SyntheticModule(["default", ...Object.keys(exports).filter(k => k !== "default")], function () {
      this.setExport("default", exports.default ?? exports);
      for (const [key, value] of Object.entries(exports)) if (key !== "default") this.setExport(key, value);
    }, { context });
  });
  await module.evaluate(); return module.namespace;
}
function fixture() {
  let incident = { _id: ID, status: "open", category: "confirmed_data_breach" };
  const notifications = [], checks = [];
  const doc = value => ({ ...value, async save(){ return this; } });
  const matches = (item, filter) => Object.entries(filter).every(([key,value]) => String(item[key]) === String(value));
  const Notification = {
    findOne: filter => query(notifications.find(x => matches(x,filter)) || null),
    find: filter => query(notifications.filter(x => matches(x,filter))),
    async create(items){const result=items.map(item=>doc({ _id: `notification-${notifications.length+1}`, events: [], ...item }));notifications.push(...result);return result;},
    countDocuments: async()=>0,
  };
  const Check = {
    findOne: filter => query(checks.find(x => matches(x,filter)) || null),
    async create(items){const result=items.map(item=>doc({ _id: `check-${checks.length+1}`, events: [], ...item }));checks.push(...result);return result;},
    find:()=>query(checks),
  };
  const empty = { find:()=>query([]) };
  const dependencies = {
    mongoose: { default: {isValidObjectId: value=>typeof value==="string"&&/^[a-f0-9]{24}$/.test(value),connection:{transaction:async work=>work({})}} },
    bcryptjs: { default: {compare:async(password,hash)=>password==="correct-password"&&hash==="stored-hash"} },
    "../models/PrivacyOperationalCheck.js":{default:Check},
    "../models/PrivacyNotificationRecord.js":{default:Notification},
    "../models/PrivacyIncident.js":{default:{findById:id=>query(String(id)===String(incident._id)?incident:null),find:()=>query([incident])}},
    "../models/PrivacyRetentionPolicy.js":{default:empty},
    "../models/OperationalJobStatus.js":{default:empty},
    "../models/SuperAdmin.js":{default:{findOne:()=>query({passwordHash:"stored-hash"})}},
    "./operationalJobMonitor.js":{maintenanceHealth:()=>[]},
    "../utils/privacySafeLog.js":{auditRetentionDays:()=>365,safeDiagnostic:()=>"ERROR"},
  };
  return { dependencies, notifications, checks, setIncident:value=>incident=value };
}
const note = "The responsible privacy reviewer documented the assessment and evidence.";
const evidence = "PRIVACY-CASE-123";
const legalBasis = "Reviewed applicable notification duties and recorded the responsible legal assessment.";
const dueAt = new Date(Date.now()+3600000).toISOString();
const deliveredAt = new Date(Date.now()-60000).toISOString();

test("safe logs discard query strings, bearer keys, identifiers and sensitive metadata", async()=>{
  const s=await load("src/utils/privacySafeLog.js",{"node:crypto":{default:crypto}});
  const route=s.safeRoute(`/api/patients/${ID}/record?otp=123456&token=secret`);
  assert.equal(route,"/api/patients/:id/record");
  assert.equal(s.safeRoute("/display/"+"a".repeat(48)),"/display/:key");
  const metadata=s.safeSecurityMetadata({email:"person@example.invalid",password:"secret",reason:"Medical diagnosis",requestId:ID,status:"pending",code:"AUTH_FAIL",unknown:"private"});
  assert.equal(metadata.email,undefined);assert.equal(metadata.reason,undefined);assert.equal(metadata.unknown,undefined);
  assert.equal(metadata.requestId,ID);assert.equal(metadata.status,"pending");
  assert.equal(s.safeDiagnostic({code:"SECRET\nPASSWORD"}),"ERROR");
  assert.equal(s.auditRetentionDays(90),365);assert.equal(s.auditRetentionDays(730),730);
});

test("retention preflight detects legacy, wrong-name, shorter and mismatched TTL indexes",async()=>{
  const s=await load("src/services/privacyRetentionSafety.js",{"../utils/privacySafeLog.js":{auditRetentionDays:()=>365}});
  assert.equal(s.inspectRetentionIndexes("securityevents",[{name:"createdAt_1",key:{createdAt:1},expireAfterSeconds:90*86400}]).length,1);
  assert.equal(s.inspectRetentionIndexes("securityevents",[{name:"security_event_ttl",key:{createdAt:1},expireAfterSeconds:365*86400}]).length,0);
  assert.equal(s.inspectRetentionIndexes("securityevents",[{name:"security_event_ttl",key:{createdAt:1},expireAfterSeconds:730*86400}]).length,1);
  assert.equal(s.inspectRetentionIndexes("activitylogs",[{name:"activity_log_ttl",key:{expiresAt:1},expireAfterSeconds:0}]).length,0);
  assert.equal(s.inspectRetentionIndexes("activitylogs",[{name:"activity_log_ttl",key:{expiresAt:1},expireAfterSeconds:1}]).length,1);
  await assert.rejects(s.assertPrivacyRetentionIndexes({collection:()=>({indexes:async()=>[{name:"createdAt_1",key:{createdAt:1},expireAfterSeconds:90*86400}]})}),e=>e.code==="PRIVACY_RETENTION_MIGRATION_REQUIRED");
});

test("readiness is false for missing, waived or expired evidence",async()=>{
  const f=fixture(),s=await load("src/services/privacyPhase4Service.js",f.dependencies);
  assert.equal(s.readinessSummary([]).ready,false);
  assert.equal(s.readinessSummary([{key:"backup_restore",status:"passed",expiresAt:new Date(Date.now()-1000)}]).checks[0].ready,false);
  assert.equal(s.readinessSummary([{key:"backup_restore",status:"waived",expiresAt:new Date(Date.now()+100000)}]).checks[0].ready,false);
  assert.throws(()=>s.validateOperationalReview({key:"backup_restore",status:"passed",note,evidenceReference:evidence}),/expiry/);
  assert.throws(()=>s.validateOperationalReview({key:"delete_database",status:"passed",note,evidenceReference:evidence,expiresAt:dueAt}),/Invalid readiness/);
  await assert.rejects(s.ownerStepUp(ID,"wrong"),e=>e.status===403);
  await s.ownerStepUp(ID,"correct-password");
});

test("readiness reviews retain evidence history and reject stale concurrent changes",async()=>{
  const f=fixture(),s=await load("src/services/privacyPhase4Service.js",f.dependencies);
  const input={key:"backup_restore",status:"passed",note,evidenceReference:evidence,expiresAt:dueAt};
  const first=await s.recordOperationalReview(input,ID);assert.equal(first.events.length,1);
  const second=await s.recordOperationalReview({...input,status:"failed",expiresAt:null},ID);
  assert.equal(second.events.length,2);assert.equal(second.status,"failed");
  assert.equal(s.readinessSummary(f.checks).ready,false);
});

test("notification validation requires legal assessment, deadline and actual delivery evidence",async()=>{
  const f=fixture(),s=await load("src/services/privacyPhase4Service.js",f.dependencies);
  const input={audience:"board",status:"required",note,evidenceReference:evidence,legalBasis};
  assert.throws(()=>s.validateNotificationReview(input),/deadline/);
  assert.throws(()=>s.validateNotificationReview({...input,audience:"all_patients",dueAt}),/Invalid notification/);
  assert.throws(()=>s.validateNotificationReview({...input,status:"delivered",deliveredAt:new Date(Date.now()+60000).toISOString()}),/delivery time/);
  assert.throws(()=>s.validateNotificationReview({...input,status:"not_required",deliveredAt}),/only valid/);
  assert.equal(s.validateNotificationReview({...input,dueAt}).status,"required");
});

test("notification delivery requires an earlier required decision and cannot be downgraded",async()=>{
  const f=fixture(),s=await load("src/services/privacyPhase4Service.js",f.dependencies);
  const input={audience:"board",status:"required",note,evidenceReference:evidence,legalBasis,dueAt};
  await assert.rejects(s.recordNotificationReview(ID,{...input,status:"delivered",deliveredAt},ID),e=>e.status===409);
  const required=await s.recordNotificationReview(ID,input,ID);assert.equal(required.events.length,1);
  const delivered=await s.recordNotificationReview(ID,{...input,status:"delivered",deliveredAt},ID);
  assert.equal(delivered.status,"delivered");assert.equal(delivered.events.length,2);
  assert.equal(delivered.events[0].toStatus,"required");assert.equal(delivered.events[1].toStatus,"delivered");
  await assert.rejects(s.recordNotificationReview(ID,{...input,status:"not_required",dueAt:null},ID),e=>e.status===409);
  assert.equal(f.notifications[0].status,"delivered");
});

test("Board and affected-individual decisions are independent and required before closure",async()=>{
  const f=fixture(),s=await load("src/services/privacyPhase4Service.js",f.dependencies);
  await s.recordNotificationReview(ID,{audience:"board",status:"not_required",note,evidenceReference:evidence,legalBasis},ID);
  assert.equal((await s.notificationReadiness(ID)).complete,false);
  await s.recordNotificationReview(ID,{audience:"affected_individuals",status:"required",note,evidenceReference:evidence,legalBasis,dueAt},ID);
  assert.equal((await s.notificationReadiness(ID)).complete,false);
  await s.recordNotificationReview(ID,{audience:"affected_individuals",status:"delivered",note,evidenceReference:evidence,legalBasis,deliveredAt},ID);
  assert.equal((await s.notificationReadiness(ID)).complete,true);
  f.setIncident({_id:ID,status:"closed"});
  await assert.rejects(s.recordNotificationReview(ID,{audience:"other_authority",status:"not_required",note,evidenceReference:evidence,legalBasis},ID),e=>e.status===409);
  await assert.rejects(s.recordNotificationReview(other,{audience:"board",status:"required",note,evidenceReference:evidence,legalBasis,dueAt},ID),e=>e.status===404);
});

test("job monitoring identifies stale schedules and saves only safe diagnostic codes",async()=>{
  const writes=[];
  const s=await load("src/services/operationalJobMonitor.js",{
    "../models/OperationalJobStatus.js":{default:{updateOne:async(...args)=>{writes.push(args);}}},
    "../utils/privacySafeLog.js":{safeDiagnostic:()=>"ETIMEDOUT"},
  });
  const health=s.maintenanceHealth([{key:"appointment_reminders",lastSuccessAt:new Date(Date.now()-60000),lastOutcome:"success"}]);
  assert.equal(health.find(x=>x.key==="appointment_reminders").stale,false);
  assert.equal(health.find(x=>x.key==="followup_reminders").stale,true);
  await s.recordMaintenanceRun("appointment_reminders","failure",new Date(Date.now()-1000),new Error("Sensitive database URI"));
  assert.equal(writes[0][1].$set.failureCode,"ETIMEDOUT");
  assert.equal(JSON.stringify(writes).includes("Sensitive database URI"),false);
});

test("monitoring write failure cannot retry a successfully completed clinical job",async()=>{
  const s=await load("src/services/resilientJob.js",{"../utils/privacySafeLog.js":{safeDiagnostic:()=>"ERROR"}});
  let calls=0, failures=0;
  const job=s.createResilientJob("Synthetic",async()=>{calls++;return "done";},{onSuccess:async()=>{throw Error("Monitoring unavailable");},onFailure:async()=>{failures++;}});
  assert.equal(await job(),"done");assert.equal(calls,1);assert.equal(failures,0);
});

test("owner-only operations routes and backup tools contain no automatic deletion or statutory sending",async()=>{
  const routes=read("src/routes/privacyPhase4Routes.js");
  assert.match(routes,/router\.use\(protectSuperAdmin\)/);
  assert.match(routes,/ownerStepUp\(req\.superAdmin\.id/);
  assert.doesNotMatch(routes,/deleteMany\(|dropDatabase\(|sendEmail\(/);
  const restore=read("scripts/privacyRestoreDrill.mjs");
  assert.match(restore,/RESTORE_TO_DISPOSABLE_DATABASE/);
  assert.match(restore,/opd_restore_/);
  assert.doesNotMatch(restore,/--drop|dropDatabase\(/);
  const migration=read("scripts/privacyRetentionMigration.js");
  assert.match(migration,/PRIVACY_RETENTION_MIGRATION_APPROVED/);
  assert.match(migration,/--acknowledge-retention-review/);
  const closure=read("src/services/privacyClosureService.js");
  assert.match(closure,/PRIVACY_ERASURE_ENABLED/);
});

test("backup manifest validation rejects mismatched or malformed sources",async()=>{
  const s=await load("src/utils/privacyBackupIntegrity.js",{"node:fs":{default:fs},"node:crypto":{default:crypto},"node:path":{default:await import("node:path")}});
  const manifest={format:"opd-mongodb-backup-v1",database:"opd_test",filename:"backup.archive.gz",bytes:12,sha256:"a".repeat(64),collectionCounts:{patients:1}};
  assert.equal(s.validateBackupManifest(manifest,"/tmp/backup.archive.gz","opd_test").database,"opd_test");
  assert.throws(()=>s.validateBackupManifest({...manifest,bytes:0},"/tmp/backup.archive.gz"),/Invalid backup/);
  assert.throws(()=>s.validateBackupManifest(manifest,"/tmp/other.archive.gz"),/Invalid backup/);
  assert.throws(()=>s.validateBackupManifest(manifest,"/tmp/backup.archive.gz","production"),/Invalid backup/);
});
