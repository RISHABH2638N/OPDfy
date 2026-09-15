import mongoose from "mongoose";
const eventSchema = new mongoose.Schema({
  status: { type: String, enum: ["pending", "passed", "failed", "waived"], required: true },
  note: { type: String, required: true, maxlength: 2000 },
  evidenceReference: { type: String, required: true, maxlength: 240 },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", required: true },
  at: { type: Date, default: Date.now },
}, { _id: true, strict: "throw" });
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, enum: ["backup_restore", "database_integrity", "access_review", "dependency_review", "incident_drill", "clinical_regression", "privacy_rights", "legal_signoff", "vendor_review", "monitoring"] },
  status: { type: String, enum: ["pending", "passed", "failed", "waived"], default: "pending" },
  reviewedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  events: { type: [eventSchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true, strict: "throw" });
export default mongoose.model("PrivacyOperationalCheck", schema);
