import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateCollectionMatch, verifyBackupArchive } from "../src/utils/privacyBackupIntegrity.js";
import { runMongoTool } from "../src/utils/mongoTools.js";
import mongoose from "mongoose";

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? "" : args[i + 1] || ""; };
const archive = path.resolve(option("--archive") || "");
const targetDb = option("--target-db");
const sourceDb = option("--source-db");
if (process.env.PRIVACY_RESTORE_DRILL_ACK !== "RESTORE_TO_DISPOSABLE_DATABASE") throw new Error("Explicit disposable-restore acknowledgement required.");
if (!/^opd_restore_[a-zA-Z0-9_-]{1,48}$/.test(targetDb) || !/^[a-zA-Z0-9_-]{1,64}$/.test(sourceDb) || targetDb === sourceDb) throw new Error("Use a fresh opd_restore_* target, separate from the source database.");
const uri = process.env.PRIVACY_RESTORE_URI;
if (!uri) throw new Error("PRIVACY_RESTORE_URI is required. Use a separate disposable MongoDB deployment where possible.");
const manifest = await verifyBackupArchive(archive, sourceDb);
let connected = false;
try {
  await mongoose.connect(uri, { dbName: targetDb, autoIndex: false, serverSelectionTimeoutMS: 10000 });
  connected = true;
  const db = mongoose.connection.db;
  if ((await db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error("Target database is not empty. Restore refused; no data was overwritten.");
  await mongoose.disconnect(); connected = false;
  const result = runMongoTool(process.env.MONGORESTORE_BIN || "mongorestore", uri, ["--gzip", "--archive=" + archive, "--nsInclude=" + sourceDb + ".*", "--nsFrom=" + sourceDb + ".*", "--nsTo=" + targetDb + ".*", "--stopOnError"]);
  if (result.error || result.status !== 0) throw new Error("Restore failed. The disposable target may contain partial data; inspect it manually. No automatic cleanup or drop was performed.");
  await mongoose.connect(uri, { dbName: targetDb, autoIndex: false, serverSelectionTimeoutMS: 10000 }); connected = true;
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Replica-set transaction capability not verified.");
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  const counts = {};
  for (const item of collections) {
    if (item.name.startsWith("system.")) continue;
    counts[item.name] = await mongoose.connection.db.collection(item.name).countDocuments({});
    await mongoose.connection.db.collection(item.name).indexes();
  }
  validateCollectionMatch(manifest.collectionCounts, counts);
  const marker = crypto.randomUUID();
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await mongoose.connection.db.collection("privacy_restore_drill_checks").insertOne({ marker }, { session });
    await session.abortTransaction();
  } finally { await session.endSession(); }
  if (await mongoose.connection.db.collection("privacy_restore_drill_checks").findOne({ marker })) throw new Error("Transaction rollback did not remove the drill marker.");
  // No patient-level values are emitted or exported by this report.
  const countMismatch = Object.entries(manifest.collectionCounts || {}).filter(([name,count]) => counts[name] !== count);
  if (countMismatch.length) throw new Error("Restored collection counts differ from the backup manifest. Investigate snapshot consistency before accepting the drill.");
  const report = { format: "opd-restore-drill-v1", sourceDatabase: sourceDb, targetDatabase: targetDb, archiveSha256: manifest.sha256, checkedAt: new Date().toISOString(), collectionCounts: counts, transactionRollbackVerified: true, restoreVerified: true, manualFunctionalVerificationRequired: true };
  const reportPath = archive + ".restore-report.json";
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ report: reportPath, collectionCount: Object.keys(counts).length, transactionRollbackVerified: true, manualFunctionalVerificationRequired: true }));
} finally { if (connected) await mongoose.disconnect(); }
