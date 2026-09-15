import mongoose from "mongoose";
import tenantScopedPlugin from "./tenantScopedPlugin.js";

const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  sourceToken: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true },
  sourceConsultation: { type: mongoose.Schema.Types.ObjectId, ref: "Consultation", default: null },
  fromDoctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fromDepartment: { type: String, required: true },
  toDoctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  toDepartment: { type: String, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 2000 },
  priority: { type: String, enum: ["routine", "urgent"], default: "routine" },
  status: { type: String, enum: ["pending", "accepted", "cancelled", "completed"], default: "pending", index: true },
  targetToken: { type: mongoose.Schema.Types.ObjectId, ref: "Token", default: null },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  acceptedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ tenantId: 1, sourceToken: 1, toDoctor: 1 }, {
  unique: true,
  name: "referral_source_destination_unique",
});
schema.index({ tenantId: 1, targetToken: 1 }, {
  unique: true,
  partialFilterExpression: { targetToken: { $type: "objectId" } },
});
schema.index({ tenantId: 1, status: 1, createdAt: -1 });
schema.plugin(tenantScopedPlugin);
export default mongoose.model("DepartmentReferral", schema);
