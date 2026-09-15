import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { databaseTransaction } from "../utils/databaseTransaction.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import mongoose from "mongoose";

import Consultation from "../models/Consultation.js";
import DepartmentReferral from "../models/DepartmentReferral.js";
import Tenant from "../models/Tenant.js";
import { ensureFollowUpPlan, completeLinkedFollowUp, listTreatingDoctorFollowUps } from "../services/followUpService.js";
import Token from "../models/Token.js";
import { syncAppointmentFromToken } from "../services/appointmentLifecycleService.js";
import { emitOperationalUpdate, emitQueueUpdate, emitPatientTokenUpdate } from "../services/realtimeService.js";
import { normalizeDepartment } from "../utils/departments.js";
import {
  processQueueNotifications,
  notifyConsultationCompleted,
} from "../services/notificationService.js";

import {
  protect,
  requireRole,
} from "../middleware/auth.js";

const router = asyncRouter();

/* =========================================================
   COMPLETE A CONSULTATION

   POST /api/consultations

   Doctor/Admin only
========================================================= */

router.post(
  "/",
  protect,
  requireRole("doctor"),
  async (req, res) => {
    try {
      const {
        tokenId,
        symptoms = "",
        diagnosis = "",
        prescription = "",
        medicines = [],
        testsRecommended = [],
        labReferralEnabled = false,
        labReferralDate = "",
        labReferralPriority = "routine",
        advice = "",
        notes = "",
        followUpDate = "",
        completedFollowUpConsultationId = "",
      } = req.body;

      /* -------------------------------
         Validate token ID
      -------------------------------- */

      if (
        !tokenId ||
        !mongoose.Types.ObjectId.isValid(tokenId)
      ) {
        return res.status(400).json({
          message: "Invalid token ID.",
        });
      }

      /* -------------------------------
         Diagnosis required
      -------------------------------- */

      if (!diagnosis.trim()) {
        return res.status(400).json({
          message: "Diagnosis is required.",
        });
      }

      /* -------------------------------
         Find OPD token
      -------------------------------- */

      const token =
        await Token.findById(tokenId);

      if (!token) {
        return res.status(404).json({
          message: "Token not found.",
        });
      }

      /* -------------------------------
         Must be registered patient
      -------------------------------- */

      if (!token.patient) {
        return res.status(400).json({
          message:
            "This token is not linked to a registered patient.",
        });
      }

      /* -------------------------------
         Patient must first be called
      -------------------------------- */

      if (token.isArchived || token.queueControl?.isOnHold || token.status !== "called") {
        return res.status(400).json({
          message:
            "Patient must be called before completing the consultation.",
        });
      }

      /* -------------------------------
         DOCTOR SPECIALTY / ASSIGNMENT GUARD
      -------------------------------- */

      if (req.user.role === "doctor") {
        const doctorDepartment = normalizeDepartment(req.user.department);

        if (token.department !== doctorDepartment) {
          return res.status(403).json({
            message: "You cannot consult a patient outside your assigned specialty.",
          });
        }

        if (!token.assignedDoctor || token.assignedDoctor.toString() !== req.user.id.toString()) {
          return res.status(403).json({
            message: "This patient is not assigned to your workstation.",
          });
        }
      }

      /* -------------------------------
         Prevent duplicate consultation
      -------------------------------- */

      const existing =
        await Consultation.findOne({
          token: token._id,
        });

      if (existing) {
        return res.status(409).json({
          message:
            "A consultation already exists for this token.",
        });
      }

      /* -------------------------------
         Validate follow-up date
      -------------------------------- */

      let parsedFollowUpDate = null;

      if (followUpDate) {
        parsedFollowUpDate =
          new Date(followUpDate);

        if (
          Number.isNaN(
            parsedFollowUpDate.getTime()
          )
        ) {
          return res.status(400).json({
            message:
              "Invalid follow-up date.",
          });
        }
      }

      const cleanMedicines = Array.isArray(medicines)
        ? medicines
            .map((medicine) => ({
              name: String(medicine?.name || "").trim(),
              dosage: String(medicine?.dosage || "").trim(),
              frequency: String(medicine?.frequency || "").trim(),
              duration: String(medicine?.duration || "").trim(),
              instructions: String(medicine?.instructions || "").trim(),
            }))
            .filter((medicine) => medicine.name)
            .slice(0, 30)
        : [];

      const cleanTests = Array.isArray(testsRecommended)
        ? testsRecommended.map((test) => String(test || "").trim()).filter(Boolean).slice(0, 30)
        : String(testsRecommended || "")
            .split(",")
            .map((test) => test.trim())
            .filter(Boolean)
            .slice(0, 30);

      const shouldCreateLabReferral =
        Boolean(labReferralEnabled) && cleanTests.length > 0;

      let parsedLabReferralDate = null;
      if (shouldCreateLabReferral && labReferralDate) {
        parsedLabReferralDate = new Date(labReferralDate);
        if (Number.isNaN(parsedLabReferralDate.getTime())) {
          return res.status(400).json({ message: "Invalid lab referral date." });
        }
      }

      const cleanLabPriority =
        String(labReferralPriority || "routine").toLowerCase() === "urgent"
          ? "urgent"
          : "routine";

      /* -------------------------------
         Create consultation
      -------------------------------- */

      const { consultation, completedToken } = await databaseTransaction(async () => {
        const token = await Token.findById(tokenId);
        if (!token || token.isArchived || token.queueControl?.isOnHold || token.status !== "called" || String(token.assignedDoctor) !== req.user.id) {
          throw Object.assign(new Error("This visit is no longer assigned and ready for completion."), { status: 409 });
        }
        const consultation =
        await Consultation.create({
          tenantId: req.tenantId,
          patient:
            token.patient,

          token:
            token._id,

          // Confirmed from your JWT:
          // authRoutes.js signs { id: user._id }
          doctor:
            req.user.id,

          department:
            token.department,

          symptoms:
            String(symptoms).trim(),

          diagnosis:
            String(diagnosis).trim(),

          prescription:
            String(prescription).trim(),

          medicines:
            cleanMedicines,

          testsRecommended:
            cleanTests,

          labReferral: {
            enabled: shouldCreateLabReferral,
            referralDate: shouldCreateLabReferral
              ? parsedLabReferralDate || new Date()
              : null,
            priority: cleanLabPriority,
            status: "pending",
            completedAt: null,
          },

          advice:
            String(advice).trim(),

          notes:
            String(notes).trim(),

          followUpDate:
            parsedFollowUpDate,

          status:
            "completed",
        });

      /* -------------------------------
         Complete OPD token
      -------------------------------- */

      token.status =
        "completed";

      token.completedAt =
        new Date();

      await token.save();
      await syncAppointmentFromToken(token);
      const followUpTenant = await Tenant.findById(req.tenantId).select("name timezone").lean();
      await completeLinkedFollowUp(consultation, token, {
        sourceId: String(completedFollowUpConsultationId || ""), tenant: followUpTenant,
      });
      if (consultation.followUpDate) {
        await ensureFollowUpPlan(consultation, followUpTenant);
      }
      await DepartmentReferral.updateMany(
        { sourceToken: token._id, sourceConsultation: null },
        { $set: { sourceConsultation: consultation._id } }
      );
      await DepartmentReferral.updateOne(
        { targetToken: token._id, status: "accepted" },
        { $set: { status: "completed", completedAt: new Date() } }
      );
      return { consultation, completedToken: token };

      });
      Object.assign(token, { status: completedToken.status, completedAt: completedToken.completedAt });

      /* -------------------------------
         Broadcast new queue
      -------------------------------- */

      const tokens =
        await Token.find({ isArchived: { $ne: true } })
          .select("tokenNumber department status urgency -_id")
          .sort({
            department: 1,
            tokenNumber: 1,
          })
          .lean();

      const io = req.app.get("io");

      emitQueueUpdate(io, tokens);
      emitPatientTokenUpdate(io, token.patient, token);
      emitOperationalUpdate(io, ["queue", "appointments", "analytics"]);

      notifyConsultationCompleted(token, io).catch(() => console.error("Consultation notification failed."));
      processQueueNotifications(io).catch(() => console.error("Queue notification processing failed."));

      /* -------------------------------
         Response
      -------------------------------- */

      return res.status(201).json({
        message:
          "Consultation completed successfully.",

        consultation,
        token,
      });
    } catch (error) {
      console.error(
        "Complete consultation error:",
        safeDiagnostic(error)
      );

      if (error?.code === 11000) {
        return res.status(409).json({
          message: "This visit already has a completed consultation record.",
        });
      }

      return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to complete consultation.") });
    }
  }
);


