import mongoose from "mongoose";

const channelSchema = new mongoose.Schema({
  status: { type: String, enum: ["pending", "sent", "delivered", "failed", "skipped"], default: "pending" },
  attemptedAt: { type: Date, default: null }, deliveredAt: { type: Date, default: null },
  providerReference: { type: String, default: "", maxlength: 240 }, failureCode: { type: String, default: "", maxlength: 80 },
}, { _id: false, strict: "throw" });
const schema = new mongoose.Schema({
  incident: { type: mongoose.Schema.Types.ObjectId, ref: "PrivacyIncident", required: true, index: true },
  affectedPatient: { type: mongoose.Schema.Types.ObjectId, ref: "IncidentAffectedPatient", required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  language: { type: String, enum: ["en", "hi"], default: "en" },
  inApp: { type: channelSchema, default: () => ({}) }, email: { type: channelSchema, default: () => ({}) },
  attempts: { type: Number, default: 0, min: 0 }, lastAttemptAt: { type: Date, default: null },
}, { timestamps: true, optimisticConcurrency: true, strict: "throw" });
schema.index({ incident: 1, affectedPatient: 1 }, { unique: true, name: "incident_patient_delivery_unique" });
schema.index({ incident: 1, "email.status": 1 });
export default mongoose.model("IncidentNotificationDelivery", schema);
