import mongoose from "mongoose";
const schema = new mongoose.Schema({
 patient: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalPatient", required: true, index: true },
 guardianEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 200 },
 guardianName: { type: String, required: true, trim: true, maxlength: 120 },
 relationship: { type: String, enum: ["parent", "legal_guardian", "other"], required: true },
 status: { type: String, enum: ["pending_email", "awaiting_clinic_review", "verified", "rejected", "revoked"], default: "pending_email", index: true },
 emailVerifiedAt: { type: Date, default: null },
 verification: { hash: { type: String, select: false }, nonce: { type: String, select: false }, expiresAt: Date, attempts: { type: Number, default: 0 } },
 tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },
 evidenceReference: { type: String, default: "", maxlength: 240 },
 reviewNote: { type: String, default: "", maxlength: 1200 },
 reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
 reviewedAt: { type: Date, default: null },
}, { timestamps: true, optimisticConcurrency: true, strict: "throw" });
schema.index({ patient: 1, guardianEmail: 1 }, { unique: true, name: "privacy_guardian_identity_unique" });
export default mongoose.model("PrivacyGuardianCase", schema);
