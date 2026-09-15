import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import Token from "../models/Token.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import QueueReservation from "../models/QueueReservation.js";
import Consultation from "../models/Consultation.js";
import { protect, requireRole } from "../middleware/auth.js";
import { DEPARTMENTS, normalizeDepartment } from "../utils/departments.js";
import { getDoctorAvailability, onlyAvailableDoctors } from "../utils/doctorAvailability.js";
import { availableDateOptions, buildSlots, isDoctorWorkingOnDate } from "../utils/appointmentSlots.js";
import { checkInAppointment } from "../services/appointmentCheckIn.js";
import { createQueueToken } from "../services/queueTokenService.js";
import { checkInQueueReservation, hospitalDate } from "../services/queueReservationService.js";
import {
  processQueueNotifications,
  notifyNoShow,
  notifyAppointmentBooked,
} from "../services/notificationService.js";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  SLOT_OCCUPYING_APPOINTMENT_STATUSES,
  syncAppointmentFromToken,
  markMissedAppointments,
} from "../services/appointmentLifecycleService.js";
import {
  emitOperationalUpdate,
  emitQueueUpdate,
  emitPatientTokenUpdate,
} from "../services/realtimeService.js";
import Tenant from "../models/Tenant.js";
import { applyClinicSlotRules, filterClinicAppointmentDates, assertAppointmentSlotAllowed, assertQueueAcceptingArrivals, getClinicOperationsSnapshot } from "../utils/clinicOperations.js";
import { rescheduleAppointment } from "../services/appointmentRescheduleService.js";
import { quoteVisitFee, preparePayment, attachPaymentToToken } from "../utils/billing.js";

const router = asyncRouter();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

router.use(protect, requireRole("receptionist", "admin"));

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function cleanPhone(value = "") {
  return String(value || "").replace(/\D/g, "").slice(0, 10);
}

async function broadcast(req, extraDomains = []) {
  const io = req.app.get("io");
  if (!io) return;
  const queue = await Token.find({ isArchived: { $ne: true } })
    .select("tokenNumber department status urgency -_id")
    .sort({ department: 1, tokenNumber: 1 })
    .lean();
  emitQueueUpdate(io, queue);
  emitOperationalUpdate(io, ["queue", "analytics", ...extraDomains]);
  processQueueNotifications(io).catch((error) => {
    console.error("Reception queue notification processing failed:", safeDiagnostic(error));
  });
}

router.get("/operations-status", async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select("timezone settings.operations settings.billing").lean();
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    return res.json({ status: getClinicOperationsSnapshot(tenant) });
  } catch {
    return res.status(500).json({ message: "Unable to load front-desk operating status." });
  }
});


/* ---------------------------------------------------------
   Search registered patients for front-desk registration.
   Only non-clinical identity/contact fields are returned.
--------------------------------------------------------- */
router.get("/patients", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const query = {};

    if (search) {
      const safe = escapeRegex(search);
      query.$or = [
        { name: { $regex: safe, $options: "i" } },
        { patientId: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { phone: { $regex: safe, $options: "i" } },
      ];
    }

    const patients = await Patient.find(query)
      .select("_id patientId name email phone dateOfBirth gender profileCompleted createdAt")
      .sort({ updatedAt: -1 })
      .limit(25)
      .lean();

    res.json(patients);
  } catch (error) {
    console.error("RECEPTION SEARCH PATIENTS:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to search patients." });
  }
});

/* ---------------------------------------------------------
   Load today's online reservation for a selected patient.
   Reservation is NOT a live queue position until checked in.
--------------------------------------------------------- */
router.get("/patients/:id/reservations", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid patient." });
    }
    const reservations = await QueueReservation.find({
      patient: req.params.id,
      reservationDate: hospitalDate(),
      status: "reserved",
    })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ reservations });
  } catch (error) {
    console.error("RECEPTION PATIENT RESERVATIONS:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load online reservations." });
  }
});

