const DAY = 86400000;

export function dateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function analyticsPeriod(query, timezone, now = new Date()) {
  const today = dateKey(now, timezone);
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  let startDate;
  let endDate = today;
  if (query.startDate != null || query.endDate != null) {
    if (!validDate(query.startDate) || !validDate(query.endDate) || query.startDate > query.endDate || query.startDate > today ||
      (Date.parse(`${query.endDate}T00:00:00Z`) - Date.parse(`${query.startDate}T00:00:00Z`)) / DAY >= 366) {
      throw Object.assign(new Error("Choose a valid date range of up to 366 days ending today or earlier."), { status: 400 });
    }
    startDate = query.startDate;
    endDate = query.endDate > today ? today : query.endDate;
  } else {
    const days = Number(query.range ?? 1);
    if (![1, 7, 30].includes(days)) throw Object.assign(new Error("Choose today, 7 days, 30 days or a custom range."), { status: 400 });
    startDate = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  }
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY) + 1;
  const utcStart = new Date(Date.parse(`${startDate}T00:00:00Z`) - 2 * DAY);
  const utcEnd = new Date(Date.parse(`${endDate}T23:59:59.999Z`) + 2 * DAY);
  return { startDate, endDate, today, timezone, days, utcStart, utcEnd };
}

const id = (value) => String(value?._id || value || "");
const minutes = (start, end) => {
  const value = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  return start && end && Number.isFinite(value) && value >= 0 && value <= 360 ? value : null;
};
const average = (values) => values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : 0;
const percentile = (values, portion) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * portion;
  return Number((sorted[Math.floor(rank)] + (sorted[Math.ceil(rank)] - sorted[Math.floor(rank)]) * (rank % 1)).toFixed(1));
};

export function summarizeDoctorAnalytics(period, { tokens, waitingTokens = [], appointments, consultations, followUps, referrals, feedback, earlierPatientIds = [] }) {
  const within = (value) => value && dateKey(new Date(value), period.timezone) >= period.startDate && dateKey(new Date(value), period.timezone) <= period.endDate;
  const visits = tokens.filter((item) => within(item.createdAt));
  const notes = consultations.filter((item) => within(item.createdAt));
  const plans = followUps.filter((item) => within(item.createdAt));
  const referralRows = referrals.filter((item) => within(item.createdAt));
  const ratings = feedback.filter((item) => within(item.createdAt));
  const previous = new Set(earlierPatientIds.map(id));
  let firstVisits = 0;
  let repeatVisits = 0;
  for (const item of [...visits].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    if (!item.patient) continue;
    const patientId = id(item.patient);
    if (previous.has(patientId)) repeatVisits += 1;
    else { firstVisits += 1; previous.add(patientId); }
  }
  const waitTimes = visits.map((item) => minutes(item.createdAt, item.calledAt)).filter((value) => value !== null);
  const consultTimes = visits.filter((item) => item.status === "completed")
    .map((item) => minutes(item.calledAt, item.completedAt)).filter((value) => value !== null);
  const byDate = new Map();
  for (let n = 0; n < period.days; n++) {
    const key = new Date(Date.parse(`${period.startDate}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
    byDate.set(key, { date: key, total: 0, completed: 0, skipped: 0 });
  }
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const item of visits) {
    const row = byDate.get(dateKey(new Date(item.createdAt), period.timezone));
    if (row) { row.total++; if (item.status === "completed") row.completed++; if (item.status === "skipped") row.skipped++; }
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: period.timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(item.createdAt)));
    if (Number.isInteger(hour) && hours[hour]) hours[hour].count++;
  }
  const ratingMap = new Map([...byDate.keys()].map((key) => [key, { date: key, count: 0, average: 0, sum: 0 }]));
  for (const item of ratings) {
    const row = ratingMap.get(dateKey(new Date(item.createdAt), period.timezone));
    if (row) { row.count++; row.sum += Number(item.rating) || 0; }
  }
  const diagnosisMap = new Map();
  for (const item of notes) {
    const diagnosis = String(item.diagnosis || "").trim();
    if (diagnosis) diagnosisMap.set(diagnosis, (diagnosisMap.get(diagnosis) || 0) + 1);
  }
  const appointmentCount = appointments.length;
  const appointmentCompleted = appointments.filter((item) => item.status === "completed").length;
  const appointmentCancelled = appointments.filter((item) => item.status === "cancelled").length;
  const percent = (count, total) => total ? Number((count * 100 / total).toFixed(1)) : 0;
  return {
    period: { startDate: period.startDate, endDate: period.endDate, timezone: period.timezone, days: period.days },
    overview: {
      patientsHandled: new Set(visits.filter((item) => item.status === "completed").map((item) => id(item.patient)).filter(Boolean)).size,
      totalVisits: visits.length,
      completed: visits.filter((item) => item.status === "completed").length,
      skipped: visits.filter((item) => item.status === "skipped").length,
      held: visits.filter((item) => item.queueControl?.isOnHold).length,
      noShows: visits.filter((item) => item.arrivalStatus === "no_show").length + appointments.filter((item) => item.status === "missed" && !item.token).length,
      waitingNow: waitingTokens.filter((item) => !item.queueControl?.isOnHold && dateKey(new Date(item.createdAt), period.timezone) === period.today).length,
      averageWaitMinutes: average(waitTimes), medianWaitMinutes: percentile(waitTimes, .5), p90WaitMinutes: percentile(waitTimes, .9),
      averageConsultationMinutes: average(consultTimes),
      emergency: visits.filter((item) => item.urgency === "emergency").length,
      prescriptions: notes.filter((item) => Boolean(item.prescription?.trim()) || item.medicines?.some((medicine) => medicine.name?.trim())).length,
      diagnoses: notes.filter((item) => item.diagnosis?.trim()).length,
      firstVisits, repeatVisits,
    },
    sources: { appointments: visits.filter((item) => item.queueSource === "appointment").length, walkIns: visits.filter((item) => item.queueSource === "walk_in").length, onlineReservations: visits.filter((item) => item.queueSource === "reservation").length },
    appointmentStatus: { total: appointmentCount, completed: appointmentCompleted, cancelled: appointmentCancelled, completionRate: percent(appointmentCompleted, appointmentCount), cancellationRate: percent(appointmentCancelled, appointmentCount) },
    followUps: { recommended: plans.length, completed: followUps.filter((item) => item.status === "completed" && within(item.completedAt)).length },
    referrals: { outgoing: referralRows.filter((item) => item.fromDoctor).length, incoming: referralRows.filter((item) => item.toDoctor).length },
    feedback: { count: ratings.length, average: average(ratings.map((item) => Number(item.rating)).filter(Number.isFinite)), trend: [...ratingMap.values()].map(({ date, count, sum }) => ({ date, count, average: count ? Number((sum / count).toFixed(1)) : 0 })) },
    dailyVolume: [...byDate.values()], peakHours: hours.filter((row) => row.count).sort((a, b) => b.count - a.count || a.hour - b.hour).slice(0, 6),
    diagnosisSummary: [...diagnosisMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count })),
  };
}
