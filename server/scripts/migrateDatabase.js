import "../src/models/OperationalJobStatus.js";
import "../src/models/PrivacyIncident.js";
import "../src/models/PrivacyOperationalCheck.js";
import "../src/models/PrivacyNotificationRecord.js";
import "../src/models/IncidentAffectedPatient.js";
import "../src/models/IncidentNotificationDelivery.js";
import "../src/models/IncidentEvidenceSnapshot.js";
import "../src/models/BackupRecord.js";
import "../src/models/RestoreDrillRecord.js";
import "../src/models/PrivacyRetentionPolicy.js";
import "../src/models/PrivacyCorrectionReview.js";
import "../src/models/PrivacyGuardianCase.js";
import "dotenv/config";
import mongoose from "mongoose";
import { assertPrivacyRetentionIndexes } from "../src/services/privacyRetentionSafety.js";
import bcrypt from "bcryptjs";
import "../src/app.js";
import "../src/models/DepartmentReferral.js";
import "../src/models/FollowUpPlan.js";
import "../src/models/PrivacyRequest.js";
import "../src/models/PrivacyVerification.js";
import "../src/models/PrivacyClosureReview.js";
import "../src/models/PrivacyExportGrant.js";
import "../src/models/PrivacyConsentEvent.js";
import "../src/models/ClinicalConsent.js";

const apply = process.argv.includes("--apply");
if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI before running the database check.");

try {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  await assertPrivacyRetentionIndexes(db);
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("A MongoDB replica set is required for clinic onboarding and atomic visit updates.");
  const checks = [
    ["tokens", "multiple active tokens for a patient", { isArchived: false, status: { $in: ["waiting", "called"] }, patient: { $type: "objectId" } }, { tenant: "$tenantId", patient: "$patient" }],
    ["tokens", "multiple called tokens for a doctor", { isArchived: false, status: "called", assignedDoctor: { $type: "objectId" } }, { tenant: "$tenantId", doctor: "$assignedDoctor" }],
    ["appointments", "multiple active appointments per patient/day", { status: { $in: ["booked", "checked_in"] } }, { tenant: "$tenantId", patient: "$patient", date: "$appointmentDate" }],
  ];
  let blockers = 0;
  for (const [collection, label, match, group] of checks) {
    const [result] = await db.collection(collection).aggregate([{ $match: match }, { $group: { _id: group, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "groups" }]).toArray();
    const count = result?.groups || 0;
    blockers += count;
    console.log(`${label}: ${count} conflicting group(s)`);
  }
  // Detect legacy demo passwords without logging credentials or account IDs.
  const legacy = await db.collection("users").find({ email: { $in: ["admin@opd.com", "doctor@opd.com"] } }).project({ passwordHash: 1 }).toArray();
  for (const account of legacy) {
    if (await bcrypt.compare("Admin@123", account.passwordHash || "") || await bcrypt.compare("Doctor@123", account.passwordHash || "")) blockers++;
  }
  if (blockers) throw new Error("Database has release blockers. Review duplicate visits and replace any legacy demo credentials. No records were changed.");

  for (const model of Object.values(mongoose.models)) {
    const diff = await model.diffIndexes();
    console.log(`${model.modelName}: ${diff.toCreate.length} index definition(s) to create; ${diff.toDrop.length} existing definition(s) differ.`);
  }
  if (!apply) {
    console.log("Check only: no changes made. After a backup and stopping the old server, run npm run db:migrate to apply.");
  } else {
    // OTPs are ephemeral and the release changes their hash format. Invalidating
    // pending codes is intentional; patient accounts and medical records remain.
    await db.collection("globalpatientotps").deleteMany({});
    const indexes = await db.collection("globalpatientotps").indexes().catch((error) => { if (error.code === 26) return []; throw error; });
    for (const index of indexes) if (index.key?.email === 1 && !index.unique) await db.collection("globalpatientotps").dropIndex(index.name);
    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    console.log("Migration complete. Pending OTPs invalidated; required indexes created. Clinical records were not removed.");
  }
} catch (error) {
  console.error(error?.name === "MongoServerError" ? "Database check failed; review database index and access configuration." : error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
