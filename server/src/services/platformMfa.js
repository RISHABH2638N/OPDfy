import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import SuperAdmin from "../models/SuperAdmin.js";
import { verifySessionToken } from "../utils/sessionTokens.js";
import { newTotpSecret, verifyTotp } from "../utils/totp.js";
const fail = (message = "Invalid or expired verification.", status = 401) => Object.assign(new Error(message), { status });
export const mfaRequired = () => process.env.PLATFORM_MFA_REQUIRED === "true";
export const mfaConfigured = () => String(process.env.PLATFORM_MFA_ENCRYPTION_SECRET || "").length >= 32;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
function encryptionKey() {
  if (!mfaConfigured()) throw fail("Platform MFA encryption is not configured. Contact the operator.", 503);
  return crypto.createHash("sha256").update(process.env.PLATFORM_MFA_ENCRYPTION_SECRET).digest();
}
export function encryptMfaSecret(secret, id) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`opdfy-owner-mfa:${id}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString("hex")).join(":");
}
export function decryptMfaSecret(encoded, id) {
  const parts = String(encoded || "").split(":");
  if (parts.length !== 3 || !parts.every(p => /^[a-f0-9]+$/.test(p))) throw fail();
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[0], "hex"));
  decipher.setAAD(Buffer.from(`opdfy-owner-mfa:${id}`)); decipher.setAuthTag(Buffer.from(parts[1], "hex"));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], "hex")), decipher.final()]).toString("utf8");
}
const versionFilter = version => ({ $or: [{ tokenVersion: version }, ...(version === 0 ? [{ tokenVersion: { $exists: false } }] : [])] });
export function ownerSession(account, verifiedMfa = false) {
  const token = jwt.sign({ id: String(account._id), role: "superadmin", ver: Number(account.tokenVersion || 0), mfa: verifiedMfa },
    process.env.SUPER_ADMIN_JWT_SECRET, { expiresIn: process.env.NODE_ENV === "production" ? "30m" : "4h" });
  return { token, user: { id: account._id, name: account.name, email: account.email, role: "superadmin",
    mfaEnabled: Boolean(account.mfaEnabled), mfaEnrollmentRequired: mfaRequired() && !account.mfaEnabled } };
}
async function owner(id, password) {
  if (typeof password !== "string" || !password || Buffer.byteLength(password) > 72) throw fail("Fresh platform password verification failed.", 403);
  const account = await SuperAdmin.findOne({ _id: id, status: "active" }).select("+passwordHash +tokenVersion +mfa");
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) throw fail("Fresh platform password verification failed.", 403);
  return account;
}
function recoveryCodes() {
  return Array.from({ length: 10 }, () => crypto.randomBytes(10).toString("hex").match(/.{4}/g).join("-"));
}
const recoveryHash = (id, code) => digest(`owner-recovery:${id}:${code.replaceAll("-", "").toLowerCase()}`);
function factor(account, code) {
  if (!account.mfaEnabled || !account.mfa?.secretEncrypted) throw fail();
  const secret = decryptMfaSecret(account.mfa.secretEncrypted, account._id);
  const counter = verifyTotp(secret, code, { lastCounter: account.mfa.lastCounter ?? -1 });
  if (counter !== null) return { query: { "mfa.lastCounter": { $lt: counter } }, update: { $set: { "mfa.lastCounter": counter } } };
  if (typeof code === "string" && /^[a-f0-9-]{20,24}$/i.test(code) && /^[a-f0-9]{20}$/i.test(code.replaceAll("-", ""))) {
    const hash = recoveryHash(account._id, code);
    if (account.mfa.recoveryHashes?.includes(hash)) return { query: { "mfa.recoveryHashes": hash }, update: { $pull: { "mfa.recoveryHashes": hash } } };
  }
  throw fail();
}
export async function beginOwnerEnrollment(id, password) {
  const account = await owner(id, password);
  if (account.mfaEnabled) throw fail("MFA is already enabled.", 409);
  const secret = newTotpSecret();
  const updated = await SuperAdmin.updateOne({ _id: id, status: "active", mfaEnabled: { $ne: true }, ...versionFilter(Number(account.tokenVersion || 0)) },
    { $set: { "mfa.pendingEncrypted": encryptMfaSecret(secret, id), "mfa.pendingExpiresAt": new Date(Date.now() + 10 * 60000) } });
  if (!updated.modifiedCount) throw fail();
  return { secret, otpauthUri: `otpauth://totp/${encodeURIComponent(`OPDfy:${account.email}`)}?secret=${secret}&issuer=OPDfy&algorithm=SHA1&digits=6&period=30` };
}
export async function enableOwnerMfa(id, password, code) {
  const account = await owner(id, password);
  if (account.mfaEnabled || !account.mfa?.pendingEncrypted || !(account.mfa.pendingExpiresAt > new Date())) throw fail();
  const secret = decryptMfaSecret(account.mfa.pendingEncrypted, id);
  const counter = verifyTotp(secret, code); if (counter === null) throw fail();
  const codes = recoveryCodes(), version = Number(account.tokenVersion || 0);
  const saved = await SuperAdmin.findOneAndUpdate({ _id: id, status: "active", mfaEnabled: { $ne: true },
    "mfa.pendingEncrypted": account.mfa.pendingEncrypted, "mfa.pendingExpiresAt": { $gt: new Date() }, ...versionFilter(version),
  }, { $set: { mfaEnabled: true, mfa: { secretEncrypted: account.mfa.pendingEncrypted, lastCounter: counter,
    recoveryHashes: codes.map(c => recoveryHash(id, c)) } }, $inc: { tokenVersion: 1 } }, { new: true }).select("+tokenVersion");
  if (!saved) throw fail();
  return { ...ownerSession(saved, true), recoveryCodes: codes };
}
export async function issueOwnerChallenge(account) {
  const nonce = crypto.randomBytes(24).toString("hex"), version = Number(account.tokenVersion || 0);
  const updated = await SuperAdmin.updateOne({ _id: account._id, status: "active", mfaEnabled: true, ...versionFilter(version) },
    { $set: { "mfa.challengeHash": digest(nonce), "mfa.challengeExpiresAt": new Date(Date.now() + 5 * 60000) } });
  if (!updated.modifiedCount) throw fail();
  return { mfaRequired: true, challengeToken: jwt.sign({ id: String(account._id), role: "superadmin-mfa-challenge", ver: version, jti: nonce },
    process.env.SUPER_ADMIN_JWT_SECRET, { expiresIn: "5m" }) };
}
export function decodeOwnerChallenge(token) {
  if (typeof token !== "string" || token.length > 4096) throw fail();
  try {
    const decoded = verifySessionToken(token, process.env.SUPER_ADMIN_JWT_SECRET);
    if (decoded.role !== "superadmin-mfa-challenge" || typeof decoded.jti !== "string") throw fail();
    return decoded;
  } catch { throw fail(); }
}
export async function finishOwnerChallenge(challengeToken, code) {
  const decoded = decodeOwnerChallenge(challengeToken);
  const account = await SuperAdmin.findOne({ _id: decoded.id, status: "active", mfaEnabled: true }).select("+mfa +tokenVersion");
  if (!account || Number(account.tokenVersion || 0) !== decoded.ver) throw fail();
  const proof = factor(account, code);
  const saved = await SuperAdmin.findOneAndUpdate({ _id: account._id, status: "active", mfaEnabled: true,
    "mfa.challengeHash": digest(decoded.jti), "mfa.challengeExpiresAt": { $gt: new Date() },
    ...versionFilter(decoded.ver), ...proof.query,
  }, { ...proof.update, $unset: { "mfa.challengeHash": 1, "mfa.challengeExpiresAt": 1 } }, { new: true }).select("+tokenVersion");
  if (!saved) throw fail();
  return ownerSession(saved, true);
}
export async function changeOwnerMfa(id, password, code, regenerate = false) {
  const account = await owner(id, password), proof = factor(account, code);
  const codes = regenerate ? recoveryCodes() : [];
  const update = regenerate ? { $set: { ...(proof.update.$set || {}), "mfa.recoveryHashes": codes.map(c => recoveryHash(id, c)) } } : { $set: { mfaEnabled: false }, $unset: { mfa: 1 } };
  update.$inc = { tokenVersion: 1 };
  const saved = await SuperAdmin.findOneAndUpdate({ _id: id, status: "active", mfaEnabled: true,
    ...versionFilter(Number(account.tokenVersion || 0)), ...proof.query,
  }, update, { new: true }).select("+tokenVersion");
  if (!saved) throw fail();
  return { ...ownerSession(saved, regenerate), ...(regenerate ? { recoveryCodes: codes } : {}) };
}
