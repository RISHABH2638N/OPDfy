import mongoose from "mongoose";

const schema = new mongoose.Schema({
  incident: { type: mongoose.Schema.Types.ObjectId, ref: "PrivacyIncident", required: true, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", required: true },
  evidenceReference: { type: String, required: true, maxlength: 240 },
}, { timestamps: true, strict: "throw" });
schema.index({ incident: 1, tenantId: 1, patientId: 1 }, { unique: true, name: "incident_affected_patient_unique" });
export default mongoose.model("IncidentAffectedPatient", schema);
