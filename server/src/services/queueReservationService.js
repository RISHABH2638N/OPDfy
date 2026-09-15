import { databaseTransaction } from "../utils/databaseTransaction.js";
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

export function onlineReservationLimit() {
  const configured = Number(process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR || 70);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 70;
}

export async function expireOldQueueReservations() {
  const today = hospitalDate();
  const now = new Date();
  return QueueReservation.updateMany(
    { status: "reserved", reservationDate: { $lt: today } },
    { $set: { status: "expired", expiredAt: now } }
  );
}

export async function createOnlineQueueReservation({ tenantId, patient, doctor, department, urgency = "normal", consultationKind = "normal", patientRequestedUrgency = "" }) {
  await expireOldQueueReservations();
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

  const usedOnlinePlaces = await QueueReservation.countDocuments({
    doctor: doctor._id,
    reservationDate: today,
    status: { $in: ["reserved", "checked_in"] },
  });
  const limit = onlineReservationLimit();
  if (usedOnlinePlaces >= limit) {
    const error = new Error(
      `Online reservations for Dr. ${doctor.name} are full today. Walk-in patients can still check in at reception subject to clinic availability.`
    );
    error.status = 409;
    error.code = "ONLINE_RESERVATION_LIMIT";
    throw error;
  }

  const feeQuote = await quoteVisitFee({ doctor, tenant, department, patientId: patient._id, visitType: "reservation", urgency, consultationKind, serviceDate: today });
  return QueueReservation.create({
    tenantId,
    patient: patient._id,
    patientId: patient.patientId,
    patientName: patient.name,
    phone: patient.phone || "",
    department,
    doctor: doctor._id,
    doctorName: doctor.name,
    urgency: urgency === "emergency" ? "emergency" : "normal",
    patientRequestedUrgency: patientRequestedUrgency === "emergency" ? "emergency" : "",
    reservationDate: today,
    status: "reserved",
    billing: { feeType: feeQuote.feeType, quotedAmount: feeQuote.amount, status: "pending" },
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
  await expireOldQueueReservations();
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
