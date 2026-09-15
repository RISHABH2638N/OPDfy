import { databaseTransaction } from "../utils/databaseTransaction.js";
import Appointment from "../models/Appointment.js";
import Token from "../models/Token.js";
import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import { createQueueToken } from "./queueTokenService.js";
import { getDoctorAvailability, DEFAULT_TIMEZONE } from "../utils/doctorAvailability.js";
import {
  notifyAppointmentCheckedIn,
  processQueueNotifications,
} from "./notificationService.js";
import {
  appointmentStatusFromTokenStatus,
} from "./appointmentLifecycleService.js";
import { emitOperationalUpdate, emitQueueUpdate, emitPatientTokenUpdate } from "./realtimeService.js";
import { assertQueueAcceptingArrivals } from "../utils/clinicOperations.js";
import { quoteVisitFee, preparePayment, attachPaymentToToken } from "../utils/billing.js";

function hospitalToday(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}


async function broadcastQueue(io) {
  if (!io) return;

  const queue = await Token.find({
    isArchived: { $ne: true },
  })
    .select("tokenNumber department status urgency -_id")
    .sort({
      department: 1,
      tokenNumber: 1,
    })
    .lean();

  emitQueueUpdate(io, queue);
  emitOperationalUpdate(io, ["queue", "appointments", "analytics"]);
}

async function checkInAppointmentRecords({
  appointmentId,
  io = null,
  requireToday = true,
  payment = {},
  actorId = null,
}) {
  const appointment = await Appointment.findById(appointmentId);

  if (!appointment) {
    const error = new Error("Appointment not found.");
    error.status = 404;
    throw error;
  }

  if (appointment.status === "cancelled") {
    const error = new Error("Cancelled appointment cannot be checked in.");
    error.status = 409;
    throw error;
  }

  if (appointment.status === "completed") {
    const error = new Error("This appointment has already been completed.");
    error.status = 409;
    throw error;
  }

  if (appointment.status === "skipped" || appointment.status === "missed") {
    const error = new Error(
      appointment.status === "missed"
        ? "This appointment is marked missed. Reception can reschedule it to a new slot."
        : "This appointment was skipped. Please book a new available appointment slot."
    );
    error.status = 409;
    throw error;
  }

  const tenant = await Tenant.findById(appointment.tenantId).select("timezone settings.operations settings.billing").lean();
  if (tenant) assertQueueAcceptingArrivals(tenant);

  const today = hospitalToday(new Date(), tenant?.timezone || DEFAULT_TIMEZONE);

  if (requireToday && appointment.appointmentDate !== today) {
    const error = new Error(
      appointment.appointmentDate > today
        ? `This QR becomes valid on ${appointment.appointmentDate}.`
        : "This appointment date has already passed."
    );
    error.status = 409;
    throw error;
  }

  if (appointment.token) {
    const existingToken = await Token.findById(appointment.token);

    if (existingToken) {
      const expectedStatus = appointmentStatusFromTokenStatus(existingToken.status);

      if (expectedStatus && appointment.status !== expectedStatus) {
        appointment.status = expectedStatus;
        await appointment.save();
      }

      if (existingToken.status === "completed") {
        const error = new Error("This appointment has already been completed.");
        error.status = 409;
        throw error;
      }

      if (existingToken.status === "skipped") {
        const error = new Error(
          "This appointment was skipped. Please book a new available appointment slot."
        );
        error.status = 409;
        throw error;
      }

      return {
        appointment,
        token: existingToken,
        alreadyCheckedIn: true,
      };
    }

    // Recover from a dangling appointment.token reference if an old/manual
    // database edit removed the queue token.
    appointment.token = null;
    appointment.status = "booked";
    appointment.checkedInAt = null;
    await appointment.save();
  }

  const activeToken = await Token.findOne({
    patient: appointment.patient,
    isArchived: { $ne: true },
    status: { $in: ["waiting", "called"] },
  });

  if (activeToken) {
    const error = new Error(
      `Patient already has active token #${activeToken.tokenNumber}.`
    );
    error.status = 409;
    throw error;
  }

  const doctor = await User.findById(appointment.doctor)
    .select("_id name department doctorSchedule billingProfile");

  if (!doctor) {
    const error = new Error("Assigned doctor no longer exists.");
    error.status = 409;
    throw error;
  }

  const availability = getDoctorAvailability(doctor);

  if (!availability.isAvailable) {
    const error = new Error(availability.reason);
    error.status = 409;
    error.availability = availability;
    throw error;
  }

  const feeQuote = appointment.billing?.quotedAmount !== undefined
    ? { feeType: appointment.billing?.feeType || "appointment", amount: Number(appointment.billing?.quotedAmount || 0) }
    : await quoteVisitFee({ doctor, tenant, department: appointment.department, patientId: appointment.patient, visitType: "appointment", consultationKind: appointment.billing?.feeType === "follow_up" ? "follow_up" : "normal", serviceDate: appointment.appointmentDate });
  const paymentData = preparePayment({ quotedAmount: feeQuote.amount, payment, tenant, actorId });

  const token = await createQueueToken({
      tenantId: appointment.tenantId || null,
      patient: appointment.patient,
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      phone: appointment.phone,
      department: appointment.department,
      assignedDoctor: appointment.doctor,
      status: "waiting",
      urgency: "normal",
      arrivalStatus: "arrived",
      appointment: appointment._id,
      queueSource: "appointment",
      billing: { feeType: feeQuote.feeType, ...paymentData },
    }, { maxRetries: 1 });
  await attachPaymentToToken(token, paymentData, feeQuote.feeType);
  appointment.billing = token.billing?.toObject
    ? token.billing.toObject()
    : { ...(token.billing || {}) };
  appointment.status = "checked_in";
  appointment.token = token._id;
  appointment.checkedInAt = new Date();
  await appointment.save();

  return {
    appointment,
    token,
    alreadyCheckedIn: false,
  };
}

export async function checkInAppointment(options) {
  const result = await databaseTransaction(() => checkInAppointmentRecords({ ...options, io: null }));
  const io = options.io;
  if (result.token?.patient) emitPatientTokenUpdate(io, result.token.patient, result.token);
  broadcastQueue(io).catch(() => console.error("Check-in queue refresh failed."));
  if (!result.alreadyCheckedIn) {
    notifyAppointmentCheckedIn(result.appointment, result.token, io).catch(() => console.error("Check-in notification failed."));
    processQueueNotifications(io).catch(() => console.error("Queue notification processing failed."));
  }
  return result;
}

export { hospitalToday };
