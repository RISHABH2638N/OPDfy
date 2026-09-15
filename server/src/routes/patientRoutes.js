import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import Patient from "../models/Patient.js";
import GlobalPatient from "../models/GlobalPatient.js";
import Token from "../models/Token.js";
import Consultation from "../models/Consultation.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import FollowUpPlan from "../models/FollowUpPlan.js";
import { findFollowUpSource, validateFollowUpBooking, reconcileFollowUpPlan, ensureFollowUpPlan } from "../services/followUpService.js";
import Notification from "../models/Notification.js";
import Tenant from "../models/Tenant.js";
import { DEPARTMENTS, normalizeDepartment } from "../utils/departments.js";
import { getDoctorAvailability, onlyAvailableDoctors } from "../utils/doctorAvailability.js";
import { availableDateOptions, buildSlots, isDoctorWorkingOnDate } from "../utils/appointmentSlots.js";
import { checkInAppointment, hospitalToday } from "../services/appointmentCheckIn.js";
import QueueReservation from "../models/QueueReservation.js";
import { createOnlineQueueReservation, expireOldQueueReservations, hospitalDate } from "../services/queueReservationService.js";
import { getTokenWaitEstimate } from "../utils/waitTime.js";
import { notifyAppointmentBooked, processQueueNotifications } from "../services/notificationService.js";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  SLOT_OCCUPYING_APPOINTMENT_STATUSES,
  markMissedAppointments,
} from "../services/appointmentLifecycleService.js";
import { emitOperationalUpdate, emitQueueUpdate } from "../services/realtimeService.js";
import { applyClinicSlotRules, assertAppointmentSlotAllowed, filterClinicAppointmentDates } from "../utils/clinicOperations.js";
import { rescheduleAppointment } from "../services/appointmentRescheduleService.js";
import { quoteVisitFee } from "../utils/billing.js";
import { withDoctorRatings } from "../services/doctorRatings.js";
import ClinicalConsent from "../models/ClinicalConsent.js";
import { appendConsentEvent, effectiveConsentStatus, normalizePersonName } from "../utils/clinicalConsent.js";
import { createPatientNotification } from "../services/notificationService.js";
import { logSecurityEvent } from "../utils/securityEvents.js";

import { protectPatient } from "../middleware/patientAuth.js";

const router = asyncRouter();


/* =========================================================
   HELPER
========================================================= */

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}


/* =========================================================
   GET CURRENT PATIENT PROFILE

   GET /api/patients/me
========================================================= */

router.get(
  "/me",
  protectPatient,
  async (req, res) => {
    try {
      const patient =
        await Patient.findById(
          req.patient._id
        );

      if (!patient) {
        return res.status(404).json({
          message:
            "Patient profile not found.",
        });
      }

      return res.json({
        patient,
        identityReviewRequired: Boolean(req.patientIdentityReviewRequired),
      });

    } catch (error) {
      console.error(
        "Get patient profile error:",
        safeDiagnostic(error)
      );

      return res.status(500).json({
        message:
          "Unable to load patient profile.",
      });
    }
  }
);


/* =========================================================
   UPDATE CURRENT PATIENT PROFILE

   PUT /api/patients/me
========================================================= */

