import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import mongoose from "mongoose";

import Feedback from "../models/Feedback.js";
import Consultation from "../models/Consultation.js";
import User from "../models/User.js";
import { protect, requireRole } from "../middleware/auth.js";
import { protectPatient } from "../middleware/patientAuth.js";
import { emitOperationalUpdate } from "../services/realtimeService.js";

const router = asyncRouter();

router.post("/patient", protectPatient, async (req, res) => {
  try {
    const consultationId = String(req.body.consultationId || "");
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || "").trim();

    if (!mongoose.Types.ObjectId.isValid(consultationId)) {
      return res.status(400).json({ message: "Invalid consultation." });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5 stars." });
    }

    if (comment.length > 1000) {
      return res.status(400).json({ message: "Feedback comment is too long." });
    }

    const consultation = await Consultation.findOne({
      _id: consultationId,
      patient: req.patient._id,
      status: "completed",
    });

    if (!consultation) {
      return res.status(404).json({
        message: "Completed consultation not found for this patient.",
      });
    }

    if (!consultation.doctor || !consultation.token) {
      return res.status(400).json({
        message: "This consultation cannot receive doctor feedback.",
      });
    }

    const doctor = await User.findOne({
      _id: consultation.doctor,
      role: "doctor",
    }).select("_id");

    if (!doctor) {
      return res.status(400).json({ message: "Doctor account is unavailable." });
    }

    const feedback = await Feedback.create({
      tenantId: req.tenantId,
      patient: req.patient._id,
      doctor: consultation.doctor,
      consultation: consultation._id,
      token: consultation.token,
      department: consultation.department,
      rating,
      comment,
    });

    const populated = await Feedback.findById(feedback._id)
      .populate("doctor", "name department")
      .populate("patient", "name patientId")
      .populate("token", "tokenNumber department");

    emitOperationalUpdate(req.app.get("io"), ["feedback", "analytics"]);

    return res.status(201).json({
      message: "Thank you. Your feedback has been submitted.",
      feedback: populated,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "Feedback has already been submitted for this visit.",
      });
    }

    console.error("Patient feedback submit error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to submit feedback." });
  }
});

router.get("/patient", protectPatient, async (req, res) => {
  try {
    const feedback = await Feedback.find({ patient: req.patient._id })
      .populate("doctor", "name department")
      .populate("token", "tokenNumber department")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ feedback });
  } catch (error) {
    console.error("Patient feedback list error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load feedback." });
  }
});

router.get("/doctor", protect, requireRole("doctor"), async (req, res) => {
  try {
    const feedback = await Feedback.find({ doctor: req.user.id })
      .populate("patient", "name patientId")
      .populate("token", "tokenNumber department")
      .sort({ createdAt: -1 })
      .lean();

    const averageRating = feedback.length
      ? Number((feedback.reduce((sum, item) => sum + Number(item.rating || 0), 0) / feedback.length).toFixed(1))
      : 0;

    return res.json({
      feedback,
      summary: { total: feedback.length, averageRating },
    });
  } catch (error) {
    console.error("Doctor feedback list error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load doctor feedback." });
  }
});

router.get(
  "/admin/doctor/:doctorId",
  protect,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { doctorId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(doctorId)) {
        return res.status(400).json({ message: "Invalid doctor." });
      }

      const doctor = await User.findOne({ _id: doctorId, role: "doctor" })
        .select("name department email")
        .lean();

      if (!doctor) {
        return res.status(404).json({ message: "Doctor not found." });
      }

      const feedback = await Feedback.find({ doctor: doctorId })
        .populate("patient", "name patientId")
        .populate("token", "tokenNumber department")
        .sort({ createdAt: -1 })
        .lean();

      const averageRating = feedback.length
        ? Number((feedback.reduce((sum, item) => sum + Number(item.rating || 0), 0) / feedback.length).toFixed(1))
        : 0;

      return res.json({
        doctor,
        feedback,
        summary: { total: feedback.length, averageRating },
      });
    } catch (error) {
      console.error("Admin doctor feedback error:", safeDiagnostic(error));
      return res.status(500).json({ message: "Unable to load doctor feedback." });
    }
  }
);

export default router;
