const text = (value, min, max, label) => {
  const normalized = String(value || "").trim();
  if (normalized.length < min || normalized.length > max) {
    throw Object.assign(new Error(`${label} must be between ${min} and ${max} characters.`), { status: 400 });
  }
  return normalized;
};

export const ESTABLISHMENT_TYPES = Object.freeze([
  "clinic", "polyclinic", "hospital", "nursing_home", "diagnostic_centre", "other",
]);

function optionalDate(value, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error(`${label} must be a valid date.`), { status: 400 });
  }
  const result = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(result.getTime())) throw Object.assign(new Error(`${label} must be a valid date.`), { status: 400 });
  return result;
}

export function cleanClinicLegalVerification(input = {}) {
  const establishmentType = String(input.establishmentType || "").trim();
  if (!ESTABLISHMENT_TYPES.includes(establishmentType)) {
    throw Object.assign(new Error("Choose a valid clinical establishment type."), { status: 400 });
  }
  return {
    legalName: text(input.legalName, 2, 160, "Legal establishment name"),
    establishmentType,
    registrationNumber: text(input.registrationNumber, 3, 100, "Clinical establishment registration number"),
    registrationAuthority: text(input.registrationAuthority, 2, 140, "Registration authority"),
    registrationState: text(input.registrationState, 2, 80, "Registration state or Union Territory"),
    certificateExpiresAt: optionalDate(input.certificateExpiresAt, "Certificate expiry"),
    evidenceReference: text(input.evidenceReference, 3, 240, "Evidence reference"),
  };
}

export function cleanDoctorProfessionalVerification(input = {}) {
  return {
    councilName: text(input.councilName, 2, 140, "Medical council name"),
    registrationState: text(input.registrationState, 2, 80, "Registration state or Union Territory"),
    registrationExpiresAt: optionalDate(input.registrationExpiresAt, "Registration expiry"),
    evidenceReference: text(input.evidenceReference, 3, 240, "Evidence reference"),
  };
}

export function effectiveVerificationStatus(record = {}, now = new Date()) {
  if (["platform_reviewed", "clinic_reviewed"].includes(record.status) &&
      record.certificateExpiresAt && new Date(record.certificateExpiresAt) < now) return "expired";
  if (["platform_reviewed", "clinic_reviewed"].includes(record.status) &&
      record.registrationExpiresAt && new Date(record.registrationExpiresAt) < now) return "expired";
  return record.status || "not_submitted";
}

export function publicClinicVerification(record = {}) {
  return {
    status: effectiveVerificationStatus(record),
    legalName: record.legalName || "",
    establishmentType: record.establishmentType || "",
    registrationAuthority: record.registrationAuthority || "",
    registrationState: record.registrationState || "",
    certificateExpiresAt: record.certificateExpiresAt || null,
    reviewedAt: record.reviewedAt || null,
  };
}

export function publicDoctorVerification(record = {}) {
  return {
    status: effectiveVerificationStatus(record),
    councilName: record.councilName || "",
    registrationState: record.registrationState || "",
    registrationExpiresAt: record.registrationExpiresAt || null,
    reviewedAt: record.reviewedAt || null,
  };
}
