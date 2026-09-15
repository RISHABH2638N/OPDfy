import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { protect, requireRole } from "../middleware/auth.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import Appointment from "../models/Appointment.js";
import QueueReservation from "../models/QueueReservation.js";
import { checkInQueueReservation, hospitalDate as reservationHospitalDate } from "../services/queueReservationService.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import {
  checkInAppointment,
  hospitalToday,
} from "../services/appointmentCheckIn.js";

const router = asyncRouter();
const qrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.QR_RATE_MAX_PER_MINUTE || 30),
  store: createRateLimitStore("qr-checkin"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many QR check-in requests. Please try again shortly." },
});
router.use(protect, requireRole("receptionist", "admin"), qrLimiter);

function qrSecret() {
  const dedicated = String(process.env.QR_JWT_SECRET || "").trim();
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === "production") {
    const error = new Error("QR verification is not configured.");
    error.status = 503;
    throw error;
  }
  return process.env.JWT_SECRET;
}

function decodeCheckInToken(rawToken) {
  const token = String(rawToken || "").trim();

  if (!token) {
    const error = new Error("QR check-in code is missing.");
    error.status = 400;
    throw error;
  }

  let decoded;

  try {
    decoded = jwt.verify(
      token,
      qrSecret(), { algorithms: ["HS256"] }
    );
  } catch (error) {
    const invalid = new Error(
      error?.name === "TokenExpiredError"
        ? "This appointment QR has expired."
        : "Invalid appointment QR code."
    );
    invalid.status = 400;
    throw invalid;
  }

  if (
    decoded?.type !== "appointment-checkin" ||
    !decoded?.appointmentId
  ) {
    const error = new Error("Invalid appointment QR code.");
    error.status = 400;
    throw error;
  }

  return decoded;
}

router.post("/appointment/verify", async (req, res) => {
  try {
    const decoded = decodeCheckInToken(req.body.token);

    const appointment = await Appointment.findById(decoded.appointmentId)
      .select(
        "_id patient patientId patientName doctorName department appointmentDate startTime endTime status token billing"
      )
      .lean();

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found.",
      });
    }

    const today = hospitalToday();

    if (appointment.appointmentDate !== today) {
      return res.status(409).json({
        valid: false,
        message:
          appointment.appointmentDate > today
            ? `This QR becomes valid on ${appointment.appointmentDate}.`
            : "This appointment date has already passed.",
      });
    }

    if (["cancelled", "completed", "skipped", "missed"].includes(appointment.status)) {
      return res.status(409).json({
        valid: false,
        message:
          appointment.status === "cancelled"
            ? "This appointment has been cancelled."
            : appointment.status === "completed"
              ? "This appointment has already been completed."
              : appointment.status === "missed"
                ? "This appointment is marked missed. Please contact reception to reschedule it."
                : "This appointment was skipped. Please book a new appointment.",
      });
    }

    logSecurityEvent(req, { event: "qr_verify", outcome: "success", tenantId: req.tenantId, metadata: { kind: "appointment" } });
    return res.json({
      valid: true,
      appointment: {
        id: appointment._id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        department: appointment.department,
        appointmentDate: appointment.appointmentDate,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: appointment.status,
        alreadyCheckedIn: Boolean(appointment.token),
        billing: appointment.billing || {},
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      valid: false,
      message: publicErrorMessage(error, "Unable to verify QR code."),
    });
  }
});

router.post("/appointment", async (req, res) => {
  try {
    const decoded = decodeCheckInToken(req.body.token);

    const appointment = await Appointment.findById(decoded.appointmentId)
      .select("_id patient")
      .lean();

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found.",
      });
    }


    const result = await checkInAppointment({
      appointmentId: appointment._id,
      io: req.app.get("io"),
      requireToday: true,
      payment: req.body.payment || {}, actorId: req.user.id,
    });

    return res.status(result.alreadyCheckedIn ? 200 : 201).json({
      message: result.alreadyCheckedIn
        ? `Already checked in. Token #${result.token?.tokenNumber ?? "—"}.`
        : `Check-in successful. Token #${result.token.tokenNumber} created.`,
      ...result,
    });
  } catch (error) {
    logSecurityEvent(req, { event: "qr_checkin", outcome: error.status === 403 ? "blocked" : "failure", tenantId: req.tenantId, metadata: { code: error.code || "" } });
    console.error("QR APPOINTMENT CHECK-IN:", safeDiagnostic(error));

    return res.status(error.status || 500).json({
      message: publicErrorMessage(error, "Unable to check in appointment."),
      availability: error.availability,
    });
  }
});


