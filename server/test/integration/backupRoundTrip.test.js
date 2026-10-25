import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import mongoose from 'mongoose';import {MongoClient} from 'mongodb';import {MongoMemoryReplSet} from 'mongodb-memory-server';
import Tenant from '../../src/models/Tenant.js';import Patient from '../../src/models/Patient.js';import BackupRecord from '../../src/models/BackupRecord.js';import RestoreDrillRecord from '../../src/models/RestoreDrillRecord.js';
import {runWithTenant} from '../../src/services/tenantExecutionContext.js';
import {queueBackup,executeBackup,queueRestoreDrill,executeRestoreDrill} from '../../src/services/backupRecoveryService.js';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function credentialUri(db,user,password){const url=new URL(db.getUri());url.username=user;url.password=password;url.searchParams.set('authSource','admin');return url.toString();}
test('real encrypted backup and isolated authenticated restore', {timeout:120000},async t=>{
 const dump=process.env.MONGODUMP_BIN||'mongodump',restore=process.env.MONGORESTORE_BIN||'mongorestore';
 if([dump,restore].some(bin=>spawnSync(bin,['--version'],{encoding:'utf8',timeout:5000}).status!==0)){t.skip('MongoDB Database Tools unavailable: set MONGODUMP_BIN and MONGORESTORE_BIN to run the actual round trip.');return;}
 let source,target,client;const temp=fs.mkdtempSync(path.join(os.tmpdir(),'opdfy-qa-backup-')),report={synthetic:true,separateDeployments:true,authenticated:true,checks:[]};
 const start=async()=>{const name='qaRoot',password=crypto.randomBytes(24).toString('hex');const db=await MongoMemoryReplSet.create({binary:{version:process.env.MONGOMS_VERSION||'7.0.24'},replSet:{count:1,auth:{enable:true,customRootName:name,customRootPwd:password}},instanceOpts:[{args:['--nounixsocket']}]});return {db,uri:credentialUri(db,name,password)};};
 try{
  source=await start();target=await start();assert.notEqual(new URL(source.uri).host,new URL(target.uri).host);
  Object.assign(process.env,{NODE_ENV:'test',MONGO_URI:source.uri,PRIVACY_RESTORE_URI:target.uri,PRIVACY_RESTORE_ALLOW_SAME_DEPLOYMENT:'false',BACKUP_DATABASE_NAME:'opdfy_qa_backup_source',BACKUP_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),BACKUP_STORAGE_PROVIDER:'local',BACKUP_STORAGE_DIR:path.join(temp,'storage'),BACKUP_RETENTION_DELETE_ENABLED:'false',SECURITY_ALERT_EMAIL:'',MONGODUMP_BIN:dump,MONGORESTORE_BIN:restore});
  await mongoose.connect(source.uri,{dbName:process.env.BACKUP_DATABASE_NAME,autoIndex:false});for(const model of Object.values(mongoose.models))await model.createIndexes();
  const clinic=await Tenant.create({name:'Synthetic Recovery Clinic',slug:'qa-recovery-clinic',status:'active'});
  const patient=await runWithTenant(clinic._id,()=>Patient.create({name:'Synthetic Recovery Patient',email:'recovery@example.invalid',allergies:['SYNTHETIC_RECOVERY_ALLERGY']}));
  const before=await mongoose.connection.db.collection('patients').findOne({_id:patient._id});const beforeDigest=digest(mongoose.mongo.BSON.serialize(before));
  let backup,record,drill,restored;const ownerId=new mongoose.Types.ObjectId();
  await t.test('actual dump is encrypted and stored with trusted checksums',async()=>{
   backup=await queueBackup({trigger:'manual',requestedBy:null});await executeBackup(backup._id);record=await BackupRecord.findById(backup._id).select('+objectKey +manifestObjectKey');assert.equal(record.status,'succeeded',record.failureCode);
   const object=fs.readFileSync(path.join(process.env.BACKUP_STORAGE_DIR,record.objectKey));assert.equal(digest(object),record.encryptedSha256);assert.equal(object.includes(Buffer.from('SYNTHETIC_RECOVERY_ALLERGY')),false);assert.equal(record.encryption.algorithm,'AES-256-GCM');report.checks.push('encrypted_backup');
  });
  if(!record||record.status!=='succeeded')return;
  await t.test('restore on another authenticated replica set preserves record content, indexes and rollback',async()=>{
   drill=await queueRestoreDrill(backup._id,ownerId);await executeRestoreDrill(drill._id);restored=await RestoreDrillRecord.findById(drill._id);assert.equal(restored.status,'succeeded',restored.failureCode);assert.equal(restored.transactionRollbackVerified,true);
   client=new MongoClient(target.uri);await client.connect();const db=client.db(restored.targetDatabase),after=await db.collection('patients').findOne({_id:patient._id});assert.equal(digest(mongoose.mongo.BSON.serialize(after)),beforeDigest);
   const indexes=await db.collection('patients').indexes();assert.ok(indexes.some(i=>i.unique));
   assert.equal(await db.collection('privacy_restore_drill_checks').countDocuments({}),0);
   report.checks.push('content_hash_match','indexes_restored','transaction_rollback');report.collectionCount=restored.collectionCount;
  });
  await t.test('existing restore target refuses overwrite and retains synthetic sentinel',async()=>{
   assert.ok(client);const db=client.db('opd_restore_qa_nonempty');await db.collection('sentinel').insertOne({value:'must-survive'});
   const archive=path.join(temp,'manual.archive.gz'),manifest=JSON.parse(fs.readFileSync(path.join(process.env.BACKUP_STORAGE_DIR,record.manifestObjectKey),'utf8'));
   const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.BACKUP_ENCRYPTION_KEY,'base64'),Buffer.from(manifest.encryption.iv,'base64'));decipher.setAuthTag(Buffer.from(manifest.encryption.authTag,'base64'));
   const plain=Buffer.concat([decipher.update(fs.readFileSync(path.join(process.env.BACKUP_STORAGE_DIR,record.objectKey))),decipher.final()]);fs.writeFileSync(archive,plain,{mode:0o600});
   fs.writeFileSync(archive+'.sha256.json',JSON.stringify({...manifest,format:'opd-mongodb-backup-v1',filename:path.basename(archive),bytes:plain.length}));
   const result=spawnSync(process.execPath,['scripts/privacyRestoreDrill.mjs','--archive',archive,'--source-db',record.database,'--target-db','opd_restore_qa_nonempty'],{env:{...process.env,PRIVACY_RESTORE_DRILL_ACK:'RESTORE_TO_DISPOSABLE_DATABASE'},encoding:'utf8',timeout:20000});assert.notEqual(result.status,0);assert.match(result.stderr,/Target database is not empty/);assert.equal(await db.collection('sentinel').countDocuments({value:'must-survive'}),1);report.checks.push('nonempty_target_refused');
  });
  await t.test('tampered stored ciphertext fails recovery without accepting a restore',async()=>{
   const filename=path.join(process.env.BACKUP_STORAGE_DIR,record.objectKey),bytes=fs.readFileSync(filename);bytes[0]^=1;fs.writeFileSync(filename,bytes);
   const bad=await queueRestoreDrill(backup._id,ownerId);await executeRestoreDrill(bad._id);const outcome=await RestoreDrillRecord.findById(bad._id);assert.equal(outcome.status,'failed');assert.equal(outcome.failureCode,'BACKUP_INTEGRITY_FAILED');report.checks.push('tampering_rejected');
  });
 }finally{
  if(process.env.QA_ARTIFACTS_DIR){fs.mkdirSync(process.env.QA_ARTIFACTS_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.QA_ARTIFACTS_DIR,'restore-results.json'),JSON.stringify(report,null,2));}
  await client?.close();await mongoose.disconnect();if(source)await source.db.stop();if(target)await target.db.stop();fs.rmSync(temp,{recursive:true,force:true});
 }
});
