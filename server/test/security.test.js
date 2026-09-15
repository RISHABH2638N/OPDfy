import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { io as connectSocket } from "socket.io-client";
import { validateInputTree } from "../src/middleware/requestSafety.js";
import { preparePayment, quoteVisitFee } from "../src/utils/billing.js";
import { csvCell, publicErrorMessage, asyncRouter } from "../src/utils/httpSafety.js";
import { verifySessionToken } from "../src/utils/sessionTokens.js";
import { validateImageDataUrl } from "../src/utils/imageValidation.js";
import { runWithTenant } from "../src/services/tenantExecutionContext.js";
import { tenantIsAvailable } from "../src/services/realtimeGateway.js";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Patient from "../src/models/Patient.js";
import GlobalPatient from "../src/models/GlobalPatient.js";
import Appointment from "../src/models/Appointment.js";
import Token from "../src/models/Token.js";
import ActivityLog from "../src/models/ActivityLog.js";
import SecurityEvent from "../src/models/SecurityEvent.js";
import express from "express";

// Request tests exercise actual routes/JWTs/Socket.IO against controlled model
// responses. They do NOT claim to verify MongoDB transactions or indexes.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SUPER_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.QR_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_URL = "https://clinic.example.invalid";
process.env.DEFAULT_TENANT_SLUG = "";
const ids = Array.from({ length: 8 }, () => new mongoose.Types.ObjectId());
const [tenantId, otherTenantId, staffId, globalId, patientId, appointmentId, tokenId, otherStaffId] = ids;
let staffVersion = 0, patientVersion = 0, databaseUnavailable = false;
let staffRole = "receptionist";
let membershipSaves = 0;
const patientProfile = { _id: globalId, email: "patient@example.invalid", name: "Test Patient", phone: "9876543210", allergies: ["test allergen"], medicalHistory: ["test history"], currentMedications: ["test medicine"], profileCompleted: true, status: "active" };
const membership = { ...patientProfile, _id: patientId, tenantId, globalPatientId: globalId, patientId: "TEST-001", save: async () => { membershipSaves++; } };
const tenant = { _id: tenantId, name: "Test Clinic", slug: "test-clinic", status: "active", settings: { billing: { maxDiscountPercent: 90 }, branding: { shortName: "Test" } }, subscription: {} };
const appointment = { _id: appointmentId, patient: patientId, tenantId, patientName: "Test Patient", doctorName: "Test Doctor", department: "General OPD", appointmentDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()), startTime: "10:00", endTime: "10:10", status: "booked", billing: { quotedAmount: 100, status: "pending" } };
const query = (value) => ({ select() { return this; }, lean() { return this; }, sort() { return this; }, limit() { return this; }, populate() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const signStaff = (overrides = {}, options = {}) => jwt.sign({ id: String(staffId), role: staffRole, tenantId: String(tenantId), ver: staffVersion, ...overrides }, process.env.JWT_SECRET, { expiresIn: "10m", ...options });
const signPatient = (overrides = {}, options = {}) => jwt.sign({ id: String(globalId), role: "patient-global", ver: patientVersion, ...overrides }, process.env.JWT_SECRET, { expiresIn: "10m", ...options });
let instance, base;
before(async () => {
  mock.method(Tenant, "findOne", (filter) => { if (databaseUnavailable) throw new Error("database-internal-secret"); return query(filter.slug === "test-clinic" ? tenant : null); });
  mock.method(Tenant, "findById", () => query(tenant));
  mock.method(User, "findOne", (filter) => query(String(filter._id) === String(staffId) ? { _id: staffId, tenantId, name: "Staff", email: "staff@example.invalid", role: staffRole, department: "General OPD", tokenVersion: staffVersion } : null));
  mock.method(User, "findById", () => query({ _id: staffId, role: staffRole, tokenVersion: staffVersion }));
  mock.method(GlobalPatient, "findOne", () => query({ ...patientProfile, tokenVersion: patientVersion }));
  mock.method(GlobalPatient, "updateOne", async () => { patientVersion++; });
  mock.method(User, "updateOne", async () => { staffVersion++; });
  mock.method(Patient, "findOne", () => query(membership));
  mock.method(Token, "find", () => query([]));
  mock.method(Token, "findById", () => query({ _id: tokenId, assignedDoctor: otherStaffId }));
  mock.method(Appointment, "findById", () => query(appointment));
  mock.method(ActivityLog, "create", async () => ({}));
  mock.method(SecurityEvent, "create", async () => ({}));
  const { createApplication } = await import("../src/app.js");
  instance = createApplication();
  instance.server.listen(0, "127.0.0.1");
  await once(instance.server, "listening");
  base = `http://127.0.0.1:${instance.server.address().port}`;
});
after(async () => { await new Promise((resolve) => instance.io.close(resolve)); mock.restoreAll(); });

async function request(path, { method = "GET", token, body, headers = {}, clinic = "test-clinic" } = {}) {
  const response = await fetch(base + path, { method, headers: { "X-Clinic-Slug": clinic, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

for (const [name, payload] of [
  ["Mongo operator", { email: { $ne: null } }],
  ["nested operator", { payment: { $set: { paidAmount: 0 } } }],
  ["prototype key", JSON.parse('{"__proto__":{"admin":true}}')],
  ["constructor key", { constructor: { prototype: { admin: true } } }],
  ["dotted key", { "billing.paidAmount": 0 }],
]) test(`input guard rejects ${name}`, () => assert.throws(() => validateInputTree(payload)));
test("valid clinical forms and medicine arrays are accepted", () => assert.doesNotThrow(() => validateInputTree({ medicines: [{ name: "test", dosage: "1" }], payment: { paidAmount: 100, method: "cash" } })));
test("excessive nesting is rejected", () => { let value = {}; for (let i = 0; i < 15; i++) value = { field: value }; assert.throws(() => validateInputTree(value)); });
test("unbounded arrays are rejected", () => assert.throws(() => validateInputTree({ medicines: Array(201).fill("x") })));
test("huge text is rejected", () => assert.throws(() => validateInputTree({ message: "x".repeat(16001) })));
test("malformed JSON has a safe response", async () => { const r = await request("/api/auth/login", { method: "POST", body: '{"email":secret' }); assert.equal(r.status, 400); assert.equal(r.body.message, "Invalid JSON request."); });
test("unsafe JSON is blocked before login", async () => assert.equal((await request("/api/auth/login", { method: "POST", body: { email: { $ne: null } } })).status, 400));
test("oversized password is rejected before bcrypt", async () => assert.equal((await request("/api/auth/login", { method: "POST", body: { password: "é".repeat(37) } })).status, 400));
test("repeated query parameters are rejected", async () => assert.equal((await request("/api/tokens?department=a&department=b")).status, 400));
test("CORS rejects an untrusted browser origin", async () => assert.equal((await request("/api/tokens", { headers: { Origin: "https://untrusted.example.invalid" } })).status, 403));
test("CORS permits the configured origin", async () => { const r = await request("/api/tokens", { headers: { Origin: process.env.CLIENT_URL } }); assert.equal(r.status, 200); assert.equal(r.headers.get("access-control-allow-origin"), process.env.CLIENT_URL); });
test("API responses prohibit caching and MIME sniffing", async () => { const r = await request("/api/tokens"); assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); });
test("missing clinic context fails closed", async () => assert.equal((await request("/api/tokens", { clinic: "" })).status, 400));
test("staff token for another tenant is rejected", async () => assert.equal((await request("/api/auth/me", { token: signStaff({ tenantId: String(otherTenantId) }) })).status, 401));
test("patient JWT cannot enter staff routes", async () => assert.equal((await request("/api/auth/me", { token: signPatient() })).status, 401));
test("QR JWT cannot enter staff routes", async () => { const token = jwt.sign({ type: "appointment-checkin", appointmentId: String(appointmentId) }, process.env.QR_JWT_SECRET, { expiresIn: "1h" }); assert.equal((await request("/api/auth/me", { token })).status, 401); });
test("revoked staff session is rejected", async () => { const token = signStaff(); staffVersion++; assert.equal((await request("/api/auth/me", { token })).status, 401); });
test("revoked patient session cannot reach a clinic profile", async () => { const token = signPatient(); patientVersion++; const saves = membershipSaves; assert.equal((await request("/api/patients/me", { token })).status, 401); assert.equal(membershipSaves, saves); });
test("revoked patient session cannot reach global profile", async () => assert.equal((await request("/api/patient-auth/me", { token: signPatient({ ver: patientVersion - 1 }) })).status, 401));
test("expired JWT is rejected", async () => assert.equal((await request("/api/auth/me", { token: signStaff({}, { expiresIn: -1 }) })).status, 401));
test("future JWT is rejected without a server error", async () => assert.equal((await request("/api/auth/me", { token: signStaff({ nbf: Math.floor(Date.now() / 1000) + 100 }) })).status, 401));
test("sessions require an expiration", () => assert.throws(() => verifySessionToken(jwt.sign({ id: String(staffId) }, process.env.JWT_SECRET))));
test("sessions require HS256", () => assert.throws(() => verifySessionToken(signStaff({}, { algorithm: "HS384" }))));
test("malformed session identifiers are rejected", () => assert.throws(() => verifySessionToken(signPatient({ id: "invalid" }))));
test("reception cannot enter admin settings", async () => assert.equal((await request("/api/admin/billing-settings", { token: signStaff() })).status, 403));
test("reception cannot complete consultations", async () => assert.equal((await request("/api/consultations", { method: "POST", token: signStaff(), body: {} })).status, 403));
test("reception cannot issue clinical consent requests", async () => assert.equal((await request("/api/clinical-consents", { method: "POST", token: signStaff(), body: {} })).status, 403));
test("reception cannot read patient identity review requests", async () => assert.equal((await request("/api/privacy-clinic/identity-reviews", { token: signStaff() })).status, 403));
test("reception cannot approve a patient identity claim", async () => assert.equal((await request(`/api/privacy-clinic/identity-reviews/${patientId}/review`, { method: "POST", token: signStaff(), body: {} })).status, 403));
test("patient cannot enter staff consent worklist", async () => assert.equal((await request("/api/clinical-consents", { token: signPatient() })).status, 401));
test("staff cannot enter patient consent records", async () => assert.equal((await request("/api/patients/me/clinical-consents", { token: signStaff() })).status, 403));
test("anonymous QR verification cannot disclose patient data", async () => { const r = await request("/api/check-in/verify", { method: "POST", body: { token: "code" } }); assert.equal(r.status, 401); assert.equal(r.body.visit, undefined); });
test("patient cannot use reception QR endpoints", async () => assert.equal((await request("/api/check-in", { method: "POST", token: signPatient(), body: {} })).status, 401));
test("reception can verify an authorized appointment QR", async () => { const token = jwt.sign({ type: "appointment-checkin", appointmentId: String(appointmentId) }, process.env.QR_JWT_SECRET, { expiresIn: "1h" }); const r = await request("/api/check-in/verify", { method: "POST", token: signStaff(), body: { token } }); assert.equal(r.status, 200); assert.equal(r.body.visit.billing.quotedAmount, 100); });
test("missed appointment QR remains unusable", async () => { appointment.status = "missed"; const token = jwt.sign({ type: "appointment-checkin", appointmentId: String(appointmentId) }, process.env.QR_JWT_SECRET, { expiresIn: "1h" }); const r = await request("/api/check-in/verify", { method: "POST", token: signStaff(), body: { token } }); appointment.status = "booked"; assert.equal(r.status, 409); });
test("public clinic metadata omits private billing settings", async () => { const r = await request("/api/tenant/current"); assert.equal(r.status, 200); assert.equal(r.body.tenant.settings.billing, undefined); });
test("doctors cannot request another doctor's token ETA", async () => { staffRole = "doctor"; const r = await request(`/api/tokens/${tokenId}/eta`, { token: signStaff() }); staffRole = "receptionist"; assert.equal(r.status, 403); });

test("patient cannot assert payment for a positive fee", () => assert.throws(() => preparePayment({ quotedAmount: 100, payment: { method: "cash", paidAmount: 100 }, tenant }), (error) => error.status === 403));
test("reception payment records the verified collector", () => { const payment = preparePayment({ quotedAmount: 100, payment: { method: "cash", paidAmount: 100, collectedBy: "forged" }, tenant, actorId: staffId }); assert.equal(String(payment.collectedBy), String(staffId)); assert.equal(payment.status, "paid"); });
for (const value of [-1, "NaN", {}, true, 1000001, null]) test(`payment rejects invalid amount ${JSON.stringify(value)}`, () => assert.throws(() => preparePayment({ quotedAmount: 100, payment: { method: "cash", paidAmount: value }, tenant, actorId: staffId })));
test("discounts are blocked unless enabled", () => assert.throws(() => preparePayment({ quotedAmount: 100, payment: { method: "cash", paidAmount: 0, overrideReason: "forged" }, tenant, actorId: staffId })));
test("discounts enforce limit and mandatory reason", () => { const discountTenant = { settings: { billing: { allowReceptionFeeOverride: true, maxDiscountPercent: 10 } } }; for (const payment of [{ method: "cash", paidAmount: 70, overrideReason: "test" }, { method: "cash", paidAmount: 90 }]) assert.throws(() => preparePayment({ quotedAmount: 100, payment, tenant: discountTenant, actorId: staffId })); });
test("doctor fee takes precedence over clinic fallback", async () => assert.equal((await quoteVisitFee({ doctor: { billingProfile: { consultationFee: 150 } }, tenant: { settings: { billing: { clinicDefaultFee: 100 } } }, department: "General OPD" })).amount, 150));
test("clinic fallback remains visible for unspecified doctor fee", async () => assert.equal((await quoteVisitFee({ doctor: {}, tenant: { settings: { billing: { clinicDefaultFee: 100 } } }, department: "General OPD" })).amount, 100));
test("explicit zero doctor fee remains free", async () => assert.equal((await quoteVisitFee({ doctor: { billingProfile: { consultationFee: 0 } }, tenant: { settings: { billing: { clinicDefaultFee: 100 } } } })).amount, 0));

for (const value of ["=HYPERLINK(1)", "+1", "-1", "@SUM(1)", " \t=1", "\n=1"]) test(`CSV formula defense ${JSON.stringify(value)}`, () => assert.match(csvCell(value), /^"?'/));
test("CSV preserves ordinary clinical text", () => assert.equal(csvCell('Clinic, "A"'), '"Clinic, ""A"""'));
test("SVG upload is rejected", () => assert.equal(validateImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=").ok, false));
test("spoofed PNG upload is rejected", () => assert.equal(validateImageDataUrl("data:image/png;base64,PHNjcmlwdD4=").ok, false));
test("oversized image is rejected", () => assert.equal(validateImageDataUrl("data:image/png;base64," + Buffer.alloc(200000).toString("base64")).ok, false));
test("internal exception details are hidden", () => assert.equal(publicErrorMessage(new Error("database password"), "Request failed."), "Request failed."));
test("expected user validation remains readable", () => assert.equal(publicErrorMessage(Object.assign(new Error("Select a doctor."), { status: 400 })), "Select a doctor."));
test("expired or suspended clinic cannot join live channels", () => { assert.equal(tenantIsAvailable({ status: "suspended" }), false); assert.equal(tenantIsAvailable({ status: "active", subscription: { endsAt: new Date(0) } }), false); });

function openSocket(auth, extra = {}) {
  const socket = connectSocket(base, { autoConnect: false, reconnection: false, transports: ["websocket"], auth: { clinicSlug: "test-clinic", ...auth }, ...extra });
  return socket;
}
test("WebSocket rejects an untrusted Origin", async () => { const socket = openSocket({}, { extraHeaders: { Origin: "https://untrusted.example.invalid" } }); const rejected = once(socket, "connect_error"); socket.connect(); await rejected; socket.disconnect(); });
test("WebSocket rejects a revoked patient token", async () => { const socket = openSocket({ patientToken: signPatient({ ver: patientVersion - 1 }) }); const rejected = once(socket, "connect_error"); socket.connect(); await rejected; socket.disconnect(); });
test("WebSocket membership sync preserves patient profile fields", async () => { const socket = openSocket({ patientToken: signPatient() }); const connected = once(socket, "connect"); socket.connect(); await connected; assert.equal(membership.name, patientProfile.name); assert.deepEqual(membership.allergies, patientProfile.allergies); assert.deepEqual(membership.currentMedications, patientProfile.currentMedications); socket.disconnect(); });
test("WebSocket disconnects when a JWT expires", async () => { const socket = openSocket({ patientToken: signPatient({}, { expiresIn: 2 }) }); const connected = once(socket, "connect"); socket.connect(); await connected; const expired = await once(socket, "session:expired"); assert.equal(expired[0].kind, "patient"); socket.disconnect(); });
test("patient logout revokes HTTP and live sessions", async () => { const token = signPatient(); const socket = openSocket({ patientToken: token }); const connected = once(socket, "connect"); socket.connect(); await connected; const expired = once(socket, "session:expired"); assert.equal((await request("/api/patient-auth/logout", { method: "POST", token, body: {} })).status, 200); await expired; assert.equal((await request("/api/patient-auth/me", { token })).status, 401); socket.disconnect(); });
test("failed socket reauthentication leaves no patient room", async () => { const socket = openSocket({ patientToken: signPatient() }); const connected = once(socket, "connect"); socket.connect(); await connected; const failed = once(socket, "patient:authentication-failed"); socket.emit("patient:authenticate", "invalid"); await failed; const serverSocket = instance.io.sockets.sockets.get(socket.id); assert.equal([...serverSocket.rooms].some((room) => room.startsWith("patient:")), false); assert.equal([...serverSocket.rooms].some((room) => room.startsWith("tenant:")), false); socket.disconnect(); });

test("tenant model query injects its ownership filter", async () => {
  const scope = new mongoose.Types.ObjectId();
  const real = await import("../src/models/QueueReservation.js");
  const model = real.default;
  const calls = [];
  const stub = mock.method(model.collection, "find", (filter) => { calls.push(filter); return { toArray: async () => [] }; });
  try { await runWithTenant(scope, () => model.find({ tenantId: otherTenantId }).lean()); assert.equal(String(calls[0].tenantId), String(scope)); }
  finally { stub.mock.restore(); }
});
test("tenant model cannot read without context", async () => { const { default: model } = await import("../src/models/QueueReservation.js"); await assert.rejects(model.find({}), /Tenant execution context/); });
test("tenant ownership cannot be removed through an update", async () => { const { default: model } = await import("../src/models/QueueReservation.js"); await assert.rejects(runWithTenant(tenantId, () => model.updateOne({}, { $unset: { tenantId: 1 } })), /immutable/); });
test("tenant-wide estimated counts are prohibited", async () => { const { default: model } = await import("../src/models/QueueReservation.js"); await assert.rejects(runWithTenant(tenantId, () => model.estimatedDocumentCount()), /countDocuments/); });
test("unscoped cross-collection aggregates are prohibited", async () => { const { default: model } = await import("../src/models/QueueReservation.js"); await assert.rejects(runWithTenant(tenantId, () => model.aggregate([{ $lookup: { from: "patients", as: "all" } }])), /explicitly scoped/); });
test("appointment partial index retains string-only slot keys", () => { const entry = Appointment.schema.indexes().find(([, options]) => options.name === "tenant_appointment_slot_unique"); assert.deepEqual(entry[1].partialFilterExpression, { slotKey: { $type: "string" } }); });
test("production rejects placeholder or reused secrets", () => { const result = spawnSync(process.execPath, ["--input-type=module", "-e", 'import {validateRuntimeEnv} from "./src/utils/runtimeConfig.js"; validateRuntimeEnv();'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", MONGO_URI: "mongodb://127.0.0.1/test", JWT_SECRET: "replace-this-with-a-long-random-secret", SUPER_ADMIN_JWT_SECRET: "replace-this-with-a-long-random-secret", QR_JWT_SECRET: "replace-this-with-a-long-random-secret", DISPLAY_KEY_ENCRYPTION_SECRET: "replace-this-with-a-long-random-secret" }, encoding: "utf8" }); assert.notEqual(result.status, 0); });
test("async router forwards rejected promises", async () => { const app = express(); const router = asyncRouter(); router.get("/", async () => { throw new Error("controlled"); }); app.use(router); app.use((error, req, res, next) => res.status(503).json({ message: error.message })); const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); try { const response = await fetch(`http://127.0.0.1:${server.address().port}/`); assert.equal(response.status, 503); } finally { await new Promise((resolve) => server.close(resolve)); } });
