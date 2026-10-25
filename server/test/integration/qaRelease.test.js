import crypto from 'node:crypto';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import jwt from 'jsonwebtoken';import mongoose from 'mongoose';
import {io as connectSocket} from 'socket.io-client';
import {startQaFixture,unique} from '../helpers/qaFixture.js';
import {runWithTenant} from '../../src/services/tenantExecutionContext.js';
import Patient from '../../src/models/Patient.js';import User from '../../src/models/User.js';import GlobalPatient from '../../src/models/GlobalPatient.js';
import QueueReservation from '../../src/models/QueueReservation.js';import Token from '../../src/models/Token.js';import Appointment from '../../src/models/Appointment.js';
import {hospitalDate,checkInQueueReservation} from '../../src/services/queueReservationService.js';
import {databaseTransaction} from '../../src/utils/databaseTransaction.js';
import {recordConsent,CONSENT_NOTICE_VERSION} from '../../src/services/privacyConsentService.js';
let f,a,b,doctor,otherDoctor,admin,reception,p1,p2,owner,display,identities;
const matrix=[],concurrency=[];
before(async()=>{
 f=await startQaFixture();a=await f.clinic();b=await f.clinic();doctor=await f.staff(a);otherDoctor=await f.staff(a);admin=await f.staff(a,'admin');reception=await f.staff(a,'receptionist');p1=await f.patient(a);p2=await f.patient(a);owner=await f.owner();display=await f.display(a);
 const pending=await f.clinic('qa-pending-'+unique(),{status:'pending'}),applicant=await f.staff(pending,'admin');
 const onboarding=jwt.sign({purpose:'clinic-onboarding',tenantId:String(pending._id),adminId:String(applicant._id),ver:0},process.env.JWT_SECRET,{expiresIn:'1h'});
 identities={anonymous:'',patient:p1.token,doctor:f.signStaff(doctor,a),receptionist:f.signStaff(reception,a),admin:f.signStaff(admin,a),owner:f.signOwner(owner),onboarding,display:display.key};
});
after(async()=>{if(process.env.QA_ARTIFACTS_DIR){fs.mkdirSync(process.env.QA_ARTIFACTS_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.QA_ARTIFACTS_DIR,'backend-contracts.json'),JSON.stringify({matrix,concurrency},null,2));}if(f)await f.close();});
const req=(url,options={})=>f.request('/api'+url,{slug:a.slug,...options});