/* ---------------------------------------------------------
   Confirm physical arrival for an online reservation.
   The live FCFS token number is created HERE, not at online booking time.
--------------------------------------------------------- */
router.post("/reservations/:id/check-in", async (req, res) => {
  try {
    const result = await checkInQueueReservation({
      reservationId: req.params.id,
      io: req.app.get("io"),
      payment: req.body.payment || {},
      actorId: req.user.id,
    });
    return res.status(result.alreadyCheckedIn ? 200 : 201).json({
      message: result.alreadyCheckedIn
        ? `Patient is already checked in with token #${result.token.tokenNumber}.`
        : `Arrival confirmed. FCFS token #${result.token.tokenNumber} issued now.`,
      ...result,
    });
  } catch (error) {
    console.error("RECEPTION RESERVATION CHECK-IN:", safeDiagnostic(error));
    return res.status(error.status || 500).json({
      message: publicErrorMessage(error, "Unable to check in online reservation."),
      availability: error.availability,
    });
  }
});

/* ---------------------------------------------------------
   Register a walk-in patient.
   Contact details are optional so patients without a phone/email are
   never excluded from the OPD queue. The permanent Patient ID is enough.
--------------------------------------------------------- */
router.post("/patients", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = cleanEmail(req.body.email);
    const phone = cleanPhone(req.body.phone);
    const gender = String(req.body.gender || "");
    const dateOfBirth = req.body.dateOfBirth || null;

    if (!name) {
      return res.status(400).json({ message: "Patient name is required." });
    }

    if (phone && !/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ message: "Enter a valid 10-digit mobile number." });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }

    const duplicateOr = [];
    if (phone) duplicateOr.push({ phone });
    if (email) duplicateOr.push({ email });

    if (duplicateOr.length) {
      const existing = await Patient.findOne({ $or: duplicateOr }).lean();
      if (existing) {
        return res.status(409).json({
          message: "A patient with this phone/email already exists. Select the existing patient instead.",
          patient: existing,
        });
      }
    }

    const payload = {
      tenantId: req.tenantId,
      name,
      dateOfBirth,
      gender: ["Male", "Female", "Other", ""].includes(gender) ? gender : "",
      profileCompleted: Boolean(name && (phone || email)),
    };
    if (email) payload.email = email;
    if (phone) payload.phone = phone;

    const patient = await Patient.create(payload);

    res.status(201).json({
      _id: patient._id,
      patientId: patient.patientId,
      name: patient.name,
      email: patient.email || "",
      phone: patient.phone || "",
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      profileCompleted: patient.profileCompleted,
    });
  } catch (error) {
    console.error("RECEPTION CREATE PATIENT:", safeDiagnostic(error));
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "A patient with this phone/email already exists.",
      });
    }
    res.status(500).json({ message: publicErrorMessage(error, "Unable to register patient.") });
  }
});

router.get("/fee-quote", async (req, res) => {
  try {
    const doctorId = String(req.query.doctorId || "");
    const patientId = String(req.query.patientId || "");
    const visitType = ["walk_in", "reservation", "appointment"].includes(String(req.query.visitType)) ? String(req.query.visitType) : "walk_in";
    const urgency = String(req.query.urgency || "normal") === "emergency" ? "emergency" : "normal";
    if (!mongoose.Types.ObjectId.isValid(doctorId)) return res.status(400).json({ message: "Select a doctor." });
    const [doctor, tenant] = await Promise.all([
      User.findOne({ _id: doctorId, role: "doctor" }).select("_id name department billingProfile").lean(),
      Tenant.findById(req.tenantId).select("settings.billing").lean(),
    ]);
    if (!doctor) return res.status(404).json({ message: "Doctor not found." });
    const quote = await quoteVisitFee({ doctor, tenant, department: doctor.department, patientId: mongoose.Types.ObjectId.isValid(patientId) ? patientId : null, visitType, urgency });
    return res.json({ quote, doctor: { _id: doctor._id, name: doctor.name, department: doctor.department } });
  } catch (error) {
    return res.status(500).json({ message: "Unable to calculate consultation fee." });
  }
});