// Only the doctor actively treating this patient may select an earlier
// recommendation to mark completed. No diagnosis or prescription is exposed.
router.get("/token/:tokenId/follow-ups", protect, requireRole("doctor"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.tokenId)) return res.status(400).json({ message: "Invalid token ID." });
    const token = await Token.findById(req.params.tokenId);
    if (!token?.patient || token.isArchived || token.status !== "called" ||
        String(token.assignedDoctor) !== String(req.user.id) ||
        normalizeDepartment(token.department) !== normalizeDepartment(req.user.department)) {
      return res.status(403).json({ message: "Follow-up history is available only for your actively called patient." });
    }
    const tenant = await Tenant.findById(req.tenantId).select("name timezone").lean();
    const followUps = await listTreatingDoctorFollowUps({
      patientId: token.patient, doctorId: req.user.id, tenant, before: new Date(),
    });
    return res.json({ followUps });
  } catch (error) {
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to load follow-up recommendations.") });
  }
});

/* =========================================================
   DOCTOR/ADMIN:
   GET PREVIOUS CLINICAL VISITS FOR THE ACTIVE TOKEN

   GET /api/consultations/token/:tokenId/previous

   Privacy rule:
   - Doctor can only read history for a registered patient
     currently called and assigned to that same doctor.
   - Admin may inspect the same snapshot for support/audit.
   - Current token/visit is always excluded.
========================================================= */

