import mongoose from "mongoose";
const schema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalPatient", required: true, index: true },
  request: { type: mongoose.Schema.Types.ObjectId, ref: "PrivacyRequest", default: null },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, { strict: "throw", versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model("PrivacyExportGrant", schema);
