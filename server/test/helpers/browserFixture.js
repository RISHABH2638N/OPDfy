import crypto from 'node:crypto';
import { once } from 'node:events';
import { mock } from 'node:test';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import GlobalPatient from '../../src/models/GlobalPatient.js';
import SuperAdmin from '../../src/models/SuperAdmin.js';
import Tenant from '../../src/models/Tenant.js';
import User from '../../src/models/User.js';
import Token from '../../src/models/Token.js';
import { runWithTenant } from '../../src/services/tenantExecutionContext.js';
export { totp } from '../../src/utils/totp.js';
// A closed local test fixture. It never reads MONGO_URI, launches real backup
// commands or contacts email/AI/storage providers. The SMTP transport is mocked.
export async function startBrowserFixture(clientOrigin) {
 if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(clientOrigin)) throw new Error('Browser tests require a loopback frontend.');
 Object.assign(process.env,{NODE_ENV:'test',CLIENT_URL:clientOrigin,PLATFORM_MFA_REQUIRED:'false',
   QR_JWT_SECRET:crypto.randomBytes(32).toString('hex'),JWT_SECRET:crypto.randomBytes(32).toString('hex'),SUPER_ADMIN_JWT_SECRET:crypto.randomBytes(32).toString('hex'),
   PLATFORM_MFA_ENCRYPTION_SECRET:crypto.randomBytes(32).toString('hex'),
   SMTP_HOST:'synthetic.example.invalid',SMTP_USER:'local-test',SMTP_PASS:'local-test',OTP_FROM_EMAIL:'local@example.invalid'});
 const mail=[],transport=mock.method(nodemailer,'createTransport',()=>({async sendMail(message){mail.push(message);return {accepted:[message.to]};}}));
 const db=await MongoMemoryReplSet.create({binary:{version:process.env.MONGOMS_VERSION||'7.0.24'},replSet:{count:1},instanceOpts:[{args:['--nounixsocket']}]});
 await mongoose.connect(db.getUri(),{dbName:'opdfy_local_browser_fixture',autoIndex:false});
 const {createApplication}=await import('../../src/app.js');
 for(const model of Object.values(mongoose.models))await model.createIndexes();
 const app=createApplication();app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 return {mail,GlobalPatient,apiOrigin:`http://127.0.0.1:${app.server.address().port}`,
   async seedOwner(password){return SuperAdmin.create({name:'Synthetic Browser Owner',email:'browser-owner@example.invalid',passwordHash:await bcrypt.hash(password,12)});},
   async seedQueue(){
     const tenant=await Tenant.create({name:'Synthetic Browser Clinic',slug:'browser-queue-clinic',status:'active'});
     const other=await Tenant.create({name:'Other Synthetic Browser Clinic',slug:'browser-other-clinic',status:'active'});
     const user=await runWithTenant(tenant._id,async()=>{
       const staff=await User.create({name:'Synthetic Reception',email:'browser-reception@example.invalid',role:'receptionist',passwordHash:'local-test-not-for-login'});
       await Token.create({patient:new mongoose.Types.ObjectId(),patientName:'Synthetic Queue Patient',patientId:'QA-1',department:'General OPD',tokenNumber:1,status:'waiting'});
       return staff;
     });
     return {slug:tenant.slug,otherSlug:other.slug,token:jwt.sign({id:String(user._id),tenantId:String(tenant._id),role:user.role,ver:0},process.env.JWT_SECRET,{expiresIn:'1h'})};
   },
   async close(){await new Promise(resolve=>app.io.close(resolve));await mongoose.disconnect();await db.stop();transport.mock.restore();},
 };
}
