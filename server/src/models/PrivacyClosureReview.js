import mongoose from "mongoose";
const schema = new mongoose.Schema({
  request: { type: mongoose.Schema.Types.ObjectId, ref: "PrivacyRequest", required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalPatient", required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  decision: { type: String, enum: ["retain_clinical_records"], required: true },
  legalBasis: { type: String, required: true, trim: true, maxlength: 1200 },
  evidenceReference: { type: String, required: true, trim: true, maxlength: 240 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reviewedAt: { type: Date, default: Date.now },
}, { strict: "throw", timestamps: true });
schema.index({ request: 1, tenantId: 1 }, { unique: true, name: "privacy_closure_clinic_review_unique" });
export default mongoose.model("PrivacyClosureReview", schema);
