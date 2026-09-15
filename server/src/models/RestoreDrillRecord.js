import mongoose from "mongoose";

const schema = new mongoose.Schema({
  backup: { type: mongoose.Schema.Types.ObjectId, ref: "BackupRecord", required: true, index: true },
  status: { type: String, enum: ["queued", "running", "succeeded", "failed"], default: "queued", index: true },
  targetDatabase: { type: String, required: true, maxlength: 80 },
  startedAt: { type: Date, default: null }, completedAt: { type: Date, default: null },
  archiveSha256: { type: String, default: "", maxlength: 64 }, collectionCount: { type: Number, default: 0, min: 0 },
  transactionRollbackVerified: { type: Boolean, default: false }, manualFunctionalVerificationRequired: { type: Boolean, default: true },
  failureCode: { type: String, default: "", maxlength: 80 },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", required: true },
}, { timestamps: true, optimisticConcurrency: true, strict: "throw" });
schema.index({ createdAt: -1 });
export default mongoose.model("RestoreDrillRecord", schema);
