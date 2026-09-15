import mongoose from "mongoose";
import Consultation from "../models/Consultation.js";
import FollowUpPlan from "../models/FollowUpPlan.js";
import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import { currentTenantId } from "./tenantExecutionContext.js";
import { hospitalLocalDateTime } from "../utils/clinicOperations.js";

const id = (value) => String(value?._id || value || "");
const ACTIVE = ["booked", "checked_in"];
const COMPLETED = ["completed"];
export const FOLLOW_UP_STAGES = Object.freeze([-3, -2, -1, 0, 1, 2, 3]);
export function followUpDateKey(date, tenant) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error("Invalid follow-up date.");
  // Existing prescription forms submit YYYY-MM-DD, stored as UTC midnight.
  // Preserve that calendar date rather than shifting it for western timezones.
  if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0) {
    return value.toISOString().slice(0, 10);
  }
  return hospitalLocalDateTime(tenant, value).date;
}

export function calendarDayDifference(fromDate, toDate) {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!valid.test(fromDate) || !valid.test(toDate)) throw new Error("Invalid calendar date.");
  return Math.round((Date.parse(`${toDate}T12:00:00Z`) - Date.parse(`${fromDate}T12:00:00Z`)) / 86400000);
}

export function calendarDatePlus(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid calendar date.");
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function activeFilter(plan) {
  return { patient: plan.patient, doctor: plan.doctor, followUpConsultation: plan.consultation,
    status: { $in: ACTIVE } };
}

export async function ensureFollowUpPlan(consultation, tenant) {
  if (!consultation?.followUpDate || !consultation?.patient || !consultation?.doctor) return null;
  const dueDate = followUpDateKey(consultation.followUpDate, tenant);
  const doctor = await User.findById(consultation.doctor).select("name").lean();
  return FollowUpPlan.findOneAndUpdate(
    { consultation: consultation._id },
    { $setOnInsert: {
      tenantId: currentTenantId(), consultation: consultation._id,
      patient: consultation.patient, doctor: consultation.doctor,
      department: consultation.department, doctorName: doctor?.name || "",
      dueDate, status: "pending",
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// Existing plans are never reset by a repeated migration or scheduler run.
// A later visit is not automatically treated as completion merely because it
// concerns the same patient: it must be an explicitly linked follow-up.
export async function reconcileFollowUpPlan(plan) {
  if (!plan || ["completed", "cancelled"].includes(plan.status)) return plan;
  const linked = await Appointment.find({
    patient: plan.patient, doctor: plan.doctor, followUpConsultation: plan.consultation,
    status: { $in: [...ACTIVE, ...COMPLETED] },
  }).select("_id appointmentDate startTime status token createdAt")
    .sort({ createdAt: 1 }).lean();
  for (const candidate of linked) {
    if (candidate.status !== "completed") continue;
    const completed = candidate.token && await Consultation.findOne({
      token: candidate.token, patient: plan.patient, doctor: plan.doctor, status: "completed",
    }).select("_id createdAt").lean();
    if (!completed) continue;
    return FollowUpPlan.findOneAndUpdate(
      { _id: plan._id, status: { $in: ["pending", "scheduled"] } },
      { $set: { status: "completed", appointment: candidate._id,
        completedConsultation: completed._id, completedAt: completed.createdAt || candidate.createdAt } }, { new: true }
    );
  }
  let chosen = linked.find((item) => ACTIVE.includes(item.status)) || null;
  if (!chosen) {
    const source = await Consultation.findById(plan.consultation).select("createdAt").lean();
    if (source) {
      const legacy = await Appointment.find({
        patient: plan.patient, doctor: plan.doctor, followUpConsultation: null,
        "billing.feeType": { $in: ["follow_up", "free_follow_up"] },
        createdAt: { $gt: source.createdAt },
        status: { $in: [...ACTIVE, ...COMPLETED] },
      }).select("_id appointmentDate startTime status token createdAt").sort({ createdAt: 1 }).limit(30).lean();
      for (const candidate of legacy) {
        const latest = await Consultation.findOne({
          patient: plan.patient, doctor: plan.doctor, status: "completed",
          followUpDate: { $ne: null }, createdAt: { $lt: candidate.createdAt },
        }).select("_id").sort({ createdAt: -1 }).lean();
        if (id(latest) !== id(plan.consultation)) continue;
        if (candidate.status === "completed") {
          const completed = candidate.token && await Consultation.findOne({ token: candidate.token, patient: plan.patient,
            doctor: plan.doctor, status: "completed" }).select("_id createdAt").lean();
          if (!completed) continue;
          return FollowUpPlan.findOneAndUpdate(
            { _id: plan._id, status: { $in: ["pending", "scheduled"] } },
            { $set: { status: "completed", appointment: candidate._id,
              completedConsultation: completed._id, completedAt: completed.createdAt || candidate.createdAt } }, { new: true }
          );
        }
        chosen = candidate;
        break;
      }
    }
  }
  const status = chosen ? "scheduled" : "pending";
  if (status === plan.status && id(chosen) === id(plan.appointment)) return plan;
  return FollowUpPlan.findOneAndUpdate(
    { _id: plan._id, status: { $in: ["pending", "scheduled"] } },
    { $set: { status, appointment: chosen?._id || null } }, { new: true }
  );
}

export async function findFollowUpSource({ patientId, doctorId, consultationId = "", tenant, serviceDate = "", before = null }) {
  if (consultationId && !mongoose.isValidObjectId(consultationId)) {
    throw Object.assign(new Error("Invalid follow-up reference."), { status: 400 });
  }
  // Explicit IDs are always checked against the authenticated patient, clinic and doctor.
  const query = { patient: patientId, doctor: doctorId, status: "completed", followUpDate: { $ne: null } };
  if (consultationId) query._id = consultationId;
  if (before) query.createdAt = { $lt: before };
  const sources = await Consultation.find(query).select("_id patient doctor department followUpDate createdAt")
    .sort({ createdAt: -1 }).limit(1).lean();
  for (const source of sources) {
    const plan = await ensureFollowUpPlan(source, tenant);
    const current = await reconcileFollowUpPlan(plan);
    if (current && !["completed", "cancelled"].includes(current.status)) {
      return current;
    }
  }
  if (consultationId) throw Object.assign(new Error("This follow-up is no longer available for the selected patient and doctor."), { status: 409 });
  return null;
}

export async function validateFollowUpBooking({ patientId, doctorId, consultationId, tenant, serviceDate }) {
  const plan = await findFollowUpSource({ patientId, doctorId, consultationId, tenant, serviceDate });
  if (!plan) {
    if (!consultationId) return null; // Preserve existing fee-eligible legacy bookings.
    throw Object.assign(new Error("Select a valid pending follow-up with this doctor."), { status: 409 });
  }
  // A plan cannot be linked to two simultaneous active appointments.
  const existing = await Appointment.findOne(activeFilter(plan)).select("_id").lean();
  if (existing) throw Object.assign(new Error("This follow-up already has an active appointment."), { status: 409 });
  return plan;
}

export async function completeLinkedFollowUp(consultation, token, { sourceId = "", tenant = null } = {}) {
  let linkedSource = token?.followUpConsultation || null;
  if (token?.appointment) {
    const appointment = await Appointment.findById(token.appointment)
      .select("followUpConsultation patient doctor").lean();
    if (appointment?.followUpConsultation &&
        id(appointment.patient) === id(consultation.patient) &&
        id(appointment.doctor) === id(consultation.doctor)) {
      linkedSource = appointment.followUpConsultation;
    }
  }
  if (sourceId && linkedSource && id(sourceId) !== id(linkedSource)) {
    throw Object.assign(new Error("The selected follow-up does not match this visit's linked recommendation."), { status: 409 });
  }
  const selectedId = sourceId || linkedSource || "";
  const isFollowUpVisit = ["follow_up", "free_follow_up"].includes(token?.billing?.feeType);
  if (!selectedId && !isFollowUpVisit) return null;
  if (!tenant) throw new Error("Clinic context is required for follow-up completion.");
  if (selectedId && !mongoose.isValidObjectId(selectedId)) {
    throw Object.assign(new Error("Invalid follow-up reference."), { status: 400 });
  }
  const filter = {
    patient: consultation.patient, doctor: consultation.doctor, status: "completed",
    followUpDate: { $ne: null }, createdAt: { $lt: consultation.createdAt },
  };
  if (selectedId) filter._id = selectedId;
  const source = await Consultation.findOne(filter)
    .select("_id patient doctor department followUpDate createdAt")
    .sort({ createdAt: -1 }).lean();
  if (!source) {
    if (selectedId) throw Object.assign(new Error("The selected follow-up does not belong to this patient and doctor."), { status: 409 });
    return null;
  }
  // Do not reconcile here: the current appointment was just marked completed
  // inside this transaction. Reconciliation could mark the plan completed
  // before the completion hook validates it and cause a false 409 rollback.
  const plan = await ensureFollowUpPlan(source, tenant);
  if (["completed", "cancelled"].includes(plan.status)) {
    if (id(plan.completedConsultation) === id(consultation._id)) return plan;
    if (selectedId) throw Object.assign(new Error("This follow-up has already been completed or cancelled."), { status: 409 });
    return null;
  }
  const result = await FollowUpPlan.findOneAndUpdate(
    { _id: plan._id, patient: consultation.patient, doctor: consultation.doctor,
      status: { $in: ["pending", "scheduled"] } },
    { $set: { status: "completed", appointment: token.appointment || plan.appointment || null,
      completedConsultation: consultation._id, completedAt: new Date() } }, { new: true }
  );
  if (!result && selectedId) {
    throw Object.assign(new Error("This follow-up has already been completed or cancelled."), { status: 409 });
  }
  return result;
}

export async function listTreatingDoctorFollowUps({ patientId, doctorId, tenant, before }) {
  const sources = await Consultation.find({
    patient: patientId, doctor: doctorId, status: "completed",
    followUpDate: { $ne: null }, createdAt: { $lt: before },
  }).select("_id patient doctor department followUpDate createdAt")
    .sort({ createdAt: -1 }).limit(30).lean();
  const plans = [];
  for (const source of sources) {
    const plan = await ensureFollowUpPlan(source, tenant);
    const current = await reconcileFollowUpPlan(plan);
    if (current && !["completed", "cancelled"].includes(current.status)) {
      plans.push({ consultationId: current.consultation, dueDate: current.dueDate,
        status: current.status, department: current.department });
    }
  }
  return plans;
}

export function followUpReminderStage(plan, today) {
  if (!plan || ["completed", "cancelled"].includes(plan.status)) return null;
  // Negative = before the due date; positive = overdue.
  const days = calendarDayDifference(plan.dueDate, today);
  return FOLLOW_UP_STAGES.includes(days) ? days : null;
}

export function followUpReminderContent({ stage, doctorName, department, dueDate, clinicName, appointment, roomNumber = "" }) {
  const name = doctorName ? `Dr. ${doctorName}` : "Your doctor";
  const details = `${name} · ${department} · ${clinicName}${roomNumber ? ` · Room ${roomNumber}` : ""}`;
  const scheduled = appointment && ACTIVE.includes(appointment.status);
  const appointmentText = scheduled
    ? `Your appointment is booked for ${appointment.appointmentDate} at ${appointment.startTime}.`
    : "No active follow-up appointment is linked to this recommendation. Open Appointments to book a suitable slot or contact reception.";
  const title = stage === 0 ? "Follow-up due today" :
    stage < 0 ? `Follow-up in ${-stage} day${stage === -1 ? "" : "s"}` :
    `Follow-up pending: ${stage} day${stage === 1 ? "" : "s"} overdue`;
  const intro = stage > 0 ? `Your recommended follow-up on ${dueDate} is ${stage} day${stage === 1 ? "" : "s"} overdue.` :
    stage === 0 ? `Your recommended follow-up is due today (${dueDate}).` :
    `Your recommended follow-up is on ${dueDate}, in ${-stage} day${stage === -1 ? "" : "s"}.`;
  return { title, message: `${intro}\n${details}\n${appointmentText}` };
}