router.get("/billing-summary", async (req, res) => {
  try {
    const today = hospitalDate();
    const start = new Date(`${today}T00:00:00.000Z`);
    const end = new Date(`${today}T23:59:59.999Z`);
    const [payments, appointments, reservations] = await Promise.all([
      Token.find({ "billing.paidAt": { $gte: start, $lte: end }, "billing.status": { $in: ["paid", "waived", "refunded"] } }).select("billing").lean(),
      Appointment.find({ appointmentDate: today, status: "booked", "billing.status": "pending", "billing.quotedAmount": { $gt: 0 } }).select("billing.quotedAmount").lean(),
      QueueReservation.find({ reservationDate: today, status: "reserved", "billing.status": "pending", "billing.quotedAmount": { $gt: 0 } }).select("billing.quotedAmount").lean(),
    ]);
    const paid = payments.filter((item) => item.billing?.status === "paid");
    const methods = { cash: 0, upi: 0, card: 0, other: 0 };
    let collected = 0;
    for (const item of paid) { const amount = Number(item.billing?.paidAmount || 0); collected += amount; if (methods[item.billing?.method] !== undefined) methods[item.billing.method] += amount; }
    const pending = [...appointments, ...reservations];
    return res.json({ date: today, collected, paidCount: paid.length, pendingCount: pending.length, pendingAmount: pending.reduce((sum,item)=>sum+Number(item.billing?.quotedAmount||0),0), methods });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load front-desk billing summary." });
  }
});

/* ---------------------------------------------------------
   Doctors are returned only for routing visibility.
--------------------------------------------------------- */
router.get("/doctors", async (req, res) => {
  try {
    const doctors = await User.find({ role: "doctor" })
      .select("_id name department doctorSchedule billingProfile")
      .sort({ department: 1, name: 1 })
      .lean();
    res.json(onlyAvailableDoctors(doctors));
  } catch (error) {
    res.status(500).json({ message: "Unable to load doctor roster." });
  }
});

/* ---------------------------------------------------------
   Issue a walk-in token linked to an existing patient.
--------------------------------------------------------- */
router.post("/tokens", async (req, res) => {
  try {
    const patientMongoId = String(req.body.patientMongoId || "");
    const department = normalizeDepartment(req.body.department || "General OPD");
    const doctorId = String(req.body.doctorId || "");
    const urgency = req.body.urgency === "emergency" ? "emergency" : "normal";

    if (!mongoose.Types.ObjectId.isValid(patientMongoId)) {
      return res.status(400).json({ message: "Select a registered patient first." });
    }

    if (!DEPARTMENTS.includes(department)) {
      return res.status(400).json({ message: "Invalid department." });
    }

    const tenant = await Tenant.findById(req.tenantId).select("timezone settings.operations settings.billing").lean();
    if (tenant) assertQueueAcceptingArrivals(tenant);

    const patient = await Patient.findById(patientMongoId);
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found." });
    }

    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({
        message: `Select the ${department} doctor who should receive this patient.`,
      });
    }

    const selectedDoctor = await User.findOne({
      _id: doctorId,
      role: "doctor",
      department,
    }).select("_id name department doctorSchedule billingProfile");

    if (!selectedDoctor) {
      return res.status(409).json({
        message: `The selected doctor is not registered in ${department}.`,
      });
    }

    const doctorAvailability = getDoctorAvailability(selectedDoctor);
    if (!doctorAvailability.isAvailable) {
      return res.status(409).json({
        message: doctorAvailability.reason,
        availability: doctorAvailability,
      });
    }

    const pendingReservation = await QueueReservation.findOne({
      patient: patient._id,
      reservationDate: hospitalDate(),
      status: "reserved",
    }).lean();

    if (pendingReservation) {
      return res.status(409).json({
        message: `This patient already has an online reservation with Dr. ${pendingReservation.doctorName}. Use "Check In Reservation" so FCFS position is assigned at arrival.`,
        reservation: pendingReservation,
      });
    }

    const activeToken = await Token.findOne({
      patient: patient._id,
      isArchived: { $ne: true },
      status: { $in: ["waiting", "called"] },
    }).lean();

    if (activeToken) {
      return res.status(409).json({
        message: `This patient already has active ${activeToken.department} token #${activeToken.tokenNumber}.`,
      });
    }

    const feeQuote = await quoteVisitFee({ doctor: selectedDoctor, tenant, department, patientId: patient._id, visitType: "walk_in", urgency });
    const paymentData = preparePayment({ quotedAmount: feeQuote.amount, payment: req.body.payment || {}, tenant, actorId: req.user.id });

    const token = await createQueueToken({
      tenantId: req.tenantId,
      patient: patient._id,
      patientId: patient.patientId,
      patientName: patient.name || "Walk-in Patient",
      phone: patient.phone || "",
      department,
      urgency,
      arrivalStatus: "arrived",
      assignedDoctor: selectedDoctor._id,
      status: "waiting",
      queueSource: "walk_in",
      billing: { feeType: feeQuote.feeType, ...paymentData },
    });
    await attachPaymentToToken(token, paymentData, feeQuote.feeType);

    const io = req.app.get("io");
    if (token.patient) {
      emitPatientTokenUpdate(io, token.patient, token);
    }

    await broadcast(req, ["billing"]);
    res.status(201).json(token);
  } catch (error) {
    console.error("RECEPTION CREATE TOKEN:", safeDiagnostic(error));
    res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to issue token.") });
  }
});

