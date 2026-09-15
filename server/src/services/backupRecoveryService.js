import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import BackupRecord from "../models/BackupRecord.js";
import RestoreDrillRecord from "../models/RestoreDrillRecord.js";
import { backupStorageConfig, deleteBackupObject, downloadBackupObject, uploadBackupObject } from "./backupStorageService.js";
import { sendEmail } from "../utils/sendEmail.js";
import { validateEncryptedManifest } from "../utils/privacyBackupIntegrity.js";
import { safeDiagnostic } from "../utils/privacySafeLog.js";

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const bool = value => String(value || "false").toLowerCase() === "true";
const deploymentHost = value => {
  try { return new URL(String(value || "")).host.toLowerCase(); }
  catch { return ""; }
};
const restoreUri = () => {
  const target = String(process.env.PRIVACY_RESTORE_URI || "").trim();
  if (!target) throw fail("PRIVACY_RESTORE_URI is not configured for a disposable database.",503);
  const sourceHost = deploymentHost(process.env.MONGO_URI), targetHost = deploymentHost(target);
  if (!sourceHost || !targetHost) throw fail("Restore drill database configuration is invalid.",503);
  if (sourceHost === targetHost && !bool(process.env.PRIVACY_RESTORE_ALLOW_SAME_DEPLOYMENT)) throw fail("Restore drill must use a separate MongoDB deployment.",503);
  return target;
};
const databaseName = () => {
  const value = String(process.env.BACKUP_DATABASE_NAME || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw fail("Set a valid BACKUP_DATABASE_NAME.", 503);
  return value;
};
const encryptionKey = () => {
  const raw = String(process.env.BACKUP_ENCRYPTION_KEY || "");
  let key; try { key = Buffer.from(raw, "base64"); } catch { key = null; }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw) || !key || key.length !== 32) throw fail("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.", 503);
  return key;
};
const fileHash = async filename => { const sum = crypto.createHash("sha256"); for await (const chunk of fs.createReadStream(filename)) sum.update(chunk); return sum.digest("hex"); };
const retention = date => {
  const monthly = date.getUTCDate() === 1, weekly = date.getUTCDay() === 0;
  const retentionClass = monthly ? "monthly" : weekly ? "weekly" : "daily";
  const days = Number(process.env[`BACKUP_RETENTION_${retentionClass.toUpperCase()}_DAYS`] || ({ daily:7, weekly:28, monthly:365 }[retentionClass]));
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw fail("Backup retention configuration is invalid.", 503);
  return { retentionClass, expiresAt: new Date(date.getTime() + days * 86400000) };
};
const run = (script, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(scripts, script), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errorOutput = "";
  const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Object.assign(new Error("Backup operation timed out."), { code: "BACKUP_TIMEOUT" })); }, 35 * 60 * 1000);
  child.stdout.on("data", chunk => { if (output.length < 20000) output += chunk; });
  child.stderr.on("data", chunk => { if (errorOutput.length < 2000) errorOutput += chunk; });
  child.on("error", error => { clearTimeout(timer); reject(error); });
  child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else reject(Object.assign(new Error("Backup tool failed."), { code: /not found|ENOENT/i.test(errorOutput) ? "BACKUP_TOOL_MISSING" : "BACKUP_TOOL_FAILED" })); });
});
async function encryptArchive(source, target, key) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  await pipeline(fs.createReadStream(source), cipher, fs.createWriteStream(target, { flags: "wx", mode: 0o600 }));
  return { iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyId: crypto.createHash("sha256").update(key).digest("hex").slice(0,16) };
}
async function decryptArchive(source, target, key, encryption) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encryption.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encryption.authTag, "base64"));
  await pipeline(fs.createReadStream(source), decipher, fs.createWriteStream(target, { flags: "wx", mode: 0o600 }));
}
async function alertFailure(kind, recordId, code) {
  const recipient = String(process.env.SECURITY_ALERT_EMAIL || "").trim(); if (!recipient) return;
  try { await sendEmail({ to: recipient, subject: `OPDfy ${kind} failure`, text: `${kind} ${recordId} failed with diagnostic code ${code}. Review the protected Platform Admin backup dashboard. No patient data is included in this email.`, html: `<p><strong>OPDfy ${kind} failure</strong></p><p>Reference: ${recordId}</p><p>Diagnostic: ${code}</p><p>Review the protected backup dashboard. No patient data is included in this email.</p>` }); } catch {}
}

