import ActivityLog from "../models/ActivityLog.js";
import { safeRoute, auditRetentionDays, safeDiagnostic } from "../utils/privacySafeLog.js";
import { runWithTenant } from "../services/tenantExecutionContext.js";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const DEFAULT_RETENTION_DAYS = auditRetentionDays(process.env.AUDIT_LOG_RETENTION_DAYS);

function sanitizePath(req) {
  return safeRoute(req.originalUrl || req.url);
}

function targetFromUrl(req) {
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  const objectId = path.match(/\/([a-f\d]{24})(?:\/|$)/i)?.[1];
  return objectId || "";
}

function describe(req) {
  const method = req.method.toUpperCase();
  const path = sanitizePath(req);

  const rules = [
    [/^\/api\/admin\/users$/, "Staff", method === "POST" ? "CREATE_STAFF" : "UPDATE_STAFF", "Created a staff account"],
    [/^\/api\/admin\/users\/:id\/schedule$/, "Staff", "UPDATE_DOCTOR_SCHEDULE", "Updated a doctor schedule or room assignment"],
    [/^\/api\/admin\/users\/:id$/, "Staff", "DELETE_STAFF", "Deleted a staff login account"],
    [/^\/api\/admin\/clinic-branding$/, "Clinic Settings", "UPDATE_CLINIC_BRANDING", "Updated clinic branding or contact settings"],
    [/^\/api\/admin\/billing-settings$/, "Billing", "UPDATE_BILLING_SETTINGS", "Updated clinic OPD billing and fee rules"],
    [/^\/api\/admin\/users\/:id\/billing-profile$/, "Billing", "UPDATE_DOCTOR_FEES", "Updated a doctor fee profile"],
    [/^\/api\/admin\/payments\/:id\/refund$/, "Billing", "REFUND_PAYMENT", "Marked an OPD payment as refunded"],
    [/^\/api\/admin\/waiting-lounge-displays$/, "TV Display", "CREATE_TV_DISPLAY", "Created a secure waiting lounge TV display"],
    [/^\/api\/admin\/waiting-lounge-displays\/:id\/rotate-key$/, "TV Display", "ROTATE_TV_DISPLAY_KEY", "Regenerated a secure TV display link"],
    [/^\/api\/admin\/waiting-lounge-displays\/:id$/, "TV Display", method === "DELETE" ? "DELETE_TV_DISPLAY" : "UPDATE_TV_DISPLAY", method === "DELETE" ? "Removed a waiting lounge TV display" : "Updated waiting lounge TV settings"],
    [/^\/api\/reception\/patients$/, "Reception", "REGISTER_PATIENT", "Registered a walk-in patient"],
    [/^\/api\/reception\/tokens$/, "Queue", "ISSUE_WALKIN_TOKEN", "Issued a walk-in queue token"],
    [/^\/api\/reception\/reservations\/:id\/check-in$/, "Queue", "CHECK_IN_RESERVATION", "Checked in an online reservation to the live FCFS queue"],
    [/^\/api\/reception\/appointments$/, "Appointments", "BOOK_APPOINTMENT", "Booked an appointment from reception"],
    [/^\/api\/reception\/appointments\/:id\/check-in$/, "Appointments", "CHECK_IN_APPOINTMENT", "Checked in a scheduled appointment"],
    [/^\/api\/reception\/tokens\/:id\/doctor$/, "Queue", "ASSIGN_DOCTOR", "Assigned or changed the doctor for a waiting token"],
    [/^\/api\/reception\/tokens\/:id\/arrival$/, "Queue", "UPDATE_ARRIVAL", "Updated patient arrival / no-show status"],
    [/^\/api\/reception\/tokens\/:id\/intervention$/, "Queue", "QUEUE_INTERVENTION", "Reception performed a controlled queue intervention"],
    [/^\/api\/reception\/prescriptions\/:id\/printed$/, "Prescription", "PRINT_PRESCRIPTION", "Reception printed a completed prescription"],
    [/^\/api\/tokens\/:id\/status$/, "Queue", "UPDATE_TOKEN_STATUS", "Updated a live token status"],
    [/^\/api\/tokens\/reset$/, "Queue", "RESET_DAILY_QUEUE", "Reset and archived the daily queue"],
    [/^\/api\/consultations$/, "Consultation", "COMPLETE_CONSULTATION", "Completed a consultation"],
  ];

  for (const [pattern, module, action, summary] of rules) {
    if (pattern.test(path)) return { module, action, summary };
  }

  return {
    module: path.split("/")[2] || "Operations",
    action: `${method}_OPERATION`,
    summary: `Completed ${method} operation in ${path.split("/")[2] || "operations"}`,
  };
}

export function activityAuditMiddleware(req, res, next) {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return next();

  res.on("finish", () => {
    if (!req.user || !["admin", "doctor", "receptionist"].includes(req.user.role)) return;
    if (res.statusCode >= 400) return;
    if (!req.tenantId) return;

    const tenantId = String(req.tenantId);
    const descriptor = res.locals.auditDescriptor || describe(req);
    const expiresAt = new Date(Date.now() + DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    runWithTenant(tenantId, async () => {
      try {
        await ActivityLog.create({
          tenantId,
          actorId: req.user.id || null,
          actorName: req.user.name || "Staff User",
          actorRole: req.user.role,
          action: descriptor.action,
          module: descriptor.module,
          summary: descriptor.summary,
          method: req.method.toUpperCase(),
          route: sanitizePath(req),
          statusCode: res.statusCode,
          targetId: targetFromUrl(req),
          expiresAt,
        });
      } catch (error) {
        // Audit logging must never break a live OPD workflow.
        console.error("Activity audit write skipped:", safeDiagnostic(error));
      }
    });
  });

  next();
}