router.put(
  "/me",
  protectPatient,
  async (req, res) => {
    try {
      const {
        name,
        phone,
        dateOfBirth,
        gender,
        bloodGroup,
        allergies,
        medicalHistory,
        currentMedications,
        pastSurgeries,
        emergencyContact,
      } = req.body;


      /* -----------------------------------------------------
         REQUIRED PROFILE FIELD
      ----------------------------------------------------- */

      if (
        !name ||
        !String(name).trim()
      ) {
        return res.status(400).json({
          message:
            "Patient name is required.",
        });
      }


      /* -----------------------------------------------------
         PHONE VALIDATION
      ----------------------------------------------------- */

      const cleanPhone =
        String(phone || "")
          .replace(/\D/g, "")
          .trim();

      if (
        cleanPhone &&
        !/^[6-9]\d{9}$/.test(
          cleanPhone
        )
      ) {
        return res.status(400).json({
          message:
            "Please enter a valid 10-digit mobile number.",
        });
      }


      /* -----------------------------------------------------
         GENDER VALIDATION
      ----------------------------------------------------- */

      const allowedGenders = [
        "",
        "Male",
        "Female",
        "Other",
      ];

      if (
        !allowedGenders.includes(
          gender || ""
        )
      ) {
        return res.status(400).json({
          message:
            "Invalid gender.",
        });
      }


      /* -----------------------------------------------------
         BLOOD GROUP VALIDATION
      ----------------------------------------------------- */

      const allowedBloodGroups = [
        "",
        "A+",
        "A-",
        "B+",
        "B-",
        "AB+",
        "AB-",
        "O+",
        "O-",
      ];

      if (
        !allowedBloodGroups.includes(
          bloodGroup || ""
        )
      ) {
        return res.status(400).json({
          message:
            "Invalid blood group.",
        });
      }


      /* -----------------------------------------------------
         FIND AUTHENTICATED PATIENT

         IMPORTANT:
         We use req.patient._id from JWT.

         We DO NOT use email from req.body.
      ----------------------------------------------------- */

      const patient =
        await Patient.findById(
          req.patient._id
        );

      if (!patient) {
        return res.status(404).json({
          message:
            "Patient profile not found.",
        });
      }


      /* -----------------------------------------------------
         UPDATE BASIC DETAILS
      ----------------------------------------------------- */

      patient.name =
        String(name).trim();


      /* -----------------------------------------------------
         PHONE

         If phone exists:
           save it.

         If phone is empty:
           remove the field completely.

         This is important because your Patient model
         uses a sparse unique phone index.
      ----------------------------------------------------- */

      if (cleanPhone) {
        patient.phone =
          cleanPhone;
      } else {
        patient.phone =
          undefined;
      }


      /* -----------------------------------------------------
         DATE OF BIRTH
      ----------------------------------------------------- */

      if (dateOfBirth) {
        const parsedDate =
          new Date(dateOfBirth);

        if (
          Number.isNaN(
            parsedDate.getTime()
          )
        ) {
          return res.status(400).json({
            message:
              "Invalid date of birth.",
          });
        }

        if (
          parsedDate > new Date()
        ) {
          return res.status(400).json({
            message:
              "Date of birth cannot be in the future.",
          });
        }

        patient.dateOfBirth =
          parsedDate;

      } else {
        patient.dateOfBirth =
          null;
      }


      /* -----------------------------------------------------
         GENDER
      ----------------------------------------------------- */

      patient.gender =
        gender || "";


      /* -----------------------------------------------------
         BLOOD GROUP
      ----------------------------------------------------- */

      patient.bloodGroup =
        bloodGroup || "";


      /* -----------------------------------------------------
         MEDICAL DETAILS
      ----------------------------------------------------- */

      patient.allergies =
        normalizeList(
          allergies
        );

      patient.medicalHistory =
        normalizeList(
          medicalHistory
        );

      patient.currentMedications =
        normalizeList(
          currentMedications
        );

      patient.pastSurgeries =
        normalizeList(
          pastSurgeries
        );


      /* -----------------------------------------------------
         EMERGENCY CONTACT
      ----------------------------------------------------- */

      const emergencyName =
        String(
          emergencyContact?.name ||
          ""
        ).trim();

      const emergencyPhone =
        String(
          emergencyContact?.phone ||
          ""
        )
          .replace(/\D/g, "")
          .trim();


      /* -----------------------------------------------------
         EMERGENCY PHONE VALIDATION
      ----------------------------------------------------- */

      if (
        emergencyPhone &&
        !/^[6-9]\d{9}$/.test(
          emergencyPhone
        )
      ) {
        return res.status(400).json({
          message:
            "Please enter a valid emergency contact phone number.",
        });
      }


      patient.emergencyContact = {
        name:
          emergencyName,

        phone:
          emergencyPhone,
      };


      /* -----------------------------------------------------
         PROFILE COMPLETE
      ----------------------------------------------------- */

      patient.profileCompleted =
        true;


      /* -----------------------------------------------------
         SAVE PATIENT

         Handle duplicate phone number properly.
      ----------------------------------------------------- */

      try {
        await patient.save();

        // SaaS Day 7 compatibility: the patient-owned global health profile is
        // authoritative for reusable demographics/medical history. Clinic
        // consultation notes, diagnoses and prescriptions remain tenant-only.
        if (req.globalPatient?._id) {
          await GlobalPatient.updateOne(
            { _id: req.globalPatient._id },
            {
              $set: {
                name: patient.name,
                phone: patient.phone || "",
                dateOfBirth: patient.dateOfBirth || null,
                gender: patient.gender || "",
                bloodGroup: patient.bloodGroup || "",
                allergies: patient.allergies || [],
                medicalHistory: patient.medicalHistory || [],
                currentMedications: patient.currentMedications || [],
                pastSurgeries: patient.pastSurgeries || [],
                emergencyContact: patient.emergencyContact || { name: "", phone: "" },
                profileCompleted: true,
                profileUpdatedAt: new Date(),
              },
            }
          );
        }

      } catch (saveError) {

        /* -----------------------------------------------
           MongoDB duplicate key
        ----------------------------------------------- */

        if (
          saveError?.code === 11000
        ) {
          const duplicateField =
            Object.keys(
              saveError.keyPattern || {}
            )[0];

          if (
            duplicateField === "phone"
          ) {
            return res.status(409).json({
              message:
                "This mobile number is already registered with another patient.",
            });
          }

          if (
            duplicateField === "email"
          ) {
            return res.status(409).json({
              message:
                "This email address is already registered.",
            });
          }

          if (
            duplicateField === "patientId"
          ) {
            return res.status(409).json({
              message:
                "Patient ID conflict. Please try again.",
            });
          }

          return res.status(409).json({
            message:
              "This patient information already exists.",
          });
        }

        throw saveError;
      }


      /* -----------------------------------------------------
         RESPONSE
      ----------------------------------------------------- */

      return res.json({
        message:
          "Patient profile updated successfully.",

        patient: {
          id:
            patient._id,

          patientId:
            patient.patientId,

          name:
            patient.name,

          phone:
            patient.phone || "",

          email:
            patient.email,

          dateOfBirth:
            patient.dateOfBirth,

          gender:
            patient.gender,

          bloodGroup:
            patient.bloodGroup,

          allergies:
            patient.allergies,

          medicalHistory:
            patient.medicalHistory,

          currentMedications:
            patient.currentMedications,

          pastSurgeries:
            patient.pastSurgeries || [],

          emergencyContact:
            patient.emergencyContact,

          profileCompleted:
            patient.profileCompleted,
        },
      });

    } catch (error) {
      console.error(
        "Update patient profile error:",
        safeDiagnostic(error)
      );

      return res.status(500).json({
        message:
          "Unable to update patient profile.",
      });
    }
  }
);