/* ---------------------------------------------------------
   Universal reception scanner endpoints.
   Accept both scheduled-appointment QR and same-day queue-reservation QR.
--------------------------------------------------------- */
function decodeUniversalCheckInToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    const error = new Error("QR check-in code is missing.");
    error.status = 400;
    throw error;
  }
  try {
    return jwt.verify(token, qrSecret(), { algorithms: ["HS256"] });
  } catch (error) {
    const invalid = new Error(error?.name === "TokenExpiredError" ? "This check-in QR has expired." : "Invalid check-in QR code.");
    invalid.status = 400;
    throw invalid;
  }
}

router.post("/verify", async (req, res) => {
  try {
    const decoded = decodeUniversalCheckInToken(req.body.token);
    if (decoded?.type === "appointment-checkin" && decoded?.appointmentId) {
      const appointment = await Appointment.findById(decoded.appointmentId)
        .select("_id patientName doctorName department appointmentDate startTime endTime status token billing")
        .lean();
      if (!appointment) return res.status(404).json({ valid: false, message: "Appointment not found." });
      if (appointment.appointmentDate !== hospitalToday()) {
        return res.status(409).json({ valid: false, message: "This appointment QR is not valid today." });
      }
      if (["cancelled", "completed", "skipped", "missed"].includes(appointment.status)) {
        return res.status(409).json({ valid: false, message: "This appointment cannot be checked in." });
      }
      return res.json({
        valid: true,
        kind: "appointment",
        visit: {
          id: appointment._id,
          patientName: appointment.patientName,
          doctorName: appointment.doctorName,
          department: appointment.department,
          status: appointment.status,
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
          schedule: `${appointment.startTime}-${appointment.endTime}`,
          alreadyCheckedIn: Boolean(appointment.token),
          billing: appointment.billing || {},
        },
      });
    }

    if (decoded?.type === "queue-reservation-checkin" && decoded?.reservationId) {
      const reservation = await QueueReservation.findById(decoded.reservationId).lean();
      if (!reservation) return res.status(404).json({ valid: false, message: "Queue reservation not found." });
      if (reservation.reservationDate !== reservationHospitalDate()) {
        return res.status(409).json({ valid: false, message: "This online reservation is not valid today." });
      }
      if (!['reserved', 'checked_in'].includes(reservation.status)) {
        return res.status(409).json({ valid: false, message: "This online reservation cannot be checked in." });
      }
      return res.json({
        valid: true,
        kind: "reservation",
        visit: {
          id: reservation._id,
          patientName: reservation.patientName,
          doctorName: reservation.doctorName,
          department: reservation.department,
          status: reservation.status,
          appointmentDate: reservation.reservationDate,
          startTime: "FCFS at arrival",
          schedule: "Same-day FCFS reservation",
          urgency: reservation.urgency,
          alreadyCheckedIn: reservation.status === "checked_in" && Boolean(reservation.token),
          billing: reservation.billing || {},
        },
      });
    }

    return res.status(400).json({ valid: false, message: "Unsupported check-in QR code." });
  } catch (error) {
    return res.status(error.status || 500).json({ valid: false, message: publicErrorMessage(error, "Unable to verify QR code.") });
  }
});

router.post("/", async (req, res) => {
  try {
    const decoded = decodeUniversalCheckInToken(req.body.token);
    let result;
    let kind;
    if (decoded?.type === "appointment-checkin" && decoded?.appointmentId) {
      kind = "appointment";
      result = await checkInAppointment({ appointmentId: decoded.appointmentId, io: req.app.get("io"), requireToday: true, payment: req.body.payment || {}, actorId: req.user.id });
    } else if (decoded?.type === "queue-reservation-checkin" && decoded?.reservationId) {
      kind = "reservation";
      result = await checkInQueueReservation({ reservationId: decoded.reservationId, io: req.app.get("io"), payment: req.body.payment || {}, actorId: req.user.id });
    } else {
      return res.status(400).json({ message: "Unsupported check-in QR code." });
    }
    return res.status(result.alreadyCheckedIn ? 200 : 201).json({
      kind,
      message: result.alreadyCheckedIn
        ? `Already checked in. Token #${result.token?.tokenNumber ?? "—"}.`
        : `Arrival confirmed. FCFS token #${result.token.tokenNumber} issued now.`,
      ...result,
    });
  } catch (error) {
    logSecurityEvent(req, { event: "qr_checkin", outcome: error.status === 403 ? "blocked" : "failure", tenantId: req.tenantId, metadata: { code: error.code || "" } });
    console.error("UNIVERSAL QR CHECK-IN:", safeDiagnostic(error));
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to check in."), availability: error.availability });
  }
});

export default router;