/* ---------------------------------------------------------
   Assign/reassign a waiting token to one doctor.
   Reception chooses exactly which specialist receives the case.
--------------------------------------------------------- */
router.patch("/tokens/:id/doctor", async (req, res) => {
  try {
    const doctorId = String(req.body.doctorId || "");
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({ message: "Select a valid doctor." });
    }

    const token = await Token.findById(req.params.id);
    if (!token || token.isArchived) {
      return res.status(404).json({ message: "Active token not found." });
    }
    if (token.status !== "waiting") {
      return res.status(409).json({
        message: "Only a waiting token can be reassigned by reception.",
      });
    }

    if (token.appointment || token.reservation || ["appointment", "reservation"].includes(token.queueSource)) {
      return res.status(409).json({
        message:
          token.queueSource === "reservation"
            ? "Online reservation check-in is locked to the doctor selected by the patient. Create a new walk-in token only if reception intentionally changes the doctor."
            : "Appointment check-in is locked to the doctor originally booked. Cancel/reschedule the appointment instead of reassigning its live token.",
      });
    }

    const doctor = await User.findOne({
      _id: doctorId,
      role: "doctor",
      department: token.department,
    }).select("_id name department doctorSchedule billingProfile");

    if (!doctor) {
      return res.status(409).json({
        message: `Choose a registered ${token.department} doctor.`,
      });
    }

    const availability = getDoctorAvailability(doctor);
    if (!availability.isAvailable) {
      return res.status(409).json({ message: availability.reason, availability });
    }

    token.assignedDoctor = doctor._id;
    await token.save();
    if (token.patient) {
      emitPatientTokenUpdate(req.app.get("io"), token.patient, token);
    }
    await broadcast(req);

    return res.json({
      token,
      doctor: { _id: doctor._id, name: doctor.name, department: doctor.department },
    });
  } catch (error) {
    console.error("RECEPTION ASSIGN DOCTOR:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to assign doctor." });
  }
});

