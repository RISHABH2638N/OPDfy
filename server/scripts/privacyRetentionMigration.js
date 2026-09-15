import "dotenv/config";
import mongoose from "mongoose";
import { auditRetentionDays } from "../src/utils/privacySafeLog.js";
import { inspectRetentionIndexes, MINIMUM_LOG_DAYS } from "../src/services/privacyRetentionSafety.js";

const apply = process.argv.includes("--apply");
const acknowledged = process.argv.includes("--acknowledge-retention-review");
if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
if (apply && !acknowledged) throw new Error("Review the approved retention policy and backup first; pass --acknowledge-retention-review.");
if (apply && process.env.PRIVACY_RETENTION_MIGRATION_APPROVED !== "true") throw new Error("PRIVACY_RETENTION_MIGRATION_APPROVED=true is required for an explicit migration.");
let connected = false;
try {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  connected = true;
  const db = mongoose.connection.db;
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("A replica set or supported sharded cluster is required.");
  const securityDays = auditRetentionDays(process.env.SECURITY_LOG_RETENTION_DAYS);
  const activityDays = auditRetentionDays(process.env.AUDIT_LOG_RETENTION_DAYS);
  const findings = [];
  for (const name of ["securityevents", "activitylogs"]) {
    const indexes = await db.collection(name).indexes().catch(error => { if (error.code === 26) return []; throw error; });
    findings.push(...inspectRetentionIndexes(name, indexes, name === "securityevents" ? securityDays : activityDays));
  }
  console.log(JSON.stringify({ minimumLogDays: MINIMUM_LOG_DAYS, securityDays, activityDays, shortTtlIndexes: findings }, null, 2));
  if (!apply) { console.log("Check only; no changes made."); }
  else {
    // Operators must stop old writers and verify a recoverable backup. No clinical collection is modified.
    const activityPreflight = await db.collection("activitylogs").indexes().catch(error => { if (error.code === 26) return []; throw error; });
    if (activityPreflight.some(i => i.key?.expiresAt === 1 && i.expireAfterSeconds != null && Number(i.expireAfterSeconds) !== 0)) throw new Error("Unexpected activity TTL options require manual retention review. No indexes were changed.");
    const unexpectedActivity = activityPreflight.filter(i => i.expireAfterSeconds != null && (Object.keys(i.key || {}).length !== 1 || i.key?.expiresAt !== 1));
    if (unexpectedActivity.length) throw new Error("Unexpected activity TTL fields require manual review. No indexes were changed.");
    const security = db.collection("securityevents");
    const securityIndexes = await security.indexes().catch(error => { if (error.code === 26) return []; throw error; });
    const unexpectedSecurity = securityIndexes.filter(i => i.expireAfterSeconds != null && (Object.keys(i.key || {}).length !== 1 || i.key?.createdAt !== 1));
    if (unexpectedSecurity.length) throw new Error("Unexpected security TTL fields require manual review. No indexes were changed.");
    if (securityIndexes.some(i => i.expireAfterSeconds == null && Object.keys(i.key || {}).length === 1 && i.key?.createdAt === 1)) throw new Error("An existing non-TTL security date index needs manual review before replacing it. No indexes were changed.");
    const securityTtl = securityIndexes.filter(i => i.key?.createdAt === 1 && i.expireAfterSeconds != null);
    const longestSecuritySeconds = Math.max(securityDays * 86400, ...securityTtl.map(i => Number(i.expireAfterSeconds)));
    if (longestSecuritySeconds > securityDays * 86400) throw new Error("Existing security retention is longer than configuration. Increase SECURITY_LOG_RETENTION_DAYS and review the policy before applying any change.");
    for (const index of securityTtl) await security.dropIndex(index.name);
    await security.createIndex({ createdAt: 1 }, { name: "security_event_ttl", expireAfterSeconds: longestSecuritySeconds });
    const activity = db.collection("activitylogs");
    const activityIndexes = await activity.indexes().catch(error => { if (error.code === 26) return []; throw error; });
    const activityTtl = activityIndexes.filter(i => i.key?.expiresAt === 1 && i.expireAfterSeconds != null);
    if (activityTtl.some(i => Number(i.expireAfterSeconds) !== 0)) throw new Error("Unexpected activity TTL options require manual retention review. No activity index was changed.");
    for (const index of activityTtl) await activity.dropIndex(index.name);
    // Existing dates are extended, never shortened. Already deleted records cannot be recovered here.
    await activity.updateMany({}, [{ $set: { expiresAt: { $max: ["$expiresAt", { $dateAdd: { startDate: "$createdAt", unit: "day", amount: activityDays } }] } } }]);
    await activity.createIndex({ expiresAt: 1 }, { name: "activity_log_ttl", expireAfterSeconds: 0 });
    console.log("Retention migration applied. Existing audit dates were extended; no clinical records were deleted.");
  }
} catch (error) {
  console.error(error?.code || error?.name || "ERROR", error?.message || "Migration failed.");
  process.exitCode = 1;
} finally { if (connected) await mongoose.disconnect(); }
