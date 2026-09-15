import crypto from "node:crypto";
const allowedMetadata = new Set(["requestId", "caseId", "incidentId", "policyId", "clinicId", "status", "type", "kind", "purpose", "decision", "version", "attempts", "code", "audience", "key", "retainedClinicCount", "count", "role", "severity"]);
export function safeRoute(value) {
  return String(value || "").split(/[?#]/, 1)[0]
    .replace(/\/[a-f0-9]{24}(?=\/|$)/gi, "/:id")
    .replace(/\/[a-f0-9]{48,}(?=\/|$)/gi, "/:key")
    .slice(0, 180);
}
export function safeSecurityMetadata(value = {}) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value).slice(0, 25)) {
    if (!allowedMetadata.has(key)) continue;
    if (raw === null || typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw))) out[key] = raw;
    else if (typeof raw === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(raw)) out[key] = raw;
  }
  return out;
}
export function safeDiagnostic(error) {
  const code = String(error?.code || "");
  if (/^(?:[A-Z][A-Z0-9_]{0,59}|[0-9]{1,6})$/.test(code)) return code;
  const name = String(error?.name || "");
  return /^[A-Za-z]{2,50}Error$/.test(name) ? name : "ERROR";
}
export function auditRetentionDays(value, fallback = 365) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 365 && n <= 3650 ? n : fallback;
}
export function securityEventFingerprint(event) {
  return crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
}
