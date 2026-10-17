import test from "node:test";
import assert from "node:assert/strict";
import { onlineReservationLimit, validateDoctorOnlineLimit } from "../src/utils/onlineReservationPolicy.js";

test("legacy doctor remains at default daily online limit", () => {
  const old = process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR;
  delete process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR;
  try { assert.equal(onlineReservationLimit({}), 70); }
  finally { if (old === undefined) delete process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR; else process.env.ONLINE_RESERVATION_LIMIT_PER_DOCTOR = old; }
});

test("a doctor-specific limit overrides the legacy setting, including zero", () => {
  assert.equal(onlineReservationLimit({ onlineReservationLimit: 30 }), 30);
  assert.equal(onlineReservationLimit({ onlineReservationLimit: 0 }), 0);
  assert.equal(onlineReservationLimit({ onlineReservationLimit: 120 }), 120);
});

test("admin inputs must be whole numbers between 0 and 10000", () => {
  assert.equal(validateDoctorOnlineLimit(50), 50);
  assert.equal(validateDoctorOnlineLimit(0), 0);
  for (const value of [-1, 10001, 1.5, "50", null, undefined, Infinity]) {
    assert.throws(() => validateDoctorOnlineLimit(value), /whole number/);
  }
});
