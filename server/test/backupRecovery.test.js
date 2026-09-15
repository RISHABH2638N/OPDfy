import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BackupRecord from "../src/models/BackupRecord.js";
import RestoreDrillRecord from "../src/models/RestoreDrillRecord.js";
import { backupStorageConfig, deleteBackupObject, downloadBackupObject, uploadBackupObject } from "../src/services/backupStorageService.js";
import { runScheduledBackup } from "../src/services/backupRecoveryService.js";

const id="aaaaaaaaaaaaaaaaaaaaaaaa";
test("backup and restore records validate safe workflow states",async()=>{
 const backup=new BackupRecord({trigger:"manual",status:"queued",database:"opd_system",provider:"s3",retentionClass:"daily",expiresAt:new Date(Date.now()+86400000),requestedBy:id});
 await backup.validate(); assert.equal(backup.status,"queued");
 const drill=new RestoreDrillRecord({backup:id,targetDatabase:"opd_restore_20260912_abcd1234",requestedBy:id});
 await drill.validate(); assert.equal(drill.manualFunctionalVerificationRequired,true);
});
test("local storage adapter is development-only and preserves exact bytes",async()=>{
 const before={node:process.env.NODE_ENV,provider:process.env.BACKUP_STORAGE_PROVIDER,directory:process.env.BACKUP_STORAGE_DIR};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"opd-storage-test-")),source=path.join(root,"source.bin"),target=path.join(root,"target.bin");
 try{
  process.env.NODE_ENV="development";process.env.BACKUP_STORAGE_PROVIDER="local";process.env.BACKUP_STORAGE_DIR=path.join(root,"store");
  fs.writeFileSync(source,Buffer.from("encrypted-test-payload"));assert.equal(backupStorageConfig().provider,"local");
  await uploadBackupObject("backups/test/item.enc",source,"application/octet-stream");await downloadBackupObject("backups/test/item.enc",target);
  assert.deepEqual(fs.readFileSync(target),fs.readFileSync(source));await deleteBackupObject("backups/test/item.enc");
  process.env.NODE_ENV="production";assert.throws(()=>backupStorageConfig(),/prohibited in production/);
 }finally{for(const [key,value]of Object.entries(before)){const name=key==="node"?"NODE_ENV":key==="provider"?"BACKUP_STORAGE_PROVIDER":"BACKUP_STORAGE_DIR";if(value===undefined)delete process.env[name];else process.env[name]=value;}fs.rmSync(root,{recursive:true,force:true});}
});
test("scheduler stays inert unless explicitly enabled",async()=>{const old=process.env.BACKUP_SCHEDULE_ENABLED;process.env.BACKUP_SCHEDULE_ENABLED="false";try{assert.equal(await runScheduledBackup(),null);}finally{if(old===undefined)delete process.env.BACKUP_SCHEDULE_ENABLED;else process.env.BACKUP_SCHEDULE_ENABLED=old;}});
test("backup APIs are platform protected and production restore is absent",()=>{
 const routes=fs.readFileSync(new URL("../src/routes/backupRecoveryRoutes.js",import.meta.url),"utf8"),service=fs.readFileSync(new URL("../src/services/backupRecoveryService.js",import.meta.url),"utf8");
 assert.match(routes,/router\.use\(protectSuperAdmin\)/);assert.match(routes,/ownerStepUp\(req\.superAdmin\.id/);assert.match(routes,/RESTORE TO DISPOSABLE DATABASE/);
 assert.doesNotMatch(routes,/production-restore|dropDatabase|deleteMany/);assert.match(service,/productionRestoreEnabled:false/);assert.match(service,/aes-256-gcm/);assert.doesNotMatch(service,/console\.log\(process\.env/);
});

test("background recovery errors are handled even when the database cannot claim a job", async () => {
 const { launchRecoveryJob } = await import("../src/services/backupRecoveryService.js");
 const original = BackupRecord.findOneAndUpdate, log = console.error, recipient = process.env.SECURITY_ALERT_EMAIL;
 const logs = [];
 try {
  delete process.env.SECURITY_ALERT_EMAIL;
  console.error = (...args) => logs.push(args.join(" "));
  BackupRecord.findOneAndUpdate = async () => { throw Object.assign(new Error("private database details"), { code: "DB_OFFLINE" }); };
  await assert.doesNotReject(launchRecoveryJob("backup", id));
  assert.ok(logs.some(line => line.includes("DB_OFFLINE")));
  assert.ok(logs.every(line => !line.includes("private database details")));
 } finally {
  BackupRecord.findOneAndUpdate = original; console.error = log;
  if (recipient === undefined) delete process.env.SECURITY_ALERT_EMAIL; else process.env.SECURITY_ALERT_EMAIL = recipient;
 }
});

test("temporary-directory failure marks the claimed backup failed instead of leaving it running", async () => {
 const { executeBackup } = await import("../src/services/backupRecoveryService.js");
 const claim = BackupRecord.findOneAndUpdate, update = BackupRecord.updateOne, makeDir = fs.mkdtempSync, recipient = process.env.SECURITY_ALERT_EMAIL;
 const writes = [];
 try {
  delete process.env.SECURITY_ALERT_EMAIL;
  BackupRecord.findOneAndUpdate = async () => ({ _id: id });
  BackupRecord.updateOne = async (filter, change) => { writes.push({ filter, change }); };
  fs.mkdtempSync = () => { throw Object.assign(new Error("no temporary space"), { code: "ENOSPC" }); };
  await executeBackup(id);
  assert.equal(writes[0].change.$set.status, "failed");
  assert.equal(writes[0].change.$set.failureCode, "ENOSPC");
 } finally {
  BackupRecord.findOneAndUpdate = claim; BackupRecord.updateOne = update; fs.mkdtempSync = makeDir;
  if (recipient === undefined) delete process.env.SECURITY_ALERT_EMAIL; else process.env.SECURITY_ALERT_EMAIL = recipient;
 }
});

test("simultaneous backup submissions create one queued job in a single server process", async () => {
 const { queueBackup } = await import("../src/services/backupRecoveryService.js");
 const names = ['NODE_ENV','BACKUP_STORAGE_PROVIDER','BACKUP_STORAGE_DIR','BACKUP_DATABASE_NAME','BACKUP_ENCRYPTION_KEY'];
 const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
 const exists = BackupRecord.exists, create = BackupRecord.create;
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opd-admission-test-'));
 let queued = false, creations = 0;
 try {
  Object.assign(process.env, { NODE_ENV:'test',BACKUP_STORAGE_PROVIDER:'local',BACKUP_STORAGE_DIR:root,BACKUP_DATABASE_NAME:'audit_test',BACKUP_ENCRYPTION_KEY:Buffer.alloc(32, 1).toString('base64') });
  BackupRecord.exists = async () => { const result = queued; await new Promise(resolve => setTimeout(resolve, 5)); return result; };
  BackupRecord.create = async data => { creations++; queued = true; return { ...data, _id:id }; };
  const outcomes = await Promise.allSettled([queueBackup({trigger:'manual'}), queueBackup({trigger:'manual'})]);
  assert.equal(creations, 1);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.status, 409);
  queued = false;
  assert.ok(await queueBackup({trigger:'manual'}));
 } finally {
  BackupRecord.exists = exists; BackupRecord.create = create;
  for (const [name,value] of Object.entries(saved)) if(value===undefined)delete process.env[name];else process.env[name]=value;
  fs.rmSync(root,{recursive:true,force:true});
 }
});
