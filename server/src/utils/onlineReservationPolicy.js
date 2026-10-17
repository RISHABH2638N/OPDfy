// Configurable per-clinic/doctor daily ONLINE reservation capacity.
// Walk-in token issuance is intentionally not governed by this policy.
export const MAX_DAILY_ONLINE_RESERVATIONS = 10000;
export const FALLBACK_DAILY_ONLINE_RESERVATIONS = 70;

export function onlineReservationLimit(doctor = null) {
  const override = doctor?.onlineReservationLimit;
  // Zero intentionally disables new online reservations for the doctor.
  if (Number.isInteger(override) && override >= 0 && override <= MAX_DAILY_ONLINE_RESERVATIONS) {
    return override;
  }
  const legacy = Number(process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR);
  return Number.isSafeInteger(legacy) && legacy > 0 && legacy <= MAX_DAILY_ONLINE_RESERVATIONS
    ? legacy : FALLBACK_DAILY_ONLINE_RESERVATIONS;
}

export function validateDoctorOnlineLimit(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_DAILY_ONLINE_RESERVATIONS) {
    const error = new Error(`Online limit must be a whole number from 0 to ${MAX_DAILY_ONLINE_RESERVATIONS}.`);
    error.status = 400;
    throw error;
  }
  return value;
}
