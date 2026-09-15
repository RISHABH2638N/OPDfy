import test, { mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../src/models/User.js";
import { runWithTenant } from "../src/services/tenantExecutionContext.js";
import { requestStaffReset, finishStaffReset, resetDigest, validResetPassword } from "../src/services/staffPasswordReset.js";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
const tenant = new mongoose.Types.ObjectId(), id = new mongoose.Types.ObjectId();
const email = "staff@example.invalid", password = "A-strong-test-password-123";

test("password reset digest is purpose/clinic/account bound", () => {
  const digest = resetDigest(tenant, id, email, "nonce", "123456");
  assert.notEqual(digest, resetDigest(new mongoose.Types.ObjectId(), id, email, "nonce", "123456"));
  assert.notEqual(digest, resetDigest(tenant, id, "other@example.invalid", "nonce", "123456"));
  assert.equal(validResetPassword("short"), false);
  assert.equal(validResetPassword("é".repeat(37)), false);
  assert.equal(validResetPassword(password), true);
});

for (const role of ["admin", "doctor", "receptionist"]) test(`${role} reset sends to registered email and stores no plaintext OTP`, async () => {
  let update, mail;
  const a = mock.method(User.collection, "findOne", async (filter) => {
    assert.equal(String(filter.tenantId), String(tenant));
    return { _id: id, tenantId: tenant, email, role, tokenVersion: 0 };
  });
  const b = mock.method(User.collection, "updateOne", async (filter, value) => { update = value; return { modifiedCount: 1 }; });
  try {
    await runWithTenant(tenant, () => requestStaffReset(tenant, email, async value => { mail = value; }));
    assert.equal(mail.to, email);
    const code = mail.text.match(/code is (\d{6})/)[1];
    assert.equal(update.$set.passwordReset.hash, resetDigest(tenant, id, email, update.$set.passwordReset.nonce, code));
    assert.equal(JSON.stringify(update).includes(code), false);
  } finally { a.mock.restore(); b.mock.restore(); }
});

test("reset consumes code and revokes sessions atomically; a lost race is rejected", async () => {
  const reset = { email, version: 0, nonce: "nonce", attempts: 1, expiresAt: new Date(Date.now() + 60000), hash: resetDigest(tenant, id, email, "nonce", "123456") };
  let applied = false;
  const a = mock.method(User.collection, "findOneAndUpdate", async (filter, update) => {
    assert.equal(String(filter.tenantId), String(tenant));
    assert.equal(filter["passwordReset.attempts"].$lt, 5);
    assert.ok(filter["passwordReset.expiresAt"].$gt instanceof Date);
    return { _id: id, tenantId: tenant, email, tokenVersion: 0, passwordReset: reset };
  });
  const b = mock.method(User.collection, "updateOne", async (filter, update) => {
    assert.equal(filter["passwordReset.nonce"], reset.nonce);
    assert.equal(filter.email, email);
    assert.equal(update.$inc.tokenVersion, 1);
    assert.equal(update.$unset.passwordReset, 1);
    assert.ok(await bcrypt.compare(password, update.$set.passwordHash));
    if (applied) return { modifiedCount: 0 };
    applied = true; return { modifiedCount: 1 };
  });
  try {
    assert.equal(String(await runWithTenant(tenant, () => finishStaffReset(tenant, email, "123456", password))), String(id));
    await assert.rejects(runWithTenant(tenant, () => finishStaffReset(tenant, email, "123456", password)), /Invalid or expired/);
    await assert.rejects(runWithTenant(tenant, () => finishStaffReset(tenant, email, "999999", password)), /Invalid or expired/);
  } finally { a.mock.restore(); b.mock.restore(); }
});

test("missing, expired or exhausted challenges cannot reset a password", async () => {
  const a = mock.method(User.collection, "findOneAndUpdate", async () => null);
  try { await assert.rejects(runWithTenant(tenant, () => finishStaffReset(tenant, email, "123456", password)), /Invalid or expired/); }
  finally { a.mock.restore(); }
});

test("recovery queries require tenant context and reset fields are private by default", async () => {
  assert.equal(User.schema.path("passwordReset").options.select, false);
  await assert.rejects(requestStaffReset(tenant, email), /Tenant execution context/);
});
