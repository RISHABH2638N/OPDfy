import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { sendEmail } from "../utils/sendEmail.js";

export const RESET_MESSAGE = "If this email belongs to a staff account at this clinic, a password reset code will be sent. Check your inbox and spam folder.";
const roles = ["admin", "doctor", "receptionist"];
const invalid = () => Object.assign(new Error("Invalid or expired code. Request a new code if needed."), { status: 400 });
export function resetDigest(tenant, id, email, nonce, otp) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(JSON.stringify(["staff-password-reset", String(tenant), String(id), email, nonce, otp])).digest("hex");
}
export function validResetPassword(value) {
  return typeof value === "string" && value.length >= 12 && Buffer.byteLength(value, "utf8") <= 72;
}

export async function requestStaffReset(tenantId, email, mailer = sendEmail) {
  const user = await User.findOne({ email, role: { $in: roles } }).select("+tokenVersion");
  if (!user) return;
  const now = new Date(), nonce = crypto.randomBytes(24).toString("hex");
  const otp = String(crypto.randomInt(100000, 1000000));
  const hash = resetDigest(tenantId, user._id, email, nonce, otp);
  const updated = await User.updateOne({
    _id: user._id, email,
    $or: [{ "passwordReset.sentAt": { $exists: false } }, { "passwordReset.sentAt": { $lte: new Date(now.getTime() - 60000) } }],
  }, { $set: { passwordReset: { hash, nonce, email, version: Number(user.tokenVersion || 0),
    sentAt: now, expiresAt: new Date(now.getTime() + 10 * 60000), attempts: 0 } } });
  if (!updated.modifiedCount) return;
  try {
    await mailer({ to: user.email, subject: "OPDfy — staff password reset",
      text: `Your staff password reset code is ${otp}. It expires in 10 minutes. Do not share this code. If you did not request a reset, ignore this email. Your password has not changed.` });
  } catch {
    await User.updateOne({ _id: user._id, "passwordReset.nonce": nonce }, { $unset: { passwordReset: 1 } });
    // Generic HTTP response must not reveal whether the address is registered.
    console.error("Staff password reset email could not be delivered. Check SMTP configuration/provider logs.");
  }
}

export async function finishStaffReset(tenantId, email, otp, password) {
  if (!/^\d{6}$/.test(otp) || !validResetPassword(password)) throw invalid();
  // Reserve each verification attempt atomically, including concurrent requests.
  const user = await User.findOneAndUpdate({ email, role: { $in: roles },
    "passwordReset.email": email, "passwordReset.expiresAt": { $gt: new Date() },
    "passwordReset.attempts": { $lt: 5 },
  }, { $inc: { "passwordReset.attempts": 1 } }, { new: true }).select("+passwordReset +tokenVersion");
  if (!user) throw invalid();
  const reset = user.passwordReset;
  const expected = resetDigest(tenantId, user._id, email, reset.nonce, otp);
  if (!/^[a-f0-9]{64}$/.test(reset.hash || "") ||
      !crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(reset.hash, "hex")) ||
      Number(user.tokenVersion || 0) !== reset.version) throw invalid();
  const passwordHash = await bcrypt.hash(password, 12);
  // Consume the code and change the password in ONE atomic document update.
  const result = await User.updateOne({ _id: user._id, email,
    "passwordReset.hash": reset.hash, "passwordReset.nonce": reset.nonce,
    "passwordReset.expiresAt": { $gt: new Date() }, "passwordReset.attempts": { $lte: 5 },
    $or: [{ tokenVersion: reset.version }, ...(reset.version === 0 ? [{ tokenVersion: { $exists: false } }] : [])],
  }, { $set: { passwordHash }, $inc: { tokenVersion: 1 }, $unset: { passwordReset: 1 } });
  if (result.modifiedCount !== 1) throw invalid();
  return user._id;
}
