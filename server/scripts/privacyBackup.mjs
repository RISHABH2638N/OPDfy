import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { runMongoTool } from "../src/utils/mongoTools.js";
import { validateCollectionCounts, validateCollectionMatch } from "../src/utils/privacyBackupIntegrity.js";

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? "" : args[i + 1] || ""; };
const db = option("--db");
const destination = option("--output");
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(db) || !destination || !process.env.MONGO_URI) throw new Error("Provide --db, --output and MONGO_URI. Never place credentials in command arguments.");
const output = path.resolve(destination);
if (!output.endsWith(".archive.gz")) throw new Error("Output must end with .archive.gz.");
if (fs.existsSync(output) || fs.existsSync(output + ".sha256.json")) throw new Error("Refusing to overwrite an existing backup or manifest.");
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
const command = process.env.MONGODUMP_BIN || "mongodump";
let collectionCounts = {};
let digest;
async function inventory() {
  const counts = {};
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  for (const item of collections) if (!item.name.startsWith("system.")) {
    counts[item.name] = await mongoose.connection.db.collection(item.name).countDocuments({});
  }
  return validateCollectionCounts(counts);
}
try {
  await mongoose.connect(process.env.MONGO_URI, { dbName: db, autoIndex: false, serverSelectionTimeoutMS: 10000 });
  collectionCounts = await inventory();
  const result = runMongoTool(command, process.env.MONGO_URI, ["--db", db, "--gzip", "--archive=" + output]);
  if (result.error || result.status !== 0) throw new Error("Backup failed. Verify MongoDB Database Tools, connectivity and read permissions.");
  fs.chmodSync(output, 0o600);
  validateCollectionMatch(collectionCounts, await inventory());
  const sha256 = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(output)) sha256.update(chunk);
  digest = sha256.digest("hex");
} catch (error) {
  if (fs.existsSync(output)) fs.unlinkSync(output);
  throw error;
} finally { await mongoose.disconnect(); }
const manifest = { format: "opd-mongodb-backup-v1", database: db, filename: path.basename(output), bytes: fs.statSync(output).size, sha256: digest, createdAt: new Date().toISOString(), encryption: "external-protected-storage-required", restoreVerified: false, snapshotConsistency: "not-guaranteed-by-document-counts", maintenanceWindowDeclared: args.includes("--maintenance-confirmed"), collectionCounts };
fs.writeFileSync(output + ".sha256.json", JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ manifest: output + ".sha256.json", bytes: manifest.bytes, sha256: manifest.sha256, restoreVerified: false }));
