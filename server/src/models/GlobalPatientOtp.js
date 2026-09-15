import mongoose from "mongoose";

const globalPatientOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    otpHash: { type: String, required: true, trim: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

globalPatientOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("GlobalPatientOtp", globalPatientOtpSchema);
