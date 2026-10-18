import { performance } from "node:perf_hooks";
import { databaseTransaction } from "../utils/databaseTransaction.js";
import { withKeyedQueue } from "../utils/keyedAsyncQueue.js";
import { onlineReservationLimit } from "../utils/onlineReservationPolicy.js";
import QueueReservation from "../models/QueueReservation.js";
import Token from "../models/Token.js";
import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import { createQueueToken } from "./queueTokenService.js";
import { getDoctorAvailability, DEFAULT_TIMEZONE } from "../utils/doctorAvailability.js";
import { emitOperationalUpdate, emitQueueUpdate, emitPatientTokenUpdate } from "./realtimeService.js";
import { processQueueNotifications } from "./notificationService.js";
import { assertQueueAcceptingArrivals, assertSameDayReservationAllowed } from "../utils/clinicOperations.js";
import { quoteVisitFee, preparePayment, attachPaymentToToken } from "../utils/billing.js";

export function hospitalDate(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Kept as a named export for existing callers of this service.
export { onlineReservationLimit } from "../utils/onlineReservationPolicy.js";

// Bulk expiry runs in a scheduled tenant-scoped maintenance job, NOT on each
// booking. Patient history may request an inexpensive patient-scoped refresh.
export async function expireOldQueueReservations({ patientId = null, timeZone = DEFAULT_TIMEZONE } = {}) {
  const today = hospitalDate(new Date(), timeZone);
  return QueueReservation.updateMany(
    {
      status: "reserved",
      reservationDate: { $lt: today },
      ...(patientId ? { patient: patientId } : {}),
    },
    { $set: { status: "expired", expiredAt: new Date() } }
  );
}

export async function createOnlineQueueReservation({ tenantId, patient, doctor, department, urgency = "normal", consultationKind = "normal", patientRequestedUrgency = "" }) {
  // Old dates cannot block today's reservation: the date is part of both
  // duplicate detection and capacity checks. Expiry is handled separately.
  const reservationStartedAt = performance.now();
  const trace = process.env.PERF_TRACE_CLINICS === "1";
  const tenant = await Tenant.findById(tenantId).select("timezone settings.operations settings.billing").lean();
  if (tenant) assertSameDayReservationAllowed(tenant);
  const today = hospitalDate(new Date(), tenant?.timezone || DEFAULT_TIMEZONE);

  const activeToken = await Token.findOne({
    patient: patient._id,
    isArchived: { $ne: true },
    status: { $in: ["waiting", "called"] },
  }).lean();
  if (activeToken) {
    const error = new Error(`You already have active token #${activeToken.tokenNumber}.`);
    error.status = 409;
    throw error;
  }

  const existing = await QueueReservation.findOne({
    patient: patient._id,
    reservationDate: today,
    status: "reserved",
  }).lean();
  if (existing) {
    const error = new Error(`You already have an online reservation for ${existing.department}. Check in at reception when you arrive.`);
    error.status = 409;
    error.reservation = existing;
    throw error;
  }

  // Price calculation is outside the lock/transaction to reduce contention.
  const feeQuote = await quoteVisitFee({ doctor, tenant, department, patientId: patient._id, visitType: "reservation", urgency, consultationKind, serviceDate: today });

  // Reduce same-process write conflicts without weakening the DB guarantee.
  // This queue is an optimization ONLY; across Render instances the transaction
  // still serializes doctor changes and the count + insert remain atomic.
  const queueStartedAt = performance.now();
  const queueKey = `${tenantId}:${doctor._id}:${today}`;
  return withKeyedQueue(queueKey, async () => {
    const queueWaitMs = performance.now() - queueStartedAt;
    const transactionStartedAt = performance.now();
    let countMs = 0;
    let transactionAttempts = 0;
    try {
      const result = await databaseTransaction(async () => {
        transactionAttempts += 1;
        const capacityDoctor = await User.findOneAndUpdate(
          { _id: doctor._id, role: "doctor" },
          { $inc: { reservationCapacityRevision: 1 } },
          { new: true }
        ).select("name onlineReservationLimit");
        if (!capacityDoctor) {
          throw Object.assign(new Error("Doctor is no longer registered with this clinic."), { status: 409 });
        }
        const countStartedAt = performance.now();
        const usedOnlinePlaces = await QueueReservation.countDocuments({
          doctor: doctor._id,
          reservationDate: today,
          status: { $in: ["reserved", "checked_in"] },
        });
        countMs += performance.now() - countStartedAt;
        const limit = onlineReservationLimit(capacityDoctor);
        if (usedOnlinePlaces >= limit) {
          const error = new Error(
            `Online reservations for Dr. ${capacityDoctor.name} are full today. Walk-in patients can still check in at reception subject to clinic availability.`
          );
          error.status = 409;
          error.code = "ONLINE_RESERVATION_LIMIT";
          throw error;
        }
        return QueueReservation.create({
          tenantId,
          patient: patient._id,
          patientId: patient.patientId,
          patientName: patient.name,
          phone: patient.phone || "",
          department,
          doctor: doctor._id,
          doctorName: capacityDoctor.name,
          urgency: urgency === "emergency" ? "emergency" : "normal",
          patientRequestedUrgency: patientRequestedUrgency === "emergency" ? "emergency" : "",
          reservationDate: today,
          status: "reserved",
          billing: { feeType: feeQuote.feeType, quotedAmount: feeQuote.amount, status: "pending" },
        });
      });
      if (trace) {
        console.info(`[ClinicPerf] online_booking total=${(performance.now() - reservationStartedAt).toFixed(1)}ms queue_wait=${queueWaitMs.toFixed(1)}ms transaction=${(performance.now() - transactionStartedAt).toFixed(1)}ms count=${countMs.toFixed(1)}ms attempts=${transactionAttempts} outcome=success`);
      }
      return result;
    } catch (error) {
      if (trace) {
        console.info(`[ClinicPerf] online_booking total=${(performance.now() - reservationStartedAt).toFixed(1)}ms queue_wait=${queueWaitMs.toFixed(1)}ms transaction=${(performance.now() - transactionStartedAt).toFixed(1)}ms count=${countMs.toFixed(1)}ms attempts=${transactionAttempts} outcome=${error?.status === 409 ? "conflict" : "failure"}`);
      }
      throw error;
    }
  });
}

async function broadcastQueue(io) {
  if (!io) return;
  const queue = await Token.find({ isArchived: { $ne: true } })
    .select("tokenNumber department status urgency -_id")
    .sort({ department: 1, tokenNumber: 1 })
    .lean();
  emitQueueUpdate(io, queue);
  emitOperationalUpdate(io, ["queue", "analytics", "reservations"]);
  await processQueueNotifications(io);
}

async function checkInQueueReservationRecords({ reservationId, io = null, payment = {}, actorId = null }) {
  // The check-in path already rejects non-today reservations below. A global
  // expiry update here would slow every reception check-in unnecessarily.
  const reservation = await QueueReservation.findById(reservationId);
  if (!reservation) {
    const error = new Error("Online queue reservation not found.");
    error.status = 404;
    throw error;
  }

  if (reservation.status === "checked_in" && reservation.token) {
    const existingToken = await Token.findById(reservation.token);
    if (existingToken) return { reservation, token: existingToken, alreadyCheckedIn: true };
  }
  if (reservation.status !== "reserved") {
    const error = new Error(
      reservation.status === "expired" ? "This reservation has expired. Please ask reception for a walk-in token." :
      reservation.status === "cancelled" ? "This reservation was cancelled." : "This reservation cannot be checked in."
    );
    error.status = 409;
    throw error;
  }

  const tenant = await Tenant.findById(reservation.tenantId).select("timezone settings.operations settings.billing").lean();
  if (tenant) assertQueueAcceptingArrivals(tenant);
  const today = hospitalDate(new Date(), tenant?.timezone || DEFAULT_TIMEZONE);
  if (reservation.reservationDate !== today) {
    reservation.status = "expired";
    reservation.expiredAt = new Date();
    await reservation.save();
    const error = new Error("This reservation is not valid today. Please ask reception for a walk-in token.");
    error.status = 409;
    throw error;
  }

  const activeToken = await Token.findOne({
    patient: reservation.patient,
    isArchived: { $ne: true },
    status: { $in: ["waiting", "called"] },
  });
  if (activeToken) {
    const error = new Error(`Patient already has active token #${activeToken.tokenNumber}.`);
    error.status = 409;
    throw error;
  }

  const doctor = await User.findOne({
    _id: reservation.doctor,
    role: "doctor",
    department: reservation.department,
  }).select("_id name department doctorSchedule billingProfile");
  if (!doctor) {
    const error = new Error("Reserved doctor is no longer available. Please ask reception to choose another doctor.");
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

  const feeQuote = reservation.billing?.quotedAmount !== undefined
    ? { feeType: reservation.billing?.feeType || "reservation", amount: Number(reservation.billing?.quotedAmount || 0) }
    : await quoteVisitFee({ doctor, tenant, department: reservation.department, patientId: reservation.patient, visitType: "reservation", urgency: reservation.urgency, consultationKind: reservation.billing?.feeType === "follow_up" ? "follow_up" : "normal", serviceDate: reservation.reservationDate });
  const paymentData = preparePayment({ quotedAmount: feeQuote.amount, payment, tenant, actorId });

  const token = await createQueueToken({
      tenantId: reservation.tenantId,
      patient: reservation.patient,
      patientId: reservation.patientId,
      patientName: reservation.patientName,
      phone: reservation.phone,
      department: reservation.department,
      assignedDoctor: reservation.doctor,
      urgency: reservation.urgency,
      arrivalStatus: "arrived",
      status: "waiting",
      queueSource: "reservation",
      reservation: reservation._id,
      billing: { feeType: feeQuote.feeType, ...paymentData },
    }, { maxRetries: 1 });
  await attachPaymentToToken(token, paymentData, feeQuote.feeType);
  reservation.billing = token.billing?.toObject
    ? token.billing.toObject()
    : { ...(token.billing || {}) };
  reservation.status = "checked_in";
  reservation.token = token._id;
  reservation.checkedInAt = new Date();
  await reservation.save();
  return { reservation, token, alreadyCheckedIn: false };
}


export async function checkInQueueReservation(options) {
  const result = await databaseTransaction(() => checkInQueueReservationRecords({ ...options, io: null }));
  const io = options.io;
  if (result.token?.patient) emitPatientTokenUpdate(io, result.token.patient, result.token);
  broadcastQueue(io).catch(() => console.error("Reservation queue refresh failed."));
  return result;
}
