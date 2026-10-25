import crypto from "node:crypto";
import { logSecurityEvent } from "../utils/securityEvents.js";
const routes = [
  [/^\/api\/tokens\/(?:private$|[^/]+\/(?:conditions|patient-profile)$)/, "queue", "/api/tokens/:private-resource"],
  [/^\/api\/reception\/(?:patients|prescriptions|appointments|tokens|reservations|payments)(?:\/|$)/, "reception", "/api/reception/:patient-resource"],
  [/^\/api\/admin\/(?:patients|analytics|condition-insights|revenue|exports?)(?:\/|$)/, "administration", "/api/admin/:patient-resource"],
  [/^\/api\/consultations(?:\/|$)/, "consultation", "/api/consultations/:resource"],
  [/^\/api\/patients\/(?:me|history|records)(?:\/|$)/, "patient-self", "/api/patients/:self-resource"],
  [/^\/api\/patient-auth\/(?:me|profile)$/, "global-profile", "/api/patient-auth/:self-profile"],
  [/^\/api\/(?:privacy|privacy-clinic)(?:\/|$)/, "privacy", "/api/privacy/:resource"],
  [/^\/api\/(?:clinical-consents|referrals|feedback)(?:\/|$)/, "clinical-operation", "/api/:clinical-resource"],
];
export function sensitiveAccessDescriptor(path) {
  const clean = String(path || "").split("?", 1)[0];
  const entry = routes.find(([pattern]) => pattern.test(clean));
  return entry ? { type: entry[1], route: entry[2], export: /\/(?:export|download)(?:\/|$)/.test(clean) } : null;
}
export function sensitiveAccessAudit(req, res, next) {
  if (req.method !== "GET") return next();
  const descriptor = sensitiveAccessDescriptor(req.originalUrl || req.url);
  if (!descriptor) return next();
  res.once("finish", () => {
    const actor = req.superAdmin ? { actorType: "superadmin", actorId: req.superAdmin.id } : req.user
      ? { actorType: "staff", actorId: req.user.id || req.user._id }
      : req.globalPatient ? { actorType: "patient", actorId: req.globalPatient._id }
      : req.patientAuth ? { actorType: "patient", actorId: req.patientAuth.globalPatientId }
      : { actorType: "anonymous", actorId: "" };
    const path = String(req.originalUrl || req.url || "").split("?", 1)[0];
    const id = path.match(/(?:^|\/)([a-f0-9]{24})(?:\/|$)/i)?.[1];
    const auditReq = Object.create(req);
    // Never retain arbitrary path segments or query-string patient details.
    auditReq.originalUrl = descriptor.route;
    logSecurityEvent(auditReq, { event: descriptor.export ? "bulk_data_export" : "patient_data_access",
      outcome: res.statusCode < 400 ? "success" : [401, 403].includes(res.statusCode) ? "blocked" : "failure",
      ...actor, tenantId: req.tenantId || null,
      metadata: { status: res.statusCode, resourceType: descriptor.type,
        ...(id ? { resourceId: crypto.createHmac("sha256", process.env.JWT_SECRET || "local-audit").update(id.toLowerCase()).digest("hex") } : {}),
        role: req.user?.role || req.superAdmin?.role || (actor.actorType === "patient" ? "patient" : "anonymous") },
    });
  });
  next();
}
