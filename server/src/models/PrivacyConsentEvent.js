import mongoose from "mongoose";
const schema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalPatient", required: true, index: true },
  purpose: { type: String, required: true, enum: ["external_ai"] },
  version: { type: Number, required: true, min: 1 },
  decision: { type: String, required: true, enum: ["granted", "withdrawn"] },
  noticeVersion: { type: String, required: true, maxlength: 80 },
  language: { type: String, enum: ["en", "hi"], required: true },
  actor: { type: String, enum: ["patient", "system"], required: true },
  source: { type: String, required: true, maxlength: 80 },
  recordedAt: { type: Date, default: Date.now, required: true },
}, { strict: "throw", versionKey: false });
schema.index({ patient: 1, purpose: 1, version: 1 }, { unique: true, name: "privacy_consent_event_version_unique" });
schema.index({ patient: 1, purpose: 1, recordedAt: -1 });
export default mongoose.model("PrivacyConsentEvent", schema);
