import mongoose from "mongoose";
import { auditRetentionDays } from "../utils/privacySafeLog.js";

const securityEventSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },
  actorType: { type: String, enum: ["anonymous", "staff", "patient", "superadmin", "system"], default: "anonymous", index: true },
  actorId: { type: String, default: "", maxlength: 80 },
  event: { type: String, required: true, trim: true, maxlength: 100, index: true },
  outcome: { type: String, enum: ["success", "failure", "blocked"], required: true, index: true },
  ip: { type: String, default: "", maxlength: 80 },
  route: { type: String, default: "", maxlength: 180 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

securityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: auditRetentionDays(process.env.SECURITY_LOG_RETENTION_DAYS) * 24 * 60 * 60, name: "security_event_ttl" });
export default mongoose.model("SecurityEvent", securityEventSchema);
