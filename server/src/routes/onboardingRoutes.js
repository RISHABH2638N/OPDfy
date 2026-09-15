import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { verifySessionToken } from "../utils/sessionTokens.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import { runWithTenant } from "../services/tenantExecutionContext.js";
import { expireDueSubscriptions } from "../services/subscriptionService.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { validatePolicyAcceptance } from "../utils/policyAcceptance.js";
import { cleanClinicLegalVerification, publicClinicVerification } from "../utils/legalVerification.js";

const router = asyncRouter();
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5, store: createRateLimitStore("clinic-signup"), standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many clinic registration attempts. Please try again later." },
});
const statusLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, store: createRateLimitStore("clinic-discovery-status"), standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many status checks. Please wait a moment." },
});

const normalizeSlug = (value) => String(value || "").trim().toLowerCase()
  .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

function validateInput(body = {}) {
  let legalVerification;
  try { legalVerification = cleanClinicLegalVerification(body.legalVerification); }
  catch (error) { return { error: error.message }; }
  const value = {
    clinicName: String(body.clinicName || "").trim(),
    clinicSlug: normalizeSlug(body.clinicSlug || body.clinicName),
    contactEmail: normalizeEmail(body.contactEmail),
    contactPhone: String(body.contactPhone || "").trim(),
    adminName: String(body.adminName || "").trim(),
    adminEmail: normalizeEmail(body.adminEmail || body.contactEmail),
    password: String(body.password || ""),
    legalVerification,
  };
  if (value.clinicName.length < 2 || value.clinicName.length > 120) return { error: "Clinic name must be between 2 and 120 characters." };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.clinicSlug) || value.clinicSlug.length < 3 || value.clinicSlug.length > 80) return { error: "Clinic URL slug must be 3-80 characters using letters, numbers, and hyphens only." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contactEmail)) return { error: "A valid clinic contact email is required." };
  if (value.contactPhone && !/^[+0-9() -]{7,20}$/.test(value.contactPhone)) return { error: "Please enter a valid clinic contact phone number." };
  if (value.adminName.length < 2 || value.adminName.length > 100) return { error: "Admin name must be between 2 and 100 characters." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.adminEmail)) return { error: "A valid clinic admin email is required." };
  if (value.password.length < 12) return { error: "Admin password must be at least 12 characters." };
  return { value };
}

function signOnboardingToken(tenant, admin) {
  return jwt.sign(
    { purpose: "clinic-onboarding", tenantId: String(tenant._id), adminId: String(admin._id), ver: Number(admin.tokenVersion || 0), clinicSlug: tenant.slug },
    process.env.JWT_SECRET, { expiresIn: process.env.NODE_ENV === "production" ? "30m" : "7d" }
  );
}

function signStaffToken(tenant, admin) {
  return jwt.sign({
    id: String(admin._id), name: admin.name, email: admin.email, role: "admin",
    ver: Number(admin.tokenVersion || 0), department: admin.department || "General OPD", tenantId: String(tenant._id), clinicSlug: tenant.slug,
  }, process.env.JWT_SECRET, { expiresIn: process.env.NODE_ENV === "production" ? "30m" : "8h" });
}

async function resolveOnboarding(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const payload = verifySessionToken(token, process.env.JWT_SECRET);
    if (payload.purpose !== "clinic-onboarding" || !mongoose.Types.ObjectId.isValid(payload.tenantId)) return null;
    const tenant = await Tenant.findById(payload.tenantId).lean();
    return tenant ? { payload, tenant } : null;
  } catch { return null; }
}

router.get("/staff-clinics", statusLimiter, async (_req, res) => {
  try {
    await expireDueSubscriptions();
    const tenants = await Tenant.find({ status: "active" })
      .select("_id name slug settings")
      .sort({ name: 1 })
      .lean();

    return res.json({
      clinics: tenants.map((tenant) => ({
        id: tenant._id,
        name: tenant.settings?.displayName || tenant.name,
        slug: tenant.slug,
      })),
    });
  } catch (error) {
    console.error("Staff clinic discovery error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load clinic workspaces." });
  }
});

