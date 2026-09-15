import express from "express";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protectGlobalPatient } from "../middleware/globalPatientAuth.js";
import { protectSuperAdmin } from "../middleware/platformAuth.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import PrivacyRequest from "../models/PrivacyRequest.js";
import { PRIVACY_TYPES, issuePrivacyChallenge, submitPrivacyRequest, publicPrivacyRequest } from "../services/privacyRequestService.js";

const router = asyncRouter();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 6,
  store: createRateLimitStore("privacy-verification"),
  keyGenerator: (req) => `patient:${req.globalPatient._id}`,
  standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many privacy verification attempts. Please try again later." } });
function handle(error, res) {
  return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to process privacy request.") });
}
router.get("/types", protectGlobalPatient, (req, res) => {
  res.json({ types: PRIVACY_TYPES });
});
router.get("/me", protectGlobalPatient, async (req, res) => {
  const requests = await PrivacyRequest.find({ patient: req.globalPatient._id })
    .sort({ createdAt: -1 }).limit(50).lean();
  res.json({ requests: requests.map(publicPrivacyRequest) });
});
router.post("/verification", protectGlobalPatient, limiter, async (req, res) => {
  try {
    const result = await issuePrivacyChallenge(req.globalPatient, req.body?.type);
    logSecurityEvent(req, { event: "privacy_verification_requested", outcome: "success",
      actorType: "patient", actorId: req.globalPatient._id });
    res.json({ message: "A verification code has been sent to your registered email.", ...result });
  } catch (error) { handle(error, res); }
});
router.post("/requests", protectGlobalPatient, limiter, async (req, res) => {
  try {
    const request = await submitPrivacyRequest(req.globalPatient, req.body);
    logSecurityEvent(req, { event: "privacy_request_created", outcome: "success",
      actorType: "patient", actorId: req.globalPatient._id, metadata: { requestId: String(request._id), type: request.type } });
    res.status(201).json({ message: "Your verified request has been received for review. No account or medical records have been deleted.", request: publicPrivacyRequest(request) });
  } catch (error) { handle(error, res); }
});

// Platform-owner case handling. A support case is not authority to erase a clinic's records.
router.get("/admin/requests", protectSuperAdmin, async (req, res) => {
  const filter = {};
  if (["pending", "in_review", "fulfilled", "rejected"].includes(req.query.status)) filter.status = req.query.status;
  const requests = await PrivacyRequest.find(filter).sort({ createdAt: -1 }).limit(100)
    .populate("patient", "email name").lean();
  res.json({ requests: requests.map((request) => ({
    ...publicPrivacyRequest(request), patient: request.patient
      ? { id: request.patient._id, email: request.patient.email, name: request.patient.name } : null,
  })) });
});
router.patch("/admin/requests/:id", protectSuperAdmin, async (req, res) => {
  const { status, resolution } = req.body || {};
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid request ID." });
  if (!["in_review", "fulfilled", "rejected"].includes(status) ||
      typeof resolution !== "string" || resolution.trim().length < 10 || resolution.length > 2000)
    return res.status(400).json({ message: "Provide a valid status and a review note of at least 10 characters." });
  const request = await PrivacyRequest.findOneAndUpdate({
    _id: req.params.id, status: { $in: ["pending", "in_review"] },
    ...(status === "fulfilled" ? { type: { $nin: ["erasure", "correction", "identity_review"] } } : {}),
  }, { $set: { status, resolution: resolution.trim(), reviewedAt: new Date(), reviewedBy: req.superAdmin.id } }, { new: true, runValidators: true });
  if (!request) return res.status(409).json({ message: "Request unavailable. Account erasure, correction and clinic identity verification must use their guarded workflows." });
  logSecurityEvent(req, { event: "privacy_request_reviewed", outcome: "success",
    actorType: "superadmin", actorId: req.superAdmin.id,
    metadata: { requestId: String(request._id), status } });
  res.json({ request: publicPrivacyRequest(request) });
});
export default router;
