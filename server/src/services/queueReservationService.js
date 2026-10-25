import crypto from "node:crypto";
import { currentTenantId } from "./tenantExecutionContext.js";
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

export function onlineReservationLimit(doctor = {}) {
  const fallback = process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR;
  const configured = doctor.onlineReservationCapacity ?? (fallback === undefined || fallback === "" ? 70 : Number(fallback));
  if (!Number.isInteger(configured) || configured < 0 || configured > 100000) {
    throw Object.assign(new Error("Online reservation capacity is not configured correctly."), { status: 503 });
  }
  return configured; // Zero closes online reservations; null/absent inherits.
}

export async function expireOldQueueReservations({ patientId = null, reservationId = null, now = new Date() } = {}) {
  const tenant = await Tenant.findById(currentTenantId()).select("timezone").lean();
  if (!tenant) throw Object.assign(new Error("Clinic is unavailable."), { status: 404 });
  const today = hospitalDate(now, tenant.timezone || DEFAULT_TIMEZONE);
  return QueueReservation.updateMany({ status: "reserved", reservationDate: { $lt: today },
    ...(patientId ? { patient: patientId } : {}), ...(reservationId ? { _id: reservationId } : {}),
  }, { $set: { status: "expired", expiredAt: now } });
}

export async function createOnlineQueueReservation({ tenantId, patient, doctor, department, urgency = "normal", consultationKind = "normal", patientRequestedUrgency = "" }) {
  if (String(tenantId) !== currentTenantId()) throw Object.assign(new Error("Clinic context mismatch."), { status: 403 });
  return databaseTransaction(async () => {
    // An actual write shared by ALL reservations for this doctor prevents
    // snapshot write-skew. Concurrent transactions conflict here and the MongoDB
    // driver retries them against a fresh snapshot before counting capacity.
    // Admin cap changes touch this same document and therefore serialize too.
    const lockedDoctor = await User.findOneAndUpdate({ _id: doctor._id, role: "doctor", department },
      { $inc: { reservationCapacityRevision: 1 } }, { new: true })
      .select("_id name department doctorSchedule billingProfile onlineReservationCapacity");
    if (!lockedDoctor) throw Object.assign(new Error("Selected doctor is unavailable."), { status: 409 });
    const tenant = await Tenant.findById(tenantId).select("timezone settings.operations settings.billing").lean();
    if (!tenant) throw Object.assign(new Error("Clinic is unavailable."), { status: 404 });
    assertSameDayReservationAllowed(tenant);
    const today = hospitalDate(new Date(), tenant.timezone || DEFAULT_TIMEZONE);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify([String(tenantId), String(patient._id), String(lockedDoctor._id), today,
      department, urgency === "emergency" ? "emergency" : "normal", consultationKind === "follow_up" ? "follow_up" : "normal", patientRequestedUrgency === "emergency" ? "emergency" : ""])).digest("hex");
    const existing = await QueueReservation.findOne({ patient: patient._id, reservationDate: today, status: "reserved" }).select("+bookingFingerprint").lean();
    if (existing) {
      const { bookingFingerprint, ...view } = existing;
      if (bookingFingerprint === fingerprint) return { ...view, idempotentReplay: true };
      throw Object.assign(new Error(`You already have an online reservation for ${existing.department}. Check in at reception when you arrive.`), { status: 409, reservation: view });
    }
    const activeToken = await Token.findOne({ patient: patient._id, isArchived: { $ne: true }, status: { $in: ["waiting", "called"] } }).lean();
    if (activeToken) throw Object.assign(new Error(`You already have active token #${activeToken.tokenNumber}.`), { status: 409 });
    const availability = getDoctorAvailability(lockedDoctor, new Date(), tenant.timezone || DEFAULT_TIMEZONE);
    if (!availability.isAvailable) throw Object.assign(new Error(availability.reason), { status: 409, availability });
    const limit = onlineReservationLimit(lockedDoctor);
    const used = await QueueReservation.countDocuments({ doctor: lockedDoctor._id, reservationDate: today, status: { $in: ["reserved", "checked_in"] } });
    if (used >= limit) throw Object.assign(new Error(`Online reservations for Dr. ${lockedDoctor.name} are full today. Walk-in patients can still check in at reception subject to clinic availability.`), { status: 409, code: "ONLINE_RESERVATION_LIMIT" });
    const feeQuote = await quoteVisitFee({ doctor: lockedDoctor, tenant, department, patientId: patient._id, visitType: "reservation", urgency, consultationKind, serviceDate: today });
    const reservation = await QueueReservation.create({ tenantId, patient: patient._id, patientId: patient.patientId,
      patientName: patient.name, phone: patient.phone || "", department, doctor: lockedDoctor._id, doctorName: lockedDoctor.name,
      urgency: urgency === "emergency" ? "emergency" : "normal",
      patientRequestedUrgency: patientRequestedUrgency === "emergency" ? "emergency" : "",
      reservationDate: today, bookingFingerprint: fingerprint, status: "reserved", billing: { feeType: feeQuote.feeType, quotedAmount: feeQuote.amount, status: "pending" },
    });
    const { bookingFingerprint, ...view } = reservation.toObject();
    return view;
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
  const availability = getDoctorAvailability(doctor, new Date(), tenant?.timezone || DEFAULT_TIMEZONE);
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