/* =========================================================
   LIST DOCTORS AVAILABLE TO PATIENT

   GET /api/patients/doctors?department=ENT
========================================================= */
router.get(
  "/doctors",
  protectPatient,
  async (req, res) => {
    try {
      const query = { role: "doctor" };
      if (req.query.department) {
        const department = normalizeDepartment(req.query.department);
        if (!DEPARTMENTS.includes(department)) {
          return res.status(400).json({ message: "Invalid department." });
        }
        query.department = department;
      }

      const doctors = await User.find(query)
        .select("_id name department doctorSchedule billingProfile prescriptionProfile.qualification prescriptionProfile.designation professionalVerification")
        .sort({ department: 1, name: 1 })
        .lean();

      return res.json({ doctors: await withDoctorRatings(onlyAvailableDoctors(doctors)) });
    } catch (error) {
      console.error("Patient doctor roster error:", safeDiagnostic(error));
      return res.status(500).json({ message: "Unable to load available doctors." });
    }
  }
);


/* =========================================================
   CREATE SAME-DAY ONLINE QUEUE RESERVATION

   POST /api/patients/me/tokens

   Important: online booking does NOT create a live queue token. The
   patient's final FCFS token number is created only after hospital
   arrival is confirmed by reception/QR check-in.
========================================================= */

router.post("/me/tokens", protectPatient, async (req, res) => {
  try {
    const requestedDepartment = normalizeDepartment(req.body.department || "General OPD");
    const patientUrgencyFlag =
      String(req.body.urgency || "normal").toLowerCase() === "emergency";
    // Patients may flag concern, but authoritative queue priority is staff-controlled.
    const requestedUrgency = "normal";
    const requestedDoctorId = String(req.body.doctorId || "");
    const consultationKind = String(req.body.consultationKind || "normal") === "follow_up" ? "follow_up" : "normal";

    if (!DEPARTMENTS.includes(requestedDepartment)) {
      return res.status(400).json({ message: "Invalid department." });
    }

    const patient = await Patient.findById(req.patient._id);
    if (!patient) return res.status(404).json({ message: "Patient profile not found." });
    if (!patient.profileCompleted) {
      return res.status(400).json({
        message: "Please complete your patient profile before reserving a queue place.",
      });
    }
    if (!patient.name?.trim()) {
      return res.status(400).json({ message: "Patient name is missing from your profile." });
    }

    if (!requestedDoctorId.match(/^[a-f\d]{24}$/i)) {
      return res.status(400).json({
        message: `Please select a ${requestedDepartment} specialist before reserving.`,
      });
    }

    const selectedDoctor = await User.findOne({
      _id: requestedDoctorId,
      role: "doctor",
      department: requestedDepartment,
    }).select("_id name department doctorSchedule billingProfile");

    if (!selectedDoctor) {
      return res.status(409).json({
        message: `The selected doctor is not available in ${requestedDepartment}. Please select another specialist.`,
      });
    }

    const doctorAvailability = getDoctorAvailability(selectedDoctor);
    if (!doctorAvailability.isAvailable) {
      return res.status(409).json({
        message: doctorAvailability.reason,
        availability: doctorAvailability,
      });
    }

    const reservation = await createOnlineQueueReservation({
      tenantId: req.tenantId,
      patient,
      doctor: selectedDoctor,
      department: requestedDepartment,
      urgency: requestedUrgency,
      consultationKind,
      patientRequestedUrgency: patientUrgencyFlag ? "emergency" : "",
    });

    emitOperationalUpdate(req.app.get("io"), ["reservations"]);

    return res.status(201).json({
      message:
        "Online reservation confirmed. Your final FCFS token will be issued only after you arrive and check in at reception/QR scanner.",
      reservation,
      doctor: {
        _id: selectedDoctor._id,
        name: selectedDoctor.name,
        department: selectedDoctor.department,
      },
    });
  } catch (error) {
    console.error("Patient queue reservation error:", safeDiagnostic(error));
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "You already have an active online reservation for today.",
      });
    }
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Unable to reserve OPD queue place.",
      reservation: error.reservation,
    });
  }
});

/* =========================================================
   GET LOGGED-IN PATIENT TOKEN HISTORY

   GET /api/patients/me/tokens
========================================================= */

router.get(
  "/me/tokens",
  protectPatient,
  async (req, res) => {
    try {
      await expireOldQueueReservations();

      const tokens =
        await Token.find({
          patient:
            req.patient._id,
        }).sort({
          createdAt: -1,
        });

      const reservations = await QueueReservation.find({
        patient: req.patient._id,
      })
        .sort({ createdAt: -1 })
        .lean();

      return res.json({
        tokens,
        reservations,
      });

    } catch (error) {
      console.error(
        "Patient token history error:",
        safeDiagnostic(error)
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to load OPD history.",
        });
    }
  }
);



/* =========================================================
   PATIENT WAITING LOUNGE ACCESS

   Access is granted only inside the currently selected clinic when the
   patient has either a confirmed same-day online reservation or a live
   queue token. Switching clinic slugs requires a fresh entitlement there.
========================================================= */
router.get("/me/lounge-access", protectPatient, async (req, res) => {
  try {
    await expireOldQueueReservations();
    const today = hospitalDate();

    const [reservation, activeToken] = await Promise.all([
      QueueReservation.findOne({
        patient: req.patient._id,
        reservationDate: today,
        status: { $in: ["reserved", "checked_in"] },
      })
        .select("_id status department doctorName reservationDate")
        .lean(),
      Token.findOne({
        patient: req.patient._id,
        isArchived: { $ne: true },
        status: { $in: ["waiting", "called"] },
      })
        .select("_id tokenNumber status department queueSource")
        .lean(),
    ]);

    const allowed = Boolean(reservation || activeToken);
    return res.json({
      allowed,
      clinicSlug: req.tenant?.slug || "",
      source: activeToken ? "live_token" : reservation ? "reservation" : null,
      reservation: reservation || null,
      token: activeToken || null,
    });
  } catch (error) {
    console.error("PATIENT WAITING LOUNGE ACCESS:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to verify waiting lounge access." });
  }
});

