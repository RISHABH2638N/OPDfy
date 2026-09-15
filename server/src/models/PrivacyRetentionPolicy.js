import mongoose from "mongoose";
const schema = new mongoose.Schema({
 scope: { type: String, enum: ["platform", "clinic"], required: true },
 tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },
 category: { type: String, required: true, trim: true, maxlength: 100 },
 version: { type: String, required: true, trim: true, maxlength: 80 },
 status: { type: String, enum: ["draft", "approved", "superseded"], default: "draft" },
 legalBasis: { type: String, required: true, maxlength: 2000 },
 retentionRule: { type: String, required: true, maxlength: 2000 },
 trigger: { type: String, required: true, maxlength: 500 },
 backupRule: { type: String, required: true, maxlength: 1000 },
 evidenceReference: { type: String, required: true, maxlength: 240 },
 approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null },
 approvedAt: { type: Date, default: null },
}, { timestamps: true, strict: "throw" });
schema.index({ scope: 1, tenantId: 1, category: 1, version: 1 }, { unique: true, name: "privacy_retention_policy_version_unique" });
export default mongoose.model("PrivacyRetentionPolicy", schema);
