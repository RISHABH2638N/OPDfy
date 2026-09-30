import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Token from "../src/models/Token.js";
import Appointment from "../src/models/Appointment.js";
import Consultation from "../src/models/Consultation.js";
import FollowUpPlan from "../src/models/FollowUpPlan.js";
import DepartmentReferral from "../src/models/DepartmentReferral.js";
import Feedback from "../src/models/Feedback.js";
import { analyticsPeriod, summarizeDoctorAnalytics } from "../src/services/doctorAnalytics.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SUPER_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.QR_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_URL = "https://clinic.example.invalid";

const tenantId = new mongoose.Types.ObjectId();
const doctorId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();
const patientId = new mongoose.Types.ObjectId();
const tenant = { _id: tenantId, name: "Clinic", slug: "doctor-analytics", timezone: "Asia/Kolkata", status: "active", subscription: {} };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone }).format(new Date());
const createdAt = new Date(`${today}T09:00:00Z`);
const query = (value) => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
let app, base;

before(async () => {
  mock.method(Tenant, "findOne", () => query(tenant));
  mock.method(User, "findOne", () => query({ _id: doctorId, tenantId, role: "doctor", name: "Doctor", department: "General OPD", tokenVersion: 0 }));
  mock.method(Token, "find", (filter) => {
    if (filter.status === "waiting") {
      assert.equal(filter.department, "General OPD");
      assert.deepEqual(filter.$or, [{ assignedDoctor: String(doctorId) }, { assignedDoctor: null }]);
      return query([{ createdAt, queueControl: { isOnHold: false } }, { createdAt, queueControl: { isOnHold: true } }]);
    }
    assert.equal(String(filter.assignedDoctor), String(doctorId));
    return query(filter.createdAt?.$lt ? [] : [{ patient: patientId, createdAt, calledAt: new Date(createdAt.getTime() + 20 * 60000), completedAt: new Date(createdAt.getTime() + 30 * 60000), status: "completed", queueSource: "walk_in", urgency: "normal", arrivalStatus: "arrived" }]);
  });
  mock.method(Appointment, "find", (filter) => { assert.equal(String(filter.doctor), String(doctorId)); return query([]); });
  mock.method(Consultation, "find", (filter) => { assert.equal(String(filter.doctor), String(doctorId)); return query([{ diagnosis: "Fever", prescription: "Rest", createdAt }]); });
  mock.method(FollowUpPlan, "find", () => query([]));
  mock.method(DepartmentReferral, "find", () => query([]));
  mock.method(Feedback, "find", () => query([]));
  const { createApplication } = await import("../src/app.js");
  app = createApplication();
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { if (app) await new Promise((resolve) => app.io.close(resolve)); mock.restoreAll(); });

test("doctor analytics uses only authenticated doctor data and excludes arbitrary doctorId", async () => {
  const credential = jwt.sign({ id: String(doctorId), role: "doctor", tenantId: String(tenantId), ver: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const response = await fetch(`${base}/api/doctor/analytics?range=1&doctorId=${otherId}`, { headers: { "X-Clinic-Slug": tenant.slug, Authorization: `Bearer ${credential}` } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.overview.patientsHandled, 1);
  assert.equal(data.overview.averageWaitMinutes, 20);
  assert.equal(data.overview.averageConsultationMinutes, 10);
  assert.equal(data.overview.prescriptions, 1);
  assert.equal(data.overview.waitingNow, 1);
  assert.equal(data.dailyVolume.reduce((count, row) => count + row.total, 0), 1);
});

test("doctor analytics validates custom dates", async () => {
  const credential = jwt.sign({ id: String(doctorId), role: "doctor", tenantId: String(tenantId), ver: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const response = await fetch(`${base}/api/doctor/analytics?startDate=2026-02-30&endDate=${today}`, { headers: { "X-Clinic-Slug": tenant.slug, Authorization: `Bearer ${credential}` } });
  assert.equal(response.status, 400);
});

test("recent prescriptions are available only with an authenticated doctor session", async () => {
  const anonymous = await fetch(`${base}/api/consultations/doctor/recent`, { headers: { "X-Clinic-Slug": tenant.slug } });
  assert.equal(anonymous.status, 401);
  const credential = jwt.sign({ id: String(doctorId), role: "doctor", tenantId: String(tenantId), ver: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const response = await fetch(`${base}/api/consultations/doctor/recent`, { headers: { "X-Clinic-Slug": tenant.slug, Authorization: `Bearer ${credential}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).consultations.length, 1);
});

test("percentiles and first visits use actual observations", () => {
  const period = analyticsPeriod({ startDate: "2026-09-01", endDate: "2026-09-02" }, "Asia/Kolkata", new Date("2026-09-29T12:00:00Z"));
  const a = new Date("2026-09-01T04:00:00Z");
  const rows = [5, 15, 25].map((wait) => ({ patient: patientId, createdAt: a, calledAt: new Date(a.getTime() + wait * 60000), status: "completed", queueSource: "walk_in" }));
  const result = summarizeDoctorAnalytics(period, { tokens: rows, appointments: [], consultations: [], followUps: [], referrals: [], feedback: [] });
  assert.equal(result.overview.medianWaitMinutes, 15);
  assert.equal(result.overview.p90WaitMinutes, 23);
  assert.equal(result.overview.firstVisits, 1);
  assert.equal(result.overview.repeatVisits, 2);
});

test("a completed older follow-up and missed appointment count in the selected period", () => {
  const period = analyticsPeriod({ startDate: "2026-09-01", endDate: "2026-09-02" }, "Asia/Kolkata", new Date("2026-09-29T12:00:00Z"));
  const date = new Date("2026-09-01T04:00:00Z");
  const result = summarizeDoctorAnalytics(period, {
    tokens: [], consultations: [], referrals: [], feedback: [],
    appointments: [{ status: "missed", token: null }],
    followUps: [{ status: "completed", createdAt: new Date("2026-08-01T04:00:00Z"), completedAt: date }],
  });
  assert.equal(result.overview.noShows, 1);
  assert.equal(result.followUps.recommended, 0);
  assert.equal(result.followUps.completed, 1);
});
