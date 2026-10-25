import crypto from 'node:crypto';
import { once } from 'node:events';
import { mock } from 'node:test';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Tenant from '../../src/models/Tenant.js';
import User from '../../src/models/User.js';
import Patient from '../../src/models/Patient.js';
import GlobalPatient from '../../src/models/GlobalPatient.js';
import SuperAdmin from '../../src/models/SuperAdmin.js';
import WaitingLoungeDisplay from '../../src/models/WaitingLoungeDisplay.js';
import { newDisplayCredential } from '../../src/utils/displayKeyCrypto.js';
import { hashPatientPassword } from '../../src/utils/patientPasswords.js';
import { runWithTenant } from '../../src/services/tenantExecutionContext.js';
export const TEST_PASSWORD='Synthetic clinic password 2026!';
export const allDays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
let sequence=0;
export const unique=()=>`${++sequence}-${crypto.randomBytes(3).toString('hex')}`;
// Every invocation starts its own loopback replica set; never consumes MONGO_URI.
export async function startQaFixture({clientOrigin='http://127.0.0.1:5176',distributed=false}={}) {
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(clientOrigin))throw Error('Loopback frontend required.');
 Object.assign(process.env,{NODE_ENV:'test',MONGO_URI:'',PRIVACY_RESTORE_URI:'',CLIENT_URL:clientOrigin,
   HOSPITAL_TIMEZONE:'UTC',PLATFORM_MFA_REQUIRED:'false',BACKUP_SCHEDULE_ENABLED:'false',GEMINI_API_KEY:'',
   TRUST_PROXY_HOPS:'1',SMTP_HOST:'qa.example.invalid',SMTP_USER:'synthetic',SMTP_PASS:'synthetic',OTP_FROM_EMAIL:'qa@example.invalid'});
 for(const key of ['JWT_SECRET','SUPER_ADMIN_JWT_SECRET','QR_JWT_SECRET','DISPLAY_KEY_ENCRYPTION_SECRET','PLATFORM_MFA_ENCRYPTION_SECRET'])process.env[key]=crypto.randomBytes(48).toString('hex');
 const mail=[];let deliveryFails=false;
 const smtp=mock.method(nodemailer,'createTransport',()=>({async sendMail(message){if(deliveryFails)throw Object.assign(Error('Synthetic delivery outage'),{code:'SMTP_TEST_OFFLINE'});mail.push(message);return {accepted:[message.to]};}}));
 const db=await MongoMemoryReplSet.create({binary:{version:process.env.MONGOMS_VERSION||'7.0.24'},replSet:{count:1},instanceOpts:[{args:['--nounixsocket']}]});
 await mongoose.connect(db.getUri(),{dbName:'opdfy_disposable_qa',autoIndex:false,maxPoolSize:12});
 const {createApplication}=await import('../../src/app.js');
 for(const model of Object.values(mongoose.models))await model.createIndexes();
 const app=createApplication({realtime:{distributed}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const origin=`http://127.0.0.1:${app.server.address().port}`;
 const passwordHash=await bcrypt.hash(TEST_PASSWORD,10),patientHash=await hashPatientPassword(TEST_PASSWORD);
 async function clinic(slug='qa-clinic-'+unique(),extra={}){return Tenant.create({name:'Synthetic '+slug,slug,status:'active',timezone:'UTC',settings:{operations:{clinicHoursEnabled:false}},...extra});}
 async function staff(tenant,role='doctor',extra={}){return runWithTenant(tenant._id,()=>User.create({name:'Synthetic '+role,email:`${role}-${unique()}@example.invalid`,passwordHash,role,department:'General OPD',doctorSchedule:{workingDays:allDays,startTime:'00:00',endTime:'23:59'},...extra}));}
 async function patient(tenant,extra={}){
  const id=unique().replaceAll('-','');
  const global=await GlobalPatient.create({email:`patient-${id}@example.invalid`,username:`qa.${id}`,name:'Synthetic Patient '+id,passwordHash:patientHash,dateOfBirth:new Date('1994-01-01'),gender:'Other',phone:String(9000000000+sequence),allergies:['SYNTHETIC_PROFILE_ALLERGY'],medicalHistory:['SYNTHETIC_PROFILE_HISTORY'],profileCompleted:true,...extra});
  const local=await runWithTenant(tenant._id,()=>Patient.create({globalPatientId:global._id,email:global.email,name:global.name,phone:global.phone,profileCompleted:true,identityLink:{method:'verified_global_registration'},allergies:['SYNTHETIC_ALLERGY'],medicalHistory:['SYNTHETIC_HISTORY']}));
  return {global,local,token:signPatient(global)};
 }
 const signStaff=(user,tenant,options={})=>jwt.sign({id:String(user._id),tenantId:String(tenant._id),role:user.role,ver:0,...options.claims},process.env.JWT_SECRET,{expiresIn:options.expiresIn||'1h'});
 function signPatient(user,options={}){return jwt.sign({id:String(user._id),role:'patient-global',ver:0,...options.claims},process.env.JWT_SECRET,{expiresIn:options.expiresIn||'1h'});}
 async function owner(){return SuperAdmin.create({name:'Synthetic QA Owner',email:`owner-${unique()}@example.invalid`,passwordHash});}
 const signOwner=user=>jwt.sign({id:String(user._id),role:'superadmin',ver:0},process.env.SUPER_ADMIN_JWT_SECRET,{expiresIn:'1h'});
 async function display(tenant){const credential=newDisplayCredential();const record=await runWithTenant(tenant._id,()=>WaitingLoungeDisplay.create({name:'Synthetic TV',...credential}));return {record,key:credential.accessKey};}
 async function request(path,{token='',slug='',body,method=body?'POST':'GET',headers={},signal}={}){
  if(!path.startsWith('/api/'))throw Error('Only local API paths allowed.');
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json','X-Forwarded-For':`198.18.${Math.floor(++sequence/240)%240}.${sequence%240+1}`,...(token?{Authorization:`Bearer ${token}`} :{}),...(slug?{'X-Clinic-Slug':slug}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={text};}return {status:response.status,body:data,headers:response.headers};
 }
 return {db,app,origin,mail,password:TEST_PASSWORD,clinic,staff,patient,owner,display,signStaff,signPatient,signOwner,request,
  failEmail(value=true){deliveryFails=value;},
  async close(){await new Promise(resolve=>app.io.close(resolve));await mongoose.disconnect();await db.stop();smtp.mock.restore();}};
}