router.patch("/me/reservations/:id/cancel", protectPatient, async (req, res) => {
  try {
    const reservation = await QueueReservation.findOne({
      _id: req.params.id,
      patient: req.patient._id,
    });
    if (!reservation) return res.status(404).json({ message: "Reservation not found." });
    if (reservation.status !== "reserved") {
      return res.status(409).json({ message: "Only an unconfirmed reservation can be cancelled." });
    }
    reservation.status = "cancelled";
    reservation.cancelledAt = new Date();
    await reservation.save();
    emitOperationalUpdate(req.app.get("io"), ["reservations"]);
    return res.json({ message: "Online queue reservation cancelled.", reservation });
  } catch (error) {
    console.error("PATIENT RESERVATION CANCELLATION:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to cancel reservation." });
  }
});

router.get("/me/reservations/:id/check-in-qr", protectPatient, async (req, res) => {
  try {
    const reservation = await QueueReservation.findOne({
      _id: req.params.id,
      patient: req.patient._id,
      status: "reserved",
      reservationDate: hospitalDate(),
    }).lean();
    if (!reservation) {
      return res.status(404).json({ message: "Today's active reservation was not found." });
    }
    const checkInToken = jwt.sign(
      { type: "queue-reservation-checkin", reservationId: reservation._id.toString() },
      process.env.QR_JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : process.env.JWT_SECRET),
      { expiresIn: "24h" }
    );
    return res.json({ reservation, checkInToken });
  } catch (error) {
    console.error("PATIENT QUEUE RESERVATION QR:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to generate reservation QR." });
  }
});

/* =========================================================
   CURRENT PATIENT DYNAMIC WAIT ESTIMATE

   GET /api/patients/me/eta
========================================================= */

router.get(
  "/me/eta",
  protectPatient,
  async (req, res) => {
    try {
      const token = await Token.findOne({
        patient: req.patient._id,
        isArchived: { $ne: true },
        status: { $in: ["waiting", "called"] },
      })
        .sort({ createdAt: -1 })
        .lean();

      if (!token) {
        return res.json({
          active: false,
          eta: null,
        });
      }

      const eta = await getTokenWaitEstimate(token);

      return res.json({
        active: true,
        eta,
      });
    } catch (error) {
      console.error(
        "Patient ETA error:",
        safeDiagnostic(error)
      );

      return res.status(500).json({
        message:
          "Unable to calculate live waiting time.",
      });
    }
  }
);



/* =========================================================
   PATIENT LAB REFERRAL STATUS
========================================================= */

router.patch(
  "/me/consultations/:id/lab-referral/complete",
  protectPatient,
  async (req, res) => {
    try {
      const consultation = await Consultation.findOne({
        _id: req.params.id,
        patient: req.patient._id,
        status: "completed",
      });

      if (!consultation) {
        return res.status(404).json({ message: "Consultation record not found." });
      }

      if (!consultation.labReferral?.enabled || !consultation.testsRecommended?.length) {
        return res.status(409).json({ message: "No lab referral exists for this consultation." });
      }

      if (consultation.labReferral.status === "completed") {
        return res.json({ message: "Lab referral is already marked completed.", consultation });
      }

      consultation.labReferral.status = "completed";
      consultation.labReferral.completedAt = new Date();
      await consultation.save();

      return res.json({ message: "Lab referral marked as completed.", consultation });
    } catch (error) {
      console.error("Complete lab referral error:", safeDiagnostic(error));
      return res.status(500).json({ message: "Unable to update lab referral status." });
    }
  }
);

/* =========================================================
   PATIENT CONSULTATION HISTORY

   GET /api/patients/me/consultations
========================================================= */

router.get(
  "/me/consultations",
  protectPatient,
  async (req, res) => {
    try {
      const consultations =
        await Consultation.find({
          patient:
            req.patient._id,
        })
          .populate(
            "doctor",
            "name department prescriptionProfile"
          )
          .populate(
            "token",
            "tokenNumber department"
          )
          .sort({
            createdAt: -1,
          });

      return res.json({
        consultations,
      });

    } catch (error) {
      console.error(
        "Patient consultation history error:",
        safeDiagnostic(error)
      );

      return res.status(500).json({
        message:
          "Unable to load consultation history.",
      });
    }
  }
);