router.get(
  "/token/:tokenId/previous",
  protect,
  requireRole("doctor"),
  async (req, res) => {
    try {
      const { tokenId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(tokenId)) {
        return res.status(400).json({
          message: "Invalid token ID.",
        });
      }

      const token = await Token.findById(tokenId);

      if (!token) {
        return res.status(404).json({
          message: "Token not found.",
        });
      }

      if (!token.patient) {
        return res.json({
          consultations: [],
        });
      }

      if (req.user.role === "doctor") {
        const doctorDepartment = normalizeDepartment(req.user.department);

        if (token.status !== "called") {
          return res.status(403).json({
            message: "Clinical history is available only while this patient is actively called.",
          });
        }

        if (token.department !== doctorDepartment) {
          return res.status(403).json({
            message: "You cannot access a patient outside your assigned specialty queue.",
          });
        }

        if (
          !token.assignedDoctor ||
          token.assignedDoctor.toString() !== req.user.id.toString()
        ) {
          return res.status(403).json({
            message: "This patient is not assigned to your workstation.",
          });
        }
      }

      const consultations = await Consultation.find({
        patient: token.patient,
        token: { $ne: token._id },
        status: "completed",
      })
        .populate("doctor", "name department prescriptionProfile")
        .populate("token", "tokenNumber department")
        .sort({ createdAt: -1 })
        .limit(3);

      return res.json({
        consultations,
      });
    } catch (error) {
      console.error("Previous clinical visits error:", safeDiagnostic(error));

      return res.status(500).json({
        message: "Unable to load previous clinical visits.",
      });
    }
  }
);

/* =========================================================
   DOCTOR/ADMIN:
   GET PATIENT CONSULTATION HISTORY

   GET /api/consultations/patient/:patientId
========================================================= */

router.get(
  "/patient/:patientId",
  protect,
  requireRole("doctor"),
  async (req, res) => {
    try {
      const {
        patientId,
      } = req.params;

      if (
        !mongoose.Types.ObjectId.isValid(
          patientId
        )
      ) {
        return res.status(400).json({
          message:
            "Invalid patient ID.",
        });
      }

      const consultationFilter = {
        patient: patientId,
      };

      if (req.user.role === "doctor") {
        const doctorDepartment = normalizeDepartment(req.user.department);

        // A doctor may read a patient's longitudinal history only while that
        // patient is actively called to that exact doctor. Knowing a Mongo ID
        // must never be enough to browse another patient's EHR.
        const activeAssignedToken = await Token.findOne({
          patient: patientId,
          assignedDoctor: req.user.id,
          department: doctorDepartment,
          status: "called",
          isArchived: { $ne: true },
        }).select("_id");

        if (!activeAssignedToken) {
          return res.status(403).json({
            message:
              "Patient history is available only for a patient currently called and assigned to you.",
          });
        }

        consultationFilter.department = doctorDepartment;
      }

      const consultations =
        await Consultation.find(consultationFilter)
          .populate(
            "doctor",
            "name email department prescriptionProfile"
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
        "Consultation history error:",
        safeDiagnostic(error)
      );

      return res.status(500).json({
        message:
          "Unable to load consultation history.",
      });
    }
  }
);

export default router;