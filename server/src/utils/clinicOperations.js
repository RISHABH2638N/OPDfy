import { DEFAULT_TIMEZONE } from "./doctorAvailability.js";

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function localParts(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: get("weekday"),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function minutes(value = "") {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function weekdayForDate(dateString) {
  const [year, month, day] = String(dateString || "").split("-").map(Number);
  if (!year || !month || !day) return "";
  // A Gregorian calendar date has the same weekday regardless of clinic timezone.
  // Using UTC avoids date rollover for extreme timezone offsets.
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" })
    .format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

export function normalizeClinicOperations(value = {}) {
  const rawDays = Array.isArray(value.workingDays) ? value.workingDays : WEEK_DAYS;
  const workingDays = WEEK_DAYS.filter((day) => rawDays.includes(day));
  const openTime = TIME_PATTERN.test(String(value.openTime || "")) ? String(value.openTime) : "08:00";
  const closeTime = TIME_PATTERN.test(String(value.closeTime || "")) ? String(value.closeTime) : "20:00";
  return {
    clinicHoursEnabled: Boolean(value.clinicHoursEnabled),
    workingDays: workingDays.length ? workingDays : [...WEEK_DAYS],
    openTime,
    closeTime,
    bookingCutoffMinutes: Math.min(240, Math.max(0, Number(value.bookingCutoffMinutes ?? 30) || 0)),
    checkInCutoffMinutes: Math.min(240, Math.max(0, Number(value.checkInCutoffMinutes ?? 30) || 0)),
    missedGraceMinutes: Math.min(240, Math.max(5, Number(value.missedGraceMinutes ?? 30) || 30)),
    queueState: value.queueState === "closed" ? "closed" : "open",
    queueStateDate: String(value.queueStateDate || ""),
    queueOpenedAt: value.queueOpenedAt || null,
    queueClosedAt: value.queueClosedAt || null,
    queueClosedReason: String(value.queueClosedReason || "").trim().slice(0, 240),
  };
}

export function validateClinicOperationsInput(value = {}) {
  if (value.openTime != null && !TIME_PATTERN.test(String(value.openTime))) {
    throw Object.assign(new Error("Choose a valid clinic opening time."), { status: 400 });
  }
  if (value.closeTime != null && !TIME_PATTERN.test(String(value.closeTime))) {
    throw Object.assign(new Error("Choose a valid clinic closing time."), { status: 400 });
  }
  if (Array.isArray(value.workingDays)) {
    const validDays = WEEK_DAYS.filter((day) => value.workingDays.includes(day));
    if (!validDays.length) throw Object.assign(new Error("Select at least one clinic working day."), { status: 400 });
  }
  const normalized = normalizeClinicOperations(value);
  const open = minutes(normalized.openTime);
  const close = minutes(normalized.closeTime);
  if (open === null || close === null || close <= open) {
    throw Object.assign(new Error("Clinic closing time must be later than opening time."), { status: 400 });
  }
  return normalized;
}

export function getClinicOperations(tenant) {
  return normalizeClinicOperations(tenant?.settings?.operations || {});
}

export function getClinicOperationsSnapshot(tenant, now = new Date()) {
  const timeZone = tenant?.timezone || DEFAULT_TIMEZONE;
  const settings = getClinicOperations(tenant);
  const local = localParts(now, timeZone);
  const effectiveQueueState = settings.queueStateDate === local.date ? settings.queueState : "open";
  const current = minutes(local.time);
  const open = minutes(settings.openTime);
  const close = minutes(settings.closeTime);
  const workingDay = settings.workingDays.includes(local.weekday);
  const withinHours = !settings.clinicHoursEnabled || (workingDay && current >= open && current < close);
  const bookingOpen = !settings.clinicHoursEnabled || (workingDay && current < close - settings.bookingCutoffMinutes);
  const checkInOpen = !settings.clinicHoursEnabled || (workingDay && current < close - settings.checkInCutoffMinutes && current >= open);
  return {
    ...settings,
    date: local.date,
    weekday: local.weekday,
    currentTime: local.time,
    timeZone,
    effectiveQueueState,
    isWithinHours: withinHours,
    isBookingOpen: bookingOpen,
    isCheckInOpen: checkInOpen,
  };
}

export function isClinicOperatingOnDate(tenant, dateString) {
  const settings = getClinicOperations(tenant);
  if (!settings.clinicHoursEnabled) return { ok: true };
  const weekday = weekdayForDate(dateString);
  if (!settings.workingDays.includes(weekday)) {
    return { ok: false, reason: `Clinic is closed on ${weekday}.` };
  }
  return { ok: true, weekday, openTime: settings.openTime, closeTime: settings.closeTime };
}

export function filterClinicAppointmentDates(tenant, dates = []) {
  return dates.filter((item) => isClinicOperatingOnDate(tenant, item.date).ok);
}

export function applyClinicSlotRules(tenant, dateString, slotResult = { slots: [] }, now = new Date()) {
  const dateCheck = isClinicOperatingOnDate(tenant, dateString);
  if (!dateCheck.ok) return { ...slotResult, slots: [], reason: dateCheck.reason };
  const settings = getClinicOperations(tenant);
  if (!settings.clinicHoursEnabled) return slotResult;

  const local = localParts(now, tenant?.timezone || DEFAULT_TIMEZONE);
  const open = minutes(settings.openTime);
  const close = minutes(settings.closeTime);
  const current = minutes(local.time);
  const slots = (slotResult.slots || []).filter((slot) => {
    const start = minutes(slot.startTime);
    const end = minutes(slot.endTime);
    if (start === null || end === null || start < open || end > close) return false;
    if (dateString === local.date && start < current + settings.bookingCutoffMinutes) return false;
    return true;
  });
  return { ...slotResult, slots };
}

function operationalError(message, code) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  return error;
}

export function assertQueueAcceptingArrivals(tenant, now = new Date()) {
  const snapshot = getClinicOperationsSnapshot(tenant, now);
  if (snapshot.effectiveQueueState === "closed") {
    throw operationalError(
      snapshot.queueClosedReason ? `Today's queue is closed: ${snapshot.queueClosedReason}` : "Today's OPD queue is closed for new arrivals.",
      "QUEUE_CLOSED"
    );
  }
  if (!snapshot.isCheckInOpen) {
    throw operationalError(
      `New check-ins are closed. Clinic hours are ${snapshot.openTime}-${snapshot.closeTime} with a ${snapshot.checkInCutoffMinutes}-minute check-in cutoff.`,
      "CHECKIN_CUTOFF"
    );
  }
  return snapshot;
}

export function assertSameDayReservationAllowed(tenant, now = new Date()) {
  const snapshot = getClinicOperationsSnapshot(tenant, now);
  if (snapshot.effectiveQueueState === "closed") {
    throw operationalError("Today's OPD queue is closed for new online reservations.", "QUEUE_CLOSED");
  }
  if (!snapshot.isBookingOpen) {
    throw operationalError(
      `Online booking is closed for today. Clinic hours are ${snapshot.openTime}-${snapshot.closeTime} with a ${snapshot.bookingCutoffMinutes}-minute booking cutoff.`,
      "BOOKING_CUTOFF"
    );
  }
  return snapshot;
}

export function assertAppointmentSlotAllowed(tenant, appointmentDate, startTime, now = new Date()) {
  const dateCheck = isClinicOperatingOnDate(tenant, appointmentDate);
  if (!dateCheck.ok) throw operationalError(dateCheck.reason, "CLINIC_CLOSED_DATE");
  const settings = getClinicOperations(tenant);
  if (!settings.clinicHoursEnabled) return true;
  const start = minutes(startTime);
  const open = minutes(settings.openTime);
  const close = minutes(settings.closeTime);
  if (start === null || start < open || start >= close) {
    throw operationalError(`Choose a slot inside clinic hours ${settings.openTime}-${settings.closeTime}.`, "OUTSIDE_CLINIC_HOURS");
  }
  const local = localParts(now, tenant?.timezone || DEFAULT_TIMEZONE);
  if (appointmentDate === local.date && start < minutes(local.time) + settings.bookingCutoffMinutes) {
    throw operationalError(`Same-day appointments require at least ${settings.bookingCutoffMinutes} minutes advance booking.`, "BOOKING_CUTOFF");
  }
  return true;
}

export function hospitalLocalDateTime(tenant, now = new Date()) {
  return localParts(now, tenant?.timezone || DEFAULT_TIMEZONE);
}

export { WEEK_DAYS as CLINIC_WEEK_DAYS };
