import crypto from "node:crypto";
import mongoose from "mongoose";
import GlobalPatient from "../models/GlobalPatient.js";
import GlobalPatientOtp from "../models/GlobalPatientOtp.js";
import PatientSession from "../models/PatientSession.js";
import { sendEmail } from "../utils/sendEmail.js";
import { hashPatientPassword, normalizeUsername, validUsername } from "../utils/patientPasswords.js";

export const PATIENT_CODE_MESSAGE = "If this email can be used for this request, a verification code will be sent. Check your inbox and spam folder. Existing patients should use Set up / Forgot password.";
export const normalizePatientEmail = value => typeof value === "string" ? value.trim().toLowerCase() : "";
export const validPatientEmail = value => value.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validPatientPurpose = value => ["register", "reset"].includes(value);
const invalid = () => Object.assign(new Error("Verification expired, invalid or already used. Please request a new code."), { status: 400 });
const conflict = () => Object.assign(new Error("Account changed. Please request a new code using Set up / Forgot password."), { status: 409 });
export const credentialGrantHash = value => crypto.createHash("sha256").update(value).digest("hex");
export function patientCodeDigest(email, purpose, nonce, code) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET)
    .update(JSON.stringify(["patient-credentials-v1", email, purpose, nonce, code])).digest("hex");
}
const versionMatch = version => ({ $or: [{ tokenVersion: version },
  ...(version === 0 ? [{ tokenVersion: { $exists: false } }] : [])] });

// Email delivery runs outside the HTTP response path, including its error path,
// so SMTP latency/failure does not disclose whether a recovery account exists.
// Do not log recipient, OTP, password, grant or provider response content.
export function queuePatientCredentialMail(message, mailer = sendEmail, onFailure = async () => {}) {
  void Promise.resolve().then(() => mailer(message)).catch(async () => {
    console.warn("Patient credential email could not be delivered. Check SMTP configuration/provider logs.");
    try { await onFailure(); } catch { console.warn("Patient credential email cleanup failed."); }
  });
}

export async function requestPatientCode(email, purpose, mailer = sendEmail) {
  if (!validPatientEmail(email) || !validPatientPurpose(purpose)) throw invalid();
  const patient = await GlobalPatient.findOne({ email }).select("_id status +tokenVersion");
  if (purpose === "register" ? Boolean(patient) : !patient || patient.status !== "active") return;
  const now = new Date();
  const nonce = crypto.randomBytes(24).toString("hex");
  const code = String(crypto.randomInt(100000, 1000000));
  let challenge;
  try {
    // The unique email index makes this cooldown atomic across backend workers.
    challenge = await GlobalPatientOtp.findOneAndUpdate({ email,
      $or: [{ sentAt: { $exists: false } }, { sentAt: { $lte: new Date(now.getTime() - 60000) } }],
    }, { $set: { email, purpose, nonce, otpHash: patientCodeDigest(email, purpose, nonce, code),
      patientId: patient?._id || null, tokenVersionAtIssue: Number(patient?.tokenVersion || 0),
      expiresAt: new Date(now.getTime() + 5 * 60000), sentAt: now, attempts: 0, verifiedAt: null },
      $unset: { grantHash: 1 },
    }, { upsert: true, new: true });
  } catch (error) {
    if (error?.code === 11000) return; // A pending code is inside its resend cooldown.
    throw error;
  }
  const action = purpose === "register" ? "registration" : "password setup / reset";
  queuePatientCredentialMail({ to: email, subject: `OPDfy — patient ${action} code`,
    text: `Your OPDfy patient ${action} code is ${code}. It expires in 5 minutes. Do not share it with anyone. If you did not request this, ignore this email.`,
  }, mailer, () => GlobalPatientOtp.deleteOne({ _id: challenge._id, nonce }));
}

