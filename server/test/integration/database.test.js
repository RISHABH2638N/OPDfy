import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import net from "node:net";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Tenant from "../../src/models/Tenant.js";
import User from "../../src/models/User.js";
import Patient from "../../src/models/Patient.js";
import GlobalPatient from "../../src/models/GlobalPatient.js";
import GlobalPatientOtp from "../../src/models/GlobalPatientOtp.js";
import PatientSession from "../../src/models/PatientSession.js";
import Appointment from "../../src/models/Appointment.js";
import Token from "../../src/models/Token.js";
import ClinicalConsent from "../../src/models/ClinicalConsent.js";
import PrivacyRequest from "../../src/models/PrivacyRequest.js";
import SuperAdmin from "../../src/models/SuperAdmin.js";
import { io as connectSocket } from "socket.io-client";
import { runWithTenant } from "../../src/services/tenantExecutionContext.js";
import { requestPatientCode } from "../../src/services/patientCredentials.js";
import { hashPatientPassword } from "../../src/utils/patientPasswords.js";
import { checkInAppointment, hospitalToday } from "../../src/services/appointmentCheckIn.js";

// This suite always creates its own disposable replica set. It never reads
// MONGO_URI and cannot target the operator's production or staging database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SUPER_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.QR_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_URL = "https://integration.example.invalid";
process.env.SMTP_HOST = "";
let db, clinic, otherClinic, app;
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: process.env.MONGOMS_VERSION ? { version: process.env.MONGOMS_VERSION } : undefined });
  await mongoose.connect(db.getUri(), { dbName: "opd_disposable_integration" });
  const { createApplication } = await import("../../src/app.js");
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  clinic = await Tenant.create({ name: "Integration Clinic", slug: "integration-clinic", status: "active" });
  otherClinic = await Tenant.create({ name: "Other Clinic", slug: "other-clinic", status: "active" });
  app = createApplication();
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
});
after(async () => { if (app) await new Promise((resolve) => app.io.close(resolve)); await mongoose.disconnect(); if (db) await db.stop(); });

async function visit() {
  return runWithTenant(clinic._id, async () => {
    const suffix = crypto.randomBytes(5).toString("hex");
    const doctor = await User.create({ tenantId: clinic._id, name: "Integration Doctor", email: `doctor-${suffix}@example.invalid`, passwordHash: "test-only-not-a-login", role: "doctor", department: "General OPD", doctorSchedule: { workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], startTime: "00:00", endTime: "23:59" } });
    const patient = await Patient.create({ tenantId: clinic._id, name: "Integration Patient", email: `patient-${suffix}@example.invalid`, profileCompleted: true });
    const appointment = await Appointment.create({ tenantId: clinic._id, patient: patient._id, patientName: patient.name, patientId: patient.patientId, doctor: doctor._id, doctorName: doctor.name, department: "General OPD", appointmentDate: hospitalToday(), startTime: "10:00", endTime: "10:10", slotKey: `${doctor._id}:${hospitalToday()}:10:00`, billing: { quotedAmount: 100, feeType: "appointment", status: "pending" } });
    return { doctor, patient, appointment };
  });
}
test("model queries cannot cross clinic boundaries", async () => {
  const { patient } = await visit();
  const inaccessible = await runWithTenant(otherClinic._id, () => Patient.findById(patient._id));
  assert.equal(inaccessible, null);
});

