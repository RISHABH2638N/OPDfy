import mongoose from "mongoose";

const globalPatientOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    otpHash: { type: String, required: true, trim: true, select: false },
    purpose: { type: String, enum: ["register", "reset"], required: true },
    nonce: { type: String, required: true, select: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalPatient", default: null },
    tokenVersionAtIssue: { type: Number, default: 0, min: 0 },
    sentAt: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
    grantHash: { type: String, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

globalPatientOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
globalPatientOtpSchema.index({ grantHash: 1 }, { unique: true, partialFilterExpression: { grantHash: { $type: "string" } } });

export default mongoose.model("GlobalPatientOtp", globalPatientOtpSchema);
