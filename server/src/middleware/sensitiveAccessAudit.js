import { logSecurityEvent } from "../utils/securityEvents.js";

const PATIENT_DATA_ROUTES = [/^\/api\/admin\/(?:patients|analytics)/, /^\/api\/reception\/(?:patients|prescriptions)/, /^\/api\/consultations/, /^\/api\/patients\/(?:history|records)/];
const EXPORT_ROUTES = [/\/export(?:\/|$)/, /\/download(?:\/|$)/];

export function sensitiveAccessAudit(req, res, next) {
  if (req.method !== "GET") return next();
  res.on("finish", () => {
    if (res.statusCode >= 400 || !req.user || !req.tenantId) return;
    const path = String(req.originalUrl || req.url || "").split("?", 1)[0];
    if (EXPORT_ROUTES.some(pattern => pattern.test(path))) {
      logSecurityEvent(req, { event: "bulk_data_export", outcome: "success", actorType: "staff", actorId: req.user.id, tenantId: req.tenantId });
    } else if (PATIENT_DATA_ROUTES.some(pattern => pattern.test(path))) {
      logSecurityEvent(req, { event: "patient_data_access", outcome: "success", actorType: "staff", actorId: req.user.id, tenantId: req.tenantId });
    }
  });
  next();
}
