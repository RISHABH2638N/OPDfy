import { currentTenantId } from "./tenantExecutionContext.js";

const SAFE_OPERATION_DOMAINS = new Set([
  "queue",
  "appointments",
  "analytics",
  "staff",
  "feedback",
  "reservations",
  "billing",
  "settings",
  "referrals",
]);

/**
 * Broadcasts only a privacy-safe invalidation signal.
 *
 * No patient/staff record data is sent through this event. Authenticated
 * dashboards use the signal to refetch their own authorized API views.
 */
export function emitOperationalUpdate(io, domains = []) {
  if (!io) return;

  const requested = Array.isArray(domains) ? domains : [domains];
  const safeDomains = [...new Set(
    requested
      .map((value) => String(value || "").trim())
      .filter((value) => SAFE_OPERATION_DOMAINS.has(value))
  )];

  if (!safeDomains.length) return;

  const tenantId = currentTenantId();
  if (!tenantId) return;

  io.to(`tenant:${tenantId}`).emit("operations:updated", {
    domains: safeDomains,
    revisionAt: new Date().toISOString(),
  });
}


export function emitQueueUpdate(io, queue = []) {
  if (!io) return;
  const tenantId = currentTenantId();
  if (!tenantId) return;
  const safeQueue = Array.isArray(queue) ? queue.map((item) => ({
    tokenNumber: item?.tokenNumber,
    department: item?.department,
    status: item?.status,
    urgency: item?.urgency,
    calledAt: item?.calledAt || null,
    doctorName: item?.doctorName || "",
    roomNumber: item?.roomNumber || "",
  })) : [];
  io.to(`tenant:${tenantId}`).to(`public:${tenantId}`).emit("queue:updated", safeQueue);
}


/**
 * Sends a minimal live token snapshot only to the authenticated patient room.
 * This avoids a second API/DB round trip for the common token lifecycle path
 * while keeping patient data out of public/tenant-wide queue broadcasts.
 */
export function emitPatientTokenUpdate(io, patientId, token) {
  if (!io || !patientId || !token) return;

  io.to(`patient:${String(patientId)}`).emit("patient:token-updated", {
    _id: String(token._id),
    id: String(token._id),
    patientId: token.patientId || "",
    tokenNumber: token.tokenNumber,
    status: token.status,
    department: token.department,
    urgency: token.urgency,
    assignedDoctor: token.assignedDoctor || null,
    arrivalStatus: token.arrivalStatus || "not_checked_in",
    queueSource: token.queueSource || "walk_in",
    calledAt: token.calledAt || null,
    completedAt: token.completedAt || null,
    isArchived: Boolean(token.isArchived),
  });
}

// Private invalidation only. Clinical referral text is never broadcast.
export function emitPatientReferralUpdate(io, patientId) {
  if (!io || !patientId) return;
  io.to(`patient:${String(patientId)}`).emit("patient:referrals-updated", {});
}
