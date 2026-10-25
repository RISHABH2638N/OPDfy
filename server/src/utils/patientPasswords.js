import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
// OWASP's 32 MiB scrypt profile; asynchronous native hashing keeps the event
// loop available and needs no additional package or native build step.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const prefix = "scrypt$32768$8$3";
const common = new Set([
  "password123456789", "password1234567890", "123456789012345",
  "1234567890123456", "qwerty1234567890", "thisisapassword", "letmein123456789",
]);

export const normalizeUsername = value => typeof value === "string" ? value.trim().toLowerCase() : "";
export const validUsername = value => /^[a-z0-9][a-z0-9_.]{2,29}$/.test(value);
export const boundedPassword = value => typeof value === "string" &&
  [...value].length <= 128 && Buffer.byteLength(value, "utf8") <= 512;
export const validPatientPassword = value => boundedPassword(value) &&
  [...value].length >= 15 && !/^(.)\1+$/u.test(value) &&
  !common.has(value.toLowerCase().trim());

export async function hashPatientPassword(password) {
  if (!validPatientPassword(password)) throw Object.assign(new Error(
    "Use a password of 15–128 characters. Avoid common passwords or a single repeated character."
  ), { status: 400 });
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, options);
  return `${prefix}$${salt}$${key.toString("hex")}`;
}

export async function verifyPatientPassword(password, encoded) {
  if (!boundedPassword(password)) return false;
  const parts = typeof encoded === "string" ? encoded.split("$") : [];
  const valid = parts.length === 6 && parts.slice(0, 4).join("$") === prefix &&
    /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  // Missing accounts and legacy accounts still pay the same hashing cost.
  // Never accept arbitrary cost parameters from a stored value.
  const salt = valid ? parts[4] : "0".repeat(32);
  const expected = Buffer.from(valid ? parts[5] : "0".repeat(128), "hex");
  const actual = await scrypt(password, salt, 64, options);
  return crypto.timingSafeEqual(actual, expected) && valid;
}