test('role permission matrix: actual server responses, not frontend state',async t=>{
 const resources=[
  {path:'/tokens',allowed:Object.keys(identities)},
  {path:'/auth/me',allowed:['doctor','receptionist','admin'],staffGate:true},
  {path:'/tokens/private',allowed:['doctor','receptionist','admin'],staffGate:true},
  {path:'/reception/patients',allowed:['receptionist','admin'],staffGate:true},
  {path:'/admin/users',allowed:['admin'],staffGate:true},
  {path:'/platform/me',allowed:['owner']},
  {path:'/patient-auth/me',allowed:['patient'],patientGate:true},
  {path:'/onboarding/status',allowed:['onboarding']},
 ];
 for(const resource of resources)for(const [role,token] of Object.entries(identities))await t.test(`${role} -> ${resource.path}`,async()=>{
  const expected=resource.allowed.includes(role)?200:resource.patientGate&&['doctor','receptionist','admin','onboarding'].includes(role)?403:resource.staffGate&&['doctor','receptionist','admin'].includes(role)?403:401;
  const result=await req(resource.path,{token});matrix.push({role,path:resource.path,expected,actual:result.status});assert.equal(result.status,expected,JSON.stringify(result.body));
 });
});
test('object and clinic substitution cannot reveal private patient records',async()=>{
 const reservation=await req('/patients/me/tokens',{token:p1.token,body:{doctorId:String(doctor._id),department:'General OPD'}});assert.equal(reservation.status,201,JSON.stringify(reservation.body));const id=reservation.body.reservation._id;
 for(const action of ['check-in-qr','cancel'])assert.equal((await req(`/patients/me/reservations/${id}/${action}`,{token:p2.token,method:action==='cancel'?'PATCH':'GET',...(action==='cancel'?{body:{}}:{})})).status,404);
 for(const [url,token] of [['/tokens/private',identities.receptionist],['/admin/users',identities.admin]])assert.equal((await req(url,{token,slug:b.slug})).status,401);
 assert.equal((await req(`/consultations/patient/${p1.local._id}`,{token:f.signStaff(otherDoctor,a)})).status,403);
 assert.equal((await req(`/patients/me/reservations/${id}/cancel`,{token:p1.token,method:'PATCH',body:{}})).status,200);
});
test('expired, wrong-signature, revoked and altered role sessions fail closed',async()=>{
 for(const token of [f.signStaff(reception,a,{expiresIn:-1}),jwt.sign({id:String(reception._id),tenantId:String(a._id),role:'receptionist'},'wrong-key',{expiresIn:'1h'})])assert.equal((await req('/auth/me',{token})).status,401);
 assert.equal((await req('/admin/users',{token:f.signStaff(reception,a,{claims:{role:'admin'}})})).status,403);
 const revoked=await f.staff(a,'receptionist'),old=f.signStaff(revoked,a);await runWithTenant(a._id,()=>User.updateOne({_id:revoked._id},{$inc:{tokenVersion:1}}));assert.equal((await req('/auth/me',{token:old})).status,401);
 const oldPatient=f.signPatient(p2.global);await GlobalPatient.updateOne({_id:p2.global._id},{$inc:{tokenVersion:1}});assert.equal((await req('/patient-auth/me',{token:oldPatient})).status,401);
 assert.equal((await req('/reception/patients',{token:identities.patient,headers:{'X-Role':'admin','X-User-Role':'admin'}})).status,401);
});
test('TV credential exposes sanitized queue, expires and cannot authorize staff APIs',async()=>{
 const p=await f.patient(a),d=await f.staff(a);await runWithTenant(a._id,()=>Token.create({patient:p.local._id,patientName:'SYNTHETIC_PRIVATE_NAME',patientId:p.local.patientId,department:'General OPD',assignedDoctor:d._id,tokenNumber:101,status:'waiting'}));
 const result=await req(`/display/${display.key}`);assert.equal(result.status,200);
 for(const row of result.body.queue)for(const forbidden of ['patientName','patient','phone','patientId','_id','allergies'])assert.equal(forbidden in row,false);
 assert.equal((await req('/tokens/private',{token:display.key})).status,401);assert.equal((await req('/display/'+'0'.repeat(48))).status,404);
 await runWithTenant(a._id,()=>mongoose.model('WaitingLoungeDisplay').updateOne({_id:display.record._id},{$set:{accessKeyExpiresAt:new Date(Date.now()-1000)}}));assert.equal((await req(`/display/${display.key}`)).status,404);
});
for(let round=1;round<=3;round++)test(`capacity round ${round}: mixed patient/AI HTTP booking never exceeds five`,async()=>{
 const tenant=await f.clinic(),d=await f.staff(tenant,'doctor',{name:`Capacity Specialist Round${round}`,onlineReservationCapacity:5}),people=await Promise.all(Array.from({length:10},()=>f.patient(tenant)));
 const results=await Promise.all(people.map((p,i)=>f.request(i%2?'/api/ai/chat':'/api/patients/me/tokens',{slug:tenant.slug,token:p.token,body:i%2?{message:`book a General OPD token with ${d.name}`}:{department:'General OPD',doctorId:String(d._id)}})));
 const accepted=results.filter(r=>r.status===201||r.status===200&&r.body.action==='reservation_created'),conflicts=results.filter(r=>r.status===409&&/full today/.test(r.body.message));
 const reservations=await runWithTenant(tenant._id,()=>QueueReservation.find({doctor:d._id,status:{$in:['reserved','checked_in']}}).lean()),tokens=await runWithTenant(tenant._id,()=>Token.countDocuments({}));
 concurrency.push({round,accepted:accepted.length,conflicts:conflicts.length,persisted:reservations.length,uniquePatients:new Set(reservations.map(r=>String(r.patient))).size,tokens,statuses:results.map(r=>r.status)});
 assert.equal(accepted.length,5,JSON.stringify(results));assert.equal(conflicts.length,5,JSON.stringify(results));assert.equal(reservations.length,5);assert.equal(new Set(reservations.map(r=>String(r.patient))).size,5);assert.equal(tokens,0);
 const index=results.findIndex(r=>r.status===201||r.status===200),p=people[index],own=reservations.find(r=>String(r.patient)===String(p.local._id));assert.ok(own);
 assert.equal((await f.request(`/api/patients/me/reservations/${own._id}/cancel`,{slug:tenant.slug,token:p.token,method:'PATCH',body:{}})).status,200);
 assert.equal((await f.request('/api/patients/me/tokens',{slug:tenant.slug,token:p.token,body:{doctorId:String(d._id),department:'General OPD'}})).status,201);
 assert.equal(await runWithTenant(tenant._id,()=>QueueReservation.countDocuments({doctor:d._id,status:'reserved'})),5);
});
test('tenant-scoped CRUD and forced transaction failure leave no orphan writes',async()=>{
 const p=await f.patient(a);await runWithTenant(a._id,()=>Patient.updateOne({_id:p.local._id},{$set:{name:'Synthetic Updated'}}));assert.equal((await runWithTenant(a._id,()=>Patient.findById(p.local._id))).name,'Synthetic Updated');assert.equal(await runWithTenant(b._id,()=>Patient.findById(p.local._id)),null);
 const count=await runWithTenant(a._id,()=>Patient.countDocuments({}));await assert.rejects(runWithTenant(a._id,()=>databaseTransaction(async()=>{await Patient.create({name:'Synthetic Rolled Back',email:`rollback-${unique()}@example.invalid`});throw Error('Synthetic forced transaction abort');})),/forced transaction abort/);assert.equal(await runWithTenant(a._id,()=>Patient.countDocuments({})),count);
 await runWithTenant(a._id,()=>Patient.deleteOne({_id:p.local._id}));assert.equal(await runWithTenant(a._id,()=>Patient.findById(p.local._id)),null);
});
test('unique appointment indexes reject double-slot booking and cancellation releases it',async()=>{
 const tenant=await f.clinic(),d=await f.staff(tenant),one=await f.patient(tenant),two=await f.patient(tenant),date=hospitalDate();
 const data=p=>({patient:p.local._id,patientName:p.local.name,doctor:d._id,doctorName:d.name,department:'General OPD',appointmentDate:date,startTime:'10:00',endTime:'10:10',slotKey:`${d._id}:${date}:10:00`});
 const appt=await runWithTenant(tenant._id,()=>Appointment.create(data(one)));await assert.rejects(runWithTenant(tenant._id,()=>Appointment.create(data(two))),e=>e.code===11000);
 await runWithTenant(tenant._id,()=>Appointment.updateOne({_id:appt._id},{$set:{status:'cancelled'},$unset:{slotKey:1}}));assert.ok(await runWithTenant(tenant._id,()=>Appointment.create(data(two))));
});
test('disposable database disconnect fails readiness and reconnect restores protected reads',async()=>{
 const uri=f.db.getUri();await mongoose.disconnect();
 try{const response=await fetch(f.origin+'/health/ready');assert.equal(response.status,503);}finally{await mongoose.connect(uri,{dbName:'opdfy_disposable_qa',autoIndex:false,maxPoolSize:12});}
 assert.equal((await fetch(f.origin+'/health/ready')).status,200);assert.equal((await req('/auth/me',{token:identities.receptionist})).status,200);
});
test('invalid OTP, failed delivery and restored delivery do not grant authentication',async()=>{
 const email=`delivery-${unique()}@example.invalid`;assert.equal((await req('/patient-auth/verify-otp',{body:{email,purpose:'register',otp:'000000'}})).status,400);
 f.failEmail();try{const failure=await req('/patient-auth/send-otp',{body:{email,purpose:'register'}});assert.equal(failure.status,200);assert.equal(failure.body.token,undefined);for(let i=0;i<50&&await mongoose.model('GlobalPatientOtp').exists({email});i++)await new Promise(r=>setTimeout(r,10));assert.equal(await mongoose.model('GlobalPatientOtp').exists({email}),null);}finally{f.failEmail(false);}
 assert.equal((await req('/patient-auth/send-otp',{body:{email:`restored-${unique()}@example.invalid`,purpose:'register'}})).status,200);assert.ok(f.mail.length>0);
});
test('external AI unavailable is mocked and withdrawal prevents any provider attempt',async()=>{
 const p=await f.patient(a),input={purpose:'external_ai',decision:'granted',language:'en',noticeVersion:CONSENT_NOTICE_VERSION,acknowledged:true};await recordConsent(p.global._id,input);
 const original=globalThis.fetch;let providerCalls=0;globalThis.fetch=async(url,options)=>{if(String(url).startsWith(f.origin+'/api/'))return original(url,options);if(String(url).startsWith('https://generativelanguage.googleapis.com/')){providerCalls++;return new Response(JSON.stringify({error:{message:'Synthetic outage'}}),{status:503,headers:{'Content-Type':'application/json'}});}throw Error('Unexpected external request forbidden');};process.env.GEMINI_API_KEY='synthetic-test-key-not-a-credential';
 try{const failure=await req('/ai/chat',{token:p.token,body:{message:'Please explain the software',allowExternalAI:true}});assert.equal(failure.status,502);assert.equal(providerCalls,1);assert.equal(failure.body.externalAIUsed,false);await recordConsent(p.global._id,{...input,decision:'withdrawn'});const fallback=await req('/ai/chat',{token:p.token,body:{message:'Please explain the software',allowExternalAI:true}});assert.equal(fallback.status,200);assert.equal(providerCalls,1);assert.equal(fallback.body.externalAIContacted,false);}finally{globalThis.fetch=original;process.env.GEMINI_API_KEY='';}
});
test('realtime multi-client update, reconnect and disconnect cleanup',async()=>{
 const sockets=[],open=()=>new Promise((resolve,reject)=>{const s=connectSocket(f.origin,{auth:{clinicSlug:a.slug},transports:['websocket'],forceNew:true,reconnection:false});sockets.push(s);s.once('connect',()=>resolve(s));s.once('connect_error',reject);});
 try{
  const [one,two]=await Promise.all([open(),open()]),snapshots=[[],[]];
  one.on('queue:updated',rows=>snapshots[0].push(rows));two.on('queue:updated',rows=>snapshots[1].push(rows));
  const p=await f.patient(a),response=await req('/reception/tokens',{token:identities.receptionist,body:{patientMongoId:String(p.local._id),doctorId:String(doctor._id),department:'General OPD'}});assert.equal(response.status,201,JSON.stringify(response.body));
  const received=()=>snapshots.every(events=>events.some(rows=>rows.some(r=>r.tokenNumber===response.body.tokenNumber)));
  for(let i=0;i<100&&!received();i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(received(),'Both clients must receive the newly created token, not only their initial snapshot');
  for(const events of snapshots)assert.equal(JSON.stringify(events).includes(p.local.name),false);
  one.disconnect();assert.ok((await open()).connected);
 }finally{sockets.forEach(s=>s.disconnect());await new Promise(r=>setTimeout(r,100));}
 assert.equal(f.app.app.get('realtimeAdmission').snapshot().active,0);
 const invalid=connectSocket(f.origin,{auth:{clinicSlug:'nonexistent-qa-clinic'},transports:['websocket'],forceNew:true,reconnection:false});try{await assert.rejects(new Promise((resolve,reject)=>{invalid.once('connect',resolve);invalid.once('connect_error',reject);}));}finally{invalid.disconnect();}
});

test('applicant registration, owner approval, subscription invoice and suspension',async()=>{
 const slug='qa-onboarding-'+unique(),body={clinicName:'Synthetic Onboarding Clinic',clinicSlug:slug,contactEmail:`contact-${unique()}@example.invalid`,contactPhone:'9876543210',adminName:'Synthetic Applicant',adminEmail:`applicant-${unique()}@example.invalid`,password:f.password,legalVerification:{legalName:'Synthetic Establishment',establishmentType:'clinic',registrationNumber:'TEST-ONLY-123',registrationAuthority:'Synthetic Test Authority',registrationState:'Synthetic State',evidenceReference:'SYNTHETIC-NOT-A-LICENSE'}};
 assert.equal((await req('/onboarding/register-clinic',{body})).status,400);body.policyAcceptance={accepted:true,version:'2026-09-09',language:'en'};
 const created=await req('/onboarding/register-clinic',{body});assert.equal(created.status,201,JSON.stringify(created.body));const token=created.body.onboardingToken,id=created.body.clinic.id;
 assert.equal((await req('/onboarding/status',{token})).body.clinic.status,'pending');assert.equal((await req('/admin/users',{token,slug})).status,403);
 assert.equal((await req(`/platform/clinics/${id}/review`,{token:identities.owner,method:'PATCH',body:{decision:'approve',durationMonths:1,paymentNote:'Synthetic QA payment'}})).status,200);
 const status=await req('/onboarding/status',{token});assert.equal(status.status,200);assert.equal(status.body.approvedSession.user.role,'admin');const staffToken=status.body.approvedSession.token;assert.equal((await req('/auth/me',{token:staffToken,slug})).status,200);
 const invoice={clinicId:id,plan:'Starter',billingCycle:'monthly',amountPaise:100000,dueDate:'2026-10-24',status:'pending',requestId:crypto.randomUUID()};assert.equal((await req('/platform/subscription-invoices',{token:identities.owner,body:invoice})).status,201);assert.equal((await req('/platform/subscription-invoices',{token:identities.owner,body:invoice})).status,200);
 assert.equal((await req(`/platform/clinics/${id}/status`,{token:identities.owner,method:'PATCH',body:{status:'suspended'}})).status,200);assert.equal((await req('/auth/me',{token:staffToken,slug})).status,403);
});

test('reservation check-in persistence failure rolls back token/billing and supports a safe retry',async t=>{
 const tenant=await f.clinic(),d=await f.staff(tenant),p=await f.patient(tenant);
 const booked=await f.request('/api/patients/me/tokens',{slug:tenant.slug,token:p.token,body:{doctorId:String(d._id),department:'General OPD'}});assert.equal(booked.status,201);const id=booked.body.reservation._id;
 const failed=t.mock.method(QueueReservation.prototype,'save',async()=>{throw Error('Synthetic reservation persistence failure');});
 await assert.rejects(runWithTenant(tenant._id,()=>checkInQueueReservation({reservationId:id,actorId:d._id})),/Synthetic reservation persistence failure/);failed.mock.restore();
 assert.equal(await runWithTenant(tenant._id,()=>Token.countDocuments({})),0);
 const pending=await runWithTenant(tenant._id,()=>QueueReservation.findById(id));assert.equal(pending.status,'reserved');assert.equal(pending.token,null);
 const retried=await runWithTenant(tenant._id,()=>checkInQueueReservation({reservationId:id,actorId:d._id}));assert.equal(retried.reservation.status,'checked_in');assert.equal(await runWithTenant(tenant._id,()=>Token.countDocuments({})),1);assert.equal(String(retried.reservation.token),String(retried.token._id));
});
test('simultaneous reservation check-ins return the same token and no orphan visit',async()=>{
 const tenant=await f.clinic(),d=await f.staff(tenant),p=await f.patient(tenant);const booked=await f.request('/api/patients/me/tokens',{slug:tenant.slug,token:p.token,body:{doctorId:String(d._id),department:'General OPD'}});assert.equal(booked.status,201);
 const options={reservationId:booked.body.reservation._id,actorId:d._id};const result=await Promise.all([runWithTenant(tenant._id,()=>checkInQueueReservation(options)),runWithTenant(tenant._id,()=>checkInQueueReservation(options))]);
 assert.equal(String(result[0].token._id),String(result[1].token._id));assert.equal(result.filter(r=>r.alreadyCheckedIn).length,1);assert.equal(await runWithTenant(tenant._id,()=>Token.countDocuments({})),1);
});
test('transaction helper retries a labeled transient failure without retaining first-attempt writes',async()=>{
 const tenant=await f.clinic(),email=`retry-${unique()}@example.invalid`;let attempts=0;
 await runWithTenant(tenant._id,()=>databaseTransaction(async()=>{
  attempts++;await Patient.create({name:'Synthetic Retried Patient',email});
  if(attempts===1){const transient=new mongoose.mongo.MongoServerError({message:'Synthetic write conflict',code:112});transient.addErrorLabel('TransientTransactionError');throw transient;}
 }));
 assert.equal(attempts,2);assert.equal(await runWithTenant(tenant._id,()=>Patient.countDocuments({email})),1);
});
