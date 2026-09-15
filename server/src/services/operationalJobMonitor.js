import OperationalJobStatus from "../models/OperationalJobStatus.js";
import { safeDiagnostic } from "../utils/privacySafeLog.js";
const schedules = Object.freeze({ appointment_reminders: 120000, followup_reminders: 7200000, subscription_expiry: 1800000, missed_appointments: 900000 });
export async function recordMaintenanceRun(key, outcome, startedAt, error = null) {
  if (!(key in schedules)) throw new Error("Unknown maintenance job.");
  const now = new Date();
  await OperationalJobStatus.updateOne({ key }, { $set: {
    lastStartedAt: startedAt, lastOutcome: outcome, durationMs: Math.max(0, now - startedAt),
    ...(outcome === "success" ? { lastSuccessAt: now, failureCode: "" } : { lastFailureAt: now, failureCode: safeDiagnostic(error) }),
  } }, { upsert: true, runValidators: true });
}
export function maintenanceHealth(records, now = new Date()) {
  const byKey = new Map(records.map(r => [r.key, r]));
  return Object.entries(schedules).map(([key, maxAgeMs]) => {
    const record = byKey.get(key);
    const stale = !record?.lastSuccessAt || now - new Date(record.lastSuccessAt) > maxAgeMs;
    return { key, lastSuccessAt: record?.lastSuccessAt || null, lastFailureAt: record?.lastFailureAt || null,
      lastOutcome: record?.lastOutcome || "unknown", failureCode: record?.failureCode || "", stale };
  });
}
