import crypto from "crypto";

function encryptionSecret() {
  const value = String(process.env.DISPLAY_KEY_ENCRYPTION_SECRET || "").trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DISPLAY_KEY_ENCRYPTION_SECRET is required in production.");
  }
  return String(process.env.JWT_SECRET || "development-display-key");
}

export function hashDisplayKey(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function encryptDisplayKey(value) {
  const key = crypto.createHash("sha256").update(encryptionSecret()).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptDisplayKey(value) {
  try {
    const [ivRaw, tagRaw, encryptedRaw] = String(value || "").split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) return "";
    const key = crypto.createHash("sha256").update(encryptionSecret()).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

export function newDisplayCredential(days = 90) {
  const accessKey = crypto.randomBytes(24).toString("hex");
  return {
    accessKey,
    accessKeyHash: hashDisplayKey(accessKey),
    accessKeyEncrypted: encryptDisplayKey(accessKey),
    accessKeyExpiresAt: new Date(Date.now() + Math.max(1, days) * 86400000),
  };
}
