import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { io as openSocket } from 'socket.io-client';
import Tenant from '../../src/models/Tenant.js';
import User from '../../src/models/User.js';
import Patient from '../../src/models/Patient.js';
import GlobalPatient from '../../src/models/GlobalPatient.js';
import QueueReservation from '../../src/models/QueueReservation.js';
import Token from '../../src/models/Token.js';
import SuperAdmin from '../../src/models/SuperAdmin.js';
import SecurityEvent from '../../src/models/SecurityEvent.js';
import { runWithTenant } from '../../src/services/tenantExecutionContext.js';
import { expireOldQueueReservations, hospitalDate, createOnlineQueueReservation } from '../../src/services/queueReservationService.js';
import { beginOwnerEnrollment, enableOwnerMfa, issueOwnerChallenge, finishOwnerChallenge, changeOwnerMfa, ownerSession } from '../../src/services/platformMfa.js';
import { totp } from '../../src/utils/totp.js';
import { withSharedAdmission } from '../../src/services/sharedAdmission.js';
// Local synthetic replica set only; never reads MONGO_URI. No provider connections.
process.env.NODE_ENV='test';
for(const name of ['JWT_SECRET','SUPER_ADMIN_JWT_SECRET','QR_JWT_SECRET','PLATFORM_MFA_ENCRYPTION_SECRET'])process.env[name]=crypto.randomBytes(32).toString('hex');
Object.assign(process.env,{CLIENT_URL:'https://hardening-test.example.invalid',TRUST_PROXY_HOPS:'1',SMTP_HOST:'',PLATFORM_MFA_REQUIRED:'false'});
let db, apps=[],clinic,other,staff,admin,ip=0;
const password='A private owner test passphrase 2026!',unique=()=>crypto.randomBytes(5).toString('hex');
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const signStaff=user=>jwt.sign({id:String(user._id),tenantId:String(clinic._id),role:user.role,ver:0},process.env.JWT_SECRET,{expiresIn:'1h'});
const signPatient=account=>jwt.sign({id:String(account._id),role:'patient-global',ver:0},process.env.JWT_SECRET,{expiresIn:'1h'});
before(async()=>{
 db=await MongoMemoryReplSet.create({binary:{version:process.env.MONGOMS_VERSION||'7.0.24'},replSet:{count:1},instanceOpts:[{args:['--nounixsocket']}]});
 await mongoose.connect(db.getUri(),{dbName:'opdfy_production_hardening',autoIndex:false});
 const {createApplication}=await import('../../src/app.js');
 for(const model of Object.values(mongoose.models))await model.createIndexes();
 clinic=await Tenant.create({name:'Synthetic Clinic',slug:'hardening-clinic',timezone:'UTC',status:'active',settings:{operations:{clinicHoursEnabled:false}}});
 other=await Tenant.create({name:'Other Synthetic Clinic',slug:'hardening-other',status:'active'});
 [staff,admin]=await runWithTenant(clinic._id,()=>Promise.all(['receptionist','admin'].map(role=>User.create({name:`Synthetic ${role}`,email:`${role}@example.invalid`,role,passwordHash:'not-used-for-login'}))));
 for(let i=0;i<2;i++){
  const app=createApplication({realtime:{distributed:true,limits:{perIp:2,total:30,attempts:240,leaseMs:90000,windowMs:60000}}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');apps.push(app);
 }
});
after(async()=>{for(const app of apps)await new Promise(resolve=>app.io.close(resolve));await mongoose.disconnect();if(db)await db.stop();});
async function request(path,{body,token,method=body?'POST':'GET',instance=0,slug=clinic.slug,address}={}){
 const response=await fetch(`http://127.0.0.1:${apps[instance].server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Clinic-Slug':slug,'X-Forwarded-For':address||`192.0.${Math.floor(++ip/240)}.${ip%240+1}`,...(token?{Authorization:`Bearer ${token}`}:{})},...(method==='GET'?{}:{body:JSON.stringify(body||{})})});
 return {status:response.status,body:await response.json()};
}
async function doctor(capacity=5){return runWithTenant(clinic._id,()=>User.create({name:'Synthetic Doctor',email:`doctor-${unique()}@example.invalid`,role:'doctor',department:'General OPD',passwordHash:'test-only',onlineReservationCapacity:capacity,doctorSchedule:{workingDays:days,startTime:'00:00',endTime:'23:59'}}));}
async function patient(){
 const account=await GlobalPatient.create({email:`patient-${unique()}@example.invalid`,name:'Synthetic Patient',profileCompleted:true});
 const profile=await runWithTenant(clinic._id,()=>Patient.create({name:account.name,email:account.email,globalPatientId:account._id,profileCompleted:true,identityLink:{method:'verified_global_registration'},allergies:['SENSITIVE_ALLERGY'],medicalHistory:['SENSITIVE_HISTORY'],currentMedications:['SENSITIVE_MEDICATION']}));
 return {account,profile,token:signPatient(account)};
}
const reserve=(p,d,instance=0)=>request('/patients/me/tokens',{instance,token:p.token,body:{doctorId:String(d._id),department:'General OPD'}});

test('front-desk duplicate/search responses omit clinical data and enforce role/clinic boundaries',async()=>{
 const p=await patient(),token=signStaff(staff);
 const duplicate=await request('/reception/patients',{token,body:{name:'Duplicate',email:p.account.email}});
 assert.equal(duplicate.status,409);assert.equal(String(duplicate.body.patient._id),String(p.profile._id));
 const search=await request(`/reception/patients?search=${encodeURIComponent(p.account.email)}`,{token});assert.equal(search.status,200);
 for(const body of [duplicate.body.patient,...search.body]){
  for(const key of ['allergies','medicalHistory','currentMedications','conditionProfile','globalPatientId','privacyContactDisabled'])assert.equal(key in body,false,key);
  assert.ok(body.patientId);assert.equal(body.email,p.account.email);
 }
 assert.equal((await request('/reception/patients',{token:p.token})).status,401);
 assert.equal((await request('/reception/patients',{token,slug:other.slug})).status,401);
});
test('MANDATORY: cap five, ten simultaneous patients across two apps yield five successes and five capacity conflicts',async()=>{
 const d=await doctor(5),patients=await Promise.all(Array.from({length:10},patient));
 const results=await Promise.all(patients.map((p,index)=>reserve(p,d,index%2)));
 assert.equal(results.filter(r=>r.status===201).length,5,JSON.stringify(results));
 assert.equal(results.filter(r=>r.status===409&&r.body.code==='ONLINE_RESERVATION_LIMIT').length,5,JSON.stringify(results));
 assert.equal(await runWithTenant(clinic._id,()=>QueueReservation.countDocuments({doctor:d._id,status:{$in:['reserved','checked_in']}})),5);
 assert.equal(await runWithTenant(clinic._id,()=>Token.countDocuments({assignedDoctor:d._id})),0);
});
test('reservation replay is idempotent; cancellation frees capacity; reduction preserves bookings',async()=>{
 const d=await doctor(1),p=await patient(),second=await patient();
 const created=await reserve(p,d);assert.equal(created.status,201);
 const replay=await reserve(p,d,1);assert.equal(replay.status,200);assert.equal(replay.body.reservation._id,created.body.reservation._id);
 assert.equal((await request('/patients/me/tokens',{token:p.token,body:{doctorId:String(d._id),department:'General OPD',consultationKind:'follow_up'}})).status,409);
 assert.equal((await reserve(second,d)).status,409);
 const cancel=()=>request(`/patients/me/reservations/${created.body.reservation._id}/cancel`,{token:p.token,method:'PATCH',body:{}});
 assert.equal((await cancel()).status,200);assert.equal((await cancel()).status,200);
 assert.equal((await reserve(second,d)).status,201);
 const updated=await request(`/admin/users/${d._id}/reservation-capacity`,{token:signStaff(admin),method:'PATCH',body:{capacity:0}});assert.equal(updated.status,200);
 assert.equal((await request('/admin/users/not-an-id/reservation-capacity',{token:signStaff(admin),method:'PATCH',body:{capacity:5}})).status,400);
 assert.equal((await reserve(await patient(),d)).status,409);
 assert.equal(await runWithTenant(clinic._id,()=>QueueReservation.countDocuments({doctor:d._id,status:'reserved'})),1);
 assert.equal((await request(`/admin/users/${d._id}/reservation-capacity`,{token:signStaff(staff),method:'PATCH',body:{capacity:5}})).status,403);
});
test('assistant-shared service enforces zero capacity and checked-in visits continue consuming places',async()=>{
 const d=await doctor(0),p=await patient();
 await assert.rejects(runWithTenant(clinic._id,()=>createOnlineQueueReservation({tenantId:clinic._id,patient:p.profile,doctor:d,department:d.department})),error=>error.code==='ONLINE_RESERVATION_LIMIT');
 await runWithTenant(clinic._id,()=>User.updateOne({_id:d._id},{$set:{onlineReservationCapacity:1}}));
 const r=await reserve(p,d);assert.equal(r.status,201);
 await runWithTenant(clinic._id,()=>QueueReservation.updateOne({_id:r.body.reservation._id},{$set:{status:'checked_in'}}));
 assert.equal((await reserve(await patient(),d)).status,409);
});
test('expiry follows tenant dates; targeted cleanup does not rewrite other patients',async()=>{
 const boundary=await Tenant.create({name:'Boundary',slug:`boundary-${unique()}`,timezone:'America/Los_Angeles',status:'active'});
 const d=await doctor(),p=await patient(),q=await patient();let a,b,current;
 const create=(pid,date)=>QueueReservation.create({patient:pid,doctor:d._id,patientName:'Synthetic',doctorName:d.name,department:d.department,reservationDate:date,status:'reserved'});
 await runWithTenant(boundary._id,async()=>{a=await create(p.profile._id,'2026-10-22');b=await create(q.profile._id,'2026-10-22');current=await create(p.profile._id,'2026-10-23');});
 const now=new Date('2026-10-24T01:00:00Z');assert.equal(hospitalDate(now,boundary.timezone),'2026-10-23');
 await runWithTenant(boundary._id,()=>expireOldQueueReservations({patientId:p.profile._id,now}));
 await runWithTenant(boundary._id,async()=>{assert.equal((await QueueReservation.findById(a._id)).status,'expired');assert.equal((await QueueReservation.findById(b._id)).status,'reserved');assert.equal((await QueueReservation.findById(current._id)).status,'reserved');});
});
test('sensitive reads audit private queue, reception appointments, self-access and denials without payloads',async()=>{
 const p=await patient();await request('/tokens/private',{token:signStaff(staff)});await request('/reception/appointments/today',{token:signStaff(staff)});
 await request('/patient-auth/me',{token:p.token});await request('/reception/appointments/today',{token:p.token});
 await new Promise(r=>setTimeout(r,100));const rows=await SecurityEvent.find({event:'patient_data_access'}).lean();
 assert.ok(rows.some(row=>row.metadata.resourceType==='queue'&&row.outcome==='success'));
 assert.ok(rows.some(row=>row.metadata.resourceType==='reception'&&row.outcome==='blocked'));
 assert.ok(rows.some(row=>row.metadata.resourceType==='global-profile'&&row.actorType==='patient'));
 assert.doesNotMatch(JSON.stringify(rows),/SENSITIVE_ALLERGY|SENSITIVE_HISTORY|SENSITIVE_MEDICATION/);
});
async function newOwner(value=password){return SuperAdmin.create({name:'Synthetic Owner',email:`owner-${unique()}@example.invalid`,passwordHash:await bcrypt.hash(value,12)});}
test('MFA encrypts secrets, requires a factor, consumes recovery codes and revokes old sessions',async()=>{
 const account=await newOwner(),old=ownerSession(account),pending=await beginOwnerEnrollment(account._id,password);
 const usedCode=totp(pending.secret),enabled=await enableOwnerMfa(account._id,password,usedCode);assert.equal(enabled.recoveryCodes.length,10);
 assert.equal((await request('/platform/me',{token:old.token})).status,401);
 const saved=await SuperAdmin.findById(account._id).select('+mfa +tokenVersion');assert.equal(saved.mfaEnabled,true);
 assert.equal(JSON.stringify(saved.mfa).includes(pending.secret),false);assert.equal(JSON.stringify(saved.mfa).includes(enabled.recoveryCodes[0]),false);
 const challenge=await issueOwnerChallenge(saved);assert.equal(challenge.token,undefined);
 assert.equal((await request('/platform/me',{token:challenge.challengeToken})).status,401);
 await assert.rejects(finishOwnerChallenge(challenge.challengeToken,usedCode),/Invalid/);
 const loggedIn=await finishOwnerChallenge(challenge.challengeToken,enabled.recoveryCodes[0]);assert.equal((await request('/platform/me',{token:loggedIn.token})).status,200);
 await assert.rejects(finishOwnerChallenge(challenge.challengeToken,enabled.recoveryCodes[0]),/Invalid/);
 const second=await issueOwnerChallenge(saved);await assert.rejects(finishOwnerChallenge(second.challengeToken,enabled.recoveryCodes[0]),/Invalid/);
 const replaced=await changeOwnerMfa(account._id,password,enabled.recoveryCodes[1],true);assert.equal(replaced.recoveryCodes.length,10);
 assert.equal((await request('/platform/me',{token:loggedIn.token})).status,401);
 const current=await SuperAdmin.findById(account._id).select('+tokenVersion'),final=await issueOwnerChallenge(current);
 await assert.rejects(finishOwnerChallenge(final.challengeToken,enabled.recoveryCodes[2]),/Invalid/);
 assert.ok((await finishOwnerChallenge(final.challengeToken,replaced.recoveryCodes[0])).token);
});
test('owner login cannot bypass MFA; staged enforcement permits only enrollment',async()=>{
 const account=await newOwner(),pending=await beginOwnerEnrollment(account._id,password),enabled=await enableOwnerMfa(account._id,password,totp(pending.secret));
 const login=await request('/platform/auth/login',{body:{email:account.email,password}});assert.equal(login.status,200);assert.equal(login.body.mfaRequired,true);assert.equal(login.body.token,undefined);
 const verified=await request('/platform/auth/mfa/verify',{body:{challengeToken:login.body.challengeToken,code:enabled.recoveryCodes[0]}});assert.equal(verified.status,200);assert.ok(verified.body.token);
 const legacy=await newOwner(),session=ownerSession(legacy);process.env.PLATFORM_MFA_REQUIRED='true';
 try{assert.equal((await request('/platform/overview',{token:session.token})).status,403);assert.equal((await request('/platform/auth/mfa/status',{token:session.token})).status,200);assert.ok((await beginOwnerEnrollment(legacy._id,password)).secret);
 assert.equal((await request('/platform/auth/logout',{token:session.token,method:'POST',body:{}})).status,200);
 assert.equal((await request('/platform/me',{token:session.token})).status,401);}
 finally{process.env.PLATFORM_MFA_REQUIRED='false';}
});
test('owner account throttle combines case variants across client IPs',async()=>{
 const account=await newOwner();for(let n=0;n<10;n++)assert.equal((await request('/platform/auth/login',{body:{email:n%2?account.email.toUpperCase():account.email,password:'An incorrect owner passphrase'}})).status,401);
 assert.equal((await request('/platform/auth/login',{body:{email:account.email,password}})).status,429);
});
async function connect(instance,address,transports=['websocket']){
 const socket=openSocket(`http://127.0.0.1:${apps[instance].server.address().port}`,{auth:{clinicSlug:clinic.slug},extraHeaders:{'X-Forwarded-For':address},transports,reconnection:false,forceNew:true,autoConnect:false,timeout:3000});
 const connected=await new Promise(resolve=>{socket.once('connect',()=>resolve(true));socket.once('connect_error',()=>resolve(false));socket.connect();});return {socket,connected};
}
test('socket quotas are shared, release on disconnect and permit long-polling without new leases',async()=>{
 const address='198.51.100.80',a=await connect(0,address),b=await connect(1,address,['polling']);let c;
 try{assert.equal(a.connected,true);assert.equal(b.connected,true);c=await connect(0,address);assert.equal(c.connected,false);c.socket.disconnect();
 await new Promise(r=>setTimeout(r,100));assert.equal(b.socket.connected,true);a.socket.disconnect();await new Promise(r=>setTimeout(r,100));c=await connect(1,address);assert.equal(c.connected,true);}
 finally{a.socket.disconnect();b.socket.disconnect();c?.socket.disconnect();}
});
test('public socket snapshots minimize identities and auth-event floods disconnect',async()=>{
 const d=await doctor(),p=await patient();await runWithTenant(clinic._id,()=>Token.create({patient:p.profile._id,patientName:'PRIVATE SOCKET PATIENT',patientId:p.profile.patientId,phone:'PRIVATE_PHONE',tokenNumber:90001,department:d.department,status:'waiting',assignedDoctor:d._id}));
 const client=openSocket(`http://127.0.0.1:${apps[0].server.address().port}`,{auth:{clinicSlug:clinic.slug},extraHeaders:{'X-Forwarded-For':'198.51.100.81'},transports:['websocket'],reconnection:false,autoConnect:false});
 const queue=new Promise(resolve=>client.once('queue:updated',resolve));client.connect();
 try{assert.doesNotMatch(JSON.stringify(await queue),/PRIVATE SOCKET PATIENT|PRIVATE_PHONE|patientId/);const ended=once(client,'disconnect');for(let n=0;n<8;n++)client.emit('patient:authenticate','invalid-token');await ended;}
 finally{client.disconnect();}
});
test('shared backup admission serializes competing worker exists/create sequences',async()=>{
 const schema=new mongoose.Schema({active:Boolean}),Job=mongoose.model('SyntheticAdmissionJob',schema);await Job.createCollection();
 const submit=()=>withSharedAdmission('synthetic-backup-admission',async()=>{if(await Job.exists({active:true}))throw Object.assign(new Error('Already running'),{status:409});await Job.create({active:true});return true;});
 const results=await Promise.allSettled([submit(),submit()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await Job.countDocuments({active:true}),1);
});


test('independent Node processes share the same strict doctor/day reservation ceiling',async()=>{
 const d=await doctor(5),patients=await Promise.all(Array.from({length:10},patient)),workers=[];
 try{
  for(let n=0;n<2;n++){
   const child=fork(new URL('../helpers/isolatedAppWorker.mjs',import.meta.url),[],{execArgv:[],env:{...process.env,OPDFY_TEST_DB_URI:db.getUri()},stdio:['ignore','ignore','ignore','ipc']});
   workers.push(child);
   const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Local worker startup timed out.')),15000);
    child.once('message',message=>{clearTimeout(timer);resolve(message.port);});
    child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('Local test worker failed.'));});
   });
   child.testPort=port;
  }
  const responses=await Promise.all(patients.map((patient,index)=>fetch(`http://127.0.0.1:${workers[index%2].testPort}/api/patients/me/tokens`,{
   method:'POST',headers:{'Content-Type':'application/json','X-Clinic-Slug':clinic.slug,Authorization:`Bearer ${patient.token}`},body:JSON.stringify({doctorId:String(d._id),department:d.department}),
  })));
  assert.equal(responses.filter(response=>response.status===201).length,5);
  assert.equal(responses.filter(response=>response.status===409).length,5);
  assert.equal(await runWithTenant(clinic._id,()=>QueueReservation.countDocuments({doctor:d._id,status:'reserved'})),5);
  assert.equal(await runWithTenant(clinic._id,()=>Token.countDocuments({assignedDoctor:d._id})),0);
 }finally{
  await Promise.all(workers.map(child=>new Promise(resolve=>{
   if(child.exitCode!==null)return resolve();
   const timer=setTimeout(()=>{child.kill('SIGTERM');resolve();},5000);
   child.once('exit',()=>{clearTimeout(timer);resolve();});
   if(child.connected)child.send('close');else child.kill('SIGTERM');
  })));
 }
});


test('owner login and MFA preserve the existing 72-byte password policy', async () => {
 const account=await newOwner(), oversized='Overlong passphrase '.repeat(5);
 const rejected=await request('/platform/auth/login',{body:{email:account.email,password:oversized}});
 assert.equal(rejected.status,400);
 await assert.rejects(beginOwnerEnrollment(account._id,oversized),{status:403});
 const stored=await SuperAdmin.findById(account._id).select('+mfa');
 assert.equal(stored.mfaEnabled,false);assert.ok(!stored.mfa?.pendingEncrypted);
});
