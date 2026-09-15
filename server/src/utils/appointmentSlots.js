import { DEFAULT_TIMEZONE } from "./doctorAvailability.js";

const SLOT_MINUTES = Math.max(5, Number(process.env.APPOINTMENT_SLOT_MINUTES || 15));

function timeToMinutes(value = "") {
  const m = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2,"0")}:${String(value % 60).padStart(2,"0")}`;
}
function localToday(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, weekday:"long", year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hourCycle:"h23"
  }).formatToParts(now);
  const get=(t)=>parts.find(p=>p.type===t)?.value || "";
  return { date:`${get("year")}-${get("month")}-${get("day")}`, weekday:get("weekday"), time:`${get("hour")}:${get("minute")}` };
}
function weekdayForDate(dateString, timeZone = DEFAULT_TIMEZONE) {
  const [y,m,d]=String(dateString).split("-").map(Number);
  if(!y||!m||!d) return "";
  return new Intl.DateTimeFormat("en-US",{timeZone,weekday:"long"}).format(new Date(Date.UTC(y,m-1,d,12,0,0)));
}
export function isDoctorWorkingOnDate(doctor, dateString, timeZone = DEFAULT_TIMEZONE) {
  const schedule=doctor?.doctorSchedule || {};
  const workingDays=Array.isArray(schedule.workingDays)?schedule.workingDays:[];
  const unavailableDates=Array.isArray(schedule.unavailableDates)?schedule.unavailableDates:[];
  const weekday=weekdayForDate(dateString,timeZone);
  const today = localToday(new Date(), timeZone).date;
  // "On break" is a temporary current-day state. It must not make every
  // future appointment date disappear from the booking calendar.
  if(schedule.isOnBreak && dateString === today) {
    return {ok:false,reason:`Dr. ${doctor?.name||""} is currently marked on break.`};
  }
  if(!workingDays.includes(weekday)) return {ok:false,reason:`Dr. ${doctor?.name||""} is off on ${weekday}.`};
  if(unavailableDates.includes(dateString)) return {ok:false,reason:`Dr. ${doctor?.name||""} is unavailable on ${dateString}.`};
  const start=timeToMinutes(schedule.startTime||"09:00"), end=timeToMinutes(schedule.endTime||"17:00");
  if(start===null||end===null||end<=start) return {ok:false,reason:"Doctor schedule is not configured correctly."};
  return {ok:true,weekday,startTime:schedule.startTime||"09:00",endTime:schedule.endTime||"17:00",roomNumber:schedule.roomNumber||""};
}
export function availableDateOptions(doctor, days=30, now=new Date(), timeZone=DEFAULT_TIMEZONE) {
  const today=localToday(now,timeZone).date;
  const [y,m,d]=today.split("-").map(Number);
  const out=[];
  for(let i=0;i<days;i++){
    const dt=new Date(Date.UTC(y,m-1,d+i,12));
    const date=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(dt);
    const check=isDoctorWorkingOnDate(doctor,date,timeZone);
    if(check.ok) out.push({date,weekday:check.weekday,startTime:check.startTime,endTime:check.endTime,roomNumber:check.roomNumber});
  }
  return out;
}
export function buildSlots(doctor,dateString,bookedTimes=[],now=new Date(),timeZone=DEFAULT_TIMEZONE) {
  const check=isDoctorWorkingOnDate(doctor,dateString,timeZone);
  if(!check.ok) return {slots:[],reason:check.reason};
  const start=timeToMinutes(check.startTime), end=timeToMinutes(check.endTime);
  const today=localToday(now,timeZone);
  const current=timeToMinutes(today.time);
  const booked=new Set(bookedTimes);
  const slots=[];
  for(let t=start;t+SLOT_MINUTES<=end;t+=SLOT_MINUTES){
    const startTime=minutesToTime(t), endTime=minutesToTime(t+SLOT_MINUTES);
    if(dateString===today.date && t<=current) continue;
    if(booked.has(startTime)) continue;
    slots.push({startTime,endTime,label:`${startTime} - ${endTime}`});
  }
  return {slots,roomNumber:check.roomNumber};
}
export { SLOT_MINUTES };
