import mongoose from "mongoose";
const schema = new mongoose.Schema({
 request: { type: mongoose.Schema.Types.ObjectId, ref: "PrivacyRequest", required: true, unique: true },
 patient: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalPatient", required: true },
 tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },
 decision: { type: String, enum: ["corrected", "no_change", "rejected"], required: true },
 evidenceReference: { type: String, required: true, trim: true, maxlength: 240 },
 resolution: { type: String, required: true, trim: true, maxlength: 2000 },
 reviewedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
 reviewedByRole: { type: String, enum: ["admin", "superadmin"], required: true },
 reviewedAt: { type: Date, default: Date.now },
}, { timestamps: true, strict: "throw" });
export default mongoose.model("PrivacyCorrectionReview", schema);