/* =========================================================
   APPOINTMENT BOOKING
========================================================= */
router.get("/appointment-doctors", protectPatient, async (req, res) => {
  try {
    const department = normalizeDepartment(req.query.department || "General OPD");
    if (!DEPARTMENTS.includes(department)) return res.status(400).json({ message: "Invalid department." });
    const doctors = await User.find({ role: "doctor", department })
      .select("_id name department doctorSchedule billingProfile prescriptionProfile.qualification prescriptionProfile.designation professionalVerification").sort({ name: 1 }).lean();
    return res.json({ doctors: await withDoctorRatings(doctors) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load appointment doctors." });
  }
});

router.get("/appointment-doctors/:doctorId/dates", protectPatient, async (req, res) => {
  try {
    const [doctor, tenant] = await Promise.all([
      User.findOne({ _id: req.params.doctorId, role: "doctor" }).select("_id name department doctorSchedule billingProfile").lean(),
      Tenant.findById(req.tenantId).select("timezone settings.operations settings.billing").lean(),
    ]);
    if (!doctor) return res.status(404).json({ message: "Doctor not found." });
    const dates = availableDateOptions(doctor, 30, new Date(), tenant?.timezone);
    return res.json({ dates: filterClinicAppointmentDates(tenant, dates) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load available dates." });
  }
});

router.get("/appointment-doctors/:doctorId/slots", protectPatient, async (req, res) => {
  try {
    const date = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "Select a valid appointment date." });
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
    const slots = buildSlots(doctor, date, booked.map(x => x.startTime), new Date(), tenant?.timezone);
    return res.json(applyClinicSlotRules(tenant, date, slots));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load appointment slots." });
  }
});

// Follow-up history is restricted to the authenticated clinic-local patient.
// It exposes scheduling metadata only, never diagnoses or prescription contents.
router.get("/me/follow-ups", protectPatient, async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select("name timezone settings.displayName").lean();
    const sources = await Consultation.find({
      patient: req.patient._id, status: "completed", followUpDate: { $ne: null },
    }).select("_id patient doctor department followUpDate createdAt")
      .sort({ createdAt: -1 }).limit(100).lean();
    const plans = [];
    for (const source of sources) {
      const plan = await ensureFollowUpPlan(source, tenant);
      const current = await reconcileFollowUpPlan(plan);
      if (current) plans.push(current);
    }
    const results = [];
    for (const plan of plans) {
      const doctor = await User.findById(plan.doctor).select("name department doctorSchedule.roomNumber").lean();
      const appointment = plan.appointment ? await Appointment.findById(plan.appointment)
        .select("_id status appointmentDate startTime doctorName department").lean() : null;
      results.push({
        _id: plan._id, consultationId: plan.consultation, dueDate: plan.dueDate,
        status: plan.status, doctorId: plan.doctor,
        doctorName: doctor?.name || plan.doctorName || "Your doctor",
        department: plan.department, roomNumber: doctor?.doctorSchedule?.roomNumber || "",
        clinicName: tenant?.settings?.displayName || tenant?.name || "",
        appointment,
      });
    }
    return res.json({ followUps: results });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load follow-up history." });
  }
});

router.get("/me/notifications", protectPatient, async (req, res) => {
  try {
    const notificationFilter = { patient: req.patient._id };
    if (req.query.category === "followups") {
      notificationFilter.type = { $in: ["follow_up_reminder", "follow_up_pending"] };
    }
    const notifications = await Notification.find(notificationFilter)
      .sort({ createdAt: -1 })
      .limit(req.query.category === "followups" ? 200 : 100)
      .lean();

    const unreadCount = await Notification.countDocuments({
      patient: req.patient._id, readAt: null,
    });

    return res.json({ notifications, unreadCount });
  } catch (error) {
    console.error("PATIENT NOTIFICATIONS:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load notifications." });
  }
});

router.patch("/me/notifications/read-all", protectPatient, async (req, res) => {
  try {
    await Notification.updateMany(
      { patient: req.patient._id, readAt: null },
      { $set: { readAt: new Date() } }
    );

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Unable to mark notifications as read." });
  }
});

router.patch("/me/notifications/:id/read", protectPatient, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        patient: req.patient._id,
      },
      { $set: { readAt: new Date() } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: "Notification not found." });
    }

    return res.json({ notification });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update notification." });
  }
});


router.get("/me/fee-quote", protectPatient, async (req, res) => {
  try {
    const doctorId = String(req.query.doctorId || "");
    const visitType = ["reservation", "appointment"].includes(String(req.query.visitType)) ? String(req.query.visitType) : "appointment";
    const urgency = String(req.query.urgency || "normal") === "emergency" ? "emergency" : "normal";
    const consultationKind = String(req.query.consultationKind || "normal") === "follow_up" ? "follow_up" : "normal";
    const serviceDate = String(req.query.serviceDate || "").trim();
    if (!doctorId.match(/^[a-f\d]{24}$/i)) return res.status(400).json({ message: "Select a doctor." });
    const [doctor, tenant] = await Promise.all([
      User.findOne({ _id: doctorId, role: "doctor" }).select("_id name department billingProfile").lean(),
      Tenant.findById(req.tenantId).select("settings.billing").lean(),
    ]);
    if (!doctor) return res.status(404).json({ message: "Doctor not found." });
    const quote = await quoteVisitFee({ doctor, tenant, department: doctor.department, patientId: req.patient._id, visitType, urgency, consultationKind, serviceDate });
    return res.json({ quote });
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Unable to calculate consultation fee.",
      code: error.code,
      followUp: error.followUp,
    });
  }
});

router.get("/me/appointments", protectPatient, async (req, res) => {
  try {
    await markMissedAppointments();
    const appointments = await Appointment.find({ patient: req.patient._id })
      .sort({ appointmentDate: -1, startTime: -1 }).lean();
    return res.json({ appointments });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load appointments." });
  }
});

