import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { revokeSocketSessions } from "../utils/sessionTokens.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import SuperAdmin from "../models/SuperAdmin.js";
import PlatformSetting from "../models/PlatformSetting.js";
import Tenant from "../models/Tenant.js";
import { protectSuperAdmin } from "../middleware/platformAuth.js";
import { addSubscriptionMonths, expireDueSubscriptions, subscriptionView } from "../services/subscriptionService.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { effectiveVerificationStatus } from "../utils/legalVerification.js";
import { validateImageDataUrl } from "../utils/imageValidation.js";

const router = asyncRouter();
const verificationReviewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, store: createRateLimitStore("platform-clinic-verification"), keyGenerator: req => `owner:${req.superAdmin?.id || req.ip}`, standardHeaders: true, legacyHeaders: false });
const brandingUpdateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, store: createRateLimitStore("platform-branding-update"), keyGenerator: req => `owner:${req.superAdmin?.id || req.ip}`, standardHeaders: true, legacyHeaders: false });

const DEFAULT_PLATFORM_BRANDING = Object.freeze({ productName: "OPDfy", logoUrl: "" });

function platformBrandingView(setting) {
  return {
    productName: setting?.productName || DEFAULT_PLATFORM_BRANDING.productName,
    logoUrl: setting?.logoUrl || "",
    updatedAt: setting?.updatedAt || null,
  };
}

async function verifyOwnerPassword(ownerId, password) {
  if (typeof password !== "string" || !password) throw Object.assign(new Error("Fresh platform password is required."), { status: 403 });
  const owner = await SuperAdmin.findOne({ _id: ownerId, status: "active" }).select("+passwordHash");
  if (!owner || !(await bcrypt.compare(password, owner.passwordHash))) throw Object.assign(new Error("Platform password verification failed."), { status: 403 });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: createRateLimitStore("platform-login"),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many failed platform login attempts. Please try again later." },
});

// Public branding contains no tenant, account, or clinical information. It is
// intentionally available before sign-in so login and landing screens can use
// the platform owner's current logo.
router.get("/branding/public", async (req, res) => {
  const setting = await PlatformSetting.findOne({ key: "branding" })
    .select("productName logoUrl updatedAt")
    .lean();
  res.set("Cache-Control", "public, max-age=0, must-revalidate");
  return res.json({ branding: platformBrandingView(setting) });
});

router.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ message: "Email and password are required." });

    const account = await SuperAdmin.findOne({ email, status: "active" }).select("+passwordHash +tokenVersion");
    if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
      logSecurityEvent(req, { event: "platform_login", outcome: "failure", metadata: { email } });
      return res.status(401).json({ message: "Invalid platform credentials." });
    }

    if (!process.env.SUPER_ADMIN_JWT_SECRET) {
      return res.status(503).json({ message: "Platform authentication is not configured." });
    }

    const token = jwt.sign(
      { id: String(account._id), role: "superadmin", ver: Number(account.tokenVersion || 0) },
      process.env.SUPER_ADMIN_JWT_SECRET,
      { expiresIn: process.env.NODE_ENV === "production" ? "30m" : "4h" }
    );

    logSecurityEvent(req, { event: "platform_login", outcome: "success", actorType: "superadmin", actorId: account._id });
    return res.json({
      token,
      user: { id: account._id, name: account.name, email: account.email, role: "superadmin" },
    });
  } catch (error) {
    console.error("Platform login error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to sign in to platform console." });
  }
});

router.get("/me", protectSuperAdmin, (req, res) => res.json({ user: req.superAdmin }));

router.get("/branding", protectSuperAdmin, async (req, res) => {
  const setting = await PlatformSetting.findOne({ key: "branding" })
    .select("productName logoUrl updatedAt")
    .lean();
  return res.json({ branding: platformBrandingView(setting) });
});