async function queueBackupUnlocked({ trigger, requestedBy = null, scheduleSlot = undefined }) {
  const config = backupStorageConfig(), database = databaseName(); encryptionKey();
  if (await BackupRecord.exists({ status: { $in: ["queued", "running"] } })) throw fail("A backup is already queued or running.", 409);
  const now = new Date(), policy = retention(now);
  try { return await BackupRecord.create({ trigger, requestedBy, scheduleSlot, database, provider: config.provider, ...policy }); }
  catch (error) { if (error.code === 11000) return null; throw error; }
}
export async function executeBackup(recordId) {
  const record = await BackupRecord.findOneAndUpdate({ _id: recordId, status: "queued" }, { $set: { status: "running", startedAt: new Date(), failureCode: "" } }, { new: true });
  if (!record) return;
  let temporary;
  try {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opd-backup-"));
    const archive = path.join(temporary, "backup.archive.gz"), encrypted = archive + ".enc", manifestPath = archive + ".sha256.json";
    await run("privacyBackup.mjs", ["--db", record.database, "--output", archive]);
    const originalManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const encryption = await encryptArchive(archive, encrypted, encryptionKey());
    const encryptedSha256 = await fileHash(encrypted);
    const prefix = `backups/${record.database}/${record.createdAt.toISOString().slice(0,10).replaceAll("-","/")}/${record._id}`;
    const objectKey = `${prefix}.archive.gz.enc`, manifestObjectKey = `${prefix}.manifest.json`;
    const externalManifest = { ...originalManifest, format: "opd-encrypted-mongodb-backup-v2", encryptedFilename: path.basename(encrypted), encryptedBytes: fs.statSync(encrypted).size, encryptedSha256, encryption: { algorithm: "AES-256-GCM", ...encryption }, retentionClass: record.retentionClass, expiresAt: record.expiresAt.toISOString() };
    fs.writeFileSync(manifestPath, JSON.stringify(externalManifest, null, 2) + "\n", { flag: "w", mode: 0o600 });
    await uploadBackupObject(objectKey, encrypted, "application/octet-stream");
    try { await uploadBackupObject(manifestObjectKey, manifestPath, "application/json"); } catch (error) { await deleteBackupObject(objectKey).catch(()=>{}); throw error; }
    await BackupRecord.updateOne({ _id: record._id, status: "running" }, { $set: { status: "succeeded", completedAt: new Date(), objectKey, manifestObjectKey, bytes: externalManifest.encryptedBytes, archiveSha256: originalManifest.sha256, encryptedSha256, encryption: { algorithm: "AES-256-GCM", keyId: encryption.keyId }, collectionCount: Object.keys(originalManifest.collectionCounts || {}).length } });
    await pruneExpiredBackups().catch(error => console.warn(`Backup retention cleanup skipped (${safeDiagnostic(error)}).`));
  } catch (error) {
    const code = safeDiagnostic(error); await BackupRecord.updateOne({ _id: record._id }, { $set: { status: "failed", completedAt: new Date(), failureCode: code } });
    await alertFailure("backup", String(record._id), code);
  } finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
export async function runScheduledBackup() {
  if (!bool(process.env.BACKUP_SCHEDULE_ENABLED)) return null;
  const hour = Number(process.env.BACKUP_SCHEDULE_HOUR_UTC || 20); if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw fail("BACKUP_SCHEDULE_HOUR_UTC is invalid.",503);
  const now = new Date(); if (now.getUTCHours() !== hour) return null;
  const slot = now.toISOString().slice(0,10); const record = await queueBackup({ trigger: "scheduled", scheduleSlot: slot });
  if (record) launchRecoveryJob("backup", record._id); return record;
}
export async function pruneExpiredBackups() {
  if (!bool(process.env.BACKUP_RETENTION_DELETE_ENABLED)) return { deleted: 0 };
  const records = await BackupRecord.find({ status: "succeeded", expiresAt: { $lte: new Date() } }).select("+objectKey +manifestObjectKey").limit(25);
  let deleted = 0;
  for (const record of records) { await deleteBackupObject(record.objectKey); await deleteBackupObject(record.manifestObjectKey); record.status = "deleted"; record.deletedAt = new Date(); record.objectKey = ""; record.manifestObjectKey = ""; await record.save(); deleted++; }
  return { deleted };
}
async function queueRestoreDrillUnlocked(backupId, ownerId) {
  restoreUri();
  const backup = await BackupRecord.findOne({ _id: backupId, status: "succeeded" }); if (!backup) throw fail("Successful backup not found.",404);
  if (await RestoreDrillRecord.exists({ status: { $in: ["queued", "running"] } })) throw fail("A restore drill is already queued or running.",409);
  const targetDatabase = `opd_restore_${new Date().toISOString().slice(0,10).replaceAll("-","")}_${crypto.randomBytes(4).toString("hex")}`;
  return RestoreDrillRecord.create({ backup: backup._id, targetDatabase, requestedBy: ownerId });
}
export async function executeRestoreDrill(drillId) {
  const drill = await RestoreDrillRecord.findOneAndUpdate({ _id: drillId, status: "queued" }, { $set: { status: "running", startedAt: new Date(), failureCode: "" } }, { new: true }); if (!drill) return;
  let temporary;
  try {
    const backup = await BackupRecord.findById(drill.backup).select("+objectKey +manifestObjectKey");
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opd-restore-"));
    const encrypted = path.join(temporary, "backup.archive.gz.enc"), archive = path.join(temporary, "backup.archive.gz"), manifestPath = archive + ".sha256.json";
    if (!backup || backup.status !== "succeeded") throw Object.assign(new Error("Backup unavailable."),{code:"BACKUP_UNAVAILABLE"});
    const storedManifest = path.join(temporary, "stored-manifest.json");
    await downloadBackupObject(backup.objectKey, encrypted); await downloadBackupObject(backup.manifestObjectKey, storedManifest);
    const manifest = validateEncryptedManifest(JSON.parse(fs.readFileSync(storedManifest,"utf8")), backup);
    if (manifest.format !== "opd-encrypted-mongodb-backup-v2" || (fs.statSync(encrypted).size !== backup.bytes || await fileHash(encrypted) !== backup.encryptedSha256)) throw Object.assign(new Error("Encrypted backup integrity check failed."),{code:"BACKUP_INTEGRITY_FAILED"});
    await decryptArchive(encrypted, archive, encryptionKey(), manifest.encryption);
    if (await fileHash(archive) !== manifest.sha256) throw Object.assign(new Error("Decrypted backup integrity check failed."),{code:"BACKUP_INTEGRITY_FAILED"});
    const legacyManifest = { ...manifest, format: "opd-mongodb-backup-v1", filename: path.basename(archive), bytes: fs.statSync(archive).size, encryption: "verified-before-disposable-restore" };
    fs.writeFileSync(manifestPath, JSON.stringify(legacyManifest,null,2)+"\n", { mode:0o600 });
    await run("privacyRestoreDrill.mjs", ["--archive", archive, "--source-db", backup.database, "--target-db", drill.targetDatabase], { ...process.env, PRIVACY_RESTORE_DRILL_ACK: "RESTORE_TO_DISPOSABLE_DATABASE" });
    const report = JSON.parse(fs.readFileSync(archive + ".restore-report.json","utf8"));
    await RestoreDrillRecord.updateOne({ _id: drill._id, status: "running" }, { $set: { status: "succeeded", completedAt: new Date(), archiveSha256: report.archiveSha256, collectionCount: Object.keys(report.collectionCounts || {}).length, transactionRollbackVerified: Boolean(report.transactionRollbackVerified), manualFunctionalVerificationRequired: true } });
  } catch (error) { const code=safeDiagnostic(error); await RestoreDrillRecord.updateOne({ _id: drill._id },{$set:{status:"failed",completedAt:new Date(),failureCode:code}}); await alertFailure("restore drill",String(drill._id),code); }
  finally { if (temporary) fs.rmSync(temporary,{recursive:true,force:true}); }
}
export async function backupDashboard() {
  const [backups, drills, latest, running, failed] = await Promise.all([
    BackupRecord.find({}).sort({createdAt:-1}).limit(50).lean(), RestoreDrillRecord.find({}).sort({createdAt:-1}).limit(25).lean(),
    BackupRecord.findOne({status:"succeeded"}).sort({completedAt:-1}).lean(), BackupRecord.countDocuments({status:{$in:["queued","running"]}}), BackupRecord.countDocuments({status:"failed"}),
  ]);
  let configured=true, configurationError=""; try { backupStorageConfig(); databaseName(); encryptionKey(); } catch(error){configured=false;configurationError=error.message;}
  return { configured, configurationError, scheduleEnabled: bool(process.env.BACKUP_SCHEDULE_ENABLED), scheduleHourUtc: Number(process.env.BACKUP_SCHEDULE_HOUR_UTC || 20), retentionDeletionEnabled: bool(process.env.BACKUP_RETENTION_DELETE_ENABLED), latestSuccessfulAt: latest?.completedAt||null, healthy: Boolean(latest && Date.now()-new Date(latest.completedAt)<36*3600000), running, failed, backups, drills, productionRestoreEnabled:false };
}
export async function recoverInterruptedBackupJobs() {
  const cutoff = new Date(Date.now()-60*60*1000);
  const [backups, drills] = await Promise.all([
    BackupRecord.updateMany({status:{$in:["queued","running"]},createdAt:{$lt:cutoff}},{$set:{status:"failed",completedAt:new Date(),failureCode:"BACKUP_WORKER_INTERRUPTED"}}),
    RestoreDrillRecord.updateMany({status:{$in:["queued","running"]},createdAt:{$lt:cutoff}},{$set:{status:"failed",completedAt:new Date(),failureCode:"RESTORE_WORKER_INTERRUPTED"}}),
  ]);
  return {backups:Number(backups.modifiedCount||0),drills:Number(drills.modifiedCount||0)};
}
export { fail as backupFailure };

export function launchRecoveryJob(kind, id) {
  const operation = kind === "backup" ? executeBackup : executeRestoreDrill;
  return operation(id).catch(async error => {
    const code = safeDiagnostic(error);
    console.error(`Recovery worker failed (${code}).`);
    await alertFailure(kind, String(id), code);
  });
}

// Serialize admission inside this server process so simultaneous clicks cannot
// both pass the exists/create check. Multiple workers need a distributed lease.
const admissionQueues = new Map();
async function serializeAdmission(kind, work) {
  const previous = admissionQueues.get(kind) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  admissionQueues.set(kind, current);
  await previous;
  try { return await work(); }
  finally {
    release();
    if (admissionQueues.get(kind) === current) admissionQueues.delete(kind);
  }
}
export function queueBackup(options) {
  return serializeAdmission("backup", () => queueBackupUnlocked(options));
}
export function queueRestoreDrill(backupId, ownerId) {
  return serializeAdmission("restore", () => queueRestoreDrillUnlocked(backupId, ownerId));
}
