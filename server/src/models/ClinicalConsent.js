import mongoose from "mongoose";
import tenantScopedPlugin from "./tenantScopedPlugin.js";

const eventSchema = new mongoose.Schema({
  action: { type: String, required: true, enum: ["requested", "acknowledged", "declined", "guardian_reviewed", "withdrawn", "cancelled"] },
  actorType: { type: String, required: true, enum: ["patient", "guardian", "staff"] },
  actorId: { type: String, required: true, trim: true, maxlength: 80 },
  actorRole: { type: String, default: "", trim: true, maxlength: 40 },
  note: { type: String, default: "", trim: true, maxlength: 1000 },
  at: { type: Date, required: true, default: Date.now },
}, { _id: false });

const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  category: { type: String, required: true, enum: ["general_treatment", "procedure", "record_sharing", "teleconsultation", "other"], index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  explanation: { type: String, required: true, trim: true, maxlength: 2000 },
  expectedBenefits: { type: String, default: "", trim: true, maxlength: 1600 },
  materialRisks: { type: String, default: "", trim: true, maxlength: 2000 },
  alternatives: { type: String, default: "", trim: true, maxlength: 1600 },
  refusalConsequences: { type: String, default: "", trim: true, maxlength: 1600 },
  language: { type: String, required: true, enum: ["en", "hi"] },
  noticeVersion: { type: String, required: true, default: "clinical-consent-v1", maxlength: 60 },
  status: { type: String, required: true, enum: ["pending", "patient_acknowledged", "active", "declined", "withdrawn", "cancelled"], default: "pending", index: true },
  validUntil: { type: Date, required: true, index: true },
  patientDecision: {
    decision: { type: String, enum: ["", "acknowledged", "declined"], default: "" },
    actorType: { type: String, enum: ["", "self", "guardian"], default: "" },
    typedName: { type: String, default: "", trim: true, maxlength: 120 },
    guardianRelationship: { type: String, default: "", trim: true, maxlength: 80 },
    authorityDeclared: { type: Boolean, default: false },
    language: { type: String, enum: ["", "en", "hi"], default: "" },
    declarationVersion: { type: String, default: "", maxlength: 60 },
    recordedAt: { type: Date, default: null },
  },
  staffReview: {
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    guardianAuthorityChecked: { type: Boolean, default: false },
    questionsAnswered: { type: Boolean, default: false },
    note: { type: String, default: "", trim: true, maxlength: 1000 },
  },
  events: { type: [eventSchema], default: [] },
}, { timestamps: true, strict: "throw", optimisticConcurrency: true });

schema.index({ tenantId: 1, patient: 1, createdAt: -1 }, { name: "tenant_patient_consent_history" });
schema.index({ tenantId: 1, status: 1, validUntil: 1 }, { name: "tenant_consent_worklist" });
schema.plugin(tenantScopedPlugin);

export default mongoose.model("ClinicalConsent", schema);