router.put("/branding", protectSuperAdmin, brandingUpdateLimiter, async (req, res) => {
  const logoUrl = String(req.body?.logoUrl || "").trim();
  if (logoUrl) {
    const imageCheck = validateImageDataUrl(logoUrl, { maxBytes: 300 * 1024 });
    if (!imageCheck.ok) return res.status(400).json({ message: imageCheck.message });
  }

  const setting = await PlatformSetting.findOneAndUpdate(
    { key: "branding" },
    {
      $set: {
        productName: DEFAULT_PLATFORM_BRANDING.productName,
        logoUrl,
        updatedBy: req.superAdmin.id,
      },
      $setOnInsert: { key: "branding" },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).select("productName logoUrl updatedAt");

  logSecurityEvent(req, {
    event: "platform_branding_updated",
    outcome: "success",
    actorType: "superadmin",
    actorId: req.superAdmin.id,
    metadata: { logoConfigured: Boolean(logoUrl) },
  });

  return res.json({
    message: logoUrl ? "Platform logo updated successfully." : "Platform logo removed. Default icon restored.",
    branding: platformBrandingView(setting),
  });
});
router.post("/auth/logout", protectSuperAdmin, async (req, res) => {
  await SuperAdmin.updateOne({ _id: req.superAdmin.id }, { $inc: { tokenVersion: 1 } });
  revokeSocketSessions(req.app.get("io"), "platform", req.superAdmin.id);
  return res.json({ message: "Logged out securely." });
});

router.get("/overview", protectSuperAdmin, async (req, res) => {
  await expireDueSubscriptions();
  const [totalClinics, activeClinics, suspendedClinics, pendingClinics, rejectedClinics, expiredClinics] = await Promise.all([
    Tenant.countDocuments({}),
    Tenant.countDocuments({ status: "active" }),
    Tenant.countDocuments({ status: "suspended" }),
    Tenant.countDocuments({ status: "pending" }),
    Tenant.countDocuments({ status: "rejected" }),
    Tenant.countDocuments({ status: "expired" }),
  ]);

  // Privacy boundary: platform analytics exposes aggregate counts only.
  // Raw collections are used deliberately because tenant-owned Mongoose models
  // are fail-closed outside a tenant execution context.
  const db = mongoose.connection.db;
  const [staffAccounts, patients, tokens, appointments, consultations] = await Promise.all([
    db.collection("users").countDocuments({}),
    db.collection("patients").countDocuments({}),
    db.collection("tokens").countDocuments({}),
    db.collection("appointments").countDocuments({}),
    db.collection("consultations").countDocuments({}),
  ]);

  res.json({
    clinics: { total: totalClinics, active: activeClinics, suspended: suspendedClinics, pending: pendingClinics, rejected: rejectedClinics, expired: expiredClinics },
    platform: { staffAccounts, patients, tokens, appointments, consultations },
  });
});

router.get("/clinics", protectSuperAdmin, async (req, res) => {
  await expireDueSubscriptions();
  const tenants = await Tenant.find({})
    .select("_id name slug status contactEmail contactPhone timezone onboarding subscription legalVerification createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();

  const db = mongoose.connection.db;
  const clinics = await Promise.all(tenants.map(async (tenant) => {
    const tenantId = tenant._id;
    const [staffCount, patientCount, tokenCount, appointmentCount] = await Promise.all([
      db.collection("users").countDocuments({ tenantId }),
      db.collection("patients").countDocuments({ tenantId }),
      db.collection("tokens").countDocuments({ tenantId }),
      db.collection("appointments").countDocuments({ tenantId }),
    ]);
    return { ...tenant, legalVerification: { ...(tenant.legalVerification || {}), status: effectiveVerificationStatus(tenant.legalVerification || {}) }, staffCount, patientCount, tokenCount, appointmentCount };
  }));

  res.json({ clinics });
});

router.patch("/clinics/:tenantId/legal-verification", protectSuperAdmin, verificationReviewLimiter, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.tenantId)) return res.status(400).json({ message: "Invalid clinic identifier." });
    const decision = String(req.body?.decision || "").trim();
    if (!["platform_reviewed", "rejected"].includes(decision)) return res.status(400).json({ message: "Verification decision must be platform_reviewed or rejected." });
    const note = String(req.body?.note || "").trim();
    const evidenceReference = String(req.body?.evidenceReference || "").trim();
    if (note.length < 10 || note.length > 1000) return res.status(400).json({ message: "Review note must be between 10 and 1000 characters." });
    if (evidenceReference.length < 3 || evidenceReference.length > 240) return res.status(400).json({ message: "Review evidence reference must be between 3 and 240 characters." });
    await verifyOwnerPassword(req.superAdmin.id, req.body?.password);
    const tenant = await Tenant.findById(req.params.tenantId);
    if (!tenant) return res.status(404).json({ message: "Clinic not found." });
    if (!tenant.legalVerification?.registrationNumber || !tenant.legalVerification?.registrationAuthority || !tenant.legalVerification?.legalName) {
      return res.status(409).json({ message: "The clinic must submit complete legal registration details before review." });
    }
    const at = new Date();
    if ((tenant.legalVerification.events || []).length >= 50) return res.status(409).json({ message: "Verification history is full. Preserve it before opening a continuation review." });
    tenant.legalVerification.status = decision;
    tenant.legalVerification.reviewedAt = at;
    tenant.legalVerification.reviewedBy = req.superAdmin.id;
    tenant.legalVerification.reviewNote = note;
    tenant.legalVerification.reviewEvidenceReference = evidenceReference;
    tenant.legalVerification.events.push({ status: decision, at, actorType: "superadmin", actorId: String(req.superAdmin.id), note, evidenceReference });
    await tenant.save();
    logSecurityEvent(req, { event: "platform_clinic_legal_verification", outcome: "success", actorType: "superadmin", actorId: req.superAdmin.id, tenantId: tenant._id, metadata: { status: decision } });
    return res.json({ message: decision === "platform_reviewed" ? "Clinic registration marked as platform reviewed." : "Clinic registration verification rejected.", legalVerification: { ...tenant.legalVerification.toObject(), status: effectiveVerificationStatus(tenant.legalVerification) } });
  } catch (error) {
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to review clinic registration.") });
  }
});