test("actual password login works for admin, doctor, receptionist and Super Admin while identities stay separated", async () => {
  const suffix = crypto.randomBytes(5).toString("hex");
  const password = crypto.randomBytes(20).toString("hex");
  const passwordHash = await bcrypt.hash(password, 10);
  for (const role of ["admin", "doctor", "receptionist"]) {
    const user = await runWithTenant(clinic._id, () => User.create({ tenantId: clinic._id,
      name: `Login ${role}`, email: `login-${role}-${suffix}@example.invalid`,
      passwordHash, role, department: "General OPD" }));
    const login = await securityRequest("/api/auth/login", "", "POST", {
      clinicSlug: clinic.slug, email: user.email, password,
    });
    assert.equal(login.status, 200, role);
    assert.equal(login.body.user.role, role);
    const me = await securityRequest("/api/auth/me", login.body.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, String(user._id));
    assert.equal((await securityRequest("/api/platform/me", login.body.token)).status, 401);
    assert.equal((await securityRequest("/api/auth/me", login.body.token, "GET", undefined,
      otherClinic.slug)).status, 401);
  }
  const owner = await SuperAdmin.create({ name: "Local Platform Owner",
    email: `owner-${suffix}@example.invalid`, passwordHash, status: "active" });
  const platformLogin = await securityRequest("/api/platform/auth/login", "", "POST", {
    email: owner.email, password,
  });
  assert.equal(platformLogin.status, 200);
  assert.equal((await securityRequest("/api/platform/me", platformLogin.body.token)).status, 200);
  assert.equal((await securityRequest("/api/platform/clinics", platformLogin.body.token)).status, 200);
  assert.equal((await securityRequest("/api/auth/me", platformLogin.body.token)).status, 401);
});

function staffToken(user) {
  return jwt.sign({ id: String(user._id), role: user.role, tenantId: String(clinic._id), ver: 0 },
    process.env.JWT_SECRET, { expiresIn: "10m" });
}
async function securityRequest(path, token, method = "GET", body, clinicSlug = clinic.slug) {
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "X-Clinic-Slug": clinicSlug,
      ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
test("unverified historical links cannot read clinic records or join private sockets; clinic review restores access", async () => {
  const suffix = crypto.randomBytes(5).toString("hex");
  const account = await GlobalPatient.create({ email: `legacy-${suffix}@example.invalid`,
    name: "Account Identity", profileCompleted: true, status: "active" });
  const admin = await runWithTenant(clinic._id, async () => {
    await Patient.create({ tenantId: clinic._id, globalPatientId: account._id,
      name: "Historical Identity", email: account.email, medicalHistory: ["protected record"],
      profileCompleted: true });
    return User.create({ tenantId: clinic._id, name: "Identity Reviewer", role: "admin",
      email: `reviewer-${suffix}@example.invalid`, passwordHash: "test-only-not-a-login" });
  });
  const token = jwt.sign({ id: String(account._id), role: "patient-global", ver: 0 },
    process.env.JWT_SECRET, { expiresIn: "10m" });
  for (const path of ["/api/patients/me", "/api/patients/me/appointments",
    "/api/patients/me/consultations", "/api/patients/me/tokens", "/api/referrals/patient/me"]) {
    const result = await securityRequest(path, token);
    assert.equal(result.status, 409, path);
    assert.equal(result.body.code, "PATIENT_IDENTITY_REVIEW_REQUIRED");
    assert.equal(JSON.stringify(result.body).includes("protected record"), false);
  }
  assert.equal((await securityRequest("/api/ai/chat", token, "POST", { message: "my queue?" })).status, 409);
  assert.equal((await securityRequest("/api/patient-auth/me", token)).status, 200);
  assert.equal((await securityRequest("/api/privacy/me", token)).status, 200);
  const socket = connectSocket(`http://127.0.0.1:${app.server.address().port}`, {
    autoConnect: false, reconnection: false, transports: ["websocket"],
    auth: { clinicSlug: clinic.slug, patientToken: token }, timeout: 3000,
  });
  try {
    const denied = once(socket, "connect_error"); socket.connect(); await denied;
    assert.equal(socket.connected, false);
    const request = await PrivacyRequest.create({ patient: account._id, type: "identity_review",
      clinicSlug: clinic.slug, details: "Verified account requests assisted clinic identity review.",
      verifiedAt: new Date() });
    const reviewed = await securityRequest(`/api/privacy-clinic/identity-reviews/${request._id}/review`,
      staffToken(admin), "POST", { decision: "verified", evidenceReference: "LOCAL-TEST-REVIEW",
        reviewNote: "Authorized clinic reviewed identity in this disposable test fixture." });
    assert.equal(reviewed.status, 200);
    assert.equal((await securityRequest("/api/patients/me", token)).status, 200);
    const connected = once(socket, "connect"); socket.connect(); await connected;
    const serverSocket = app.io.sockets.sockets.get(socket.id);
    assert.ok([...serverSocket.rooms].some(room => room.startsWith("patient:")));
  } finally { socket.disconnect(); }
});
test("doctors cannot list, cancel or review another doctor's clinical consent", async () => {
  const { doctor, patient } = await visit();
  const other = await runWithTenant(clinic._id, () => User.create({ tenantId: clinic._id,
    name: "Other Treating Doctor", role: "doctor", department: "General OPD",
    email: `consent-${crypto.randomBytes(5).toString("hex")}@example.invalid`, passwordHash: "test-only" }));
  const consent = await runWithTenant(clinic._id, () => ClinicalConsent.create({ tenantId: clinic._id,
    patient: patient._id, doctor: doctor._id, requestedBy: doctor._id, category: "general_treatment",
    title: "Private treatment consent", explanation: "Protected explanation", language: "en",
    validUntil: new Date(Date.now() + 86400000) }));
  const unauthorized = staffToken(other);
  const listed = await securityRequest("/api/clinical-consents", unauthorized);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.consents.some(row => row._id === String(consent._id)), false);
  for (const action of ["cancel", "review"]) {
    assert.equal((await securityRequest(`/api/clinical-consents/${consent._id}/${action}`,
      unauthorized, "PATCH", { reason: "Unauthorized cancellation attempt" })).status, 404);
  }
  assert.equal((await securityRequest(`/api/clinical-consents/${consent._id}/cancel`, staffToken(doctor),
    "PATCH", { reason: "Treating doctor cancelled the pending request" })).status, 200);
  assert.equal((await securityRequest("/api/clinical-consents", staffToken(doctor), "GET", undefined,
    otherClinic.slug)).status, 401);
});
test("a patient cannot read, cancel, reschedule or obtain another patient's appointment QR", async () => {
  const { appointment } = await visit();
  const account = await GlobalPatient.create({ email: `bola-${crypto.randomBytes(5).toString("hex")}@example.invalid`,
    name: "Different Patient", profileCompleted: true, status: "active" });
  const token = jwt.sign({ id: String(account._id), role: "patient-global", ver: 0 }, process.env.JWT_SECRET,
    { expiresIn: "10m" });
  for (const action of ["cancel", "reschedule", "check-in-qr"]) {
    const result = await securityRequest(`/api/patients/me/appointments/${appointment._id}/${action}`,
      token, action === "check-in-qr" ? "GET" : "PATCH", action === "check-in-qr" ? undefined : {});
    assert.equal(result.status, 404, action);
  }
  const list = await securityRequest("/api/patients/me/appointments", token);
  assert.equal(list.status, 200);
  assert.equal(list.body.appointments.length, 0);
  assert.equal((await securityRequest("/api/reception/patients", token)).status, 401);
});

