const DEFAULT_TIMEZONE = process.env.HOSPITAL_TIMEZONE || "Asia/Kolkata";

function partsFor(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: value("weekday"),
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

function minutes(value = "") {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function getDoctorAvailability(doctor, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const schedule = doctor?.doctorSchedule || {};
  const workingDays = Array.isArray(schedule.workingDays) ? schedule.workingDays : [];
  const unavailableDates = Array.isArray(schedule.unavailableDates) ? schedule.unavailableDates : [];
  const startTime = schedule.startTime || "09:00";
  const endTime = schedule.endTime || "17:00";
  const local = partsFor(now, timeZone);
  const current = minutes(local.time);
  const start = minutes(startTime);
  const end = minutes(endTime);

  const base = {
    isAvailable: false,
    weekday: local.weekday,
    date: local.date,
    currentTime: local.time,
    startTime,
    endTime,
    roomNumber: schedule.roomNumber || "",
    timeZone,
    reason: "",
    status: "unavailable",
  };

  if (!workingDays.includes(local.weekday)) {
    return { ...base, reason: `Dr. ${doctor?.name || ""} is off on ${local.weekday}.`, status: "weekly_off" };
  }
  if (unavailableDates.includes(local.date)) {
    return { ...base, reason: `Dr. ${doctor?.name || ""} is unavailable on ${local.date}.`, status: "leave" };
  }
  if (schedule.isOnBreak) {
    return { ...base, reason: `Dr. ${doctor?.name || ""} is currently on break.`, status: "on_break" };
  }
  if (start === null || end === null || current === null) {
    return { ...base, reason: "Doctor schedule is not configured correctly.", status: "invalid_schedule" };
  }
  if (current < start) {
    return { ...base, reason: `Dr. ${doctor?.name || ""}'s shift starts at ${startTime}.`, status: "before_shift" };
  }
  if (current >= end) {
    return { ...base, reason: `Dr. ${doctor?.name || ""}'s shift ended at ${endTime}.`, status: "shift_over" };
  }
  return {
    ...base,
    isAvailable: true,
    reason: `Available today until ${endTime}.`,
    status: "available",
  };
}

export function onlyAvailableDoctors(doctors, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return doctors
    .map((doctor) => ({ ...doctor, availability: getDoctorAvailability(doctor, now, timeZone) }))
    .filter((doctor) => doctor.availability.isAvailable);
}

export { DEFAULT_TIMEZONE };
