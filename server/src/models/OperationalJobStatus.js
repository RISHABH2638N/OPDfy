import mongoose from "mongoose";
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, enum: ["appointment_reminders", "followup_reminders", "subscription_expiry", "missed_appointments"] },
  lastStartedAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  lastFailureAt: { type: Date, default: null },
  lastOutcome: { type: String, enum: ["success", "failure"], default: "success" },
  failureCode: { type: String, default: "", maxlength: 60 },
  durationMs: { type: Number, default: null, min: 0 },
}, { timestamps: true, strict: "throw" });
export default mongoose.model("OperationalJobStatus", schema);
