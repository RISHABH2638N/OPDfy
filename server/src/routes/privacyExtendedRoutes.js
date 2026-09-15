import crypto from "node:crypto";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protectGlobalPatient } from "../middleware/globalPatientAuth.js";
import { protectSuperAdmin } from "../middleware/platformAuth.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { consentNotice, currentConsent, recordConsent, isAdultForExternalAi, CONSENT_PURPOSE } from "../services/privacyConsentService.js";
import { preparePrivacyExport, consumePrivacyExport } from "../services/privacyExportService.js";
import { getClosureReview, executeAccountClosure } from "../services/privacyClosureService.js";

const router = asyncRouter();
const handle = (error, res) => res.status(error.status || 500).json({
  message: publicErrorMessage(error, "Unable to complete privacy operation."),
});
const limiter = rateLimit({ windowMs: 15 * 60000, max: 6,
  store: createRateLimitStore("privacy-export-actions"), standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => `patient:${req.globalPatient._id}`,
  message: { message: "Too many privacy requests. Please try again later." },
});
const ownerLimiter = rateLimit({ windowMs: 15 * 60000, max: 5,
  store: createRateLimitStore("privacy-closure-owner"), standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => `owner:${req.superAdmin.id}`,
  message: { message: "Too many closure attempts. Please try again later." },
});

router.get("/consents", protectGlobalPatient, async (req, res) => {
  const current = await currentConsent(req.globalPatient._id);
  res.json({ notice: consentNotice, eligible: isAdultForExternalAi(req.globalPatient.dateOfBirth), current: current ? {
    decision: current.decision, version: current.version, noticeVersion: current.noticeVersion,
    recordedAt: current.recordedAt, language: current.language,
  } : null, active: isAdultForExternalAi(req.globalPatient.dateOfBirth) && current?.decision === "granted" && current.noticeVersion === consentNotice.version });
});
router.post("/consents", protectGlobalPatient, limiter, async (req, res) => {
  try {
    const event = await recordConsent(req.globalPatient._id, req.body);
    logSecurityEvent(req, { event: "privacy_consent_changed", outcome: "success", actorType: "patient",
      actorId: req.globalPatient._id, metadata: { purpose: event.purpose, decision: event.decision, version: event.version } });
    res.json({ message: event.decision === "withdrawn" ? "Optional external AI consent withdrawn." : "Optional external AI consent recorded.",
      current: { decision: event.decision, version: event.version, noticeVersion: event.noticeVersion, recordedAt: event.recordedAt } });
  } catch (error) { handle(error, res); }
});
router.post("/exports/prepare", protectGlobalPatient, limiter, async (req, res) => {
  try {
    const result = await preparePrivacyExport(req.globalPatient, req.body?.otp);
    logSecurityEvent(req, { event: "privacy_export_authorized", outcome: "success", actorType: "patient", actorId: req.globalPatient._id });
    res.json({ message: "Your one-time download is ready. It expires in five minutes.", ...result });
  } catch (error) { handle(error, res); }
});
router.post("/exports/download", protectGlobalPatient, limiter, async (req, res) => {
  try {
    const body = await consumePrivacyExport(req.globalPatient, req.body?.token);
    res.set("Cache-Control", "no-store, private");
    res.set("Pragma", "no-cache");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Disposition", 'attachment; filename="opd-personal-data.json"');
    logSecurityEvent(req, { event: "privacy_export_generated", outcome: "success", actorType: "patient", actorId: req.globalPatient._id });
    res.type("application/json").send(body);
  } catch (error) { handle(error, res); }
});
router.get("/closure/:id", protectGlobalPatient, async (req, res) => {
  try { res.json(await getClosureReview(req.params.id, req.globalPatient._id)); }
  catch (error) { handle(error, res); }
});
router.get("/admin/requests/:id/closure", protectSuperAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid request ID." });
    const PrivacyRequest = (await import("../models/PrivacyRequest.js")).default;
    const request = await PrivacyRequest.findOne({ _id: req.params.id, type: "erasure" }).select("patient").lean();
    if (!request) return res.status(404).json({ message: "Erasure request not found." });
    res.json(await getClosureReview(req.params.id, request.patient));
  } catch (error) { handle(error, res); }
});
router.post("/admin/requests/:id/closure/execute", protectSuperAdmin, ownerLimiter, async (req, res) => {
  try {
    const result = await executeAccountClosure({ requestId: req.params.id, ownerId: req.superAdmin.id,
      password: req.body?.password, confirmation: req.body?.confirmation, io: req.app.get("io") });
    logSecurityEvent(req, { event: "privacy_account_closed", outcome: "success", actorType: "superadmin",
      actorId: req.superAdmin.id, metadata: { requestId: String(result.requestId), retainedClinicCount: result.retainedClinicCount } });
    res.json({ message: "Global account closed and reusable profile erased. Clinic-owned records remain under reviewed retention.", result });
  } catch (error) { handle(error, res); }
});
export default router;