export async function verifyPatientCode(email, purpose, code) {
  if (!validPatientEmail(email) || !validPatientPurpose(purpose) || typeof code !== "string" || !/^\d{6}$/.test(code)) throw invalid();
  const record = await GlobalPatientOtp.findOneAndUpdate({ email, purpose, verifiedAt: null,
    expiresAt: { $gt: new Date() }, attempts: { $lt: 5 }, nonce: { $type: "string" },
  }, { $inc: { attempts: 1 } }, { new: true }).select("+otpHash");
  if (!record) throw invalid();
  const expected = patientCodeDigest(email, purpose, record.nonce, code);
  if (!/^[a-f0-9]{64}$/.test(record.otpHash || "") ||
      !crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(record.otpHash, "hex"))) throw invalid();

  let username = "";
  if (purpose === "reset") {
    const patient = await GlobalPatient.findOne({ _id: record.patientId, email, status: "active",
      ...versionMatch(record.tokenVersionAtIssue),
    }).select("username");
    if (!patient) throw invalid();
    username = patient.username || "";
  }
  const setupToken = crypto.randomBytes(32).toString("base64url");
  const verifiedAt = new Date();
  const claimed = await GlobalPatientOtp.updateOne({ _id: record._id, nonce: record.nonce,
    purpose, otpHash: record.otpHash, verifiedAt: null, expiresAt: { $gt: verifiedAt }, attempts: { $lte: 5 },
  }, { $set: { verifiedAt, grantHash: credentialGrantHash(setupToken), expiresAt: new Date(verifiedAt.getTime() + 10 * 60000) } });
  if (claimed.modifiedCount !== 1) throw invalid();
  // This is a one-use credential grant, never a patient access/session token.
  return { setupToken, username, expiresIn: 600 };
}

export async function finishPatientCredentials({ setupToken, purpose, username, password, passwordConfirmation }) {
  if (typeof setupToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(setupToken) || !validPatientPurpose(purpose)) throw invalid();
  if (password !== passwordConfirmation) throw Object.assign(new Error("Passwords do not match."), { status: 400 });
  const grantHash = credentialGrantHash(setupToken);
  const filter = () => ({ grantHash, purpose, verifiedAt: { $ne: null }, expiresAt: { $gt: new Date() } });
  // Reject bogus/expired grants before performing expensive password hashing.
  if (!(await GlobalPatientOtp.exists(filter()))) throw invalid();
  const normalizedUsername = normalizeUsername(username);
  if (!validUsername(normalizedUsername)) throw Object.assign(new Error("Username must contain 3–30 letters, numbers, dots or underscores, starting with a letter or number."), { status: 400 });
  const passwordHash = await hashPatientPassword(password);
  try {
    return await mongoose.connection.transaction(async session => {
      const challenge = await GlobalPatientOtp.findOne(filter()).session(session);
      if (!challenge) throw invalid();
      let patient;
      const now = new Date();
      if (purpose === "register") {
        [patient] = await GlobalPatient.create([{ email: challenge.email, username: normalizedUsername,
          passwordHash, credentialsSetAt: now, status: "active" }], { session });
      } else {
        patient = await GlobalPatient.findOne({ _id: challenge.patientId, email: challenge.email,
          status: "active", ...versionMatch(challenge.tokenVersionAtIssue),
        }).select("+tokenVersion").session(session);
        if (!patient) throw conflict();
        // Recovery never changes an existing username or assigns a new identity.
        if (patient.username && patient.username !== normalizedUsername) throw Object.assign(
          new Error("Use the existing username shown for your account."), { status: 400 });
        const updated = await GlobalPatient.updateOne({ _id: patient._id, email: challenge.email,
          status: "active", ...versionMatch(challenge.tokenVersionAtIssue),
        }, { $set: { username: normalizedUsername, passwordHash, credentialsSetAt: now },
          $inc: { tokenVersion: 1 },
        }, { session, runValidators: true });
        if (updated.modifiedCount !== 1) throw conflict();
        await PatientSession.updateMany({ patientId: patient._id, revokedAt: null },
          { $set: { revokedAt: now } }, { session });
      }
      const consumed = await GlobalPatientOtp.deleteOne({ _id: challenge._id, ...filter() }, { session });
      if (consumed.deletedCount !== 1) throw invalid();
      return { patientId: patient._id, email: challenge.email, username: normalizedUsername };
    });
  } catch (error) {
    if (error?.code === 11000) {
      if (error.keyPattern?.username || error.keyValue?.username) throw Object.assign(
        new Error("This username is already taken. Please choose another."), { status: 409 });
      throw conflict();
    }
    throw error;
  }
}
