import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { revokeSocketSessions } from "../utils/sessionTokens.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import GlobalPatient from "../models/GlobalPatient.js";
import GlobalPatientOtp from "../models/GlobalPatientOtp.js";
import { sendOtpEmail } from "../utils/sendEmail.js";
import { protectGlobalPatient } from "../middleware/globalPatientAuth.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";

const router = asyncRouter();
const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();
const hashOtp = (otp) => crypto.createHmac("sha256", process.env.JWT_SECRET).update(otp).digest("hex");
const normalizeList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

function publicGlobalPatient(patient) {
  return {
    id: patient._id,
    name: patient.name || "",
    email: patient.email,
    phone: patient.phone || "",
    dateOfBirth: patient.dateOfBirth || null,
    gender: patient.gender || "",
    bloodGroup: patient.bloodGroup || "",
    allergies: patient.allergies || [],
    medicalHistory: patient.medicalHistory || [],
    currentMedications: patient.currentMedications || [],
    pastSurgeries: patient.pastSurgeries || [],
    emergencyContact: patient.emergencyContact || { name: "", phone: "" },
    profileCompleted: Boolean(patient.profileCompleted),
    profileUpdatedAt: patient.profileUpdatedAt || null,
    accountScope: "global",
  };
}

// Legacy clinical identity claims must be reviewed by the treating clinic.
// Logging in or opening a profile never imports historical records by email.
async function migrateLegacyProfileIfNeeded(patient) {
  return patient;
}

const otpSendIpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 5, store: createRateLimitStore("patient-otp-send-ip"), standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many OTP requests from this network. Please try again later." },
});
const otpSendEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 3, store: createRateLimitStore("patient-otp-send-email"), standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => normalizeEmail(req.body?.email) || "invalid-email",
  message: { message: "Too many OTP requests for this email. Please wait before requesting another code." },
});
const otpVerifyIpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 15, store: createRateLimitStore("patient-otp-verify-ip"), standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many OTP verification attempts from this network. Please try again later." },
});
const otpVerifyEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10, store: createRateLimitStore("patient-otp-verify-email"), standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => normalizeEmail(req.body?.email) || "invalid-email",
  message: { message: "Too many OTP verification attempts for this email. Please try again later." },
});

router.post("/send-otp", otpSendIpLimiter, otpSendEmailLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) return res.status(400).json({ message: "Please enter a valid email address." });

    const otp = generateOtp();
    const issued = await GlobalPatientOtp.findOneAndUpdate({ email }, { $set: {
      email,
      otpHash: hashOtp(otp),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      attempts: 0,
    } }, { upsert: true, new: true });

    try {
      await sendOtpEmail(email, otp);
    } catch (mailError) {
      await GlobalPatientOtp.deleteOne({ _id: issued._id, otpHash: issued.otpHash });
      throw mailError;
    }
    return res.json({
      message: "Verification code sent to your email.",
      expiresIn: OTP_EXPIRY_MINUTES * 60,
      scope: "global-patient",
    });
  } catch (error) {
    console.error("Global patient OTP send error:", safeDiagnostic(error));
    const smtpCode = String(error?.responseCode || error?.code || "").trim();
    const devHint = process.env.NODE_ENV !== "production" && smtpCode
      ? ` SMTP error: ${smtpCode}. Check server terminal and SMTP/Brevo settings.`
      : "";
    return res.status(500).json({ message: `Unable to send verification code.${devHint}` });
  }
});

