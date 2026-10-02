import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import Tenant from "../../src/models/Tenant.js";
import User from "../../src/models/User.js";
import Patient from "../../src/models/Patient.js";
import GlobalPatient from "../../src/models/GlobalPatient.js";
import Token from "../../src/models/Token.js";
import { runWithTenant } from "../../src/services/tenantExecutionContext.js";
import { buildPrivacyExport } from "../../src/services/privacyExportService.js";
// Synthetic data only. This suite never reads MONGO_URI.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SUPER_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_URL = "https://conditions.example.invalid";
process.env.SMTP_HOST = "";
// Diagnostics only: node:test's rejection handler remains installed and still
// fails the suite. Never swallow a rejection just to make tests appear green.
process.on("unhandledRejection", error => {
  console.error("Unexpected condition integration rejection:", error?.stack || error);
});
let db, app, clinic, other, doctor, outsider, admin, receptionist, account, patient, token, patientAuth, range;
const sign = user => jwt.sign({ id: String(user._id), role: user.role, tenantId: String(clinic._id), ver: 0 }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function request(path, auth = patientAuth, method = "GET", body, slug = clinic.slug) {
  const result = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, {
    method, headers: { Authorization: `Bearer ${auth}`, "X-Clinic-Slug": slug, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: result.status, body: result.headers.get("content-type")?.includes("application/json") ? await result.json() : await result.text() };
}
before(async () => {
  // These routes use single-document atomic writes, not transactions. A
  // standalone disposable server is sufficient; transactional suites still
  // use their own replica set in database.test.js.
  db = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_VERSION ? { version: process.env.MONGOMS_VERSION } : undefined,
  });
  await mongoose.connect(db.getUri(), {
    dbName: "opdfy_condition_test", autoCreate: false, autoIndex: false,
  });
  const { createApplication } = await import("../../src/app.js");
  const models = Object.values(mongoose.models);
  await Promise.all(models.map(model => model.init()));
  // Disable automatic background creation, then await actual collections and
  // indexes explicitly. Unique constraints are still present in these tests.
  for (const model of models) {
    await model.createCollection();
    await model.createIndexes();
  }
  clinic = await Tenant.create({ name: "Condition Test", slug: "condition-test", status: "active" });
  other = await Tenant.create({ name: "Other Test", slug: "condition-other", status: "active" });
  account = await GlobalPatient.create({ email: "condition-test@example.invalid", name: "Private test name", profileCompleted: true, status: "active" });
  patientAuth = jwt.sign({ id: String(account._id), role: "patient-global", ver: 0 }, process.env.JWT_SECRET, { expiresIn: "10m" });
  await runWithTenant(clinic._id, async () => {
    const staff = (role, email) => User.create({ name: "Test Staff", email, role, passwordHash: "test-only", department: "General OPD" });
    doctor = await staff("doctor", "assigned@example.invalid"); outsider = await staff("doctor", "outsider@example.invalid");
    admin = await staff("admin", "admin@example.invalid"); receptionist = await staff("receptionist", "reception@example.invalid");
    patient = await Patient.create({ globalPatientId: account._id, name: account.name, email: account.email, identityLink: { method: "verified_global_registration" }, profileCompleted: true });
    token = await Token.create({ patient: patient._id, patientId: patient.patientId, patientName: patient.name, tokenNumber: 91, department: "General OPD", assignedDoctor: doctor._id, status: "called" });
  });
  const date = new Date().toISOString().slice(0, 10); range = `fromDate=${date}&toDate=${date}`;
  app = createApplication(); app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
});
after(async () => {
  try {
    if (app) await new Promise(resolve => app.io.close(resolve));
  } finally {
    try { await mongoose.disconnect(); }
    finally { if (db) await db.stop(); }
  }
});
async function submit(codes, overrides = {}) {
  const current = await request("/patients/me/conditions"); assert.equal(current.status, 200);
  return request("/patients/me/conditions", patientAuth, "PUT", { codes, declaration: codes.length ? "conditions" : "none", analyticsConsent: true, revision: current.body.profile.revision, ...overrides });
}
async function review(code, decision = "confirmed", verifiedCode = code) {
  const current = await request(`/tokens/${token._id}/conditions`, sign(doctor)); assert.equal(current.status, 200);
  return request(`/tokens/${token._id}/conditions`, sign(doctor), "PATCH", { code, decision, verifiedCode, revision: current.body.profile.revision });
}
test("patient cannot self-confirm or override another identity; selections are tenant scoped and validated", async () => {
  assert.equal((await request("/patients/me/conditions", "")).status, 401);
  const saved = await submit(["diabetes", "asthma"], { patientId: new mongoose.Types.ObjectId(), status: "confirmed", reviewedBy: doctor._id });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.profile.entries.map(item => item.status), ["pending", "pending"]);
  const elsewhere = await request("/patients/me/conditions", patientAuth, "GET", undefined, other.slug);
  assert.equal(elsewhere.status, 200); assert.equal(elsewhere.body.profile.entries.length, 0);
  assert.equal((await request(`/tokens/${token._id}/conditions`, patientAuth, "PATCH", {})).status, 401);
  assert.equal((await submit(["diabetes", "diabetes"])).status, 400);
  assert.equal((await submit(["invented"])).status, 400);
});
test("review is restricted to the assigned doctor and active token; correction preserves the original report", async () => {
  assert.equal((await request(`/tokens/${token._id}/conditions`, sign(outsider))).status, 403);
  assert.equal((await request(`/tokens/${token._id}/conditions`, sign(receptionist))).status, 403);
  assert.equal((await request(`/tokens/${token._id}/conditions`, sign(doctor), "GET", undefined, other.slug)).status, 401);
  assert.equal((await review("diabetes")).status, 200);
  const corrected = await review("asthma", "confirmed", "copd"); assert.equal(corrected.status, 200);
  assert.equal(corrected.body.profile.entries[1].code, "asthma"); assert.equal(corrected.body.profile.entries[1].verifiedCode, "copd");
  const stored = await runWithTenant(clinic._id, () => Patient.findById(patient._id));
  assert.equal(String(stored.conditionProfile.entries[0].reviewedBy), String(doctor._id));
  assert.equal(String(stored.conditionProfile.entries[0].reviewToken), String(token._id)); assert.ok(stored.conditionProfile.entries[0].reviewedAt);
  assert.equal((await review("asthma", "confirmed", "diabetes")).status, 400);
  await runWithTenant(clinic._id, () => Token.updateOne({ _id: token._id }, { $set: { status: "completed" } }));
  assert.equal((await request(`/tokens/${token._id}/conditions`, sign(doctor))).status, 403);
  await runWithTenant(clinic._id, () => Token.updateOne({ _id: token._id }, { $set: { status: "called" } }));
});
test("concurrent submissions allow one write; edits revoke review while consent-only changes preserve it", async () => {
  const current = (await request("/patients/me/conditions")).body.profile;
  const payload = { codes: ["diabetes", "thyroid"], declaration: "conditions", analyticsConsent: true, revision: current.revision };
  const writes = await Promise.all([request("/patients/me/conditions", patientAuth, "PUT", payload), request("/patients/me/conditions", patientAuth, "PUT", payload)]);
  assert.deepEqual(writes.map(item => item.status).sort(), [200, 409]);
  assert.ok(writes.find(item => item.status === 200).body.profile.entries.every(item => item.status === "pending"));
  assert.equal((await review("diabetes")).status, 200); assert.equal((await review("thyroid", "not_confirmed")).status, 200);
  const unchanged = await submit(["diabetes", "thyroid"], { analyticsConsent: false }); assert.equal(unchanged.body.profile.entries[0].status, "confirmed");
  assert.equal((await request(`/tokens/${token._id}/conditions`, sign(doctor), "PATCH", { code: "diabetes", verifiedCode: "diabetes", decision: "confirmed", revision: current.revision })).status, 409);
});
test("analytics and CSV count consenting confirmed patients only; small groups and all identities stay hidden", async () => {
  await runWithTenant(clinic._id, async () => {
    for (let i = 0; i < 5; i++) await Patient.create({ name: `Confidential aggregate name ${i}`, phone: `900000000${i}`,
      conditionProfile: { declaration: "conditions", analyticsConsent: true, entries: [
        { code: "asthma", status: "confirmed", verifiedCode: "diabetes", reviewedAt: new Date(), reviewedBy: doctor._id },
        ...(i < 4 ? [{ code: "thyroid", status: "confirmed", verifiedCode: "thyroid", reviewedAt: new Date() }] : []),
        { code: "hypertension", status: "pending" }, { code: "cancer", status: "not_confirmed", reviewedAt: new Date() },
      ] } });
  });
  await runWithTenant(other._id, () => Patient.create({ name: "Other private", conditionProfile: { analyticsConsent: true, entries: [{ code: "diabetes", status: "confirmed", verifiedCode: "diabetes", reviewedAt: new Date() }] } }));
  assert.equal((await request(`/admin/condition-insights?${range}`, sign(receptionist))).status, 403);
  const stats = await request(`/admin/condition-insights?${range}`, sign(admin)); assert.equal(stats.status, 200);
  assert.equal(stats.body.rows.find(item => item.code === "diabetes").count, 5);
  for (const code of ["thyroid", "hypertension", "cancer", "heart_disease"]) { const row = stats.body.rows.find(item => item.code === code); assert.equal(row.count, null); assert.equal(row.suppressed, true); }
  const csv = await request(`/admin/export?type=conditions&${range}&condition=diabetes`, sign(admin)); assert.equal(csv.status, 200);
  assert.match(csv.body, /Diabetes,5/); assert.doesNotMatch(csv.body, /Confidential|Private test|900000000|Patient ID|Patient name|phone|thyroid/i);
  assert.doesNotMatch(JSON.stringify(stats.body), /Confidential|Private test|900000000/);
  assert.equal((await request("/admin/condition-insights?fromDate=2026-02-30&toDate=2026-03-01", sign(admin))).status, 400);
  assert.equal((await request(`/admin/export?type=conditions&${range}&condition=invalid`, sign(admin))).status, 400);
});
test("consent withdrawal immediately removes contribution; personal export includes the clinic condition profile", async () => {
  await submit(["diabetes", "thyroid"]);
  let stats = await request(`/admin/condition-insights?${range}`, sign(admin)); assert.equal(stats.body.rows.find(item => item.code === "diabetes").count, 6);
  await submit(["diabetes", "thyroid"], { analyticsConsent: false });
  stats = await request(`/admin/condition-insights?${range}`, sign(admin)); assert.equal(stats.body.rows.find(item => item.code === "diabetes").count, 5);
  const personal = JSON.parse(await buildPrivacyExport(account._id)); assert.ok(JSON.stringify(personal.clinics).includes('"conditionProfile"'));
  const none = await submit([]); assert.equal(none.body.profile.declaration, "none"); assert.equal(none.body.profile.entries.length, 0);
});
