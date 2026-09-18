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
import PatientSession from "../models/PatientSession.js";
import { sendOtpEmail } from "../utils/sendEmail.js";
import { protectGlobalPatient } from "../middleware/globalPatientAuth.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";

const router = asyncRouter();
const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;
const REMEMBER_DEVICE_DAYS = Math.min(30, Math.max(1, Number(process.env.PATIENT_REMEMBER_DAYS || 30)));
const MAX_REMEMBERED_DEVICES = Math.min(10, Math.max(1, Number(process.env.PATIENT_MAX_REMEMBERED_DEVICES || 5)));
const PATIENT_REFRESH_COOKIE = process.env.NODE_ENV === "production"
  ? "__Secure-opdfy_patient_refresh"
  : "opdfy_patient_refresh";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();
const hashOtp = (otp) => crypto.createHmac("sha256", process.env.JWT_SECRET).update(otp).digest("hex");
const normalizeList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

const hashRefreshToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
const generateRefreshToken = () => crypto.randomBytes(48).toString("base64url");

function patientRefreshCookieOptions({ clear = false } = {}) {
  const sameSite = String(
    process.env.PATIENT_REMEMBER_COOKIE_SAMESITE ||
    (process.env.NODE_ENV === "production" ? "none" : "lax")
  ).trim().toLowerCase();
  const normalizedSameSite = ["lax", "strict", "none"].includes(sameSite) ? sameSite : "none";
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: normalizedSameSite,
    path: "/api/patient-auth",
  };
  const configuredDomain = String(process.env.PATIENT_REMEMBER_COOKIE_DOMAIN || "").trim();
  if (configuredDomain) options.domain = configuredDomain;
  if (!clear) options.maxAge = REMEMBER_DEVICE_DAYS * 24 * 60 * 60 * 1000;
  return options;
}

function parseCookies(req) {
  const output = {};
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { output[key] = decodeURIComponent(value); } catch { output[key] = value; }
  }
  return output;
}

function getPresentedRefreshToken(req) {
  return parseCookies(req)[PATIENT_REFRESH_COOKIE] || "";
}

function clearPatientRefreshCookie(res) {
  res.clearCookie(PATIENT_REFRESH_COOKIE, patientRefreshCookieOptions({ clear: true }));
}

function setAuthNoStore(res) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
}

function requireTrustedRememberClient(req, res, next) {
  // Refresh is authorized by an HttpOnly cookie, so require a custom header.
  // Cross-site HTML forms cannot set this header, and hostile browser origins
  // fail the app-level CORS preflight before reaching this route.
  if (String(req.get("X-OPD-Client") || "") !== "web") {
    return res.status(403).json({ message: "Remembered-session request was rejected." });
  }
  next();
}

async function createRememberedSession(req, res, patient) {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REMEMBER_DEVICE_DAYS * 24 * 60 * 60 * 1000);
  await PatientSession.create({
    patientId: patient._id,
    tokenHash: hashRefreshToken(refreshToken),
    tokenVersionAtIssue: Number(patient.tokenVersion || 0),
    expiresAt,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
  });

  // Keep the number of persistent devices bounded. Older sessions are revoked,
  // not deleted immediately, so attempted reuse still cannot become valid again.
  const overflow = await PatientSession.find({
    patientId: patient._id, revokedAt: null, expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 }).skip(MAX_REMEMBERED_DEVICES).select("_id");
  if (overflow.length) {
    await PatientSession.updateMany(
      { _id: { $in: overflow.map((entry) => entry._id) } },
      { $set: { revokedAt: new Date() } }
    );
  }

  res.cookie(PATIENT_REFRESH_COOKIE, refreshToken, patientRefreshCookieOptions());
  return expiresAt;
}

