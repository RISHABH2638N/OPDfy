import crypto from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buffer) {
  let value = 0, bits = 0, result = "";
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decode(secret) {
  if (typeof secret !== "string" || !/^[A-Z2-7]{16,128}$/.test(secret)) throw new Error("Invalid TOTP secret.");
  let value = 0, bits = 0; const bytes = [];
  for (const c of secret) { value = (value << 5) | alphabet.indexOf(c); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(bytes);
}
export function totp(secret, { time = Date.now(), digits = 6, counter = Math.floor(time / 30000) } = {}) {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", decode(secret)).update(message).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, "0");
}
export function verifyTotp(secret, code, { now = Date.now(), lastCounter = -1 } = {}) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000); let matched = null;
  for (const counter of [current - 1, current, current + 1]) {
    if (counter < 0) continue;
    if (crypto.timingSafeEqual(Buffer.from(totp(secret, { counter })), Buffer.from(code)) && counter > lastCounter) matched = counter;
  }
  return matched;
}
export const newTotpSecret = () => base32(crypto.randomBytes(20));
