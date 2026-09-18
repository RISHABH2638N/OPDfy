import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Tenant from "../../src/models/Tenant.js";
import User from "../../src/models/User.js";
import Patient from "../../src/models/Patient.js";
import GlobalPatient from "../../src/models/GlobalPatient.js";
import GlobalPatientOtp from "../../src/models/GlobalPatientOtp.js";
import PatientSession from "../../src/models/PatientSession.js";
import Appointment from "../../src/models/Appointment.js";
import Token from "../../src/models/Token.js";
import { runWithTenant } from "../../src/services/tenantExecutionContext.js";
import { checkInAppointment, hospitalToday } from "../../src/services/appointmentCheckIn.js";

// This suite always creates its own disposable replica set. It never reads
// MONGO_URI and cannot target the operator's production or staging database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
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
test("concurrent OTP replay creates only one session", async () => {
  const email = "otp-race@example.invalid";
  const otp = "314159";
  await GlobalPatientOtp.create({ email, otpHash: crypto.createHmac("sha256", process.env.JWT_SECRET).update(otp).digest("hex"), expiresAt: new Date(Date.now() + 60000), attempts: 0 });
  const url = `http://127.0.0.1:${app.server.address().port}/api/patient-auth/verify-otp`;
  const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, otp }) });
  const responses = await Promise.all([send(), send()]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(await GlobalPatientOtp.countDocuments({ email }), 0);
});
test("revoked patient token is denied by the clinic API", async () => {
  const account = await GlobalPatient.create({ email: "revoked@example.invalid", status: "active", tokenVersion: 2 });
  const token = jwt.sign({ id: String(account._id), role: "patient-global", ver: 1 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/patients/me`, { headers: { Authorization: `Bearer ${token}`, "X-Clinic-Slug": clinic.slug } });
  assert.equal(response.status, 401);
});


test("remembered patient session rotates refresh credentials and logout revokes them", async () => {
  const email = `remember-${crypto.randomBytes(5).toString("hex")}@example.invalid`;
  const otp = "271828";
  await GlobalPatientOtp.create({
    email,
    otpHash: crypto.createHmac("sha256", process.env.JWT_SECRET).update(otp).digest("hex"),
    expiresAt: new Date(Date.now() + 60000),
    attempts: 0,
  });

  const base = `http://127.0.0.1:${app.server.address().port}/api/patient-auth`;
  const verified = await fetch(`${base}/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, otp, rememberDevice: true }),
  });
  assert.equal(verified.status, 200);
  const verifiedData = await verified.json();
  assert.ok(verifiedData.token);
  const firstSetCookie = verified.headers.getSetCookie?.()[0] || verified.headers.get("set-cookie") || "";
  const firstCookie = firstSetCookie.split(";", 1)[0];
  assert.match(firstCookie, /^opdfy_patient_refresh=/);
  assert.equal(await PatientSession.countDocuments({ patientId: verifiedData.patient.id, revokedAt: null }), 1);

  const refreshed = await fetch(`${base}/refresh`, {
    method: "POST",
    headers: { Cookie: firstCookie, "X-OPD-Client": "web" },
  });
  assert.equal(refreshed.status, 200);
  const refreshedData = await refreshed.json();
  assert.ok(refreshedData.token);
  const secondSetCookie = refreshed.headers.getSetCookie?.()[0] || refreshed.headers.get("set-cookie") || "";
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
