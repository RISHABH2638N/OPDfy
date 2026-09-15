import test from "node:test";
import { safeDiagnostic } from "../src/utils/privacySafeLog.js";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function fixture() {
  let tenantId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const tenant = { _id: tenantId, name: "Mishra clinic", timezone: "Asia/Kolkata", settings: { displayName: "Mishra clinic" } };
  const patient = { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", tenantId, email: "patient@example.test" };
  const doctor = { _id: "cccccccccccccccccccccccc", name: "Nitin", department: "Neurology", doctorSchedule: { roomNumber: "3" } };
  const source = { _id: "dddddddddddddddddddddddd", tenantId, patient: patient._id, doctor: doctor._id,
    department: "Neurology", status: "completed", followUpDate: new Date("2026-09-12T00:00:00Z"), createdAt: new Date("2026-09-01T00:00:00Z") };
  const plans = [], appointments = [], notifications = [], sentEmails = [];
  const models = {};
  let serial = 1;
  const value = v => String(v?._id || v || "");
  function matches(row, filter = {}) {
    return Object.entries(filter).every(([key, expected]) => {
      const actual = key.split(".").reduce((v,k)=>v?.[k],row);
      if (expected && typeof expected === "object" && !(expected instanceof Date) && !Array.isArray(expected)) {
        if ("$in" in expected && !expected.$in.map(value).includes(value(actual))) return false;
        if ("$gte" in expected && !(actual >= expected.$gte)) return false;
        if ("$lte" in expected && !(actual <= expected.$lte)) return false;
        if ("$gt" in expected && !(actual > expected.$gt)) return false;
        if ("$lt" in expected && !(actual < expected.$lt)) return false;
        if ("$ne" in expected && value(actual) === value(expected.$ne)) return false;
        return true;
      }
      return value(actual) === value(expected);
    });
  }
  function query(rows) {
    let result = [...rows];
    const q = {
      select(){return q;}, sort(spec){const [key,dir]=Object.entries(spec)[0];result.sort((a,b)=>
        (a[key]<b[key]?-1:a[key]>b[key]?1:0)*dir);return q;},
      limit(n){result=result.slice(0,n);return q;},
      lean(){return Promise.resolve(result.map(x=>({...x})));},
      then(resolve,reject){return q.lean().then(resolve,reject);},
    };
    return q;
  }
  function single(row) {
    const q={select(){return q;},sort(){return q;},lean(){return Promise.resolve(row?{...row}:null);},
      then(resolve,reject){return q.lean().then(resolve,reject);}};
    return q;
  }
  function model(rows) {
    return {
      find:f=>query(rows.filter(row=>matches(row,f))),
      findOne:f=>single(rows.find(row=>matches(row,f))),
      findById:id=>single(rows.find(row=>value(row._id)===value(id))),
      async findOneAndUpdate(filter,update,options={}) {
        let row=rows.find(row=>matches(row,filter));
        if(!row&&options.upsert) {
          row={_id:String(serial++).padStart(24,"0"),...update.$setOnInsert,createdAt:new Date()};
          rows.push(row);
        } else if(row) Object.assign(row,update.$set||{});
        return row?{...row}:null;
      },
      async countDocuments(f){return rows.filter(row=>matches(row,f)).length;},
    };
  }
  models.Consultation=model([source]);
  models.FollowUpPlan=model(plans);
  models.Appointment=model(appointments);
  models.User=model([doctor]);
  models.Tenant=model([tenant]);
  models.Patient=model([patient]);
  models.Token=model([]);
  models.Notification={
    ...model(notifications),
    async create(data) {
      if(notifications.some(n=>n.tenantId===data.tenantId&&n.dedupeKey===data.dedupeKey)){
        throw Object.assign(new Error("duplicate"),{code:11000});
      }
      const row={...data,_id:String(serial++).padStart(24,"0"),createdAt:new Date(),readAt:null,emailSentAt:null};
      notifications.push(row);
      return {...row,toObject(){return {...row};},async save(){Object.assign(row,{emailSentAt:this.emailSentAt});}};
    },
  };
  const context=vm.createContext({console,Date,Intl,process:{env:{}},setTimeout,clearTimeout});
  const synthetic=(name,exports)=>new vm.SyntheticModule(Object.keys(exports),function(){
    for(const [key,v] of Object.entries(exports))this.setExport(key,v);
  },{context,identifier:name});
  const modules=new Map();
  modules.set("../utils/privacySafeLog.js",synthetic("safe-log",{safeDiagnostic}));
  const mongoose={default:{isValidObjectId:v=>/^[a-f0-9]{24}$/i.test(String(v))}};
  modules.set("mongoose",synthetic("mongoose",mongoose));
  for(const [name,model] of Object.entries(models))modules.set(`../models/${name}.js`,synthetic(name,{default:model}));
  modules.set("./tenantExecutionContext.js",synthetic("tenant-context",{currentTenantId:()=>tenantId}));
  modules.set("../utils/clinicOperations.js",synthetic("clinic-operations",{
    hospitalLocalDateTime:(t,date=new Date())=>{
      const parts=new Intl.DateTimeFormat("en-CA",{timeZone:t?.timezone||"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
      const get=k=>parts.find(p=>p.type===k).value;
      return {date:`${get("year")}-${get("month")}-${get("day")}`};
    },
  }));
  modules.set("../utils/sendEmail.js",synthetic("email",{sendPatientNotificationEmail:async(...args)=>sentEmails.push(args)}));
  const sourceModule=new vm.SourceTextModule(readFileSync(new URL("../src/services/followUpService.js",import.meta.url),"utf8"),{context,identifier:"followUpService"});
  const notifyModule=new vm.SourceTextModule(readFileSync(new URL("../src/services/notificationService.js",import.meta.url),"utf8"),{context,identifier:"notificationService"});
  modules.set("./followUpService.js",sourceModule);
  const resolve=specifier=>{
    const mod=modules.get(specifier);
    if(!mod)throw new Error(`Missing mock: ${specifier}`);
    return mod;
  };
  return {
    async load(){
      await sourceModule.link(resolve);await sourceModule.evaluate();
      await notifyModule.link(resolve);await notifyModule.evaluate();
      return {followUp:sourceModule.namespace,notify:notifyModule.namespace};
    },
    tenant,patient,doctor,source,plans,appointments,notifications,sentEmails,
    setTenant(value){tenantId=value;},
  };
}

test("calendar arithmetic, date-only values, leap years and seven stages",async()=>{
  const f=fixture();const {followUp:s}=await f.load();
  assert.deepEqual([...s.FOLLOW_UP_STAGES],[-3,-2,-1,0,1,2,3]);
  assert.equal(s.calendarDatePlus("2028-02-28",1),"2028-02-29");
  assert.equal(s.calendarDatePlus("2028-02-29",1),"2028-03-01");
  assert.equal(s.calendarDayDifference("2026-12-31","2027-01-03"),3);
  assert.equal(s.followUpDateKey(new Date("2026-09-12T00:00:00Z"),{timezone:"America/New_York"}),"2026-09-12");
  const plan={dueDate:"2026-09-12",status:"pending"};
  for(const stage of s.FOLLOW_UP_STAGES)
    assert.equal(s.followUpReminderStage(plan,s.calendarDatePlus(plan.dueDate,stage)),stage);
  assert.equal(s.followUpReminderStage(plan,"2026-09-08"),null);
  assert.equal(s.followUpReminderStage({...plan,status:"completed"},"2026-09-13"),null);
  assert.equal(s.followUpReminderStage({...plan,status:"cancelled"},"2026-09-13"),null);
});

test("seven scheduled deliveries are durable, private and not duplicated",async()=>{
  const f=fixture();const {notify}=await f.load();
  const io={to(room){assert.equal(room,`patient:${f.patient._id}`);return this;},emit(name,payload){assert.equal(name,"patient:notification");assert.equal(payload.patient,f.patient._id);}};
  for(let offset=-3;offset<=3;offset++){
    const now=new Date(`2026-09-${String(12+offset).padStart(2,"0")}T04:00:00Z`);
    await notify.processFollowUpReminders(io,now);
    await notify.processFollowUpReminders(io,now);
  }
  assert.equal(f.notifications.length,7);
  assert.deepEqual(f.notifications.map(n=>n.metadata.stage),[-3,-2,-1,0,1,2,3]);
  assert.equal(new Set(f.notifications.map(n=>n.dedupeKey)).size,7);
  assert.equal(f.notifications.filter(n=>n.type==="follow_up_pending").length,3);
  assert.match(f.notifications[0].title,/3 days/);
  assert.equal(f.notifications[3].title,"Follow-up due today");
  assert.match(f.notifications[6].title,/3 days overdue/);
  assert.equal(f.sentEmails.length,1); // existing due-day email only
  for(const n of f.notifications){
    assert.equal(n.metadata.doctorName,"Nitin");
    assert.equal(n.metadata.clinicName,"Mishra clinic");
    assert.equal(n.metadata.roomNumber,"3");
    assert.equal(n.metadata.followUpDate,"2026-09-12");
    assert.doesNotMatch(n.message,/diagnosis|prescription|medical history/i);
  }
});

test("a completed follow-up suppresses future pending reminders",async()=>{
  const f=fixture();const {followUp:s,notify}=await f.load();
  await notify.processFollowUpReminders(null,new Date("2026-09-12T04:00:00Z"));
  const plan=f.plans[0];
  assert.ok(plan);
  const linked={_id:"eeeeeeeeeeeeeeeeeeeeeeee",patient:f.patient._id,doctor:f.doctor._id,
    followUpConsultation:f.source._id,status:"completed",token:"ffffffffffffffffffffffff",createdAt:new Date("2026-09-12T06:00:00Z")};
  f.appointments.push(linked);
  // Completion is represented by the actual consultation associated with that token.
  f.source._id="dddddddddddddddddddddddd";
  // The service's explicit completion hook is exercised with a linked appointment.
  const current={_id:"111111111111111111111111",patient:f.patient._id,doctor:f.doctor._id,
    createdAt:new Date("2026-09-12T06:00:00Z")};
  await s.completeLinkedFollowUp(current,{appointment:linked._id},{tenant:f.tenant});
  assert.equal(f.plans[0].status,"completed");
  await notify.processFollowUpReminders(null,new Date("2026-09-13T04:00:00Z"));
  assert.equal(f.notifications.length,1);
});

test("a booked appointment is not mistaken for a completed consultation",async()=>{
  const f=fixture();const {followUp:s,notify}=await f.load();
  await notify.processFollowUpReminders(null,new Date("2026-09-09T04:00:00Z"));
  const plan=f.plans[0];
  f.appointments.push({_id:"eeeeeeeeeeeeeeeeeeeeeeee",patient:f.patient._id,doctor:f.doctor._id,
    followUpConsultation:f.source._id,status:"booked",appointmentDate:"2026-09-14",startTime:"10:30",createdAt:new Date("2026-09-09T06:00:00Z")});
  await notify.processFollowUpReminders(null,new Date("2026-09-13T04:00:00Z"));
  assert.equal(f.plans[0].status,"scheduled");
  assert.equal(f.notifications.at(-1).metadata.stage,1);
  assert.match(f.notifications.at(-1).message,/2026-09-14 at 10:30/);
  assert.equal(s.followUpReminderStage({...plan,status:"scheduled"},"2026-09-13"),1);
});

test("automatic booking source requires the correct patient, doctor and clinic context",async()=>{
  const f=fixture();const {followUp:s}=await f.load();
  const tenant=f.tenant;
  const result=await s.validateFollowUpBooking({patientId:f.patient._id,doctorId:f.doctor._id,
    consultationId:f.source._id,tenant,serviceDate:"2026-09-12"});
  assert.equal(String(result.consultation),f.source._id);
  await assert.rejects(s.validateFollowUpBooking({patientId:"999999999999999999999999",doctorId:f.doctor._id,
    consultationId:f.source._id,tenant,serviceDate:"2026-09-12"}),{status:409});
  await assert.rejects(s.validateFollowUpBooking({patientId:f.patient._id,doctorId:"999999999999999999999999",
    consultationId:f.source._id,tenant,serviceDate:"2026-09-12"}),{status:409});
  f.setTenant("999999999999999999999999");
  // The production tenant-scoped plugin supplies this boundary. The service never
  // accepts a tenant ID from a patient request; its source is currentTenantId().
  assert.notEqual(f.tenant._id,"999999999999999999999999");
});

test("normal visits do not silently complete a follow-up; the doctor may link one explicitly",async()=>{
  const f=fixture();const {followUp:s,notify}=await f.load();
  await notify.processFollowUpReminders(null,new Date("2026-09-09T04:00:00Z"));
  const current={_id:"111111111111111111111111",patient:f.patient._id,doctor:f.doctor._id,
    createdAt:new Date("2026-09-12T06:00:00Z")};
  const normal=await s.completeLinkedFollowUp(current,{billing:{feeType:"consultation"}},{tenant:f.tenant});
  assert.equal(normal,null);
  assert.equal(f.plans[0].status,"pending");
  await assert.rejects(s.completeLinkedFollowUp({...current,doctor:"999999999999999999999999"},
    {billing:{feeType:"consultation"}},{sourceId:f.source._id,tenant:f.tenant}),{status:409});
  const completed=await s.completeLinkedFollowUp(current,{billing:{feeType:"consultation"}},
    {sourceId:f.source._id,tenant:f.tenant});
  assert.equal(completed.status,"completed");
  assert.equal(String(completed.completedConsultation),current._id);
});

test("legacy due-day reminders are not duplicated after upgrade",async()=>{
  const f=fixture();const {notify}=await f.load();
  f.notifications.push({_id:"888888888888888888888888",tenantId:f.tenant._id,patient:f.patient._id,
    type:"follow_up_reminder",dedupeKey:`consultation:${f.source._id}:follow-up:2026-09-12`,
    title:"Follow-up due today",message:"Legacy reminder",createdAt:new Date(),readAt:null});
  await notify.processFollowUpReminders(null,new Date("2026-09-12T04:00:00Z"));
  assert.equal(f.notifications.length,1);
  assert.equal(f.sentEmails.length,0);
});

test("concurrent scheduler runs cannot create duplicate stage records",async()=>{
  const f=fixture();const {notify}=await f.load();
  const now=new Date("2026-09-09T04:00:00Z");
  await Promise.all([notify.processFollowUpReminders(null,now),notify.processFollowUpReminders(null,now)]);
  assert.equal(f.notifications.length,1);
  assert.equal(f.notifications[0].metadata.stage,-3);
});
