import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import mongoose from "mongoose";
import Patient from "../src/models/Patient.js";
import PrivacyIncident from "../src/models/PrivacyIncident.js";
import SecurityEvent from "../src/models/SecurityEvent.js";
import { queueSecurityAlert, createAutomaticIncident } from "../src/services/incidentResponseService.js";
import { submitConditions, reviewCondition } from "../src/services/healthConditions.js";
import { sensitiveAccessAudit } from "../src/middleware/sensitiveAccessAudit.js";

test("background security alerts handle database failures without logging private error payloads", async t => {
  const previous = process.env.SECURITY_ALERT_EMAIL;
  process.env.SECURITY_ALERT_EMAIL = "";
  const warnings = [];
  const incident = { _id: new mongoose.Types.ObjectId(), severity: "high", detectedAt: new Date() };
  t.mock.method(console, "warn", (...args) => warnings.push(args.join(" ")));
  t.mock.method(PrivacyIncident, "findOne", async () => null);
  t.mock.method(PrivacyIncident, "create", async () => incident);
  t.mock.method(PrivacyIncident, "updateOne", async () => {
    throw Object.assign(new Error("private patient name and credential must not be logged"), { name: "MongoNotConnectedError" });
  });
  try {
    await queueSecurityAlert(incident);
    assert.equal(await createAutomaticIncident({ title: "Synthetic test", description: "Synthetic test only", severity: "high", fingerprint: "test-only" }), incident);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every(line => line === "Incident security alert skipped: MongoNotConnectedError"));
  } finally {
    if (previous === undefined) delete process.env.SECURITY_ALERT_EMAIL;
    else process.env.SECURITY_ALERT_EMAIL = previous;
  }
});

test("future client revisions cannot write a stale patient declaration or clinician review snapshot", async t => {
  const patient = { _id: new mongoose.Types.ObjectId(), tenantId: new mongoose.Types.ObjectId(), conditionProfile: {
    revision: 2, declaration: "conditions", analyticsConsent: false, entries: [{ code: "diabetes", status: "pending" }],
  } };
  const update = t.mock.method(Patient, "findOneAndUpdate", async () => { throw new Error("A stale snapshot must not reach the write"); });
  await assert.rejects(submitConditions(patient, { codes: ["asthma"], declaration: "conditions", analyticsConsent: true, revision: 3 }), { status: 409 });
  await assert.rejects(reviewCondition(patient, { _id: new mongoose.Types.ObjectId() }, new mongoose.Types.ObjectId(), {
    code: "diabetes", decision: "confirmed", verifiedCode: "diabetes", revision: 3,
  }), { status: 409 });
  assert.equal(update.mock.callCount(), 0);
  assert.equal(patient.conditionProfile.entries[0].status, "pending");
});

test("condition and EHR reads are audited only after authorized success with no health data or query values", async t => {
  const records = [];
  t.mock.method(SecurityEvent, "create", async record => { records.push(record); return {}; });
  const actor = String(new mongoose.Types.ObjectId()), tenant = new mongoose.Types.ObjectId();
  function finish(path, statusCode = 200, authenticated = true) {
    const res = new EventEmitter(); res.statusCode = statusCode;
    sensitiveAccessAudit({ method: "GET", originalUrl: `${path}?condition=diabetes&patientName=private-name`,
      tenantId: tenant, user: authenticated ? { id: actor } : undefined }, res, () => {});
    res.emit("finish");
  }
  const tokenId = String(new mongoose.Types.ObjectId());
  for (const path of [`/api/tokens/${tokenId}/conditions`, `/api/tokens/${tokenId}/patient-profile`, "/api/admin/condition-insights"]) {
    finish(path); finish(path, 403); finish(path, 200, false);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.equal(record.event, "patient_data_access");
    assert.equal(record.actorId, actor); assert.equal(String(record.tenantId), String(tenant));
    assert.deepEqual(record.metadata, {});
    assert.doesNotMatch(record.route, /private-name|diabetes|\?|[a-f0-9]{24}/);
  }
});