test("paid reception check-in, doctor consultation, patient history, analytics and private realtime still work", { timeout: 15000 }, async () => {
  const { doctor, patient, appointment } = await visit();
  const account = await GlobalPatient.create({ email: patient.email, name: patient.name,
    profileCompleted: true, status: "active" });
  const receptionist = await runWithTenant(clinic._id, async () => {
    await Patient.updateOne({ _id: patient._id }, { $set: { globalPatientId: account._id,
      identityLink: { method: "verified_global_registration", linkedAt: new Date() } } });
    return User.create({ tenantId: clinic._id, name: "Front Desk", role: "receptionist",
      email: `front-${crypto.randomBytes(5).toString("hex")}@example.invalid`, passwordHash: "test-only" });
  });
  const patientToken = jwt.sign({ id: String(account._id), role: "patient-global", ver: 0 },
    process.env.JWT_SECRET, { expiresIn: "10m" });
  const socket = connectSocket(`http://127.0.0.1:${app.server.address().port}`, {
    autoConnect: false, reconnection: false, transports: ["websocket"],
    auth: { clinicSlug: clinic.slug, patientToken }, timeout: 3000,
  });
  try {
    const connected = once(socket, "connect"); socket.connect(); await connected;
    const checkedIn = await securityRequest(`/api/reception/appointments/${appointment._id}/check-in`,
      staffToken(receptionist), "POST", { payment: { method: "cash", paidAmount: 100 } });
    assert.equal(checkedIn.status, 201, JSON.stringify(checkedIn.body));
    const issued = checkedIn.body.token;
    const tokenCalled = once(socket, "patient:token-updated");
    const called = await securityRequest(`/api/tokens/${issued._id}/status`, staffToken(doctor),
      "PATCH", { status: "called" });
    assert.equal(called.status, 200, JSON.stringify(called.body));
    await tokenCalled;
    assert.equal((await securityRequest(`/api/consultations/patient/${patient._id}`,
      staffToken(doctor))).status, 200);
    const completed = await securityRequest("/api/consultations", staffToken(doctor), "POST", {
      tokenId: issued._id, diagnosis: "Local integration test diagnosis", medicines: [],
      testsRecommended: [], advice: "Local test advice", prescription: "Local test prescription",
    });
    assert.equal(completed.status, 201, JSON.stringify(completed.body));
    const history = await securityRequest("/api/patients/me/consultations", patientToken);
    assert.equal(history.status, 200);
    assert.ok(history.body.consultations.some(row => row.diagnosis === "Local integration test diagnosis"));
    const analytics = await securityRequest("/api/doctor/analytics?days=1", staffToken(doctor));
    assert.equal(analytics.status, 200);
    assert.equal(analytics.body.overview.completed, 1);
    assert.equal(analytics.body.overview.patientsHandled, 1);
    assert.equal((await securityRequest("/api/reception/prescriptions", staffToken(receptionist))).status, 200);
  } finally { socket.disconnect(); }
});

