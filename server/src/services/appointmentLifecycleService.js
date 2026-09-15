import Appointment from "../models/Appointment.js";
import Token from "../models/Token.js";
import Tenant from "../models/Tenant.js";
import { currentTenantId } from "./tenantExecutionContext.js";
import { getClinicOperations, hospitalLocalDateTime } from "../utils/clinicOperations.js";

export const ACTIVE_APPOINTMENT_STATUSES = ["booked", "checked_in"];
export const SLOT_OCCUPYING_APPOINTMENT_STATUSES = [
  "booked",
  "checked_in",
  "completed",
  "skipped",
];

export function appointmentStatusFromTokenStatus(tokenStatus) {
  if (tokenStatus === "waiting" || tokenStatus === "called") return "checked_in";
  if (tokenStatus === "completed") return "completed";
  if (tokenStatus === "skipped") return "skipped";
  return null;
}

/**
 * Keeps a linked Appointment consistent with its queue Token lifecycle.
 */
export async function syncAppointmentFromToken(token) {
  if (!token?.appointment) return null;

  const status = appointmentStatusFromTokenStatus(token.status);
  if (!status) return null;

  return Appointment.findByIdAndUpdate(
    token.appointment,
    { $set: { status } },
    { new: true }
  );
}


export async function markMissedAppointments(now = new Date()) {
  const tenantId = currentTenantId();
  if (!tenantId) return 0;
  const tenant = await Tenant.findById(tenantId).select("timezone settings.operations").lean();
  const local = hospitalLocalDateTime(tenant, now);
  const grace = getClinicOperations(tenant).missedGraceMinutes;
  const [hour, minute] = local.time.split(":").map(Number);
  const currentMinutes = hour * 60 + minute;

  const candidates = await Appointment.find({
    status: "booked",
    appointmentDate: { $lte: local.date },
  }).select("_id appointmentDate startTime").lean();

  const missedIds = candidates.filter((item) => {
    if (item.appointmentDate < local.date) return true;
    const match = String(item.startTime || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) return false;
    const slotMinutes = Number(match[1]) * 60 + Number(match[2]);
    return currentMinutes >= slotMinutes + grace;
  }).map((item) => item._id);

  if (!missedIds.length) return 0;
  const result = await Appointment.updateMany(
    { _id: { $in: missedIds }, status: "booked" },
    {
      $set: { status: "missed", missedAt: now },
      $unset: { slotKey: "" },
    }
  );
  return Number(result.modifiedCount || 0);
}

/**
 * Repairs legacy/stale checked-in appointment rows left by older builds.
 *
 * Explicitly cancelled appointments are never overwritten. The linked token is
 * treated as the source of truth once a check-in token exists.
 */
export async function reconcileLinkedAppointmentStatuses() {
  const appointments = await Appointment.find({
    token: { $ne: null },
    status: { $ne: "cancelled" },
  })
    .select("_id token status")
    .lean();

  if (!appointments.length) return 0;

  const tokenIds = appointments
    .map((appointment) => appointment.token)
    .filter(Boolean);

  const tokens = await Token.find({ _id: { $in: tokenIds } })
    .select("_id status")
    .lean();

  const statusByToken = new Map(
    tokens.map((token) => [
      String(token._id),
      appointmentStatusFromTokenStatus(token.status),
    ])
  );

  const operations = appointments.flatMap((appointment) => {
    const expectedStatus = statusByToken.get(String(appointment.token));
    if (!expectedStatus || expectedStatus === appointment.status) return [];

    return [{
      updateOne: {
        filter: { _id: appointment._id, tenantId: currentTenantId(), status: { $ne: "cancelled" } },
        update: { $set: { status: expectedStatus } },
      },
    }];
  });

  if (!operations.length) return 0;

  const result = await Appointment.bulkWrite(operations, { ordered: false });
  return Number(result.modifiedCount || 0);
}
