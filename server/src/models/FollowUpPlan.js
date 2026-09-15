import mongoose from "mongoose";
import tenantScopedPlugin from "./tenantScopedPlugin.js";

const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  consultation: { type: mongoose.Schema.Types.ObjectId, ref: "Consultation", required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  department: { type: String, required: true },
  doctorName: { type: String, default: "", trim: true },
  dueDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  // The original recommended date is retained even if the patient books another day.
  status: { type: String, enum: ["pending", "scheduled", "completed", "cancelled"], default: "pending", index: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
  completedConsultation: { type: mongoose.Schema.Types.ObjectId, ref: "Consultation", default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ tenantId: 1, consultation: 1 }, { unique: true, name: "tenant_followup_source_unique" });
schema.index({ tenantId: 1, status: 1, dueDate: 1 });
schema.index({ tenantId: 1, patient: 1, doctor: 1, dueDate: -1 });
schema.plugin(tenantScopedPlugin);
export default mongoose.model("FollowUpPlan", schema);