router.post("/verify-otp", otpVerifyIpLimiter, otpVerifyEmailLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();
    if (!isValidEmail(email)) return res.status(400).json({ message: "Invalid email address." });
    if (!/^\d{6}$/.test(otp)) return res.status(400).json({ message: "OTP must contain 6 digits." });

    // Claim an attempt atomically; concurrent guesses cannot undercount attempts.
    const otpRecord = await GlobalPatientOtp.findOneAndUpdate(
      { email, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_OTP_ATTEMPTS } },
      { $inc: { attempts: 1 } }, { new: true }
    );
    if (!otpRecord) return res.status(400).json({ message: "OTP expired, unavailable, or attempt limit reached. Request a new code." });
    const suppliedHash = Buffer.from(hashOtp(otp), "hex");
    const storedHash = Buffer.from(otpRecord.otpHash, "hex");
    if (suppliedHash.length !== storedHash.length || !crypto.timingSafeEqual(suppliedHash, storedHash)) {
      logSecurityEvent(req, { event: "patient_otp_login", outcome: "failure", metadata: { email, attempts: otpRecord.attempts } });
      return res.status(401).json({ message: "Incorrect OTP.", attemptsRemaining: MAX_OTP_ATTEMPTS - otpRecord.attempts });
    }
    // Exactly one successful verification may consume a given code.
    const consumed = await GlobalPatientOtp.findOneAndDelete({ _id: otpRecord._id, otpHash: otpRecord.otpHash, expiresAt: { $gt: new Date() } });
    if (!consumed) return res.status(400).json({ message: "OTP already used or expired. Request a new code." });

    let patient = await GlobalPatient.findOne({ email }).select("+tokenVersion");
    let isNewPatient = false;
    if (!patient) {
      try {
        patient = await GlobalPatient.create({ email, status: "active", lastLoginAt: new Date() });
        isNewPatient = true;
      } catch (error) {
        if (error?.code !== 11000) throw error;
        patient = await GlobalPatient.findOne({ email }).select("+tokenVersion");
      }
    }
    if (patient.status !== "active") return res.status(403).json({ message: "Patient account is disabled." });
    await migrateLegacyProfileIfNeeded(patient);
    patient.lastLoginAt = new Date();
    await patient.save();

    const token = jwt.sign(
      { id: String(patient._id), role: "patient-global", ver: Number(patient.tokenVersion || 0) },
      process.env.JWT_SECRET,
      { expiresIn: process.env.NODE_ENV === "production" ? "30m" : "7d" }
    );

    logSecurityEvent(req, { event: "patient_otp_login", outcome: "success", actorType: "patient", actorId: patient._id, metadata: { email } });
    return res.json({
      message: "Global patient authentication successful.",
      token,
      isNewPatient,
      patient: publicGlobalPatient(patient),
    });
  } catch (error) {
    logSecurityEvent(req, { event: "patient_otp_login", outcome: "failure", metadata: { email: normalizeEmail(req.body?.email) } });
    console.error("Global patient OTP verification error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to verify OTP." });
  }
});

router.post("/logout", protectGlobalPatient, async (req, res) => {
  await GlobalPatient.updateOne({ _id: req.globalPatient._id }, { $inc: { tokenVersion: 1 } });
  revokeSocketSessions(req.app.get("io"), "patient", req.globalPatient._id);
  return res.json({ message: "Logged out securely." });
});

router.get("/me", protectGlobalPatient, async (req, res) => {
  try {
    const patient = await migrateLegacyProfileIfNeeded(req.globalPatient);
    res.json({ patient: publicGlobalPatient(patient) });
  } catch (error) {
    console.error("Global patient profile load error:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to load your global patient profile." });
  }
});

router.get("/profile", protectGlobalPatient, async (req, res) => {
  try {
    const patient = await migrateLegacyProfileIfNeeded(req.globalPatient);
    res.json({ patient: publicGlobalPatient(patient) });
  } catch (error) {
    console.error("Global health profile load error:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to load your health profile." });
  }
});

router.put("/profile", protectGlobalPatient, async (req, res) => {
  try {
    const patient = req.globalPatient;
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
    } = req.body || {};

    const cleanName = String(name || "").trim();
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    if (!cleanName) return res.status(400).json({ message: "Patient name is required." });
    if (cleanPhone && !/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ message: "Please enter a valid 10-digit mobile number." });
    }

    const allowedGenders = ["", "Male", "Female", "Other"];
    if (!allowedGenders.includes(gender || "")) return res.status(400).json({ message: "Invalid gender." });
    const allowedBloodGroups = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    if (!allowedBloodGroups.includes(bloodGroup || "")) return res.status(400).json({ message: "Invalid blood group." });

    let parsedDate = null;
    if (dateOfBirth) {
      parsedDate = new Date(dateOfBirth);
      if (Number.isNaN(parsedDate.getTime())) return res.status(400).json({ message: "Invalid date of birth." });
      if (parsedDate > new Date()) return res.status(400).json({ message: "Date of birth cannot be in the future." });
    }

    const emergencyName = String(emergencyContact?.name || "").trim();
    const emergencyPhone = String(emergencyContact?.phone || "").replace(/\D/g, "");
    if (emergencyPhone && !/^[6-9]\d{9}$/.test(emergencyPhone)) {
      return res.status(400).json({ message: "Please enter a valid emergency contact phone number." });
    }

    const patch = {
      name: cleanName, phone: cleanPhone, dateOfBirth: parsedDate,
      gender: gender || "", bloodGroup: bloodGroup || "",
      allergies: normalizeList(allergies), medicalHistory: normalizeList(medicalHistory),
      currentMedications: normalizeList(currentMedications), pastSurgeries: normalizeList(pastSurgeries),
      emergencyContact: { name: emergencyName, phone: emergencyPhone },
      profileCompleted: true, profileUpdatedAt: new Date(),
    };
    // A profile write must not restore personal data after an account closure.
    const updated = await GlobalPatient.findOneAndUpdate({
      _id: patient._id, status: "active", tokenVersion: patient.tokenVersion,
    }, { $set: patch, $inc: { privacyRevision: 1 } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ message: "Account changed. Please sign in again." });

    return res.json({
      message: "Global health profile saved. You can now use it across OPDfy clinics.",
      patient: publicGlobalPatient(updated),
    });
  } catch (error) {
    console.error("Global health profile update error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to save your global health profile." });
  }
});

export default router;
