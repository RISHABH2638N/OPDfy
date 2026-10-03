import mongoose from "mongoose";
import Tenant from "../models/Tenant.js";
import SubscriptionInvoice from "../models/SubscriptionInvoice.js";
import { analyticsPeriod, dateKey } from "./doctorAnalytics.js";

export const PLATFORM_TIMEZONE = "Asia/Kolkata";
export const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const badRequest = message => Object.assign(new Error(message), { status: 400 });
export function platformPeriod(query, now = new Date()) {
  if (["startDate", "endDate", "range"].some(key => query[key] != null && typeof query[key] !== "string")) throw badRequest("Choose a valid date range.");
  const period = analyticsPeriod(query, PLATFORM_TIMEZONE, now);
  // Indian calendar dates, not UTC midnight. Range is inclusive in the UI.
  return { ...period, start: new Date(`${period.startDate}T00:00:00+05:30`),
    end: new Date(new Date(`${period.endDate}T00:00:00+05:30`).getTime() + 86400000) };
}

export async function buildPlatformAnalytics(query, now = new Date()) {
  const period = platformPeriod(query, now);
  if (query.clinicId && (typeof query.clinicId !== "string" || !/^[a-f\d]{24}$/i.test(query.clinicId))) throw badRequest("Invalid clinic identifier.");
  const allClinics = await Tenant.find({})
    .select("name slug status subscription analyticsTerms createdAt").sort({ name: 1 }).lean();
  const clinics = query.clinicId ? allClinics.filter(clinic => String(clinic._id) === query.clinicId.toLowerCase()) : allClinics;
  if (query.clinicId && !clinics.length) throw Object.assign(new Error("Clinic not found."), { status: 404 });
  const ids = clinics.map(clinic => clinic._id);
  const db = mongoose.connection.db;
  const scope = { tenantId: { $in: ids } };
  const dateFilter = { $gte: period.start, $lt: period.end };
  const activityStart = new Date(now.getTime() - 30 * 86400000);
  const dateExpr = format => ({ $dateToString: { date: "$createdAt", format, timezone: PLATFORM_TIMEZONE } });
  const patientKey = { $ifNull: ["$patient", { $cond: [{ $and: [{ $ne: ["$patientId", ""] }, { $ne: [{ $ifNull: ["$patientId", null] }, null] }] }, "$patientId", "$_id"] }] };
  const attended = { $or: [{ arrivalStatus: "arrived" }, { status: { $in: ["called", "completed"] } }], arrivalStatus: { $ne: "no_show" } };
  const monthStart = new Date(`${period.startDate.slice(0, 7)}-01T00:00:00+05:30`);
  const groupPatients = (format, start) => db.collection("tokens").aggregate([
    { $match: { ...scope, ...attended, createdAt: { $gte: start, $lt: period.end } } },
    { $group: { _id: { clinic: "$tenantId", date: dateExpr(format), patient: patientKey } } },
    { $group: { _id: { clinic: "$_id.clinic", date: "$_id.date" }, count: { $sum: 1 } } },
    { $project: { _id: 0, clinicId: "$_id.clinic", date: "$_id.date", count: 1 } }, { $sort: { date: 1 } },
  ]).toArray();
  const usage = (collection, filter = {}) => db.collection(collection).aggregate([
    { $match: { ...scope, createdAt: dateFilter, ...filter } },
    { $group: { _id: "$tenantId", count: { $sum: 1 } } },
  ]).toArray();
  const [daily, monthly, people, lastActivity, appointments, prescriptions, online, payments, clinicPayments] = await Promise.all([
    groupPatients("%Y-%m-%d", period.start), groupPatients("%Y-%m", monthStart),
    db.collection("users").aggregate([{ $match: scope }, { $group: { _id: { clinic: "$tenantId", role: "$role" }, count: { $sum: 1 } } }]).toArray(),
    db.collection("tokens").aggregate([{ $match: { ...scope, ...attended, createdAt: { $gte: activityStart, $lte: now } } }, { $group: { _id: "$tenantId", lastAt: { $max: "$createdAt" } } }]).toArray(),
    usage("appointments"), usage("consultations", { $or: [{ prescription: { $type: "string", $ne: "" } }, { "medicines.0": { $exists: true } }] }),
    usage("appointments", { bookingSource: "patient" }),
    SubscriptionInvoice.aggregate([{ $match: scope }, { $facet: {
      collected: [{ $match: { status: "paid", paidAt: dateFilter } }, { $group: { _id: "$tenantId", amount: { $sum: "$amountPaise" } } }],
      pending: [{ $match: { status: "pending" } }, { $group: { _id: "$tenantId", amount: { $sum: "$amountPaise" }, count: { $sum: 1 } } }],
      recent: [{ $sort: { createdAt: -1 } }, { $limit: 100 }, { $project: { fingerprint: 0, requestId: 0, createdBy: 0, settledBy: 0 } }],
      total: [{ $count: "count" }],
    } }]),
    // Appointment check-in mirrors payment into a token: aggregate tokens only.
    db.collection("tokens").aggregate([{ $match: { ...scope, "billing.status": "paid", "billing.paidAt": dateFilter } },
      { $group: { _id: "$tenantId", amount: { $sum: "$billing.paidAmount" } } }]).toArray(),
  ]);
  const money = payments[0];
  const byClinic = rows => new Map(rows.map(row => [String(row._id), row]));
  const collectedMap = byClinic(money.collected), pendingMap = byClinic(money.pending), patientPaymentMap = byClinic(clinicPayments);
  const activityMap = byClinic(lastActivity), apptMap = byClinic(appointments), prescriptionMap = byClinic(prescriptions), onlineMap = byClinic(online);
  const rows = clinics.map(clinic => {
    const id = String(clinic._id);
    const dayRows = daily.filter(row => String(row.clinicId) === id);
    const monthRows = monthly.filter(row => String(row.clinicId) === id);
    const roleCount = role => people.find(row => String(row._id.clinic) === id && row._id.role === role)?.count || 0;
    const sub = clinic.subscription || {};
    const expired = sub.status !== "unmanaged" && sub.endsAt && new Date(sub.endsAt) <= now;
    const pilot = clinic.analyticsTerms?.pilotEndsAt && new Date(clinic.analyticsTerms.pilotEndsAt) > now && clinic.status === "active";
    return { id, name: clinic.name, slug: clinic.slug, status: expired && ["active", "suspended"].includes(clinic.status) ? "expired" : clinic.status,
      terms: clinic.analyticsTerms || {}, subscriptionStatus: expired ? "expired" : sub.status || "unmanaged", renewalAt: sub.endsAt || null,
      pilot: Boolean(pilot), doctors: roleCount("doctor"), staff: roleCount("admin") + roleCount("receptionist"),
      dailyPatients: dayRows.find(row => row.date === period.endDate)?.count || 0,
      monthlyPatients: monthRows.find(row => row.date === period.endDate.slice(0, 7))?.count || 0,
      subscriptionCollectedPaise: collectedMap.get(id)?.amount || 0, outstandingPaise: pendingMap.get(id)?.amount || 0,
      pendingInvoices: pendingMap.get(id)?.count || 0, clinicCounterPayments: Math.round((patientPaymentMap.get(id)?.amount || 0) * 100) / 100,
      activeLast30Days: activityMap.has(id), usage: { appointments: apptMap.has(id), queue: dayRows.length > 0, prescriptions: prescriptionMap.has(id), patientBooking: onlineMap.has(id) },
    };
  });
  const counts = Object.fromEntries(["active", "pending", "suspended", "rejected", "expired"].map(status => [status, rows.filter(row => row.status === status).length]));
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  const dailyTrend = [];
  for (let at = period.start; at < period.end; at = new Date(at.getTime() + 86400000)) {
    const date = dateKey(at, PLATFORM_TIMEZONE); dailyTrend.push({ date, count: daily.filter(row => row.date === date).reduce((n, row) => n + row.count, 0) });
  }
  const monthlyTrend = [];
  for (let month = new Date(`${period.startDate.slice(0, 7)}-01T00:00:00Z`); month.toISOString().slice(0, 7) <= period.endDate.slice(0, 7); month.setUTCMonth(month.getUTCMonth() + 1)) {
    const date = month.toISOString().slice(0, 7); monthlyTrend.push({ date, count: monthly.filter(row => row.date === date).reduce((n, row) => n + row.count, 0) });
  }
  const alerts = rows.flatMap(row => {
    const result = [];
    if (row.pendingInvoices) result.push({ clinicId: row.id, clinicName: row.name, type: "pending_payment", value: row.outstandingPaise });
    if (row.renewalAt && new Date(row.renewalAt) > now && new Date(row.renewalAt) <= new Date(now.getTime() + 7 * 86400000)) result.push({ clinicId: row.id, clinicName: row.name, type: "renewal_due", date: row.renewalAt });
    if (row.pilot && new Date(row.terms.pilotEndsAt) <= new Date(now.getTime() + 3 * 86400000)) result.push({ clinicId: row.id, clinicName: row.name, type: "pilot_ending", date: row.terms.pilotEndsAt });
    if (row.status === "active" && !row.activeLast30Days && new Date(clinics.find(c => String(c._id) === row.id).createdAt) < activityStart) result.push({ clinicId: row.id, clinicName: row.name, type: "inactive" });
    return result;
  });
  return { period: { startDate: period.startDate, endDate: period.endDate, timezone: PLATFORM_TIMEZONE },
    overview: { total: rows.length, ...counts, pilots: rows.filter(row => row.pilot).length, doctors: sum("doctors"), staff: sum("staff"),
      dailyPatients: sum("dailyPatients"), monthlyPatients: sum("monthlyPatients"), subscriptionCollectedPaise: sum("subscriptionCollectedPaise"), outstandingPaise: sum("outstandingPaise") },
    clinics: rows, clinicOptions: allClinics.map(clinic => ({ id: String(clinic._id), name: clinic.name })), dailyTrend, monthlyTrend, alerts, invoices: money.recent, invoiceCount: money.total[0]?.count || 0,
    adoption: Object.fromEntries(["appointments", "queue", "prescriptions", "patientBooking"].map(key => [key, rows.filter(row => row.usage[key]).length])) };
}