/* ---------------------------------------------------------
   Front-desk arrival/no-show control.
   This intentionally does not let receptionists complete a
   consultation or act as a doctor.
--------------------------------------------------------- */
router.patch("/tokens/:id/arrival", async (req, res) => {
  try {
    const arrivalStatus = String(req.body.arrivalStatus || "");
    if (!["arrived", "not_checked_in", "no_show"].includes(arrivalStatus)) {
      return res.status(400).json({ message: "Invalid arrival status." });
    }

    const token = await Token.findById(req.params.id);
    if (!token || token.isArchived) {
      return res.status(404).json({ message: "Active token not found." });
    }

    if (arrivalStatus === "no_show") {
      if (token.status === "called" || token.status === "completed") {
        return res.status(409).json({
          message: "A called/completed patient cannot be marked no-show by reception.",
        });
      }
      token.status = "skipped";
      // Preserve doctor assignment so an accidental no-show can be restored
      // without creating an unassigned waiting token.
      token.calledAt = null;
      token.completedAt = null;
    } else if (token.status === "skipped" && token.arrivalStatus === "no_show") {
      if (token.appointment) {
        const linkedAppointment = await Appointment.findById(token.appointment)
          .select("_id patient appointmentDate")
          .lean();

        if (linkedAppointment) {
          const otherActiveAppointment = await Appointment.findOne({
            _id: { $ne: linkedAppointment._id },
            patient: linkedAppointment.patient,
            appointmentDate: linkedAppointment.appointmentDate,
            status: { $in: ACTIVE_APPOINTMENT_STATUSES },
          }).lean();

          if (otherActiveAppointment) {
            return res.status(409).json({
              message:
                "This no-show appointment cannot be restored because the patient has already booked another active appointment for the same day.",
            });
          }
        }
      }

      token.status = "waiting";
    }

    token.arrivalStatus = arrivalStatus;
    await token.save();
    if (token.patient) {
      emitPatientTokenUpdate(req.app.get("io"), token.patient, token);
    }

    const linkedAppointment = await syncAppointmentFromToken(token);

    // Push the operational state first. Email delivery must never make the
    // receptionist/doctor/admin dashboards wait for SMTP.
    await broadcast(req, linkedAppointment ? ["appointments"] : []);

    if (arrivalStatus === "no_show") {
      await notifyNoShow(token, req.app.get("io"));
    }

    res.json(token);
  } catch (error) {
    console.error("RECEPTION ARRIVAL:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to update arrival status." });
  }
});



/* ---------------------------------------------------------
   Prescription Print Desk.
   Reception only receives completed prescription data needed
   for physical handover; templates remain admin-controlled.
--------------------------------------------------------- */
router.get("/prescriptions", requireRole("receptionist"), async (req, res) => {
  try {
    const limit = Math.min(80, Math.max(10, Number(req.query.limit || 40)));
    const consultations = await Consultation.find({ status: "completed" })
      .select("patient token doctor department symptoms diagnosis prescription medicines testsRecommended advice followUpDate printDesk createdAt")
      .populate({ path: "patient", select: "patientId name dateOfBirth gender" })
      .populate({ path: "token", select: "tokenNumber patientName patientId department urgency createdAt" })
      .populate({ path: "doctor", select: "name department prescriptionProfile" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ consultations });
  } catch (error) {
    console.error("RECEPTION PRESCRIPTION DESK:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load completed prescriptions." });
  }
});

router.post("/prescriptions/:id/printed", requireRole("receptionist"), async (req, res) => {
  try {
    const consultation = await Consultation.findById(req.params.id);
    if (!consultation) return res.status(404).json({ message: "Prescription record not found." });
    consultation.printDesk = { printedAt: new Date(), printedBy: req.user.id };
    await consultation.save();
    res.locals.auditDescriptor = {
      module: "Prescription",
      action: "PRINT_PRESCRIPTION",
      summary: `Reception printed prescription ${String(consultation._id).slice(-6)}`,
    };
    emitOperationalUpdate(req.app.get("io"), ["prescriptions"]);
    return res.json({ message: "Prescription marked printed.", printedAt: consultation.printDesk.printedAt });
  } catch (error) {
    console.error("RECEPTION MARK PRESCRIPTION PRINTED:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to update prescription print status." });
  }
});

