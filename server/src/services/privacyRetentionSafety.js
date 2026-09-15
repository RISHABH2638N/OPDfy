import { auditRetentionDays } from "../utils/privacySafeLog.js";
export const MINIMUM_LOG_DAYS = 365;
export function inspectRetentionIndexes(collection, indexes, days = MINIMUM_LOG_DAYS) {
  const expected = collection === "securityevents" ? { name: "security_event_ttl", key: "createdAt", seconds: days * 86400 } : { name: "activity_log_ttl", key: "expiresAt", seconds: 0 };
  return indexes.filter(index => index.expireAfterSeconds != null && (
    index.name !== expected.name || Object.keys(index.key || {}).length !== 1 || index.key?.[expected.key] !== 1 || Number(index.expireAfterSeconds) !== expected.seconds
  )).map(index => ({ collection, name: index.name, seconds: index.expireAfterSeconds }));
}
export async function assertPrivacyRetentionIndexes(db) {
  const findings = [];
  for (const name of ["securityevents", "activitylogs"]) {
    const indexes = await db.collection(name).indexes().catch(error => { if (error.code === 26) return []; throw error; });
    findings.push(...inspectRetentionIndexes(name, indexes, name === "securityevents" ? auditRetentionDays(process.env.SECURITY_LOG_RETENTION_DAYS) : auditRetentionDays(process.env.AUDIT_LOG_RETENTION_DAYS)));
  }
  if (findings.length) throw Object.assign(new Error("Audit TTL indexes differ from the reviewed configuration. Stop old writers, verify a backup and run the explicit privacy retention migration before starting this release. Never shorten an existing longer retention period."), { code: "PRIVACY_RETENTION_MIGRATION_REQUIRED" });
  return true;
}
export function retentionPolicyDays() { return auditRetentionDays(process.env.AUDIT_LOG_RETENTION_DAYS); }
