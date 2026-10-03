import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import Tenant from "../../src/models/Tenant.js";
import SuperAdmin from "../../src/models/SuperAdmin.js";
import SubscriptionInvoice from "../../src/models/SubscriptionInvoice.js";
import { buildPlatformAnalytics, platformPeriod } from "../../src/services/platformAnalytics.js";

// Disposable synthetic database; never reads MONGO_URI or clinic records.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SUPER_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CLIENT_URL = "https://platform-tests.example.invalid";
process.env.SMTP_HOST = "";
let db, app, first, second, ownerToken;
const oid = () => new mongoose.Types.ObjectId();
const snapshot = new Date("2026-10-03T12:00:00Z");
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri(), { dbName: "opdfy_platform_analytics_test", autoCreate: false, autoIndex: false });
  const { createApplication } = await import("../../src/app.js");
  for (const model of Object.values(mongoose.models)) {
    await model.init(); await model.createCollection(); await model.createIndexes();
  }
  first = await Tenant.create({ name: "Synthetic Clinic One", slug: "analytics-one", status: "active", createdAt: new Date("2026-01-01"), subscription: { status: "active", endsAt: new Date("2026-10-05") }, analyticsTerms: { plan: "Starter", billingCycle: "monthly", feePaise: 129900, pilotEndsAt: new Date("2026-10-04") } });
  second = await Tenant.create({ name: "Synthetic Clinic Two", slug: "analytics-two", status: "active" });
  const owner = await SuperAdmin.create({ name: "Synthetic Owner", email: "owner@example.invalid", passwordHash: "test-only" });
  ownerToken = jwt.sign({ id: String(owner._id), role: "superadmin", ver: 0 }, process.env.SUPER_ADMIN_JWT_SECRET, { expiresIn: "10m" });
  const a = oid(), b = oid(), c = oid();
  const token = (tenantId, patient, createdAt, extra = {}) => ({ tenantId, patient, createdAt: new Date(createdAt), patientName: "PRIVATE NAME", phone: "PRIVATE PHONE", status: "completed", arrivalStatus: "arrived", isArchived: true, ...extra });
  await mongoose.connection.db.collection("tokens").insertMany([
    token(first._id, a, "2026-09-30T04:00:00Z"), token(first._id, c, "2026-09-30T18:29:59Z"),
    token(first._id, a, "2026-09-30T18:30:00Z", { billing: { status: "paid", paidAt: new Date("2026-10-01"), paidAmount: 150 } }),
    token(first._id, a, "2026-10-01T06:00:00Z"), token(first._id, b, "2026-10-02T04:00:00Z", { billing: { status: "paid", paidAt: new Date("2026-10-02"), paidAmount: 100 } }),
    token(first._id, a, "2026-10-03T04:00:00Z"), token(second._id, a, "2026-10-03T04:00:00Z"),
    token(first._id, oid(), "2026-10-03T04:00:00Z", { status: "waiting", arrivalStatus: "not_checked_in" }),
    token(first._id, oid(), "2026-10-03T04:00:00Z", { arrivalStatus: "no_show" }),
  ]);
  await mongoose.connection.db.collection("appointments").insertOne({ tenantId: first._id, bookingSource: "patient", createdAt: new Date("2026-10-01"), billing: { status: "paid", paidAmount: 150, paidAt: new Date("2026-10-01") } });
  await mongoose.connection.db.collection("consultations").insertOne({ tenantId: first._id, prescription: "PRIVATE MEDICINE", createdAt: new Date("2026-10-01") });
  await mongoose.connection.db.collection("users").insertMany([{ tenantId: first._id, role: "doctor" }, { tenantId: second._id, role: "receptionist" }]);
  app = createApplication(); app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
});
after(async () => { if (app) await new Promise(resolve => app.io.close(resolve)); await mongoose.disconnect(); if (db) await db.stop(); });
async function request(path, { token = ownerToken, method = "GET", body } = {}) {
  const result = await fetch(`http://127.0.0.1:${app.server.address().port}/api/platform${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: result.status, body: await result.json() };
}
test("Super Admin analytics rejects anonymous, clinic and patient sessions and invalid filters", async () => {
  for (const role of ["admin", "doctor", "receptionist", "patient-global"]) {
    const token = jwt.sign({ id: String(oid()), role, tenantId: String(first._id) }, process.env.JWT_SECRET);
    assert.equal((await request("/analytics", { token })).status, 401);
    assert.equal((await request("/subscription-invoices", { token, method: "POST", body: {} })).status, 401);
  }
  assert.equal((await request("/analytics", { token: "" })).status, 401);
  for (const query of ["startDate=2026-02-30&endDate=2026-10-03", "range=999", "clinicId=bad", "startDate=2026-10-03&endDate=2026-09-30"]) assert.equal((await request(`/analytics?${query}`)).status, 400);
});
test("daily and monthly unique counts respect IST boundaries, archives and clinic filters without returning identities", async () => {
  const data = await buildPlatformAnalytics({ startDate: "2026-09-30", endDate: "2026-10-03" }, snapshot);
  assert.equal(data.overview.dailyPatients, 2); assert.equal(data.overview.monthlyPatients, 3);
  assert.deepEqual(data.monthlyTrend, [{ date: "2026-09", count: 2 }, { date: "2026-10", count: 3 }]);
  assert.deepEqual(data.dailyTrend.map(row => row.count), [2, 1, 1, 2]);
  const one = data.clinics.find(row => row.id === String(first._id));
  assert.equal(one.monthlyPatients, 2); assert.equal(one.clinicCounterPayments, 250);
  assert.equal(data.overview.pilots, 1); assert.equal(data.overview.doctors, 1); assert.equal(data.adoption.prescriptions, 1);
  assert.ok(data.alerts.some(row => row.type === "pilot_ending"));
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE NAME|PRIVATE PHONE|PRIVATE MEDICINE|patientName|diagnosis/);
  const filtered = await buildPlatformAnalytics({ startDate: "2026-10-01", endDate: "2026-10-03", clinicId: String(second._id) }, snapshot);
  assert.equal(filtered.clinics.length, 1); assert.equal(filtered.overview.monthlyPatients, 1); assert.equal(filtered.adoption.appointments, 0);
  assert.equal(platformPeriod({ startDate: "2026-10-01", endDate: "2026-10-03" }, snapshot).start.toISOString(), "2026-09-30T18:30:00.000Z");
});
test("manual invoice writes validate money, deduplicate concurrent retries and cannot change clinical data or renew access", async () => {
  const body = { clinicId: String(first._id), plan: "Starter", billingCycle: "monthly", amountPaise: 129900, dueDate: "2026-10-01", status: "pending", requestId: crypto.randomUUID() };
  const before = await Tenant.findById(first._id).lean();
  for (const amountPaise of [-1, 0, 1.2, "129900", 100000001]) assert.equal((await request("/subscription-invoices", { method: "POST", body: { ...body, amountPaise } })).status, 400);
  const results = await Promise.all([1, 2].map(() => request("/subscription-invoices", { method: "POST", body })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.equal(await SubscriptionInvoice.countDocuments({}), 1);
  assert.equal((await request("/subscription-invoices", { method: "POST", body: { ...body, amountPaise: 199900 } })).status, 409);
  const after = await Tenant.findById(first._id).lean(); assert.equal(String(before.subscription.endsAt), String(after.subscription.endsAt));
  const data = await buildPlatformAnalytics({ startDate: "2026-09-30", endDate: "2026-10-03" }, snapshot);
  assert.equal(data.overview.outstandingPaise, 129900); assert.equal(data.overview.subscriptionCollectedPaise, 0);
  const id = results[0].body.id;
  const settled = await Promise.all([1, 2].map(() => request(`/subscription-invoices/${id}`, { method: "PATCH", body: { status: "paid", method: "upi", paidDate: "2026-10-01" } })));
  assert.deepEqual(settled.map(result => result.status).sort(), [200, 409]);
  const paid = await buildPlatformAnalytics({ startDate: "2026-10-01", endDate: "2026-10-03" }, snapshot);
  assert.equal(paid.overview.subscriptionCollectedPaise, 129900); assert.equal(paid.overview.outstandingPaise, 0);
  assert.equal((await request(`/subscription-invoices/${id}`, { method: "PATCH", body: { status: "void" } })).status, 409);
});
test("subscription terms and pilot end date are optional reporting data and legacy payments remain unguessed", async () => {
  assert.equal((await request(`/clinics/${second._id}/analytics-terms`, { method: "PUT", body: { plan: "Growth", billingCycle: "yearly", feePaise: 1918800, pilotEndDate: "2026-10-10" } })).status, 200);
  const clinic = await Tenant.findById(second._id).lean(); assert.equal(clinic.analyticsTerms.feePaise, 1918800); assert.equal(clinic.subscription.status, "unmanaged");
  assert.equal((await request(`/clinics/${second._id}/analytics-terms`, { method: "PUT", body: { plan: "fake", billingCycle: "yearly", feePaise: 1 } })).status, 400);
  const response = await request("/analytics?startDate=2026-10-01&endDate=2026-10-03"); assert.equal(response.status, 200);
  assert.equal(response.body.clinics.find(row => row.id === String(second._id)).subscriptionCollectedPaise, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /fingerprint|requestId|createdBy|settledBy/);
});
test("invoice selection supports payment categories, clinic isolation and older records beyond the analytics ledger limit", async () => {
  const base = { tenantId: second._id, plan: "Growth", billingCycle: "monthly", amountPaise: 189900, dueDate: "2026-10-01", status: "paid", paidAt: snapshot, method: "upi", createdBy: oid(), fingerprint: "private" };
  await SubscriptionInvoice.insertMany(Array.from({ length: 105 }, () => ({ ...base, requestId: crypto.randomUUID() })));
  await SubscriptionInvoice.create({ ...base, billingCycle: "setup", status: "pending", method: "", paidAt: null, requestId: crypto.randomUUID() });
  const firstPage = await request(`/subscription-invoices?clinicId=${second._id}&billingCycle=monthly&status=paid`);
  assert.equal(firstPage.status, 200); assert.equal(firstPage.body.invoices.length, 50); assert.ok(firstPage.body.nextCursor);
  const secondPage = await request(`/subscription-invoices?clinicId=${second._id}&billingCycle=monthly&status=paid&before=${firstPage.body.nextCursor}`);
  const lastPage = await request(`/subscription-invoices?clinicId=${second._id}&billingCycle=monthly&status=paid&before=${secondPage.body.nextCursor}`);
  const ids = [...firstPage.body.invoices, ...secondPage.body.invoices, ...lastPage.body.invoices].map(row => row._id);
  assert.equal(ids.length, 105); assert.equal(new Set(ids).size, 105); assert.equal(lastPage.body.nextCursor, null);
  assert.doesNotMatch(JSON.stringify(firstPage.body), /fingerprint|requestId|createdBy|tenantId/);
  const setup = await request(`/subscription-invoices?clinicId=${second._id}&billingCycle=setup&status=pending`);
  assert.equal(setup.body.invoices.length, 1); assert.equal(setup.body.invoices[0].billingCycle, "setup");
  const scoped = await request(`/subscription-invoices?clinicId=${first._id}`); assert.equal(scoped.body.invoices.length, 1);
  for (const query of ["", `clinicId=${second._id}&status=bad`, `clinicId=${second._id}&billingCycle[]=monthly`, `clinicId=${second._id}&before=bad`]) assert.equal((await request(`/subscription-invoices?${query}`)).status, 400);
});
test("protected PDF downloads render real payment state without creating charges or renewing clinic access", async () => {
  const row = await SubscriptionInvoice.findOne({ tenantId: first._id });
  const url = `http://127.0.0.1:${app.server.address().port}/api/platform/subscription-invoices/${row._id}/pdf`;
  for (const token of ["", jwt.sign({ id: String(oid()), role: "admin", tenantId: String(first._id) }, process.env.JWT_SECRET)]) {
    assert.equal((await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status, 401);
  }
  const before = await SubscriptionInvoice.countDocuments(); const clinicBefore = await Tenant.findById(first._id).lean();
  for (const status of ["paid", "pending", "void"]) {
    // Synthetic fixtures check all representations; API settlement guards remain unchanged.
    await SubscriptionInvoice.updateOne({ _id: row._id }, { $set: { status } });
    const result = await fetch(url, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert.equal(result.status, 200); assert.equal(result.headers.get("content-type"), "application/pdf");
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.ok(result.headers.get("content-disposition").includes(`OPD-${String(row._id).toUpperCase()}.pdf`));
    const pdf = Buffer.from(await result.arrayBuffer()); assert.ok(pdf.subarray(0, 8).toString().startsWith("%PDF-"));
    assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);
    assert.match(pdf.toString("latin1"), /\/ToUnicode/);
  }
  assert.equal(await SubscriptionInvoice.countDocuments(), before);
  const clinicAfter = await Tenant.findById(first._id).lean(); assert.deepEqual(clinicAfter.subscription, clinicBefore.subscription);
  assert.equal((await request("/subscription-invoices/bad/pdf")).status, 400);
  assert.equal((await request(`/subscription-invoices/${oid()}/pdf`)).status, 404);
});