router.post("/register-clinic", signupLimiter, async (req, res) => {
  const validation = validateInput(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const policy = validatePolicyAcceptance(req.body.policyAcceptance);
  if (policy.error) return res.status(400).json({ message: policy.error });
  if (!process.env.JWT_SECRET) return res.status(503).json({ message: "Clinic registration is temporarily unavailable." });

  const { clinicName, clinicSlug, contactEmail, contactPhone, adminName, adminEmail, password, legalVerification } = validation.value;
  let session;
  try {
    const [slugExists, contactExists] = await Promise.all([
      Tenant.exists({ slug: clinicSlug }), Tenant.exists({ contactEmail }),
    ]);
    if (slugExists) return res.status(409).json({ field: "clinicSlug", message: "This clinic URL is already in use." });
    if (contactExists) return res.status(409).json({ field: "contactEmail", message: "A clinic is already registered with this contact email." });

    const passwordHash = await bcrypt.hash(password, 12);
    session = await mongoose.startSession();
    let createdTenant, createdAdmin;

    await session.withTransaction(async () => {
      [createdTenant] = await Tenant.create([{
        name: clinicName, slug: clinicSlug, status: "pending", contactEmail, contactPhone,
        timezone: "Asia/Kolkata",
        legalVerification: { ...legalVerification, status: "submitted", submittedAt: new Date(), events: [{ status: "submitted", at: new Date(), actorType: "clinic_admin", actorId: "onboarding", note: "Clinical establishment details submitted during onboarding.", evidenceReference: legalVerification.evidenceReference }] },
        settings: { displayName: clinicName, defaultDepartment: "General OPD" },
        onboarding: { ownerName: adminName, adminEmail, submittedAt: new Date(), policyAcceptance: policy.value },
      }], { session });

      await runWithTenant(createdTenant._id, async () => {
        [createdAdmin] = await User.create([{
          tenantId: createdTenant._id, name: adminName, email: adminEmail,
          passwordHash, role: "admin", department: "General OPD",
        }], { session });
      });
    });

    return res.status(201).json({
      message: "Registration submitted for platform approval.",
      onboardingToken: signOnboardingToken(createdTenant, createdAdmin),
      clinic: { id: createdTenant._id, name: createdTenant.name, slug: createdTenant.slug, status: "pending", submittedAt: createdTenant.onboarding?.submittedAt },
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "This clinic registration conflicts with an existing account." });
    console.error("Clinic onboarding error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to submit clinic registration." });
  } finally {
    if (session) await session.endSession();
  }
});

router.get("/status", statusLimiter, async (req, res) => {
  const resolved = await resolveOnboarding(req);
  if (!resolved) return res.status(401).json({ message: "Registration session expired. Please sign in after approval or contact support." });

  const { payload, tenant } = resolved;
  const response = {
    clinic: {
      id: tenant._id, name: tenant.name, slug: tenant.slug, status: tenant.status,
      submittedAt: tenant.onboarding?.submittedAt, reviewedAt: tenant.onboarding?.reviewedAt,
      legalVerification: publicClinicVerification(tenant.legalVerification || {}),
      rejectionReason: tenant.status === "rejected" ? tenant.onboarding?.rejectionReason || "Registration did not meet platform verification requirements." : "",
      subscription: {
        status: tenant.subscription?.status || "unmanaged",
        startsAt: tenant.subscription?.startsAt || null,
        endsAt: tenant.subscription?.endsAt || null,
      },
    },
  };

  if (tenant.status === "active") {
    let admin;
    await runWithTenant(tenant._id, async () => {
      admin = await User.findById(payload.adminId).select("+tokenVersion");
    });
    if (!admin || admin.role !== "admin" || Number(payload.ver || 0) !== Number(admin.tokenVersion || 0)) return res.status(409).json({ message: "Clinic is active, but the administrator account could not be restored." });
    response.approvedSession = {
      token: signStaffToken(tenant, admin),
      user: {
        id: admin._id, name: admin.name, email: admin.email, role: admin.role,
        department: admin.department || "General OPD", tenantId: String(tenant._id), clinicSlug: tenant.slug,
      },
    };
  }
  return res.json(response);
});

export default router;
