import Token from "../models/Token.js";

const DEFAULT_MAX_RETRIES = 5;

async function nextDepartmentTokenNumber(tenantId, department) {
  const last = await Token.findOne({
    tenantId: tenantId || null,
    department,
    isArchived: { $ne: true },
  })
    .sort({ tokenNumber: -1 })
    .select("tokenNumber")
    .lean();

  return Number(last?.tokenNumber || 0) + 1;
}

function isDepartmentTokenCollision(error) {
  if (error?.code !== 11000) return false;

  const pattern = error?.keyPattern || {};
  return Boolean(pattern.department && pattern.tokenNumber);
}

/**
 * Creates an active queue token with bounded retry protection for the
 * department-scoped unique token number.
 *
 * Callers remain responsible for authorization, patient/doctor validation,
 * availability checks, and duplicate-active-token business rules.
 */
export async function createQueueToken(payload, { maxRetries = DEFAULT_MAX_RETRIES } = {}) {
  if (!payload?.department) {
    const error = new Error("Department is required to issue a queue token.");
    error.status = 400;
    throw error;
  }

  let lastCollision = null;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const tokenNumber = await nextDepartmentTokenNumber(payload.tenantId, payload.department);

    try {
      return await Token.create({
        ...payload,
        tokenNumber,
      });
    } catch (error) {
      if (!isDepartmentTokenCollision(error)) {
        throw error;
      }
      lastCollision = error;
    }
  }

  const error = new Error(
    "Queue is busy right now. Please retry token issuance in a moment."
  );
  error.status = 409;
  error.cause = lastCollision;
  throw error;
}
