import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import Token from "../models/Token.js";
import { normalizeDepartment } from "../utils/departments.js";
import { CONDITION_CATALOG, conditionProfile, submitConditions, reviewCondition, conditionInsights } from "../services/healthConditions.js";

function response(patient) { return { catalog: CONDITION_CATALOG, profile: conditionProfile(patient) }; }
async function currentPatient(req) {
  const patient = await Patient.findOne({ _id: req.patient._id, tenantId: req.tenantId });
  if (!patient) throw Object.assign(new Error("Patient profile not found."), { status: 404 });
  return patient;
}
async function clinicalPatient(req) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw Object.assign(new Error("Invalid token ID."), { status: 400 });
  const token = await Token.findOne({ _id: req.params.id, tenantId: req.tenantId,
    assignedDoctor: req.user.id, department: normalizeDepartment(req.user.department), status: "called", isArchived: { $ne: true } });
  if (!token) throw Object.assign(new Error("Condition review requires your actively called patient."), { status: 403 });
  const patient = token.patient && await Patient.findOne({ _id: token.patient, tenantId: req.tenantId });
  if (!patient) throw Object.assign(new Error("Patient profile not found."), { status: 404 });
  return { token, patient };
}
export async function getPatientConditions(req, res) { res.set("Cache-Control", "no-store").json(response(await currentPatient(req))); }
export async function savePatientConditions(req, res) {
  const updated = await submitConditions(await currentPatient(req), req.body);
  res.set("Cache-Control", "no-store").json(response(updated));
}
export async function getDoctorConditions(req, res) {
  const { patient } = await clinicalPatient(req);
  res.set("Cache-Control", "no-store").json(response(patient));
}
export async function saveDoctorReview(req, res) {
  const { patient, token } = await clinicalPatient(req);
  const updated = await reviewCondition(patient, token, req.user.id, req.body);
  res.set("Cache-Control", "no-store").json(response(updated));
}
export async function getConditionInsights(req, res) {
  res.set("Cache-Control", "no-store").json(await conditionInsights(req.tenantId, req.query));
}
