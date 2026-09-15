import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { revokeSocketSessions } from "../utils/sessionTokens.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import { normalizeDepartment } from "../utils/departments.js";
import { runtimeConfig } from "../utils/runtimeConfig.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { requestStaffReset, finishStaffReset, RESET_MESSAGE, validResetPassword } from "../services/staffPasswordReset.js";

const router = asyncRouter();
const resetIpLimiter = rateLimit({ windowMs: 15 * 60000, max: 30,
  store: createRateLimitStore("staff-reset-ip"), standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many recovery attempts. Try again in 15 minutes." } });
const resetAccountLimiter = rateLimit({ windowMs: 15 * 60000, max: 10,
  store: createRateLimitStore("staff-reset-account"), standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${req.tenantId}:${String(req.body?.email || "").trim().toLowerCase()}`,
  message: { message: "Too many recovery attempts. Try again in 15 minutes." } });
router.post(["/forgot-password", "/reset-password"], resetIpLimiter, resetAccountLimiter, async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid registered email." });
  try {
    if (req.path === "/forgot-password") {
      await requestStaffReset(req.tenantId, email);
      return res.json({ message: RESET_MESSAGE });
    }
    if (!validResetPassword(req.body.password)) return res.status(400).json({ message: "Password must be at least 12 characters and at most 72 UTF-8 bytes." });
    const id = await finishStaffReset(req.tenantId, email, String(req.body.otp || ""), req.body.password);
    revokeSocketSessions(req.app.get("io"), "staff", id);
    logSecurityEvent(req, { event: "staff_password_reset", outcome: "success", actorType: "staff", actorId: id, tenantId: req.tenantId });
    return res.json({ message: "Password reset successfully. Sign in with your new password." });
  } catch (error) {
    return res.status(error.status === 400 ? 400 : 503).json({ message: error.status === 400 ? error.message : "Password recovery is unavailable. Please try again later." });
  }
});
const loginIpLimiter = rateLimit({
  windowMs: runtimeConfig.loginWindowMs,
  max: runtimeConfig.loginIpMax,
  store: createRateLimitStore("staff-login-ip"),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    message: "Too many failed login attempts from this network. Please try again later.",
  },
});

const loginEmailLimiter = rateLimit({
  windowMs: runtimeConfig.loginWindowMs,
  max: runtimeConfig.loginEmailMax,
  store: createRateLimitStore("staff-login-account"),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "").trim().toLowerCase() || "missing-email";
    return `${String(req.tenantId || "unknown-tenant")}:${email}`;
  },
  message: {
    message: "Too many failed login attempts for this account. Please try again later.",
  },
});


router.post("/login", loginIpLimiter, loginEmailLimiter, async (req, res) => {
  try {
    const { clinicSlug, email, password } = req.body;
    if (!clinicSlug || !email || !password)
      return res
        .status(400)
        .json({ message: "Clinic, email, and password are required." });
    const user = await User.findOne({ tenantId: req.tenantId, email: email.toLowerCase().trim() }).select("+passwordHash +tokenVersion");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      logSecurityEvent(req, { event: "staff_login", outcome: "failure", tenantId: req.tenantId, metadata: { email } });
      return res.status(401).json({ message: "Invalid clinic, email, or password." });
    }
    const department = normalizeDepartment(user.department);

    const token = jwt.sign(
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        department,
        tenantId: req.tenantId.toString(),
        clinicSlug: req.tenant.slug,
        ver: Number(user.tokenVersion || 0),
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.NODE_ENV === "production" ? "30m" : "8h" },
    );
    logSecurityEvent(req, { event: "staff_login", outcome: "success", actorType: "staff", actorId: user._id, tenantId: req.tenantId });
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department,
        tenantId: req.tenantId.toString(),
        clinicSlug: req.tenant.slug,
      },
      clinic: { id: req.tenantId, name: req.tenant.name, slug: req.tenant.slug },
    });
  } catch (e) {
    console.error("Operation failed:", safeDiagnostic(e));
    res.status(500).json({ message: "Unable to login." });
  }
});

router.get("/me", protect, async (req, res) => res.json({ user: req.user }));
router.post("/logout", protect, async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  revokeSocketSessions(req.app.get("io"), "staff", req.user.id);
  return res.json({ message: "Logged out securely." });
});
export default router;
