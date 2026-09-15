import fs from "node:fs";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pipeline } from "node:stream/promises";

const safeKey = value => {
  const key = String(value || "");
  if (!/^[a-zA-Z0-9._/-]{1,500}$/.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("Invalid backup object key.");
  return key;
};
export function backupStorageConfig() {
  const provider = String(process.env.BACKUP_STORAGE_PROVIDER || "").trim().toLowerCase();
  if (!['s3','local'].includes(provider)) throw new Error("BACKUP_STORAGE_PROVIDER must be s3 or local.");
  if (provider === "local") {
    if (process.env.NODE_ENV === "production") throw new Error("Local backup storage is prohibited in production.");
    const directory = path.resolve(process.env.BACKUP_STORAGE_DIR || "");
    if (!process.env.BACKUP_STORAGE_DIR || directory === path.parse(directory).root) throw new Error("Set a dedicated BACKUP_STORAGE_DIR.");
    return { provider, directory };
  }
  const bucket = String(process.env.BACKUP_S3_BUCKET || "").trim();
  const region = String(process.env.BACKUP_S3_REGION || "").trim();
  if (!bucket || !region || !process.env.BACKUP_S3_ACCESS_KEY_ID || !process.env.BACKUP_S3_SECRET_ACCESS_KEY) throw new Error("S3 backup storage configuration is incomplete.");
  return { provider, bucket, region, endpoint: process.env.BACKUP_S3_ENDPOINT || undefined };
}
function client(config) {
  return new S3Client({ region: config.region, endpoint: config.endpoint, forcePathStyle: String(process.env.BACKUP_S3_FORCE_PATH_STYLE || "false") === "true", credentials: { accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY } });
}
export async function uploadBackupObject(keyValue, source, contentType) {
  const config = backupStorageConfig(), key = safeKey(keyValue);
  if (config.provider === "local") { const target = path.join(config.directory, key); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); await pipeline(fs.createReadStream(source), fs.createWriteStream(target, { mode: 0o600, flags: "wx" })); return; }
  await client(config).send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: fs.createReadStream(source), ContentType: contentType, ServerSideEncryption: String(process.env.BACKUP_S3_SERVER_SIDE_ENCRYPTION || "AES256") }));
}
export async function downloadBackupObject(keyValue, target) {
  const config = backupStorageConfig(), key = safeKey(keyValue);
  if (config.provider === "local") { await pipeline(fs.createReadStream(path.join(config.directory, key)), fs.createWriteStream(target, { mode: 0o600, flags: "wx" })); return; }
  const result = await client(config).send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  await pipeline(result.Body, fs.createWriteStream(target, { mode: 0o600, flags: "wx" }));
}
export async function deleteBackupObject(keyValue) {
  const config = backupStorageConfig(), key = safeKey(keyValue);
  if (config.provider === "local") { await fs.promises.unlink(path.join(config.directory, key)).catch(error => { if (error.code !== "ENOENT") throw error; }); return; }
  await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}