router.patch("/clinics/:tenantId/status", protectSuperAdmin, async (req, res) => {
  const { tenantId } = req.params;
  const status = String(req.body?.status || "");
  if (!mongoose.Types.ObjectId.isValid(tenantId)) {
    return res.status(400).json({ message: "Invalid clinic identifier." });
  }
  if (!["active", "suspended"].includes(status)) {
    return res.status(400).json({ message: "Lifecycle status endpoint only supports active or suspended clinics." });
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return res.status(404).json({ message: "Clinic not found." });

  const subscriptionEnd = tenant.subscription?.endsAt ? new Date(tenant.subscription.endsAt) : null;
  if (status === "active" && tenant.subscription?.status !== "unmanaged" && subscriptionEnd && subscriptionEnd <= new Date()) {
    tenant.status = "expired";
    tenant.subscription.status = "expired";
    tenant.subscription.expiredAt = new Date();
    await tenant.save();
    return res.status(409).json({ message: "This subscription has expired. Record the new payment and renew it first." });
  }

  tenant.status = status;
  if (tenant.subscription?.status !== "unmanaged") {
    tenant.subscription.status = status === "suspended" ? "suspended" : "active";
  }
  await tenant.save();

  logSecurityEvent(req, { event: "platform_clinic_status", outcome: "success", actorType: "superadmin", actorId: req.superAdmin.id, tenantId: tenant._id, metadata: { status } });
  res.json({
    message: `${tenant.name} is now ${status}.`,
    clinic: { _id: tenant._id, name: tenant.name, slug: tenant.slug, status: tenant.status, subscription: subscriptionView(tenant) },
  });
});


router.patch("/clinics/:tenantId/review", protectSuperAdmin, async (req, res) => {
  const { tenantId } = req.params;
  const decision = String(req.body?.decision || "").trim().toLowerCase();
  const reason = String(req.body?.reason || "").trim();

  if (!mongoose.Types.ObjectId.isValid(tenantId)) return res.status(400).json({ message: "Invalid clinic identifier." });
  if (!["approve", "reject"].includes(decision)) return res.status(400).json({ message: "Decision must be approve or reject." });
  if (decision === "reject" && (reason.length < 3 || reason.length > 500)) {
    return res.status(400).json({ message: "Please provide a rejection reason between 3 and 500 characters." });
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return res.status(404).json({ message: "Clinic not found." });
  if (!["pending", "rejected"].includes(tenant.status)) {
    return res.status(409).json({ message: "Only pending or rejected registrations can be reviewed here." });
  }

  tenant.status = decision === "approve" ? "active" : "rejected";
  tenant.onboarding = tenant.onboarding || {};
  tenant.onboarding.reviewedAt = new Date();
  tenant.onboarding.reviewedBy = req.superAdmin.id;
  tenant.onboarding.rejectionReason = decision === "reject" ? reason : "";

  if (decision === "approve") {
    const durationMonths = Math.min(24, Math.max(1, Number(req.body?.durationMonths) || 1));
    const paidAt = new Date();
    tenant.subscription = tenant.subscription || {};
    tenant.subscription.billingMode = "manual";
    tenant.subscription.status = "active";
    tenant.subscription.startsAt = paidAt;
    tenant.subscription.endsAt = addSubscriptionMonths(paidAt, durationMonths);
    tenant.subscription.lastPaymentAt = paidAt;
    tenant.subscription.lastRenewedAt = paidAt;
    tenant.subscription.expiredAt = null;
    tenant.subscription.paymentNote = String(req.body?.paymentNote || "").trim().slice(0, 300);
  }

  await tenant.save();

  return res.json({
    message: decision === "approve" ? `${tenant.name} has been approved and activated.` : `${tenant.name} registration was rejected.`,
    clinic: { _id: tenant._id, name: tenant.name, slug: tenant.slug, status: tenant.status, onboarding: tenant.onboarding, subscription: subscriptionView(tenant) },
  });
});

router.patch("/clinics/:tenantId/renew", protectSuperAdmin, async (req, res) => {
  const { tenantId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(tenantId)) return res.status(400).json({ message: "Invalid clinic identifier." });

  const durationMonths = Number(req.body?.durationMonths || 1);
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 24) {
    return res.status(400).json({ message: "Renewal duration must be between 1 and 24 months." });
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return res.status(404).json({ message: "Clinic not found." });
  if (["pending", "rejected"].includes(tenant.status)) {
    return res.status(409).json({ message: "Approve the clinic registration before creating a subscription." });
  }

  const now = new Date();
  const currentEnd = tenant.subscription?.endsAt ? new Date(tenant.subscription.endsAt) : null;
  const base = currentEnd && currentEnd > now ? currentEnd : now;

  tenant.subscription = tenant.subscription || {};
  tenant.subscription.billingMode = "manual";
  tenant.subscription.status = "active";
  tenant.subscription.startsAt = tenant.subscription.startsAt || now;
  tenant.subscription.endsAt = addSubscriptionMonths(base, durationMonths);
  tenant.subscription.lastPaymentAt = now;
  tenant.subscription.lastRenewedAt = now;
  tenant.subscription.expiredAt = null;
  tenant.subscription.paymentNote = String(req.body?.paymentNote || "").trim().slice(0, 300);
  tenant.status = "active";
  await tenant.save();

  return res.json({
    message: `${tenant.name} renewed for ${durationMonths} month${durationMonths === 1 ? "" : "s"} and is active.`,
    clinic: { _id: tenant._id, name: tenant.name, slug: tenant.slug, status: tenant.status, subscription: subscriptionView(tenant) },
  });
});

export default router;
