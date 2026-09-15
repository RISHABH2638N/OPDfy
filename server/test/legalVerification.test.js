import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanClinicLegalVerification,
  cleanDoctorProfessionalVerification,
  effectiveVerificationStatus,
  publicClinicVerification,
  publicDoctorVerification,
} from "../src/utils/legalVerification.js";

test("clinic verification input is normalized and validated", () => {
  const clean = cleanClinicLegalVerification({
    legalName: "  Sunrise Clinic  ", establishmentType: "clinic",
    registrationNumber: " REG-123 ", registrationAuthority: " Health Department ",
    registrationState: " Uttar Pradesh ", certificateExpiresAt: "2030-12-31",
    evidenceReference: " File C-42 ",
  });
  assert.equal(clean.legalName, "Sunrise Clinic");
  assert.equal(clean.registrationNumber, "REG-123");
  assert.equal(clean.certificateExpiresAt.toISOString(), "2030-12-31T23:59:59.999Z");
  assert.throws(() => cleanClinicLegalVerification({ establishmentType: "pharmacy" }), /valid clinical establishment type/);
});

test("effective status expires reviewed evidence without changing submitted records", () => {
  const now = new Date("2030-01-02T00:00:00.000Z");
  assert.equal(effectiveVerificationStatus({ status: "platform_reviewed", certificateExpiresAt: new Date("2030-01-01") }, now), "expired");
  assert.equal(effectiveVerificationStatus({ status: "submitted", certificateExpiresAt: new Date("2030-01-01") }, now), "submitted");
  assert.equal(effectiveVerificationStatus({}), "not_submitted");
});

test("doctor verification validates evidence and public views exclude sensitive references", () => {
  const clean = cleanDoctorProfessionalVerification({
    councilName: "Delhi Medical Council", registrationState: "Delhi",
    registrationExpiresAt: "2031-01-01", evidenceReference: "doctor-file-17",
  });
  const doctorPublic = publicDoctorVerification({ ...clean, status: "clinic_reviewed", reviewedAt: new Date() });
  const clinicPublic = publicClinicVerification({
    status: "platform_reviewed", legalName: "Sunrise Clinic", establishmentType: "clinic",
    registrationNumber: "SECRET-REG", registrationAuthority: "Health Department",
    registrationState: "Delhi", evidenceReference: "SECRET-FILE",
  });
  assert.equal(doctorPublic.status, "clinic_reviewed");
  assert.equal("evidenceReference" in doctorPublic, false);
  assert.equal("registrationNumber" in clinicPublic, false);
  assert.equal("evidenceReference" in clinicPublic, false);
});
