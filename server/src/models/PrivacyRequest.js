import mongoose from "mongoose";

const schema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalPatient", required: true, index: true },
  type: { type: String, required: true, enum: ["access", "correction", "erasure", "withdrawal", "grievance", "identity_review", "nomination"] },
  status: { type: String, enum: ["pending", "in_review", "fulfilled", "rejected"], default: "pending", index: true },
  clinicSlug: { type: String, default: "", maxlength: 80 },
  details: { type: String, default: "", maxlength: 2000 },
  verifiedAt: { type: Date, required: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null },
  resolution: { type: String, default: "", maxlength: 2000 },
  clinicReview: {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    decision: { type: String, enum: ["", "verified", "rejected"], default: "" },
    evidenceReference: { type: String, default: "", maxlength: 240 },
    reviewNote: { type: String, default: "", maxlength: 1200 },
  },
  correction: {
    scope: { type: String, enum: ["global_profile", "clinic_record"], default: undefined },
    field: { type: String, maxlength: 100 },
    recordId: { type: String, maxlength: 80 },
    clinicSlug: { type: String, maxlength: 80 },
    proposedValue: { type: String, maxlength: 1000, select: false },
    reason: { type: String, maxlength: 1000 },
  },
  execution: {
    kind: { type: String, enum: ["", "global_account_closure", "data_export", "correction_review"], default: "" },
    completedAt: { type: Date, default: null },
    policyVersion: { type: String, default: "", maxlength: 80 },
    retainedClinicCount: { type: Number, default: 0 },
  },
  // No clinical data or raw OTP is stored in this intake record.
}, { timestamps: true, strict: "throw" });
schema.index({ patient: 1, createdAt: -1 });
schema.index({ type: 1, clinicSlug: 1, status: 1, createdAt: -1 }, { name: "clinic_identity_review_worklist" });
schema.index({ patient: 1, type: 1 }, {
  unique: true, name: "one_open_privacy_request_per_type",
  partialFilterExpression: { status: { $in: ["pending", "in_review"] } },
});
export default mongoose.model("PrivacyRequest", schema);