router.post("/me/appointments", protectPatient, async (req, res) => {
  try {
    const department = normalizeDepartment(req.body.department || "General OPD");
    const doctorId = String(req.body.doctorId || "");
    const appointmentDate = String(req.body.appointmentDate || "");
    const startTime = String(req.body.startTime || "");
    if (!DEPARTMENTS.includes(department)) return res.status(400).json({ message: "Invalid department." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) return res.status(400).json({ message: "Select a valid appointment date." });
    if (!doctorId.match(/^[a-f\d]{24}$/i)) return res.status(400).json({ message: "Select a doctor." });
    const [doctor, tenant] = await Promise.all([
      User.findOne({ _id: doctorId, role: "doctor", department }).select("_id name department doctorSchedule billingProfile").lean(),
      Tenant.findById(req.tenantId).select("timezone settings.operations settings.billing").lean(),
    ]);
    if (!doctor) return res.status(409).json({ message: "Selected doctor does not belong to this department." });
    const working = isDoctorWorkingOnDate(doctor, appointmentDate, tenant?.timezone);
    if (!working.ok) return res.status(409).json({ message: working.reason });
    assertAppointmentSlotAllowed(tenant, appointmentDate, startTime);
    const booked = await Appointment.find({
      doctor: doctor._id,
      appointmentDate,
      status: { $in: SLOT_OCCUPYING_APPOINTMENT_STATUSES },
    }).select("startTime").lean();
    const slotResult = applyClinicSlotRules(tenant, appointmentDate, buildSlots(doctor, appointmentDate, booked.map(x => x.startTime), new Date(), tenant?.timezone));
    const slot = slotResult.slots.find(x => x.startTime === startTime);
    if (!slot) return res.status(409).json({ message: "That appointment slot is no longer available. Please choose another." });
    const patient = await Patient.findById(req.patient._id);
    if (!patient?.profileCompleted) return res.status(400).json({ message: "Complete your patient profile before booking." });
    const duplicatePatient = await Appointment.findOne({
      patient: patient._id,
      appointmentDate,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
    });
    if (duplicatePatient) return res.status(409).json({ message: `You already have an active appointment on ${appointmentDate}.` });
    const slotKey = `${doctor._id}:${appointmentDate}:${startTime}`;
    const consultationKind = String(req.body.consultationKind || "normal") === "follow_up" ? "follow_up" : "normal";
    const feeQuote = await quoteVisitFee({ doctor, tenant, department, patientId: patient._id, visitType: "appointment", consultationKind, serviceDate: appointmentDate });
    const followUpPlan = consultationKind === "follow_up"
      ? await validateFollowUpBooking({ patientId: patient._id, doctorId: doctor._id,
          consultationId: String(req.body.followUpConsultationId || ""), tenant, serviceDate: appointmentDate })
      : null;
    if (req.body.followUpConsultationId && !followUpPlan) {
      return res.status(400).json({ message: "A follow-up reference requires a follow-up consultation booking." });
    }
    try {
      const appointment = await Appointment.create({
        tenantId: req.tenantId,
        patient: patient._id, patientId: patient.patientId, patientName: patient.name,
        phone: patient.phone || "", doctor: doctor._id, doctorName: doctor.name, department,
        appointmentDate, startTime, endTime: slot.endTime, reason: String(req.body.reason || "").trim(),
        bookingSource: "patient", slotKey,
        followUpConsultation: followUpPlan?.consultation || null,
        billing: { feeType: feeQuote.feeType, quotedAmount: feeQuote.amount, status: "pending" },
      });

      if (followUpPlan) await reconcileFollowUpPlan(followUpPlan);
      const io = req.app.get("io");
      emitOperationalUpdate(io, ["appointments", "analytics"]);
      await notifyAppointmentBooked(appointment, io);

      return res.status(201).json({ appointment });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ message: "That slot was just booked. Please choose another." });
      throw error;
    }
  } catch (error) {
    console.error("PATIENT APPOINTMENT:", safeDiagnostic(error));
    const status = Number(error?.status || 500);
    return res.status(status >= 400 && status < 500 ? status : 500).json({
      message: status >= 400 && status < 500 ? error.message : "Unable to book appointment.",
    });
  }
});



router.patch("/me/appointments/:id/cancel", protectPatient, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      patient: req.patient._id,
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found." });
    }

    if (appointment.status === "cancelled") {
      return res.status(409).json({ message: "This appointment is already cancelled." });
    }

    if (appointment.status !== "booked") {
      return res.status(409).json({
        message: "Only a booked appointment can be cancelled before check-in.",
      });
    }

    const today = hospitalToday();

    if (appointment.appointmentDate < today) {
      return res.status(409).json({
        message: "Past appointments cannot be cancelled.",
      });
    }

    const cancellationReason = String(req.body?.reason || "Cancelled by patient").trim().slice(0, 300);
    appointment.status = "cancelled";
    appointment.cancelledAt = new Date();
    appointment.cancellationReason = cancellationReason || "Cancelled by patient";
    appointment.cancelledByRole = "patient";

    // Release the doctor's unique slot so another patient can book it.
    appointment.slotKey = undefined;

    await appointment.save();
    emitOperationalUpdate(req.app.get("io"), ["appointments", "analytics"]);

    return res.json({
      message: `Appointment with Dr. ${appointment.doctorName} on ${appointment.appointmentDate} at ${appointment.startTime} has been cancelled. The slot is available again.`,
      appointment,
    });
  } catch (error) {
    console.error("PATIENT APPOINTMENT CANCELLATION:", safeDiagnostic(error));
    return res.status(500).json({
      message: publicErrorMessage(error, "Unable to cancel appointment."),
    });
  }
});


router.patch("/me/appointments/:id/reschedule", protectPatient, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, patient: req.patient._id });
    if (!appointment) return res.status(404).json({ message: "Appointment not found." });
    const updated = await rescheduleAppointment({
      appointment,
      tenantId: req.tenantId,
      department: req.body.department,
      doctorId: req.body.doctorId,
      appointmentDate: String(req.body.appointmentDate || ""),
      startTime: String(req.body.startTime || ""),
      reason: req.body.reason,
      actorRole: "patient",
    });
    emitOperationalUpdate(req.app.get("io"), ["appointments", "analytics"]);
    return res.json({ message: `Appointment rescheduled to ${updated.appointmentDate} at ${updated.startTime}.`, appointment: updated });
  } catch (error) {
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to reschedule appointment.") });
  }
});

