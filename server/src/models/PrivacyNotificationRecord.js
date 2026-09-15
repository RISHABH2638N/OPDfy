import mongoose from "mongoose";
const historySchema = new mongoose.Schema({
  fromStatus: { type: String, required: true },
  toStatus: { type: String, required: true },
  dueAt: { type: Date, default: null }, deliveredAt: { type: Date, default: null },
  evidenceReference: { type: String, required: true, maxlength: 240 },
  legalBasis: { type: String, required: true, maxlength: 2000 },
  note: { type: String, required: true, maxlength: 2000 },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", required: true },
  at: { type: Date, default: Date.now },
}, { strict: "throw" });
const schema = new mongoose.Schema({
  incident: { type: mongoose.Schema.Types.ObjectId, ref: "PrivacyIncident", required: true, index: true },
  audience: { type: String, enum: ["board", "affected_individuals", "other_authority"], required: true },
  status: { type: String, enum: ["pending", "required", "not_required", "delivered", "failed"], default: "pending" },
  dueAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  evidenceReference: { type: String, default: "", maxlength: 240 },
  legalBasis: { type: String, default: "", maxlength: 2000 },
  note: { type: String, default: "", maxlength: 2000 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", required: true },
  reviewedAt: { type: Date, default: Date.now },
  events: { type: [historySchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true, strict: "throw" });
schema.index({ incident: 1, audience: 1 }, { unique: true, name: "privacy_incident_audience_unique" });
schema.index({ status: 1, dueAt: 1 });
export default mongoose.model("PrivacyNotificationRecord", schema);
