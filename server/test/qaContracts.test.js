import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { verifySessionToken } from '../src/utils/sessionTokens.js';
import { getDoctorAvailability } from '../src/utils/doctorAvailability.js';
import { validateClinicOperationsInput } from '../src/utils/clinicOperations.js';
import { onlineReservationLimit,hospitalDate } from '../src/services/queueReservationService.js';
import { validatePolicyAcceptance,POLICY_VERSION } from '../src/utils/policyAcceptance.js';
import { base32,totp,verifyTotp } from '../src/utils/totp.js';
const secret=crypto.randomBytes(48).toString('hex');
test('JWT contract rejects unsigned, wrong-key, expired and unsupported algorithm tokens',()=>{
 const valid=jwt.sign({id:'aaaaaaaaaaaaaaaaaaaaaaaa'},secret,{expiresIn:'1m'});assert.equal(verifySessionToken(valid,secret).id,'aaaaaaaaaaaaaaaaaaaaaaaa');
 for(const bad of [jwt.sign({id:'aaaaaaaaaaaaaaaaaaaaaaaa'},secret,{expiresIn:-1}),jwt.sign({id:'aaaaaaaaaaaaaaaaaaaaaaaa'},'different',{expiresIn:'1h'}),jwt.sign({id:'aaaaaaaaaaaaaaaaaaaaaaaa'},secret,{algorithm:'HS384',expiresIn:'1h'}),jwt.sign({id:'aaaaaaaaaaaaaaaaaaaaaaaa'},null,{algorithm:'none',expiresIn:'1h'})])assert.throws(()=>verifySessionToken(bad,secret));
});
test('doctor calendar edge contracts use explicit clinic time and absence rules',()=>{
 const d={doctorSchedule:{workingDays:['Saturday'],startTime:'09:00',endTime:'17:00'}};
 assert.equal(getDoctorAvailability(d,new Date('2026-10-24T08:59:59Z'),'UTC').isAvailable,false);
 assert.equal(getDoctorAvailability(d,new Date('2026-10-24T09:00:00Z'),'UTC').isAvailable,true);
 assert.equal(getDoctorAvailability(d,new Date('2026-10-24T17:00:00Z'),'UTC').isAvailable,false);
 assert.equal(getDoctorAvailability({...d,doctorSchedule:{...d.doctorSchedule,isOnBreak:true}},new Date('2026-10-24T12:00:00Z'),'UTC').isAvailable,false);
 assert.equal(hospitalDate(new Date('2026-10-24T23:30Z'),'Pacific/Kiritimati'),'2026-10-25');
 assert.equal(hospitalDate(new Date('2026-10-24T00:30Z'),'America/Los_Angeles'),'2026-10-23');
});
test('capacity and operation validation reject malformed policies without coercing overrides',()=>{
 for(const value of [-1,1.5,100001,'5',NaN])assert.throws(()=>onlineReservationLimit({onlineReservationCapacity:value}));
 for(const value of [{openTime:'25:00'},{openTime:'17:00',closeTime:'09:00'},{workingDays:['Invalid']}])assert.throws(()=>validateClinicOperationsInput(value));
 assert.equal(onlineReservationLimit({onlineReservationCapacity:0}),0);
});
test('onboarding needs current affirmative policy acceptance',()=>{
 for(const value of [undefined,{accepted:false,version:POLICY_VERSION,language:'en'},{accepted:true,version:'outdated',language:'en'}])assert.ok(validatePolicyAcceptance(value).error);
 assert.ok(validatePolicyAcceptance({accepted:true,version:POLICY_VERSION,language:'hi'}).value.acceptedAt);
});
test('TOTP rejects a code outside drift tolerance and never accepts the last consumed step',()=>{
 const key=base32(Buffer.alloc(20,7)),now=Date.parse('2026-10-24T12:00:00Z'),step=Math.floor(now/30000);
 const code=totp(key,{time:now});assert.equal(verifyTotp(key,code,{now,lastCounter:step}),null);
 assert.equal(verifyTotp(key,totp(key,{time:now-90000}),{now}),null);
});