router.get("/me/appointments/:id/check-in-qr", protectPatient, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      patient: req.patient._id,
    })
      .select(
        "_id patient patientName doctorName department appointmentDate startTime endTime status token"
      )
      .lean();

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found.",
      });
    }

    if (["cancelled", "completed", "skipped", "missed"].includes(appointment.status)) {
      return res.status(409).json({
        message: "A check-in QR is not available for this appointment.",
      });
    }

    const checkInToken = jwt.sign(
      {
        type: "appointment-checkin",
        appointmentId: appointment._id.toString(),
      },
      process.env.QR_JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : process.env.JWT_SECRET),
      {
        // Check-in service also enforces the exact appointment date/status.
        // A dedicated secret limits blast radius if an auth or QR key leaks.
        expiresIn: "45d",
      }
    );

    return res.json({
      appointment,
      checkInToken,
    });
  } catch (error) {
    console.error("PATIENT APPOINTMENT QR:", safeDiagnostic(error));
    return res.status(500).json({
      message: "Unable to generate appointment QR.",
    });
  }
});

router.get("/me/today-appointment", protectPatient, async (req, res) => {
  try {
    const today = hospitalToday();

    const appointments = await Appointment.find({
      patient: req.patient._id,
      appointmentDate: today,
      status: { $in: ["booked", "checked_in"] },
    }).sort({ startTime: 1 }).lean();

    const missing = appointments.filter((item) => item.status === "booked" && item.billing?.quotedAmount === undefined);
    if (missing.length) {
      const tenant = await Tenant.findById(req.tenantId).select("settings.billing").lean();
      const doctorIds = [...new Set(missing.map((item) => String(item.doctor)).filter(Boolean))];
      const doctors = await User.find({ _id: { $in: doctorIds }, role: "doctor" }).select("_id department billingProfile").lean();
      const doctorMap = new Map(doctors.map((doctor) => [String(doctor._id), doctor]));
      await Promise.all(appointments.map(async (item) => {
        if (item.status !== "booked" || item.billing?.quotedAmount !== undefined) return;
        const doctor = doctorMap.get(String(item.doctor));
        if (!doctor) return;
        const quote = await quoteVisitFee({ doctor, tenant, department: item.department, patientId: req.patient._id, visitType: "appointment" });
        item.billing = { ...(item.billing || {}), feeType: quote.feeType, quotedAmount: quote.amount, status: "pending" };
      }));
    }

    return res.json({ date: today, appointments });
  } catch (error) {
    console.error("PATIENT TODAY APPOINTMENT:", safeDiagnostic(error));
    return res.status(500).json({
      message: "Unable to load today's appointment.",
    });
  }
});

router.post("/me/check-in-today", protectPatient, async (req, res) => {
  try {
    const today = hospitalToday();
    const appointmentId = String(req.body.appointmentId || "");

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      patient: req.patient._id,
      appointmentDate: today,
      status: { $in: ["booked", "checked_in"] },
    })
      .select("_id")
      .lean();

    if (!appointment) {
      return res.status(404).json({
        message: "Today's appointment was not found.",
      });
    }

    const result = await checkInAppointment({
      appointmentId: appointment._id,
      io: req.app.get("io"),
      requireToday: true,
    });

    return res.status(result.alreadyCheckedIn ? 200 : 201).json({
      message: result.alreadyCheckedIn
        ? `You are already checked in with token #${result.token?.tokenNumber ?? "—"}.`
        : `Check-in successful. Your live OPD token is #${result.token.tokenNumber}.`,
      ...result,
    });
  } catch (error) {
    console.error("PATIENT SELF CHECK-IN:", safeDiagnostic(error));
    return res.status(error.status || 500).json({
      message: publicErrorMessage(error, "Unable to check in."),
      availability: error.availability,
    });
  }
});

/* =========================================================
   TREATMENT & PROCEDURE CONSENT
   Authenticated acknowledgement record; not a digital signature and never an
   automatic gate for emergency care.
========================================================= */

function patientConsentView(consent) {
  const value = typeof consent.toObject === "function" ? consent.toObject() : consent;
  const events = (value.events || []).map(({ action, actorType, actorRole, note, at }) => ({ action, actorType, actorRole, note, at }));
  return {
    _id: value._id, category: value.category, title: value.title, explanation: value.explanation,
    expectedBenefits: value.expectedBenefits, materialRisks: value.materialRisks, alternatives: value.alternatives,
    refusalConsequences: value.refusalConsequences, language: value.language, noticeVersion: value.noticeVersion,
    status: value.status, effectiveStatus: effectiveConsentStatus(value), validUntil: value.validUntil,
    patientDecision: value.patientDecision, createdAt: value.createdAt, updatedAt: value.updatedAt, events,
    requestedBy: value.requestedBy && typeof value.requestedBy === "object" ? { name: value.requestedBy.name || "Clinic staff", role: value.requestedBy.role || "staff" } : { name: "Clinic staff", role: "staff" },
    doctor: value.doctor && typeof value.doctor === "object" ? { name: value.doctor.name || "", department: value.doctor.department || "", prescriptionProfile: value.doctor.prescriptionProfile || {} } : null,
    staffReview: value.staffReview ? { reviewedAt: value.staffReview.reviewedAt || null, guardianAuthorityChecked: Boolean(value.staffReview.guardianAuthorityChecked), questionsAnswered: Boolean(value.staffReview.questionsAnswered) } : null,
  };
}

router.get("/me/clinical-consents", protectPatient, async (req, res) => {
  const consents = await ClinicalConsent.find({ patient: req.patient._id })
    .select("-staffReview.note")
    .populate("doctor", "name department prescriptionProfile.qualification prescriptionProfile.designation")
    .populate("requestedBy", "name role")
    .sort({ createdAt: -1 }).limit(100).lean();
  return res.json({ consents: consents.map(patientConsentView) });
});

