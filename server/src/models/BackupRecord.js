import mongoose from "mongoose";

const schema = new mongoose.Schema({
  trigger: { type: String, enum: ["manual", "scheduled"], required: true, index: true },
  scheduleSlot: { type: String, default: undefined, maxlength: 20 },
  status: { type: String, enum: ["queued", "running", "succeeded", "failed", "expired", "deleted"], default: "queued", index: true },
  database: { type: String, required: true, maxlength: 64 },
  provider: { type: String, enum: ["s3", "local"], required: true },
  objectKey: { type: String, default: "", maxlength: 500, select: false },
  manifestObjectKey: { type: String, default: "", maxlength: 500, select: false },
  retentionClass: { type: String, enum: ["daily", "weekly", "monthly"], required: true },
  expiresAt: { type: Date, required: true, index: true },
  startedAt: { type: Date, default: null }, completedAt: { type: Date, default: null }, deletedAt: { type: Date, default: null },
  bytes: { type: Number, default: 0, min: 0 }, archiveSha256: { type: String, default: "", maxlength: 64 }, encryptedSha256: { type: String, default: "", maxlength: 64 },
  encryption: { algorithm: { type: String, default: "AES-256-GCM" }, keyId: { type: String, default: "", maxlength: 32 } },
  collectionCount: { type: Number, default: 0, min: 0 },
  failureCode: { type: String, default: "", maxlength: 80 },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null },
}, { timestamps: true, optimisticConcurrency: true, strict: "throw" });
schema.index({ scheduleSlot: 1 }, { unique: true, sparse: true, name: "backup_schedule_slot_unique" });
schema.index({ status: 1, completedAt: -1 });
export default mongoose.model("BackupRecord", schema);
