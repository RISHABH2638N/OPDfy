import SecurityEvent from "../models/SecurityEvent.js";
import { safeRoute, safeSecurityMetadata, safeDiagnostic } from "./privacySafeLog.js";
import { evaluateSecurityEvent } from "../services/incidentResponseService.js";

export function logSecurityEvent(req, { event, outcome, actorType = "anonymous", actorId = "", tenantId = null, metadata = {} }) {
  SecurityEvent.create({
    tenantId: tenantId || req?.tenantId || null,
    actorType, actorId: String(actorId || "").slice(0, 80), event, outcome,
    ip: String(req?.ip || req?.socket?.remoteAddress || "").slice(0, 80),
    route: safeRoute(req?.originalUrl || req?.url), metadata: safeSecurityMetadata(metadata),
  }).then(record => evaluateSecurityEvent(record).catch(error => console.warn("Incident detection skipped:", safeDiagnostic(error))))
    .catch(error => console.warn("Security event log skipped:", safeDiagnostic(error)));
}
