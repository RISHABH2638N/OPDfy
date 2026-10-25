import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import GlobalPatient from "../../src/models/GlobalPatient.js";
import GlobalPatientOtp from "../../src/models/GlobalPatientOtp.js";
import PatientSession from "../../src/models/PatientSession.js";
import Patient from "../../src/models/Patient.js";
import Tenant from "../../src/models/Tenant.js";
import { runWithTenant } from "../../src/services/tenantExecutionContext.js";
import { verifyPatientPassword } from "../../src/utils/patientPasswords.js";
import { buildPrivacyExport } from "../../src/services/privacyExportService.js";

// Only a disposable local replica set is used; MONGO_URI is never read.
// All email transports are mocked. These tests cannot contact SMTP or real users.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SUPER_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_URL = "https://patient-auth.example.invalid";
process.env.TRUST_PROXY_HOPS = "1";
Object.assign(process.env, { SMTP_HOST: "mail.example.invalid", SMTP_USER: "local-test", SMTP_PASS: "local-test", OTP_FROM_EMAIL: "test@example.invalid" });
let db, app, base, transportMock, clinic, ip = 0, failMail = false;
const mail = [];
const password = "A private patient passphrase 2026!";
const nextPassword = "Another private passphrase for 2026!";
const unique = () => crypto.randomBytes(6).toString("hex");
const newIp = () => `192.0.${Math.floor(++ip / 250)}.${ip % 250 + 1}`;
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
before(async () => {
  transportMock = mock.method(nodemailer, "createTransport", () => ({ async sendMail(message) {
    if (failMail) throw new Error("Simulated SMTP failure, never an actual connection");
    mail.push(message); return { accepted: [message.to] };
  } }));
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 },
    binary: process.env.MONGOMS_VERSION ? { version: process.env.MONGOMS_VERSION } : undefined,
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(db.getUri(), { dbName: "opdfy_patient_credentials_test", autoIndex: false });
  const { createApplication } = await import("../../src/app.js");
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  clinic = await Tenant.create({ name: "Disposable Credential Test Clinic", slug: "credential-test", status: "active" });
  app = createApplication(); app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  if (app) await new Promise(resolve => app.io.close(resolve));
  await mongoose.disconnect(); if (db) await db.stop(); transportMock?.mock.restore();
});
async function request(path, body, { token, address = newIp(), method = "POST", cookie } = {}) {
  const response = await fetch(base + path, { method, headers: {
    "Content-Type": "application/json", "X-Forwarded-For": address,
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie, "X-OPD-Client": "web" } : {}),
  }, ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const auth = (path, body, options) => request(`/api/patient-auth${path}`, body, options);
async function codeFor(email, purpose) {
  const result = await auth("/send-otp", { email, purpose }); assert.equal(result.status, 200);
  for (let i = 0; i < 50 && !mail.some(m => m.to === email && m.text.includes("code is")); i++) await pause();
  const message = mail.filter(m => m.to === email && m.text.includes("code is")).at(-1);
  assert.ok(message, "mock mail delivery captured");
  return message.text.match(/code is (\d{6})/)[1];
}
async function grantFor(email, purpose = "register") {
  const otp = await codeFor(email, purpose);
  const result = await auth("/verify-otp", { email, purpose, otp }); assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function register() {
  const name = `patient_${unique()}`, email = `${name}@example.invalid`;
  const grant = await grantFor(email);
  const result = await auth("/complete-registration", { setupToken: grant.setupToken, username: name, password, passwordConfirmation: password });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { email, username: name, patient: await GlobalPatient.findOne({ email }) };
}
const login = (identifier, value = password, extra = {}) => auth("/login", { identifier, password: value, ...extra });
const finish = (setupToken, username, extra = {}) => auth("/reset-password", { setupToken, username, password: nextPassword, passwordConfirmation: nextPassword, ...extra });

test("registration verifies email before creating credentials and grants no access session", async () => {
  const email = `new-${unique()}@example.invalid`;
  const otp = await codeFor(email, "register");
  assert.equal(await GlobalPatient.countDocuments({ email }), 0);
  const verified = await auth("/verify-otp", { email, purpose: "register", otp });
  assert.equal(verified.status, 200); assert.equal(verified.body.token, undefined);
  assert.match(verified.body.setupToken, /^[\w-]{43}$/);
  assert.equal((await auth("/me", null, { method: "GET", token: verified.body.setupToken })).status, 401);
  const username = `New_${unique()}`;
  const complete = await auth("/complete-registration", { setupToken: verified.body.setupToken, username, password, passwordConfirmation: password });
  assert.equal(complete.status, 201); assert.equal(complete.body.username, username.toLowerCase());
  assert.equal(complete.body.token, undefined); assert.equal(complete.body.passwordHash, undefined);
  assert.match(complete.headers.get("cache-control"), /no-store/);
  const account = await GlobalPatient.findOne({ email }).select("+passwordHash");
  assert.ok(account.credentialsSetAt); assert.equal(await verifyPatientPassword(password, account.passwordHash), true);
  assert.equal((await GlobalPatient.findOne({ email }).lean()).passwordHash, undefined);
  assert.equal(await GlobalPatientOtp.countDocuments({ email }), 0);
});

test("username/email login is case-insensitive, sends no email and keeps remembered session support", async () => {
  const account = await register();
  const mailBefore = mail.length;
  const byName = await login(`  ${account.username.toUpperCase()}  `, password, { rememberDevice: true });
  assert.equal(byName.status, 200); assert.equal(byName.body.patient.id, String(account.patient._id));
  const cookie = byName.headers.getSetCookie().at(-1).split(";", 1)[0];
  assert.match(cookie, /^opdfy_patient_refresh=/);
  assert.equal((await auth("/refresh", {}, { cookie })).status, 200);
  const byEmail = await login(account.email.toUpperCase()); assert.equal(byEmail.status, 200);
  assert.equal(byEmail.body.patient.id, byName.body.patient.id); assert.equal(mail.length, mailBefore);
  assert.equal(JSON.stringify(byEmail.body).includes("passwordHash"), false);
});

test("wrong, nonexistent, passwordless and disabled accounts have the same login failure", async () => {
  const account = await register();
  const legacy = await GlobalPatient.create({ email: `legacy-${unique()}@example.invalid` });
  const wrong = await login(account.username, "An incorrect long password");
  const missing = await login(`absent_${unique()}`);
  const noPassword = await login(legacy.email);
  await GlobalPatient.updateOne({ _id: account.patient._id }, { $set: { status: "disabled" } });
  const disabled = await login(account.email);
  for (const result of [wrong, missing, noPassword, disabled]) {
    assert.equal(result.status, 401); assert.deepEqual(result.body, wrong.body);
  }
});

test("duplicate username rejects case variants and leaves the grant available for retry", async () => {
  const first = await register(), email = `duplicate-${unique()}@example.invalid`;
  const grant = await grantFor(email);
  const submit = username => auth("/complete-registration", { setupToken: grant.setupToken, username, password, passwordConfirmation: password });
  const conflict = await submit(first.username.toUpperCase());
  assert.equal(conflict.status, 409); assert.match(conflict.body.message, /username is already taken/);
  assert.equal(await GlobalPatient.countDocuments({ email }), 0);
  assert.equal((await submit(`retry_${unique()}`)).status, 201);
});

test("existing passwordless patient sets credentials without changing account or clinic membership", async () => {
  const account = await GlobalPatient.create({ email: `existing-${unique()}@example.invalid`, name: "Existing Patient", allergies: ["test-only allergy"], profileCompleted: true });
  // Historical rows may not contain the later tokenVersion field.
  await GlobalPatient.collection.updateOne({ _id: account._id }, { $unset: { tokenVersion: 1 } });
  const membership = await runWithTenant(clinic._id, () => Patient.create({ tenantId: clinic._id, globalPatientId: account._id,
    name: "Existing Patient", email: account.email, identityLink: { method: "verified_global_registration" } }));
  const oldToken = jwt.sign({ id: String(account._id), role: "patient-global", ver: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const oldRefresh = crypto.randomBytes(48).toString("base64url");
  await PatientSession.create({ patientId: account._id, tokenHash: crypto.createHash("sha256").update(oldRefresh).digest("hex"), tokenVersionAtIssue: 0, expiresAt: new Date(Date.now() + 60000) });
  assert.equal((await auth("/me", null, { method: "GET", token: oldToken })).status, 200);
  const grant = await grantFor(account.email, "reset"); assert.equal(grant.username, "");
  const username = `existing_${unique()}`;
  assert.equal((await finish(grant.setupToken, username)).status, 200);
  const saved = await GlobalPatient.findById(account._id).select("+tokenVersion");
  assert.equal(saved.username, username); assert.equal(saved.name, account.name);
  assert.deepEqual([...saved.allergies], ["test-only allergy"]); assert.equal(saved.tokenVersion, 1);
  assert.equal(await GlobalPatient.countDocuments({ email: account.email }), 1);
  const savedLink = await runWithTenant(clinic._id, () => Patient.findById(membership._id));
  assert.equal(String(savedLink.globalPatientId), String(account._id));
  assert.equal((await auth("/me", null, { method: "GET", token: oldToken })).status, 401);
  assert.equal((await auth("/refresh", {}, { cookie: `opdfy_patient_refresh=${oldRefresh}` })).status, 401);
  assert.ok((await PatientSession.findOne({ patientId: account._id })).revokedAt);
  assert.equal((await login(account.email, nextPassword)).body.patient.id, String(account._id));
  const exported = JSON.parse(await buildPrivacyExport(account._id));
  assert.equal(exported.account.username, username);
  assert.ok(exported.account.credentialsSetAt);
  assert.equal(JSON.stringify(exported).includes("passwordHash"), false);
});

test("reset preserves username, consumes the grant and replaces the old password", async () => {
  const account = await register(), grant = await grantFor(account.email, "reset");
  assert.equal(grant.username, account.username);
  assert.equal((await finish(grant.setupToken, `changed_${unique()}`)).status, 400);
  assert.equal((await finish(grant.setupToken, account.username)).status, 200);
  assert.equal((await finish(grant.setupToken, account.username)).status, 400);
  assert.equal((await login(account.username)).status, 401);
  assert.equal((await login(account.username, nextPassword)).status, 200);
});

test("OTP is purpose-bound and a verified code cannot be reused", async () => {
  const email = `purpose-${unique()}@example.invalid`, otp = await codeFor(email, "register");
  assert.equal((await auth("/verify-otp", { email, purpose: "reset", otp })).status, 400);
  assert.equal((await auth("/verify-otp", { email, otp })).status, 400);
  assert.equal((await auth("/verify-otp", { email, purpose: "register", otp })).status, 200);
  assert.equal((await auth("/verify-otp", { email, purpose: "register", otp })).status, 400);
  assert.equal(await GlobalPatient.countDocuments({ email }), 0);
});

test("five wrong code attempts exhaust the challenge", async () => {
  const email = `attempts-${unique()}@example.invalid`, otp = await codeFor(email, "register");
  const wrong = otp === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal((await auth("/verify-otp", { email, purpose: "register", otp: wrong })).status, 400);
  assert.equal((await auth("/verify-otp", { email, purpose: "register", otp })).status, 400);
  assert.equal((await GlobalPatientOtp.findOne({ email })).attempts, 5);
});

test("resend cooldown sends one email and preserves the current challenge", async () => {
  const email = `cooldown-${unique()}@example.invalid`, otp = await codeFor(email, "register");
  const before = await GlobalPatientOtp.findOne({ email });
  assert.equal((await auth("/send-otp", { email, purpose: "register" })).status, 200);
  await pause();
  assert.equal(mail.filter(m => m.to === email).length, 1);
  assert.equal((await GlobalPatientOtp.findOne({ email })).nonce, before.nonce);
  assert.equal((await auth("/verify-otp", { email, purpose: "register", otp })).status, 200);
});

test("expired codes and expired grants cannot create an account", async () => {
  const email = `expire-code-${unique()}@example.invalid`, otp = await codeFor(email, "register");
  await GlobalPatientOtp.updateOne({ email }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await auth("/verify-otp", { email, purpose: "register", otp })).status, 400);
  const other = `expire-grant-${unique()}@example.invalid`, grant = await grantFor(other);
  await GlobalPatientOtp.updateOne({ email: other }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const complete = await auth("/complete-registration", { setupToken: grant.setupToken, username: `expiry_${unique()}`, password, passwordConfirmation: password });
  assert.equal(complete.status, 400); assert.equal(await GlobalPatient.countDocuments({ email: other }), 0);
});

test("concurrent OTP verification grants credential access only once", async () => {
  const email = `otp-race-${unique()}@example.invalid`, otp = await codeFor(email, "register");
  const results = await Promise.all([1, 2].map(() => auth("/verify-otp", { email, purpose: "register", otp })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 400).length, 1);
});

test("concurrent use of one setup grant creates only one account", async () => {
  const email = `grant-race-${unique()}@example.invalid`, grant = await grantFor(email);
  const results = await Promise.all([1, 2].map(() => auth("/complete-registration", { setupToken: grant.setupToken, username: `race_${unique()}`, password, passwordConfirmation: password })));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.ok(results.every(r => [201, 400, 409].includes(r.status)));
  assert.equal(await GlobalPatient.countDocuments({ email }), 1);
});

test("concurrent registrations cannot take the same username", async () => {
  const emails = [`one-${unique()}@example.invalid`, `two-${unique()}@example.invalid`];
  const grants = await Promise.all(emails.map(email => grantFor(email)));
  const username = `concurrent_${unique()}`;
  const results = await Promise.all(grants.map(grant => auth("/complete-registration", { setupToken: grant.setupToken, username, password, passwordConfirmation: password })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await GlobalPatient.countDocuments({ username }), 1);
});

test("password confirmation and validation errors do not consume a valid grant", async () => {
  const email = `validation-${unique()}@example.invalid`, grant = await grantFor(email), username = `valid_${unique()}`;
  const complete = extra => auth("/complete-registration", { setupToken: grant.setupToken, username, password, passwordConfirmation: password, ...extra });
  assert.equal((await complete({ passwordConfirmation: "different" })).status, 400);
  assert.equal((await complete({ password: "short", passwordConfirmation: "short" })).status, 400);
  assert.equal((await complete({ username: "email@example.invalid" })).status, 400);
  assert.equal((await complete({})).status, 201);
});

test("a changed or disabled account invalidates recovery without restoring account access", async () => {
  const account = await register(), otp = await codeFor(account.email, "reset");
  await GlobalPatient.updateOne({ _id: account.patient._id }, { $inc: { tokenVersion: 1 } });
  assert.equal((await auth("/verify-otp", { email: account.email, purpose: "reset", otp })).status, 400);
  const other = await register(), grant = await grantFor(other.email, "reset");
  await GlobalPatient.updateOne({ _id: other.patient._id }, { $set: { status: "disabled" } });
  assert.equal((await finish(grant.setupToken, other.username)).status, 409);
  assert.equal((await GlobalPatient.findById(other.patient._id)).status, "disabled");
});

test("recovery and duplicate signup responses do not reveal email registration", async () => {
  const account = await register();
  const known = await auth("/send-otp", { email: account.email, purpose: "register" });
  const missing = await auth("/send-otp", { email: `unknown-${unique()}@example.invalid`, purpose: "reset" });
  assert.equal(known.status, 200); assert.equal(missing.status, 200); assert.deepEqual(known.body, missing.body);
  assert.equal(mail.filter(m => m.to === account.email && m.text.includes("code is")).length, 1);
});

test("login account limiter combines username/email aliases even across IPs", async () => {
  const account = await register();
  for (let i = 0; i < 10; i++) assert.equal((await login(i % 2 ? account.username : account.email, "A wrong private passphrase")).status, 401);
  assert.equal((await login(account.username, password)).status, 429);
});

test("simultaneous reset completion increments revocation version once", async () => {
  const account = await register(), grant = await grantFor(account.email, "reset");
  const results = await Promise.all([finish(grant.setupToken, account.username), finish(grant.setupToken, account.username)]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal((await GlobalPatient.findById(account.patient._id).select("+tokenVersion")).tokenVersion, 1);
});

test("SMTP failure keeps the generic response and removes the undelivered challenge", async () => {
  const account = await GlobalPatient.create({ email: `mail-fail-${unique()}@example.invalid` });
  failMail = true;
  try {
    const response = await auth("/send-otp", { email: account.email, purpose: "reset" });
    assert.equal(response.status, 200);
    for (let i = 0; i < 50 && await GlobalPatientOtp.exists({ email: account.email }); i++) await pause();
    assert.equal(await GlobalPatientOtp.countDocuments({ email: account.email }), 0);
  } finally { failMail = false; }
});