/* ---------------------------------------------------------
   Controlled queue intervention.
   This endpoint keeps day-to-day queue corrections with the
   reception desk and records every successful change in audit.
--------------------------------------------------------- */
router.post("/tokens/:id/intervention", requireRole("receptionist"), async (req, res) => {
  try {
    const action = String(req.body.action || "").trim();
    const reason = String(req.body.reason || "").trim().slice(0, 300);
    const allowed = new Set(["hold", "resume", "reassign", "transfer", "recover_no_show", "priority"]);

    if (!allowed.has(action)) return res.status(400).json({ message: "Invalid queue intervention." });
    if (!reason) return res.status(400).json({ message: "Enter a reason for this queue intervention." });

    const token = await Token.findById(req.params.id);
    if (!token || token.isArchived) return res.status(404).json({ message: "Active token not found." });
    if (token.status === "completed") return res.status(409).json({ message: "Completed consultations cannot be changed from reception." });

    const now = new Date();
    const control = token.queueControl || {};

    if (action === "hold") {
      if (token.status !== "waiting") return res.status(409).json({ message: "Only a waiting token can be placed on hold." });
      control.isOnHold = true;
      control.heldAt = now;
      control.holdReason = reason;
    }

    if (action === "resume") {
      if (!control.isOnHold) return res.status(409).json({ message: "This token is not on hold." });
      control.isOnHold = false;
      control.heldAt = null;
      control.holdReason = "";
    }

    if (action === "recover_no_show") {
      if (!(token.status === "skipped" && token.arrivalStatus === "no_show")) {
        return res.status(409).json({ message: "Only a no-show token can be recovered." });
      }
      token.status = "waiting";
      token.arrivalStatus = "arrived";
      token.calledAt = null;
      token.completedAt = null;
      control.isOnHold = false;
    }

    if (action === "priority") {
      if (token.status !== "waiting") return res.status(409).json({ message: "Priority can only be changed for a waiting token." });
      token.urgency = req.body.urgency === "emergency" ? "emergency" : "normal";
    }

    if (action === "reassign" || action === "transfer") {
      if (token.status !== "waiting") return res.status(409).json({ message: "Only a waiting token can be reassigned or transferred." });

      const targetDepartment = action === "transfer"
        ? normalizeDepartment(req.body.department || "")
        : token.department;
      if (!DEPARTMENTS.includes(targetDepartment)) {
        return res.status(400).json({ message: "Choose a valid target department." });
      }

      const doctorId = String(req.body.doctorId || "");
      if (!mongoose.Types.ObjectId.isValid(doctorId)) {
        return res.status(400).json({ message: "Choose a valid target doctor." });
      }
      const doctor = await User.findOne({ _id: doctorId, role: "doctor", department: targetDepartment })
        .select("_id name department doctorSchedule billingProfile")
        .lean();
      if (!doctor) return res.status(409).json({ message: "Target doctor is not registered in that department." });
      const availability = getDoctorAvailability(doctor);
      if (!availability.isAvailable) return res.status(409).json({ message: availability.reason, availability });

      if (action === "transfer" && targetDepartment !== token.department) {
        const last = await Token.findOne({ department: targetDepartment, isArchived: { $ne: true } })
          .sort({ tokenNumber: -1 })
          .select("tokenNumber")
          .lean();
        token.department = targetDepartment;
        token.tokenNumber = Number(last?.tokenNumber || 0) + 1;
      }
      token.assignedDoctor = doctor._id;
      control.isOnHold = false;

      if (token.appointment) {
        await Appointment.updateOne(
          { _id: token.appointment },
          { $set: { department: targetDepartment, doctor: doctor._id, doctorName: doctor.name } }
        );
      }
      if (token.reservation) {
        await QueueReservation.updateOne(
          { _id: token.reservation },
          { $set: { department: targetDepartment, doctor: doctor._id, doctorName: doctor.name } }
        );
      }
    }

    control.lastInterventionAt = now;
    control.lastInterventionReason = reason;
    token.queueControl = control;
    await token.save();
    if (token.patient) {
      emitPatientTokenUpdate(req.app.get("io"), token.patient, token);
    }

    res.locals.auditDescriptor = {
      module: "Queue",
      action: `RECEPTION_${action.toUpperCase()}`,
      summary: `Reception ${action.replaceAll("_", " ")} for ${token.department} token #${token.tokenNumber}: ${reason}`.slice(0, 230),
    };

    await broadcast(req, ["appointments"]);
    return res.json({ message: "Queue intervention applied.", token });
  } catch (error) {
    console.error("RECEPTION QUEUE INTERVENTION:", safeDiagnostic(error));
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Queue numbering changed at the same moment. Please retry the transfer." });
    }
    return res.status(500).json({ message: publicErrorMessage(error, "Unable to apply queue intervention.") });
  }
});

