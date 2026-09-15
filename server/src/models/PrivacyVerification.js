import mongoose from "mongoose";

const schema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalPatient", required: true },
  purpose: { type: String, required: true, enum: ["privacy-request"] },
  requestType: { type: String, required: true },
  otpHash: { type: String, required: true, select: false },
  nonce: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
schema.index({ patient: 1, purpose: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model("PrivacyVerification", schema);