test("production server entrypoint starts against a disposable replica set and serves monitor health", async () => {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ["src/index.js"], { cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_ENV: "production", PORT: String(port),
      MONGO_URI: db.getUri("opd_disposable_integration"), DEFAULT_TENANT_SLUG: "",
      JWT_SECRET: crypto.randomBytes(48).toString("hex"),
      SUPER_ADMIN_JWT_SECRET: crypto.randomBytes(48).toString("hex"),
      QR_JWT_SECRET: crypto.randomBytes(48).toString("hex"),
      DISPLAY_KEY_ENCRYPTION_SECRET: crypto.randomBytes(48).toString("hex"),
      BACKUP_SCHEDULE_ENABLED: "false", TRUST_PROXY_HOPS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostic = "";
  child.stdout.on("data", chunk => { diagnostic += chunk; });
  child.stderr.on("data", chunk => { diagnostic += chunk; });
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) break;
      try { response = await fetch(`http://127.0.0.1:${port}/api/health`); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(response, diagnostic);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal((await fetch(`http://127.0.0.1:${port}/health/ready`)).status, 200);
  } finally {
    if (child.exitCode === null) {
      const closed = once(child, "exit"); child.kill("SIGTERM"); await closed;
    }
  }
});
test("cancelled appointments release a string-only unique slot", async () => {
  const { doctor, patient, appointment } = await visit();
  await runWithTenant(clinic._id, async () => {
    const slotKey = appointment.slotKey;
    appointment.status = "cancelled"; appointment.slotKey = undefined; await appointment.save();
    const next = await Appointment.create({ tenantId: clinic._id, patient: patient._id, patientName: patient.name, doctor: doctor._id, doctorName: doctor.name, department: "General OPD", appointmentDate: hospitalToday(), startTime: "10:00", endTime: "10:10", slotKey });
    next.status = "cancelled"; next.slotKey = undefined; await next.save();
    assert.equal(await Appointment.countDocuments({ doctor: doctor._id, status: "cancelled" }), 2);
  });
});
test("patient cancellation updates the appointment and releases its slot", async () => {
  const suffix = crypto.randomBytes(5).toString("hex");
  const account = await GlobalPatient.create({
    email: `cancel-${suffix}@example.invalid`, name: "Cancellation Patient",
    profileCompleted: true, status: "active",
  });
  const { appointment } = await runWithTenant(clinic._id, async () => {
    const doctor = await User.create({ tenantId: clinic._id, name: "Cancellation Doctor", email: `cancel-doctor-${suffix}@example.invalid`, passwordHash: "test-only-not-a-login", role: "doctor", department: "General OPD" });
    const patient = await Patient.create({ tenantId: clinic._id, globalPatientId: account._id, identityLink: { method: "verified_global_registration", linkedAt: new Date() }, name: account.name, email: account.email, profileCompleted: true });
    return { appointment: await Appointment.create({ tenantId: clinic._id, patient: patient._id, patientName: patient.name, patientId: patient.patientId, doctor: doctor._id, doctorName: doctor.name, department: "General OPD", appointmentDate: hospitalToday(), startTime: "22:00", endTime: "22:10", slotKey: `${doctor._id}:${hospitalToday()}:22:00` }) };
  });
  const token = jwt.sign({ id: String(account._id), role: "patient-global", ver: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/patients/me/appointments/${appointment._id}/cancel`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "X-Clinic-Slug": clinic.slug, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Schedule changed" }),
  });
  assert.equal(response.status, 200);
  const stored = await runWithTenant(clinic._id, () => Appointment.findById(appointment._id).lean());
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.cancellationReason, "Schedule changed");
  assert.equal(stored.slotKey, undefined);
});
test("database prevents two active appointments per patient per day", async () => {
  const { doctor, patient } = await visit();
  await assert.rejects(runWithTenant(clinic._id, () => Appointment.create({ tenantId: clinic._id, patient: patient._id, patientName: patient.name, doctor: doctor._id, doctorName: doctor.name, department: "General OPD", appointmentDate: hospitalToday(), startTime: "11:00", endTime: "11:10", slotKey: `${doctor._id}:another-slot` })), (error) => error.code === 11000);
});
test("paid check-in records collector and is idempotent", async () => {
  const { doctor, appointment } = await visit();
  const input = { appointmentId: appointment._id, actorId: doctor._id, payment: { method: "cash", paidAmount: 100 } };
  const first = await runWithTenant(clinic._id, () => checkInAppointment(input));
  const second = await runWithTenant(clinic._id, () => checkInAppointment(input));
  assert.equal(first.token.billing.paidAmount, 100);
  assert.equal(String(first.token.billing.collectedBy), String(doctor._id));
  assert.equal(String(first.token._id), String(second.token._id));
  assert.equal(second.alreadyCheckedIn, true);
});
test("concurrent check-ins cannot issue duplicate tokens", async () => {
  const { doctor, appointment } = await visit();
  const input = { appointmentId: appointment._id, actorId: doctor._id, payment: { method: "cash", paidAmount: 100 } };
  const results = await Promise.allSettled([runWithTenant(clinic._id, () => checkInAppointment(input)), runWithTenant(clinic._id, () => checkInAppointment(input))]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  for (const result of results) if (result.status === "rejected") assert.equal(result.reason.status, 409);
  assert.equal(await runWithTenant(clinic._id, () => Token.countDocuments({ appointment: appointment._id })), 1);
});
test("failed appointment save rolls back token and payment writes", async () => {
  const { doctor, appointment } = await visit();
  const stub = mock.method(Appointment.prototype, "save", async () => { throw new Error("controlled write failure"); });
  try {
    await assert.rejects(runWithTenant(clinic._id, () => checkInAppointment({ appointmentId: appointment._id, actorId: doctor._id, payment: { method: "cash", paidAmount: 100 } })), /controlled write failure/);
  } finally { stub.mock.restore(); }
  assert.equal(await runWithTenant(clinic._id, () => Token.countDocuments({ appointment: appointment._id })), 0);
  const stored = await runWithTenant(clinic._id, () => Appointment.findById(appointment._id));
  assert.equal(stored.status, "booked");
});
test("self check-in cannot bypass a positive fee", async () => {
  const { appointment } = await visit();
  await assert.rejects(runWithTenant(clinic._id, () => checkInAppointment({ appointmentId: appointment._id, payment: { method: "cash", paidAmount: 100 } })), (error) => error.status === 403);
  assert.equal(await runWithTenant(clinic._id, () => Token.countDocuments({ appointment: appointment._id })), 0);
});
test("missed appointment cannot be checked in", async () => {
  const { doctor, appointment } = await visit();
  await runWithTenant(clinic._id, async () => { appointment.status = "missed"; appointment.slotKey = undefined; await appointment.save(); });
  await assert.rejects(runWithTenant(clinic._id, () => checkInAppointment({ appointmentId: appointment._id, actorId: doctor._id, payment: { method: "cash", paidAmount: 100 } })), (error) => error.status === 409);
});
test("concurrent OTP replay creates only one credential setup grant", async () => {
  const email = "otp-race@example.invalid";
  let otp;
  await requestPatientCode(email, "register", async message => { otp = message.text.match(/code is (\d{6})/)[1]; });
  await new Promise(resolve => setImmediate(resolve));
  const url = `http://127.0.0.1:${app.server.address().port}/api/patient-auth/verify-otp`;
  const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, otp, purpose: "register" }) });
  const responses = await Promise.all([send(), send()]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  const granted = await responses.find(response => response.status === 200).json();
  assert.ok(granted.setupToken);
  assert.equal(granted.token, undefined);
  assert.ok((await GlobalPatientOtp.findOne({ email })).verifiedAt);
  assert.equal(await GlobalPatient.countDocuments({ email }), 0);
});
test("revoked patient token is denied by the clinic API", async () => {
  const account = await GlobalPatient.create({ email: "revoked@example.invalid", status: "active", tokenVersion: 2 });
  const token = jwt.sign({ id: String(account._id), role: "patient-global", ver: 1 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/patients/me`, { headers: { Authorization: `Bearer ${token}`, "X-Clinic-Slug": clinic.slug } });
  assert.equal(response.status, 401);
});


test("remembered patient session rotates refresh credentials and logout revokes them", async () => {
  const email = `remember-${crypto.randomBytes(5).toString("hex")}@example.invalid`;
  const password = "A remembered patient passphrase 2026!";
  await GlobalPatient.create({ email, username: `remember_${crypto.randomBytes(5).toString("hex")}`,
    passwordHash: await hashPatientPassword(password), credentialsSetAt: new Date() });
  const base = `http://127.0.0.1:${app.server.address().port}/api/patient-auth`;
  const verified = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password, rememberDevice: true }),
  });
  assert.equal(verified.status, 200);
  const verifiedData = await verified.json();
  assert.ok(verifiedData.token);
  // Password login clears the previous cookie, then issues the new one.
  // A browser keeps the last Set-Cookie value for the same name and path.
  const firstSetCookie = verified.headers.getSetCookie().at(-1) || "";
  const firstCookie = firstSetCookie.split(";", 1)[0];
  assert.match(firstCookie, /^opdfy_patient_refresh=.+/);
  assert.equal(await PatientSession.countDocuments({ patientId: verifiedData.patient.id, revokedAt: null }), 1);

  const refreshed = await fetch(`${base}/refresh`, {
    method: "POST",
    headers: { Cookie: firstCookie, "X-OPD-Client": "web" },
  });
  assert.equal(refreshed.status, 200);
  const refreshedData = await refreshed.json();
  assert.ok(refreshedData.token);
  const secondSetCookie = refreshed.headers.getSetCookie().at(-1) || "";
  const secondCookie = secondSetCookie.split(";", 1)[0];
  assert.notEqual(secondCookie, firstCookie);

  const replay = await fetch(`${base}/refresh`, {
    method: "POST",
    headers: { Cookie: firstCookie, "X-OPD-Client": "web" },
  });
  assert.equal(replay.status, 401);

  const csrfStyleAttempt = await fetch(`${base}/refresh`, {
    method: "POST",
    headers: { Cookie: secondCookie },
  });
  assert.equal(csrfStyleAttempt.status, 403);

  const logout = await fetch(`${base}/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshedData.token}`, Cookie: secondCookie },
  });
  assert.equal(logout.status, 200);
  assert.equal(await PatientSession.countDocuments({ patientId: verifiedData.patient.id, revokedAt: null }), 0);

  const afterLogout = await fetch(`${base}/refresh`, {
    method: "POST",
    headers: { Cookie: secondCookie, "X-OPD-Client": "web" },
  });
  assert.equal(afterLogout.status, 401);
});
