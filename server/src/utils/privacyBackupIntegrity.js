import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
export function validateCollectionCounts(counts) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts) || !Object.keys(counts).length ||
      Object.values(counts).some(count => !Number.isSafeInteger(count) || count < 0)) {
    throw Object.assign(new Error("Backup has no valid collection inventory. Check the configured database."), { code: "BACKUP_EMPTY_DATABASE" });
  }
  return counts;
}
export function validateCollectionMatch(expected, actual) {
  validateCollectionCounts(expected);
  validateCollectionCounts(actual);
  if (Object.keys(expected).length !== Object.keys(actual).length ||
      Object.entries(expected).some(([name, count]) => actual[name] !== count)) {
    throw Object.assign(new Error("Backup collection inventory differs. Review write activity and snapshot consistency."), { code: "BACKUP_COUNT_MISMATCH" });
  }
}
export function validateEncryptedManifest(manifest, backup) {
  if (!manifest || manifest.format !== "opd-encrypted-mongodb-backup-v2" ||
      manifest.database !== backup.database || manifest.sha256 !== backup.archiveSha256 ||
      manifest.encryptedSha256 !== backup.encryptedSha256 || manifest.encryptedBytes !== backup.bytes ||
      manifest.encryption?.algorithm !== "AES-256-GCM" || manifest.encryption?.keyId !== backup.encryption?.keyId) {
    throw Object.assign(new Error("Backup manifest does not match the trusted backup record."), { code: "BACKUP_INTEGRITY_FAILED" });
  }
  validateCollectionCounts(manifest.collectionCounts);
  return manifest;
}
export function validateBackupManifest(manifest, archive, sourceDb = null) {
  if (!manifest || manifest.format !== "opd-mongodb-backup-v1" ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(manifest.database) ||
      manifest.filename !== path.basename(archive) ||
      (sourceDb && sourceDb !== manifest.database)) throw new Error("Invalid backup manifest.");
  validateCollectionCounts(manifest.collectionCounts);
  return manifest;
}
export async function verifyBackupArchive(archive, sourceDb = null) {
  const manifest = validateBackupManifest(JSON.parse(fs.readFileSync(archive + ".sha256.json", "utf8")), archive, sourceDb);
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  if (hash.digest("hex") !== manifest.sha256 || fs.statSync(archive).size !== manifest.bytes) throw new Error("Backup checksum or size mismatch. Restore refused.");
  return manifest;
}