/* ---------------------------------------------------------
   Appointment scheduling for reception / call desk.
--------------------------------------------------------- */
router.get("/appointment-doctors", async (req, res) => {
  try {
    const department = normalizeDepartment(req.query.department || "General OPD");
    const doctors = await User.find({ role: "doctor", department })
      .select("_id name department doctorSchedule billingProfile").sort({ name: 1 }).lean();
    res.json({ doctors });
  } catch { res.status(500).json({ message: "Unable to load doctors." }); }
});

router.get("/appointment-doctors/:doctorId/dates", async (req, res) => {
  try {
    const [doctor, tenant] = await Promise.all([
      User.findOne({ _id: req.params.doctorId, role: "doctor" }).select("_id name department doctorSchedule billingProfile").lean(),
      Tenant.findById(req.tenantId).select("timezone settings.operations settings.billing").lean(),
    ]);
    if (!doctor) return res.status(404).json({ message: "Doctor not found." });
    const dates = availableDateOptions(doctor, 30, new Date(), tenant?.timezone);
    return res.json({ dates: filterClinicAppointmentDates(tenant, dates) });
  } catch { return res.status(500).json({ message: "Unable to load available dates." }); }
});

router.get("/appointment-doctors/:doctorId/slots", async (req, res) => {
  try {
    const date = String(req.query.date || "");
    if (!DATE_PATTERN.test(date)) return res.status(400).json({ message: "Select a valid appointment date." });
    const [doctor, tenant] = await Promise.all([
      User.findOne({ _id: req.params.doctorId, role: "doctor" }).select("_id name department doctorSchedule billingProfile").lean(),
      Tenant.findById(req.tenantId).select("timezone settings.operations settings.billing").lean(),
    ]);
    if (!doctor) return res.status(404).json({ message: "Doctor not found." });
    const booked = await Appointment.find({
      doctor: doctor._id,
      appointmentDate: date,
      status: { $in: SLOT_OCCUPYING_APPOINTMENT_STATUSES },
    }).select("startTime").lean();
    const slots = buildSlots(doctor, date, booked.map((item) => item.startTime), new Date(), tenant?.timezone);
    return res.json(applyClinicSlotRules(tenant, date, slots));
  } catch { return res.status(500).json({ message: "Unable to load slots." }); }
});

