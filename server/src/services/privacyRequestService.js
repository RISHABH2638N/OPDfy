import crypto from "node:crypto";
import mongoose from "mongoose";
import PrivacyRequest from "../models/PrivacyRequest.js";
import PrivacyVerification from "../models/PrivacyVerification.js";
import { sendEmail } from "../utils/sendEmail.js";
import { validateIdentityReviewRequest } from "./privacyIdentityReviewService.js";

export const PRIVACY_TYPES = Object.freeze(["access", "correction", "erasure", "withdrawal", "grievance", "identity_review", "nomination"]);
const codeHash = (patientId, nonce, code) => crypto.createHmac("sha256", process.env.JWT_SECRET)
  .update(`privacy-request:${patientId}:${nonce}:${code}`).digest("hex");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validatePrivacyRequest(input) {
  const type = String(input?.type || "");
  const details = input?.details;
  const clinicSlug = String(input?.clinicSlug || "").trim().toLowerCase();
  if (!PRIVACY_TYPES.includes(type)) throw fail("Select a valid privacy request type.");
  if (typeof details !== "string" || details.trim().length < 10 || details.length > 2000)
    throw fail("Please describe your request in 10 to 2000 characters.");
  if (clinicSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clinicSlug))
    throw fail("Invalid clinic selection.");
  if (clinicSlug.length > 80) throw fail("Invalid clinic selection.");
  return { type, details: details.trim(), clinicSlug };
}

export function publicPrivacyRequest(item) {
  return { id: item._id, type: item.type, status: item.status, clinicSlug: item.clinicSlug,
    details: item.details, createdAt: item.createdAt, reviewedAt: item.reviewedAt, resolution: item.resolution || "",
    clinicReview: item.clinicReview?.decision ? { decision: item.clinicReview.decision, reviewedAt: item.clinicReview.reviewedAt } : null,
    execution: item.execution?.kind ? { kind: item.execution.kind, completedAt: item.execution.completedAt,
      retainedClinicCount: item.execution.retainedClinicCount || 0 } : null };
}

export async function issuePrivacyChallenge(patient, type) {
  if (!PRIVACY_TYPES.includes(type)) throw fail("Select a valid privacy request type.");
  const now = new Date();
  const existing = await PrivacyVerification.findOne({ patient: patient._id, purpose: "privacy-request" });
  if (existing && existing.expiresAt > now && existing.attempts < 5)
    throw fail("A verification code is already active. Please use that code or wait five minutes before requesting another.", 429);
  const nonce = crypto.randomBytes(16).toString("hex");
  const code = crypto.randomInt(100000, 1000000).toString();
  const id = new mongoose.Types.ObjectId();
  let issued;
  try {
    issued = await PrivacyVerification.findOneAndUpdate({
      patient: patient._id, purpose: "privacy-request",
      $or: [{ expiresAt: { $lte: now } }, { attempts: { $gte: 5 } }, { expiresAt: { $exists: false } }],
    }, { $set: { patient: patient._id, purpose: "privacy-request", requestType: type,
      otpHash: codeHash(patient._id, nonce, code), nonce, expiresAt: new Date(Date.now() + 300000), attempts: 0 },
      $setOnInsert: { _id: id } }, { upsert: true, new: true }).select("+otpHash +nonce");
  } catch (error) {
    if (error.code === 11000) throw fail("A verification code is already active. Please try again later.", 429);
    throw error;
  }
  try {
    await sendEmail({ to: patient.email, subject: "OPDfy privacy request verification",
      text: `Your privacy request verification code is ${code}. It expires in 5 minutes. Do not share it.`,
      html: `<p>Your OPDfy privacy request verification code is:</p><p style="font-size:28px;font-weight:bold">${code}</p><p>It expires in 5 minutes. Do not share it.</p>` });
  } catch (error) {
    await PrivacyVerification.deleteOne({ _id: issued._id, nonce });
    throw error;
  }
  return { expiresIn: 300 };
}

export async function consumePrivacyChallenge(patient, type, otp, work) {
  if (!PRIVACY_TYPES.includes(type)) throw fail("Select a valid privacy request type.");
  const code = String(otp || "");
  if (!/^\d{6}$/.test(code)) throw fail("Enter the six-digit verification code.");
  const record = await PrivacyVerification.findOneAndUpdate({
    patient: patient._id, purpose: "privacy-request", requestType: type,
    expiresAt: { $gt: new Date() }, attempts: { $lt: 5 },
  }, { $inc: { attempts: 1 } }, { new: true }).select("+otpHash +nonce");
  if (!record) throw fail("Verification expired or attempt limit reached. Request a new code.");
  const supplied = Buffer.from(codeHash(patient._id, record.nonce, code), "hex");
  const stored = Buffer.from(record.otpHash, "hex");
  if (supplied.length !== stored.length || !crypto.timingSafeEqual(supplied, stored))
    throw fail("Incorrect verification code.", 401);
  return mongoose.connection.transaction(async (session) => {
    const consumed = await PrivacyVerification.findOneAndDelete({
      _id: record._id, otpHash: record.otpHash, nonce: record.nonce,
      expiresAt: { $gt: new Date() },
    }).session(session);
    if (!consumed) throw fail("Verification already used or expired.", 409);
    return work(session);
  });
}

export async function submitPrivacyRequest(patient, input) {
  const data = validatePrivacyRequest(input);
  try {
    return await consumePrivacyChallenge(patient, data.type, input.otp, async (session) => {
      await validateIdentityReviewRequest(patient, data, session);
      const [request] = await PrivacyRequest.create([{
        patient: patient._id, ...data, verifiedAt: new Date(),
      }], { session });
      return request;
    });
  } catch (error) {
    if (error.code === 11000) throw fail("You already have an open request of this type. Please check its status.", 409);
    throw error;
  }
}
