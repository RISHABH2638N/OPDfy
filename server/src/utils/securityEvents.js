import SecurityEvent from "../models/SecurityEvent.js";
import { safeRoute, safeSecurityMetadata, safeDiagnostic } from "./privacySafeLog.js";
import { evaluateSecurityEvent } from "../services/incidentResponseService.js";
const health = { accepted: 0, persisted: 0, failures: 0, dropped: 0, pending: 0, lastFailureAt: null, lastFailureCode: null };
let lastWarning = 0;
export function securityAuditHealth() { return { ...health }; }
function failure(error, dropped = false) {
  health.failures++; if (dropped) health.dropped++;
  health.lastFailureAt = new Date().toISOString(); health.lastFailureCode = safeDiagnostic(error);
  if (Date.now() - lastWarning > 60000) { lastWarning = Date.now(); console.warn("Security audit delivery failed:", health.lastFailureCode); }
}
export function logSecurityEvent(req, { event, outcome, actorType = "anonymous", actorId = "", tenantId = null, metadata = {} }) {
  if (health.pending >= 500) {
    failure(Object.assign(new Error(), { code: "AUDIT_QUEUE_FULL" }), true); return Promise.resolve(null);
  }
  health.accepted++; health.pending++;
  return Promise.resolve().then(() => SecurityEvent.create({
    tenantId: tenantId || req?.tenantId || null,
    actorType, actorId: String(actorId || "").slice(0, 80), event, outcome,
    ip: String(req?.ip || req?.socket?.remoteAddress || "").slice(0, 80),
    route: safeRoute(req?.originalUrl || req?.url), metadata: safeSecurityMetadata(metadata),
  })).then(record => {
    health.persisted++;
    // Monitoring cannot turn a persisted event into a failed audit write.
    Promise.resolve().then(() => evaluateSecurityEvent(record)).catch(error => console.warn("Incident detection skipped:", safeDiagnostic(error)));
    return record;
  }).catch(error => { failure(error); return null; }).finally(() => { health.pending--; });
}