router.get("/appointments/today", async (req, res) => {
  try {
    await markMissedAppointments();
    const tenant = await Tenant.findById(req.tenantId).select("timezone").lean();
    const date = String(req.query.date || new Intl.DateTimeFormat("en-CA", {
      timeZone: tenant?.timezone || process.env.HOSPITAL_TIMEZONE || "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()));
    const appointments = await Appointment.find({ appointmentDate: date, status: { $ne: "cancelled" } })
      .sort({ startTime: 1 }).lean();
    return res.json({ appointments });
  } catch { return res.status(500).json({ message: "Unable to load appointments." }); }
});

router.post("/appointments", async (req, res) => {
  try {
    const patientMongoId = String(req.body.patientMongoId || "");
    const department = normalizeDepartment(req.body.department || "General OPD");
    const doctorId = String(req.body.doctorId || "");
    const appointmentDate = String(req.body.appointmentDate || "");
    const startTime = String(req.body.startTime || "");
    if (!mongoose.Types.ObjectId.isValid(patientMongoId)) return res.status(400).json({ message: "Select a patient first." });
    if (!DATE_PATTERN.test(appointmentDate)) return res.status(400).json({ message: "Select a valid appointment date." });
    const patient = await Patient.findById(patientMongoId);
    if (!patient) return res.status(404).json({ message: "Patient not found." });
    const [doctor, tenant] = await Promise.all([
      User.findOne({ _id: doctorId, role: "doctor", department }).select("_id name department doctorSchedule billingProfile").lean(),
      Tenant.findById(req.tenantId).select("timezone settings.operations settings.billing").lean(),
    ]);
    if (!doctor) return res.status(409).json({ message: "Selected doctor is not registered in this department." });
    const working = isDoctorWorkingOnDate(doctor, appointmentDate, tenant?.timezone);
    if (!working.ok) return res.status(409).json({ message: working.reason });
    assertAppointmentSlotAllowed(tenant, appointmentDate, startTime);

    const duplicatePatient = await Appointment.findOne({
      patient: patient._id,
      appointmentDate,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
    }).lean();
    if (duplicatePatient) return res.status(409).json({ message: `This patient already has an active appointment on ${appointmentDate}.` });

    const booked = await Appointment.find({
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
    if (!slot) return res.status(409).json({ message: "That slot is no longer available." });

    const feeQuote = await quoteVisitFee({ doctor, tenant, department, patientId: patient._id, visitType: "appointment" });
    try {
      const appointment = await Appointment.create({
        tenantId: req.tenantId,
        patient: patient._id, patientId: patient.patientId, patientName: patient.name || "Patient", phone: patient.phone || "",
        doctor: doctor._id, doctorName: doctor.name, department, appointmentDate, startTime, endTime: slot.endTime,
        reason: String(req.body.reason || "").trim(), bookingSource: "reception",
        slotKey: `${doctor._id}:${appointmentDate}:${startTime}`,
        billing: { feeType: feeQuote.feeType, quotedAmount: feeQuote.amount, status: "pending" },
      });
      const io = req.app.get("io");
      emitOperationalUpdate(io, ["appointments", "analytics"]);
      await notifyAppointmentBooked(appointment, io);
      return res.status(201).json({ appointment });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ message: "That slot was just booked. Choose another." });
      throw error;
    }
  } catch (error) {
    console.error("RECEPTION APPOINTMENT:", safeDiagnostic(error));
    const status = Number(error?.status || 500);
    return res.status(status >= 400 && status < 500 ? status : 500).json({
      message: status >= 400 && status < 500 ? error.message : "Unable to book appointment.",
    });
  }
});

router.patch("/appointments/:id/cancel", async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found." });
    if (appointment.status !== "booked") return res.status(409).json({ message: "Only a booked appointment can be cancelled before check-in." });
    appointment.status = "cancelled";
    appointment.cancelledAt = new Date();
    appointment.cancellationReason = String(req.body.reason || "Cancelled by reception").trim().slice(0, 300) || "Cancelled by reception";
    appointment.cancelledByRole = "receptionist";
    appointment.slotKey = undefined;
    await appointment.save();
    emitOperationalUpdate(req.app.get("io"), ["appointments", "analytics"]);
    return res.json({ message: "Appointment cancelled and slot released.", appointment });
  } catch (error) {
    return res.status(500).json({ message: publicErrorMessage(error, "Unable to cancel appointment.") });
  }
});

router.patch("/appointments/:id/reschedule", async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    const updated = await rescheduleAppointment({
      appointment,
      tenantId: req.tenantId,
      department: req.body.department,
      doctorId: req.body.doctorId,
      appointmentDate: String(req.body.appointmentDate || ""),
      startTime: String(req.body.startTime || ""),
      reason: req.body.reason,
      actorRole: "receptionist",
    });
    emitOperationalUpdate(req.app.get("io"), ["appointments", "analytics"]);
    return res.json({ message: `Appointment rescheduled to ${updated.appointmentDate} at ${updated.startTime}.`, appointment: updated });
  } catch (error) {
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to reschedule appointment.") });
  }
});

router.patch("/appointments/:id/missed", async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found." });
    if (appointment.status !== "booked") return res.status(409).json({ message: "Only an unchecked booked appointment can be marked missed." });
    appointment.status = "missed";
    appointment.missedAt = new Date();
    appointment.slotKey = undefined;
    await appointment.save();
    emitOperationalUpdate(req.app.get("io"), ["appointments", "analytics"]);
    return res.json({ message: "Appointment marked missed. It can be rescheduled to a new slot.", appointment });
  } catch {
    return res.status(500).json({ message: "Unable to mark appointment missed." });
  }
});

router.post("/appointments/:id/check-in", async (req, res) => {
  try {
    const result = await checkInAppointment({ appointmentId: req.params.id, io: req.app.get("io"), requireToday: true, payment: req.body.payment || {}, actorId: req.user.id });
    return res.status(result.alreadyCheckedIn ? 200 : 201).json(result);
  } catch (error) {
    console.error("APPOINTMENT CHECKIN:", safeDiagnostic(error));
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to check in appointment."), availability: error.availability });
  }
});

export default router;