import Appointment from "../models/Appointment.js";
import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import { normalizeDepartment, DEPARTMENTS } from "../utils/departments.js";
import { buildSlots, isDoctorWorkingOnDate } from "../utils/appointmentSlots.js";
import { ACTIVE_APPOINTMENT_STATUSES, SLOT_OCCUPYING_APPOINTMENT_STATUSES } from "./appointmentLifecycleService.js";
import { applyClinicSlotRules, assertAppointmentSlotAllowed } from "../utils/clinicOperations.js";
import { quoteVisitFee } from "../utils/billing.js";

export async function rescheduleAppointment({
  appointment,
  tenantId,
  department,
  doctorId,
  appointmentDate,
  startTime,
  reason = "",
  actorRole = "patient",
}) {
  if (!appointment) {
    const error = new Error("Appointment not found."); error.status = 404; throw error;
  }
  const canRecoverMissed = appointment.status === "missed" && ["receptionist", "admin"].includes(actorRole);
  if (appointment.status !== "booked" && !canRecoverMissed) {
    const error = new Error(
      actorRole === "receptionist" || actorRole === "admin"
        ? "Only a booked or missed appointment can be rescheduled before check-in."
        : "Only a booked appointment can be rescheduled before check-in."
    ); error.status = 409; throw error;
  }

  const targetDepartment = normalizeDepartment(department || appointment.department);
  if (!DEPARTMENTS.includes(targetDepartment)) {
    const error = new Error("Choose a valid department."); error.status = 400; throw error;
  }
  if (!/^[a-f\d]{24}$/i.test(String(doctorId || ""))) {
    const error = new Error("Choose a doctor."); error.status = 400; throw error;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(appointmentDate || "")) || !/^\d{2}:\d{2}$/.test(String(startTime || ""))) {
    const error = new Error("Choose a valid appointment date and time."); error.status = 400; throw error;
  }

  const [doctor, tenant] = await Promise.all([
    User.findOne({ _id: doctorId, role: "doctor", department: targetDepartment })
      .select("_id name department doctorSchedule billingProfile").lean(),
    Tenant.findById(tenantId).select("timezone settings.operations settings.billing").lean(),
  ]);
  if (!doctor) {
    const error = new Error("Selected doctor does not belong to this department."); error.status = 409; throw error;
  }
  const working = isDoctorWorkingOnDate(doctor, appointmentDate, tenant?.timezone);
  if (!working.ok) { const error = new Error(working.reason); error.status = 409; throw error; }
  assertAppointmentSlotAllowed(tenant, appointmentDate, startTime);

  const duplicate = await Appointment.findOne({
    _id: { $ne: appointment._id },
    patient: appointment.patient,
    appointmentDate,
    status: { $in: ACTIVE_APPOINTMENT_STATUSES },
  }).lean();
  if (duplicate) {
    const error = new Error(`Patient already has an active appointment on ${appointmentDate}.`); error.status = 409; throw error;
  }

  const booked = await Appointment.find({
    _id: { $ne: appointment._id },
    doctor: doctor._id,
    appointmentDate,
    status: { $in: SLOT_OCCUPYING_APPOINTMENT_STATUSES },
  }).select("startTime").lean();
  const slotResult = applyClinicSlotRules(
    tenant,
    appointmentDate,
    buildSlots(doctor, appointmentDate, booked.map((item) => item.startTime), new Date(), tenant?.timezone)
  );
  const slot = slotResult.slots.find((item) => item.startTime === startTime);
  if (!slot) { const error = new Error("That appointment slot is no longer available."); error.status = 409; throw error; }

  const from = { appointmentDate: appointment.appointmentDate, startTime: appointment.startTime, doctor: appointment.doctor, doctorName: appointment.doctorName, department: appointment.department };
  appointment.department = targetDepartment;
  appointment.doctor = doctor._id;
  appointment.doctorName = doctor.name;
  // A recommendation belongs to the original treating doctor. Rescheduling
  // to another doctor must not silently complete that doctor's follow-up.
  if (appointment.followUpConsultation && String(from.doctor) !== String(doctor._id)) {
    appointment.followUpConsultation = null;
  }
  appointment.appointmentDate = appointmentDate;
  appointment.startTime = startTime;
  appointment.endTime = slot.endTime;
  appointment.slotKey = `${doctor._id}:${appointmentDate}:${startTime}`;
  const feeQuote = await quoteVisitFee({ doctor, tenant, department: targetDepartment, patientId: appointment.patient, visitType: "appointment", consultationKind: appointment.billing?.feeType === "follow_up" ? "follow_up" : "normal", serviceDate: appointmentDate });
  appointment.billing = { feeType: feeQuote.feeType, quotedAmount: feeQuote.amount, paidAmount: 0, discountAmount: 0, status: "pending", method: "", receiptNumber: "", paidAt: null, collectedBy: null };
  appointment.status = "booked";
  appointment.missedAt = null;
  appointment.rescheduledAt = new Date();
  appointment.rescheduleCount = Number(appointment.rescheduleCount || 0) + 1;
  appointment.rescheduleHistory = [
    ...(appointment.rescheduleHistory || []),
    {
      fromDate: from.appointmentDate,
      fromTime: from.startTime,
      toDate: appointmentDate,
      toTime: startTime,
      fromDoctorName: from.doctorName,
      toDoctorName: doctor.name,
      reason: String(reason || "").trim().slice(0, 300),
      actorRole,
      at: new Date(),
    },
  ].slice(-10);

  try {
    await appointment.save();
  } catch (error) {
    if (error?.code === 11000) { const conflict = new Error("That slot was just booked. Choose another."); conflict.status = 409; throw conflict; }
    throw error;
  }
  return appointment;
}