router.post("/me/clinical-consents/:id/decision", protectPatient, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid consent identifier." });
    const consent = await ClinicalConsent.findOne({ _id: req.params.id, patient: req.patient._id });
    if (!consent) return res.status(404).json({ message: "Consent request not found." });
    if (effectiveConsentStatus(consent) === "expired") return res.status(409).json({ message: "This consent request has expired. Ask the clinic for a new request." });
    if (consent.status !== "pending") return res.status(409).json({ message: "A decision has already been recorded for this request." });
    const decision = String(req.body.decision || "");
    if (!["acknowledged", "declined"].includes(decision)) return res.status(400).json({ message: "Choose acknowledge or decline." });
    if (decision === "acknowledged" && req.patientIdentityReviewRequired) return res.status(409).json({ code: "PATIENT_IDENTITY_REVIEW_REQUIRED", message: "Clinic identity review is required before recording a treatment acknowledgement. You may still decline or contact the clinic." });
    const actorType = String(req.body.actorType || "self");
    if (!["self", "guardian"].includes(actorType)) return res.status(400).json({ message: "Choose self or guardian acknowledgement." });
    const typedName = String(req.body.typedName || "").trim();
    if (typedName.length < 2 || typedName.length > 120) return res.status(400).json({ message: "Type the acknowledging person's full name." });
    if (actorType === "self" && normalizePersonName(typedName) !== normalizePersonName(req.patient.name)) return res.status(400).json({ message: "Typed name must match the patient profile name." });
    const guardianRelationship = actorType === "guardian" ? String(req.body.guardianRelationship || "").trim() : "";
    if (actorType === "guardian" && (guardianRelationship.length < 2 || guardianRelationship.length > 80 || req.body.authorityDeclared !== true)) return res.status(400).json({ message: "Guardian relationship and authority declaration are required." });
    const language = String(req.body.language || "en");
    if (!["en", "hi"].includes(language)) return res.status(400).json({ message: "Consent language must be English or Hindi." });
    if (decision === "acknowledged" && [req.body.understood, req.body.voluntary, req.body.questionsOpportunity].some((value) => value !== true)) return res.status(400).json({ message: "All acknowledgement confirmations are required." });
    const at = new Date();
    consent.patientDecision = { decision, actorType, typedName, guardianRelationship, authorityDeclared: actorType === "guardian", language, declarationVersion: "clinical-consent-v1", recordedAt: at };
    consent.status = decision === "declined" ? "declined" : actorType === "guardian" ? "patient_acknowledged" : "active";
    appendConsentEvent(consent, { action: decision, actorType: actorType === "guardian" ? "guardian" : "patient", actorId: req.patient._id, actorRole: actorType, note: decision === "declined" ? "Consent declined by authenticated patient account." : actorType === "guardian" ? "Guardian acknowledgement recorded; clinic authority review required." : "Patient acknowledgement recorded." });
    await consent.save();
    try {
      await createPatientNotification({ patientId: req.patient._id, type: decision === "declined" ? "clinical_consent_declined" : "clinical_consent_recorded", title: decision === "declined" ? "Consent declined" : "Consent acknowledgement recorded", message: decision === "declined" ? `You declined “${consent.title}”. Contact the clinic if you want to discuss alternatives.` : actorType === "guardian" ? `Acknowledgement for “${consent.title}” is waiting for clinic guardian-authority review.` : `Your acknowledgement for “${consent.title}” has been recorded.`, metadata: { consentId: consent._id }, dedupeKey: `clinical-consent:${consent._id}:${decision}`, io: req.app.get("io") });
    } catch (notificationError) {
      // The clinical decision is already saved. A secondary notification failure
      // must not make the patient repeat or doubt the recorded acknowledgement.
      console.error("Clinical consent notification error:", notificationError.message);
    }
    logSecurityEvent(req, { event: `clinical_consent_${decision}`, outcome: "success", actorType: "patient", actorId: req.patient._id, tenantId: req.tenantId });
    const populated = await ClinicalConsent.findById(consent._id).populate("doctor", "name department prescriptionProfile.qualification prescriptionProfile.designation").populate("requestedBy", "name role").lean();
    return res.json({ message: decision === "declined" ? "Consent declined and recorded." : actorType === "guardian" ? "Guardian acknowledgement recorded. Clinic review is required before activation." : "Consent acknowledgement recorded.", consent: patientConsentView(populated) });
  } catch (error) { return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to record consent decision.") }); }
});

router.post("/me/clinical-consents/:id/withdraw", protectPatient, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid consent identifier." });
    const consent = await ClinicalConsent.findOne({ _id: req.params.id, patient: req.patient._id });
    if (!consent) return res.status(404).json({ message: "Consent request not found." });
    if (!["active", "patient_acknowledged"].includes(consent.status)) return res.status(409).json({ message: "Only an active acknowledgement can be withdrawn." });
    const reason = String(req.body.reason || "").trim();
    if (reason && (reason.length < 5 || reason.length > 500)) return res.status(400).json({ message: "Withdrawal reason must be between 5 and 500 characters when provided." });
    consent.status = "withdrawn";
    appendConsentEvent(consent, { action: "withdrawn", actorType: "patient", actorId: req.patient._id, actorRole: "patient", note: reason || "Consent withdrawn through authenticated patient portal." });
    await consent.save();
    await createPatientNotification({ patientId: req.patient._id, type: "clinical_consent_withdrawn", title: "Consent withdrawn", message: `Your withdrawal for “${consent.title}” was recorded. This does not reverse treatment already provided; contact the clinic for urgent questions.`, metadata: { consentId: consent._id }, dedupeKey: `clinical-consent:${consent._id}:withdrawn`, io: req.app.get("io") });
    logSecurityEvent(req, { event: "clinical_consent_withdrawn", outcome: "success", actorType: "patient", actorId: req.patient._id, tenantId: req.tenantId });
    return res.json({ message: "Consent withdrawal recorded.", consent: patientConsentView(consent) });
  } catch (error) { return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to withdraw consent.") }); }
});

export default router;
