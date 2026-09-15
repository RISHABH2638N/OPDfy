const PROD = process.env.NODE_ENV === "production";

function positiveInt(name, fallback, min = 1, max = 100000) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export const runtimeConfig = Object.freeze({
  isProduction: PROD,
  loginWindowMs: positiveInt("LOGIN_RATE_WINDOW_MINUTES", 15, 1, 120) * 60 * 1000,
  loginIpMax: positiveInt("LOGIN_RATE_IP_MAX", PROD ? 30 : 100, 1, 500),
  loginEmailMax: positiveInt("LOGIN_RATE_EMAIL_MAX", PROD ? 5 : 20, 1, 500),
  apiRateMax: positiveInt("API_RATE_MAX_PER_MINUTE", 300, 30, 5000),
  mongoServerSelectionTimeoutMs: positiveInt("MONGO_SERVER_SELECTION_TIMEOUT_MS", 10000, 1000, 60000),
  mongoConnectTimeoutMs: positiveInt("MONGO_CONNECT_TIMEOUT_MS", 10000, 1000, 60000),
  mongoSocketTimeoutMs: positiveInt("MONGO_SOCKET_TIMEOUT_MS", 45000, 5000, 300000),
});

export function validateRuntimeEnv() {
  const missing = ["MONGO_URI", "JWT_SECRET"].filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);

  if (PROD) {
    const secretNames = ["JWT_SECRET", "SUPER_ADMIN_JWT_SECRET", "QR_JWT_SECRET", "DISPLAY_KEY_ENCRYPTION_SECRET"];
    const secretValues = secretNames.map((name) => String(process.env[name] || ""));
    if (new Set(secretValues).size !== secretValues.length) throw new Error("Production secrets must be distinct.");
    if (secretValues.some((value) => /replace|change.?me|your.long|example|placeholder/i.test(value) || new Set(value).size < 12)) throw new Error("Generate random production secrets; placeholders and repeated values are not accepted.");
    const weak = [];
    if (String(process.env.JWT_SECRET || "").length < 32) weak.push("JWT_SECRET");
    if (String(process.env.SUPER_ADMIN_JWT_SECRET || "").length < 32) weak.push("SUPER_ADMIN_JWT_SECRET");
    if (String(process.env.QR_JWT_SECRET || "").length < 32) weak.push("QR_JWT_SECRET");
    if (String(process.env.DISPLAY_KEY_ENCRYPTION_SECRET || "").length < 32) weak.push("DISPLAY_KEY_ENCRYPTION_SECRET");
    if (weak.length) throw new Error(`Production secret(s) must be at least 32 characters: ${weak.join(", ")}`);
    if (!String(process.env.CLIENT_URL || "").trim()) throw new Error("CLIENT_URL is required in production.");
    const origins = String(process.env.CLIENT_URL).split(",").map((value) => value.trim());
    if (origins.some((origin) => { try { const url = new URL(origin); return url.protocol !== "https:" || origin !== url.origin; } catch { return true; } })) throw new Error("CLIENT_URL must contain exact HTTPS origins without paths.");
    const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
    if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 5.");
    if (String(process.env.DEFAULT_TENANT_SLUG || "").trim()) {
      throw new Error("DEFAULT_TENANT_SLUG must be empty in production; explicit clinic context is required.");
    }
  }
}
