import mongoose from "mongoose";
import tenantScopedPlugin from "./tenantScopedPlugin.js";

const activityLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorName: { type: String, required: true, trim: true, maxlength: 120 },
    actorRole: { type: String, required: true, enum: ["admin", "doctor", "receptionist"], index: true },
    action: { type: String, required: true, trim: true, maxlength: 100, index: true },
    module: { type: String, required: true, trim: true, maxlength: 60, index: true },
    summary: { type: String, required: true, trim: true, maxlength: 240 },
    method: { type: String, required: true, trim: true, maxlength: 10 },
    route: { type: String, required: true, trim: true, maxlength: 220 },
    statusCode: { type: Number, required: true },
    targetId: { type: String, default: "", trim: true, maxlength: 80 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

activityLogSchema.index({ tenantId: 1, createdAt: -1 });
activityLogSchema.index({ tenantId: 1, module: 1, createdAt: -1 });
activityLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "activity_log_ttl" });
activityLogSchema.plugin(tenantScopedPlugin);

export default mongoose.model("ActivityLog", activityLogSchema);
