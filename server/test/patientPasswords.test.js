import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUsername, validUsername, validPatientPassword, hashPatientPassword, verifyPatientPassword } from "../src/utils/patientPasswords.js";
import { patientCodeDigest } from "../src/services/patientCredentials.js";

process.env.JWT_SECRET ||= "unit-test-only-hmac-secret";
test("usernames normalize case and cannot be confused with email addresses", () => {
  assert.equal(normalizeUsername("  Rishabh_01 "), "rishabh_01");
  for (const name of ["ab", "a@b.com", "a/b", "_first", "a b", "a".repeat(31)]) assert.equal(validUsername(name), false, name);
  assert.equal(validUsername("patient.name_01"), true);
});
test("password policy permits long Unicode passphrases without trimming or silent truncation", async () => {
  assert.equal(validPatientPassword("short"), false);
  assert.equal(validPatientPassword("password123456789"), false);
  assert.equal(validPatientPassword("x".repeat(20)), false);
  assert.equal(validPatientPassword("a".repeat(129)), false);
  const password = "  मेरे स्वास्थ्य का सुरक्षित खाता  ";
  assert.equal(validPatientPassword(password), true);
  const hash = await hashPatientPassword(password);
  assert.equal(await verifyPatientPassword(password, hash), true);
  assert.equal(await verifyPatientPassword(password.trim(), hash), false);
  assert.equal(await verifyPatientPassword(password + "x", hash), false);
  assert.equal(hash.includes(password), false);
  assert.notEqual(await hashPatientPassword(password), hash);
});
test("missing and malformed stored credentials fail closed", async () => {
  for (const hash of [undefined, "", "scrypt$999999999$8$3$a$b", "not-a-password-hash"]) {
    assert.equal(await verifyPatientPassword("A different long passphrase", hash), false);
  }
  assert.equal(await verifyPatientPassword("x".repeat(513), "anything"), false);
  await assert.rejects(hashPatientPassword("short"), /15–128/);
});
test("OTP digests bind the email, purpose and random challenge nonce", () => {
  const hash = patientCodeDigest("a@example.invalid", "register", "nonce", "123456");
  assert.notEqual(hash, patientCodeDigest("b@example.invalid", "register", "nonce", "123456"));
  assert.notEqual(hash, patientCodeDigest("a@example.invalid", "reset", "nonce", "123456"));
  assert.notEqual(hash, patientCodeDigest("a@example.invalid", "register", "other", "123456"));
});
