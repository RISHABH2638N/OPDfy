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
import Feedback from "../src/models/Feedback.js";
import QueueReservation from "../src/models/QueueReservation.js";
import FollowUpPlan from "../src/models/FollowUpPlan.js";
import SecurityEvent from "../src/models/SecurityEvent.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SUPER_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.QR_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_URL = "https://clinic.example.invalid";
const tenantId = new mongoose.Types.ObjectId();
const adminId = new mongoose.Types.ObjectId();
const doctorId = new mongoose.Types.ObjectId();
const tenant = { _id: tenantId, name: "Clinic", slug: "analytics-clinic", timezone: "Asia/Kolkata", status: "active", subscription: {} };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone }).format(new Date());
const createdAt = new Date(`${today}T09:00:00.000Z`);
const calledAt = new Date(createdAt.getTime() + 20 * 60000);
const completedAt = new Date(calledAt.getTime() + 10 * 60000);
const token = {
  createdAt, calledAt, completedAt, department: "General OPD", assignedDoctor: doctorId,
  queueSource: "walk_in", status: "completed", arrivalStatus: "arrived", urgency: "normal",
  billing: { status: "paid", paidAt: completedAt, paidAmount: 200, method: "upi" },
};
const query = (value) => ({ select() { return this; }, populate() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
let instance, base;

before(async () => {
  mock.method(Tenant, "findOne", () => query(tenant));
  mock.method(Tenant, "findById", () => query(tenant));
  mock.method(User, "findOne", () => query({ _id: adminId, tenantId, role: "admin", name: "Admin", department: "General OPD", tokenVersion: 0 }));
  mock.method(User, "find", () => query([{ _id: doctorId, name: "Doctor", department: "General OPD" }]));
  mock.method(Token, "find", (filter) => query(filter["billing.paidAt"] ? [token] : filter.status ? [] : [token]));
  mock.method(Appointment, "find", () => query([{ appointmentDate: today, doctor: doctorId, department: "General OPD", status: "completed", rescheduleCount: 1 }]));
  mock.method(Consultation, "find", () => query([]));
  mock.method(Feedback, "find", () => query([]));
  mock.method(QueueReservation, "find", () => query([]));
  mock.method(FollowUpPlan, "find", () => query([{ dueDate: today, doctor: doctorId, department: "General OPD", status: "scheduled" }]));
  mock.method(SecurityEvent, "create", async () => ({}));
  const { createApplication } = await import("../src/app.js");
  instance = createApplication();
  instance.server.listen(0, "127.0.0.1");
  await once(instance.server, "listening");
  base = `http://127.0.0.1:${instance.server.address().port}`;
});
after(async () => { if (instance) await new Promise((resolve) => instance.io.close(resolve)); mock.restoreAll(); });

test("clinic analytics applies doctor scope and reports real waits, follow-ups and payments once", async () => {
  const credential = jwt.sign({ id: String(adminId), role: "admin", tenantId: String(tenantId), ver: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const response = await fetch(`${base}/api/admin/analytics?range=1&doctorId=${doctorId}`, {
    headers: { "X-Clinic-Slug": tenant.slug, Authorization: `Bearer ${credential}` },
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.period.timezone, tenant.timezone);
  assert.equal(data.overview.totalPatients, 1);
  assert.equal(data.overview.medianWaitMinutes, 20);
  assert.equal(data.overview.p90WaitMinutes, 20);
  assert.equal(data.followUpStatus.conversionRate, 100);
  assert.equal(data.appointmentStatus.rescheduled, 1);
  assert.equal(data.collections.net, 200);
  assert.equal(data.collections.methods.upi, 200);
  assert.equal(data.heatmap.flatMap((day) => day.slots).reduce((sum, count) => sum + count, 0), 1);
});

test("clinic analytics rejects malformed custom dates before querying records", async () => {
  const credential = jwt.sign({ id: String(adminId), role: "admin", tenantId: String(tenantId), ver: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const response = await fetch(`${base}/api/admin/analytics?startDate=2026-02-30&endDate=${today}`, {
    headers: { "X-Clinic-Slug": tenant.slug, Authorization: `Bearer ${credential}` },
  });
  assert.equal(response.status, 400);
});
