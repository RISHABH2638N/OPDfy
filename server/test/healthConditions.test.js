import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Patient from "../src/models/Patient.js";
import GlobalPatient from "../src/models/GlobalPatient.js";
import Token from "../src/models/Token.js";
import { conditionRange } from "../src/services/healthConditions.js";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SUPER_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_URL = "https://condition-tests.example.invalid";
const tenant = { _id: new mongoose.Types.ObjectId(), slug: "condition-tests", status: "active", subscription: {} };
const doctorId = new mongoose.Types.ObjectId(), otherId = new mongoose.Types.ObjectId(), adminId = new mongoose.Types.ObjectId();
const account = { _id: new mongoose.Types.ObjectId(), status: "active", tokenVersion: 0, profileCompleted: true, email: "patient@example.invalid" };
const patient = { _id: new mongoose.Types.ObjectId(), tenantId: tenant._id, globalPatientId: account._id,
  identityLink: { method: "verified_global_registration" }, profileCompleted: true, save: async () => {}, conditionProfile: { revision: 0, declaration: "undisclosed", entries: [], analyticsConsent: false } };
const token = { _id: new mongoose.Types.ObjectId(), tenantId: tenant._id, patient: patient._id, assignedDoctor: doctorId, department: "General OPD", status: "called" };
const query = value => ({ select() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const credential = (id, role) => jwt.sign({ id: String(id), role, tenantId: String(tenant._id), ver: 0 }, process.env.JWT_SECRET, { expiresIn: "10m" });
const patientCredential = jwt.sign({ id: String(account._id), role: "patient-global", ver: 0 }, process.env.JWT_SECRET, { expiresIn: "10m" });
let app;
async function request(path, auth = patientCredential, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, { method,
    headers: { "X-Clinic-Slug": tenant.slug, Authorization: `Bearer ${auth}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text() };
}
before(async () => {
  mock.method(Tenant, "findOne", () => query(tenant));
  mock.method(User, "findOne", filter => query({ _id: filter._id, tenantId: tenant._id, name: "Test", role: String(filter._id) === String(adminId) ? "admin" : "doctor", department: "General OPD", tokenVersion: 0 }));
  mock.method(GlobalPatient, "findOne", () => query(account));
  mock.method(Patient, "findOne", filter => {
    assert.equal(String(filter.tenantId || tenant._id), String(tenant._id));
    if (filter._id) assert.equal(String(filter._id), String(patient._id));
    if (filter.globalPatientId) assert.equal(String(filter.globalPatientId), String(account._id));
    return query(patient);
  });
  mock.method(Patient, "findOneAndUpdate", (filter, update) => {
    assert.equal(String(filter._id), String(patient._id)); assert.equal(String(filter.tenantId), String(tenant._id));
    assert.equal(update.$inc["conditionProfile.revision"], 1);
    const expected = filter["conditionProfile.revision"] ?? 0;
    if (expected !== patient.conditionProfile.revision) return query(null);
    for (const [key, value] of Object.entries(update.$set)) patient.conditionProfile[key.slice("conditionProfile.".length)] = value;
    patient.conditionProfile.revision += 1; return query(patient);
  });
  mock.method(Token, "findOne", filter => {
    assert.equal(String(filter.tenantId), String(tenant._id)); assert.equal(filter.status, "called"); assert.equal(filter.department, "General OPD");
    return query(String(filter.assignedDoctor) === String(doctorId) && token.status === "called" ? token : null);
  });
  mock.method(Patient, "aggregate", pipeline => {
    assert.equal(String(pipeline[0].$match.tenantId), String(tenant._id)); assert.equal(pipeline[0].$match["conditionProfile.analyticsConsent"], true);
    assert.equal(pipeline[2].$match["conditionProfile.entries.status"], "confirmed");
    assert.ok(pipeline[2].$match["conditionProfile.entries.reviewedAt"].$gte instanceof Date);
    return query([{ _id: "diabetes", count: 5 }, { _id: "asthma", count: 4 }]);
  });
  const { createApplication } = await import("../src/app.js"); app = createApplication(); app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
});
after(async () => { if (app) await new Promise(resolve => app.io.close(resolve)); mock.restoreAll(); });
test("patient conditions use patient authentication and server-owned review status", async () => {
  assert.equal((await request("/patients/me/conditions", "")).status, 401);
  assert.equal((await request("/patients/me/conditions", credential(doctorId, "doctor"))).status, 403);
  const result = await request("/patients/me/conditions", patientCredential, "PUT", { declaration: "conditions", codes: ["diabetes"], analyticsConsent: false, revision: 0, status: "confirmed", patientId: otherId });
  assert.equal(result.status, 200); assert.equal(result.body.profile.entries[0].status, "pending");
  assert.equal(result.body.profile.analyticsConsent, false);
});
test("doctor review rejects unassigned and inactive-token access and persists reviewer provenance", async () => {
  assert.equal((await request(`/tokens/${token._id}/conditions`, credential(otherId, "doctor"))).status, 403);
  const result = await request(`/tokens/${token._id}/conditions`, credential(doctorId, "doctor"), "PATCH", { code: "diabetes", decision: "confirmed", verifiedCode: "diabetes", revision: 1 });
  assert.equal(result.status, 200); assert.equal(result.body.profile.entries[0].status, "confirmed");
  assert.equal(String(patient.conditionProfile.entries[0].reviewedBy), String(doctorId)); assert.ok(patient.conditionProfile.entries[0].reviewedAt);
  token.status = "completed";
  assert.equal((await request(`/tokens/${token._id}/conditions`, credential(doctorId, "doctor"))).status, 403); token.status = "called";
});
test("stale requests cannot overwrite reviews, and edited selections return to pending", async () => {
  const input = { declaration: "conditions", codes: ["asthma"], analyticsConsent: true, revision: 1 };
  assert.equal((await request("/patients/me/conditions", patientCredential, "PUT", input)).status, 409);
  input.revision = 2;
  const result = await request("/patients/me/conditions", patientCredential, "PUT", input);
  assert.equal(result.status, 200); assert.equal(result.body.profile.entries[0].status, "pending");
  assert.equal((await request("/patients/me/conditions", patientCredential, "PUT", { ...input, codes: ["asthma", "asthma"], revision: 3 })).status, 400);
});
test("aggregate endpoints enforce admin role, suppress small groups and export only condition counts", async () => {
  const path = "fromDate=2026-10-01&toDate=2026-10-01";
  assert.equal((await request(`/admin/condition-insights?${path}`, credential(doctorId, "doctor"))).status, 403);
  const result = await request(`/admin/condition-insights?${path}`, credential(adminId, "admin")); assert.equal(result.status, 200);
  assert.equal(result.body.rows.find(item => item.code === "diabetes").count, 5);
  for (const code of ["asthma", "cancer"]) { assert.equal(result.body.rows.find(item => item.code === code).count, null); }
  const csv = await request(`/admin/export?type=conditions&${path}`, credential(adminId, "admin")); assert.equal(csv.status, 200);
  assert.match(csv.body, /Diabetes,5/); assert.doesNotMatch(csv.body, /Patient ID|patient@example|Test|phone/i);
  assert.equal((await request(`/admin/export?type=conditions&${path}&condition=invalid`, credential(adminId, "admin"))).status, 400);
});
test("condition-report filters reject impossible dates, reversed ranges and oversized windows", () => {
  assert.throws(() => conditionRange({ fromDate: "2026-02-30", toDate: "2026-03-01" }));
  assert.throws(() => conditionRange({ fromDate: "2026-10-01", toDate: "2026-09-01" }));
  assert.throws(() => conditionRange({ fromDate: "2020-01-01", toDate: "2026-10-01" }));
  assert.equal(conditionRange({ fromDate: "2024-02-29", toDate: "2024-02-29" }).fromDate, "2024-02-29");
});