async function revokePresentedRememberedSession(req, res) {
  const refreshToken = getPresentedRefreshToken(req);
  if (refreshToken) {
    await PatientSession.updateOne(
      { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }
  clearPatientRefreshCookie(res);
}

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
const rememberedRefreshLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 30, store: createRateLimitStore("patient-remember-refresh-ip"), standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many remembered-session refresh attempts. Please try again later." },
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
    const rememberDevice = req.body?.rememberDevice === true;
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

    let rememberedUntil = null;
    if (rememberDevice) {
      // Replace a previously presented device credential only after the fresh OTP
      // succeeds. This prevents a stale cookie from silently extending itself.
      await revokePresentedRememberedSession(req, res);
      rememberedUntil = await createRememberedSession(req, res, patient);
    } else {
      // An explicit unchecked choice means this browser must not stay remembered.
      await revokePresentedRememberedSession(req, res);
    }

    setAuthNoStore(res);
    logSecurityEvent(req, { event: "patient_otp_login", outcome: "success", actorType: "patient", actorId: patient._id, metadata: { email, rememberDevice } });
    return res.json({
      message: "Global patient authentication successful.",
      token,
      isNewPatient,
      rememberedUntil,
      patient: publicGlobalPatient(patient),
    });
  } catch (error) {
    logSecurityEvent(req, { event: "patient_otp_login", outcome: "failure", metadata: { email: normalizeEmail(req.body?.email) } });
    console.error("Global patient OTP verification error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to verify OTP." });
  }
});

router.post("/refresh", rememberedRefreshLimiter, requireTrustedRememberClient, async (req, res) => {
  try {
    setAuthNoStore(res);
    const presented = getPresentedRefreshToken(req);
    if (!presented) return res.status(401).json({ message: "No remembered patient session." });

    const currentHash = hashRefreshToken(presented);
    const nextRefreshToken = generateRefreshToken();
    const nextHash = hashRefreshToken(nextRefreshToken);
    const now = new Date();

    // Atomic hash rotation makes a captured old refresh credential single-use.
    // Concurrent/replayed use of the previous token loses the race and is denied.
    const remembered = await PatientSession.findOneAndUpdate(
      { tokenHash: currentHash, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { tokenHash: nextHash, lastUsedAt: now } },
      { new: true }
    ).select("+tokenVersionAtIssue");

    if (!remembered) {
      clearPatientRefreshCookie(res);
      return res.status(401).json({ message: "Remembered patient session expired or was revoked." });
    }

    const patient = await GlobalPatient.findOne({ _id: remembered.patientId, status: "active" }).select("+tokenVersion");
    if (!patient || Number(patient.tokenVersion || 0) !== Number(remembered.tokenVersionAtIssue || 0)) {
      await PatientSession.updateOne({ _id: remembered._id }, { $set: { revokedAt: now } });
      clearPatientRefreshCookie(res);
      return res.status(401).json({ message: "Remembered patient session is no longer valid." });
    }

    const token = jwt.sign(
      { id: String(patient._id), role: "patient-global", ver: Number(patient.tokenVersion || 0) },
      process.env.JWT_SECRET,
      { expiresIn: process.env.NODE_ENV === "production" ? "30m" : "7d" }
    );

    // Keep the original absolute expiration; refresh cannot extend 30 days forever.
    const cookieOptions = patientRefreshCookieOptions();
    cookieOptions.maxAge = Math.max(0, remembered.expiresAt.getTime() - Date.now());
    res.cookie(PATIENT_REFRESH_COOKIE, nextRefreshToken, cookieOptions);
    logSecurityEvent(req, { event: "patient_remembered_session_refresh", outcome: "success", actorType: "patient", actorId: patient._id });
    return res.json({ token, patient: publicGlobalPatient(patient), rememberedUntil: remembered.expiresAt });
  } catch (error) {
    logSecurityEvent(req, { event: "patient_remembered_session_refresh", outcome: "failure" });
    console.error("Patient remembered-session refresh error:", safeDiagnostic(error));
    clearPatientRefreshCookie(res);
    return res.status(500).json({ message: "Unable to restore patient session." });
  }
});

router.post("/forget-device", rememberedRefreshLimiter, requireTrustedRememberClient, async (req, res) => {
  try {
    setAuthNoStore(res);
    await revokePresentedRememberedSession(req, res);
    return res.json({ message: "This device is no longer remembered." });
  } catch (error) {
    console.error("Patient remembered-device revoke error:", safeDiagnostic(error));
    clearPatientRefreshCookie(res);
    return res.status(500).json({ message: "Unable to forget this device." });
  }
});

router.post("/logout", protectGlobalPatient, async (req, res) => {
  const patientId = req.globalPatient._id;
  await GlobalPatient.updateOne({ _id: patientId }, { $inc: { tokenVersion: 1 } });
  await PatientSession.updateMany(
    { patientId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  clearPatientRefreshCookie(res);
  setAuthNoStore(res);
  revokeSocketSessions(req.app.get("io"), "patient", patientId);
  return res.json({ message: "Logged out securely from all remembered patient sessions." });
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
