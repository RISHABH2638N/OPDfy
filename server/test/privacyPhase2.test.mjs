import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const query = value => ({
  sort() { return this; }, lean() { return this; }, select() { return this; }, session() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
async function load(name, dependencies) {
  const context = vm.createContext({ console, Buffer, process, setTimeout });
  const module = new vm.SourceTextModule(read(name), { context });
  await module.link(async specifier => {
    if (!(specifier in dependencies)) throw Error(`Unexpected dependency: ${specifier}`);
    const exports = dependencies[specifier];
    return new vm.SyntheticModule(["default", ...Object.keys(exports).filter(k => k !== "default")], function () {
      this.setExport("default", exports.default ?? exports);
      for (const [key, value] of Object.entries(exports)) if (key !== "default") this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}
const mongoose = { connection: { transaction: async work => work({}) }, isValidObjectId: () => true };
const account = { _id: "g1", status: "active", tokenVersion: 0, email: "own@example.invalid", name: "Own", privacyRevision: 0 };

function consentFixture() {
  const events = [];
  let active = true;
  const Model = {
    findOne: () => query(events.at(-1) || null),
    async create(items) {
      const item = items[0];
      if (events.some(e => e.version === item.version)) throw Object.assign(Error("duplicate"), { code: 11000 });
      const event = { ...item, recordedAt: new Date() }; events.push(event); return [event];
    },
  };
  const Global = { findOne: () => query({ _id: "g1", status: "active", dateOfBirth: new Date("1990-01-01") }), async updateOne() { return { matchedCount: active ? 1 : 0 }; } };
  return { events, setActive: value => { active = value; }, dependencies: {
    mongoose: { default: mongoose }, "../models/PrivacyConsentEvent.js": { default: Model },
    "../models/GlobalPatient.js": { default: Global },
  } };
}

test("consent is opt-in, versioned, and withdrawal revokes the effective permission", async () => {
  const f = consentFixture();
  const service = await load("src/services/privacyConsentService.js", f.dependencies);
  assert.equal(await service.hasExternalAiConsent("g1"), false);
  await assert.rejects(service.recordConsent("g1", { purpose: "external_ai", decision: "granted", language: "en", noticeVersion: service.CONSENT_NOTICE_VERSION }), /acknowledge/);
  await assert.rejects(service.recordConsent("g1", { purpose: "marketing", decision: "granted", language: "en", noticeVersion: service.CONSENT_NOTICE_VERSION, acknowledged: true }), /acknowledge/);
  const input = { purpose: "external_ai", language: "en", noticeVersion: service.CONSENT_NOTICE_VERSION, acknowledged: true };
  await service.recordConsent("g1", { ...input, decision: "granted" });
  assert.equal(await service.hasExternalAiConsent("g1"), true);
  await service.recordConsent("g1", { ...input, decision: "withdrawn" });
  assert.equal(await service.hasExternalAiConsent("g1"), false);
  assert.deepEqual(f.events.map(e => e.version), [1, 2]);
  assert.deepEqual(f.events.map(e => e.decision), ["granted", "withdrawn"]);
  f.setActive(false);
  await assert.rejects(service.recordConsent("g1", { ...input, decision: "granted" }), e => e.status === 401);
});

function matches(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = key.split(".").reduce((value, part) => value?.[part], doc);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("$in" in expected) return expected.$in.some(value => String(value) === String(actual));
      if ("$ne" in expected) return actual !== expected.$ne;
      if ("$type" in expected) return actual != null;
    }
    return String(actual) === String(expected);
  });
}
function fakeDb(data, writes = []) {
  return { collection(name) {
    const rows = data[name] || [];
    return {
      find(filter) { const result = rows.filter(row => matches(row, filter)); return { project() { return this; }, limit(n) { return { toArray: async () => result.slice(0, n) }; }, toArray: async () => result }; },
      countDocuments: async filter => rows.filter(row => matches(row, filter)).length,
      distinct: async (field, filter) => [...new Set(rows.filter(row => matches(row, filter)).map(row => row[field]))],
      async updateMany(filter, update) { writes.push({ name, filter, update }); for (const row of rows.filter(row => matches(row, filter))) Object.assign(row, update.$set); return { matchedCount: rows.length }; },
      async deleteMany() { if (!["globalpatientotps", "privacyverifications", "privacyexportgrants"].includes(name)) throw Error(`Unsafe delete from ${name}`); writes.push({ name, deleted: true }); return { deletedCount: 0 }; },
    };
  } };
}

function exportFixture() {
  const data = {
    patients: [
      { _id: "p1", tenantId: "t1", globalPatientId: "g1", identityLink: { method: "verified_global_registration" }, name: "Own" },
      { _id: "p2", tenantId: "t2", globalPatientId: "g1", name: "Unverified legacy" },
      { _id: "p3", tenantId: "t1", globalPatientId: "g2", identityLink: { method: "verified_global_registration" }, name: "Other patient" },
    ],
    tenants: [{ _id: "t1", name: "Clinic A", slug: "a" }, { _id: "t2", name: "Clinic B", slug: "b" }],
    consultations: [{ _id: "c1", tenantId: "t1", patient: "p1", diagnosis: "Own clinical note" },
      { _id: "c2", tenantId: "t1", patient: "p3", diagnosis: "Other patient secret" },
      { _id: "c3", tenantId: "t2", patient: "p2", diagnosis: "Unverified legacy secret" }],
    privacyconsentevents: [{ patient: "g1", purpose: "external_ai", decision: "granted", version: 1 }],
  };
  const grants = [];
  const requests = [];
  const Global = { findOne: () => query({ ...account }) };
  const Grant = {
    async create(items) { grants.push(...items); return items; },
    async findOneAndUpdate(filter, update) {
      const item = grants.find(g => g.patient === filter.patient && g.tokenHash === filter.tokenHash &&
        g.consumedAt == null && g.expiresAt > new Date());
      if (!item) return null;
      Object.assign(item, update.$set); return item;
    },
  };
  const Request = { findOne: () => query(null), async create(items) { const item = { _id: "r1", ...items[0] }; requests.push(item); return [item]; },
    async updateOne(filter, update) { requests.push({ filter, update }); return { matchedCount: 1 }; } };
  return { data, grants, requests, dependencies: {
    "node:crypto": { default: crypto }, mongoose: { default: { ...mongoose, connection: { ...mongoose.connection, db: fakeDb(data) } } },
    "../models/GlobalPatient.js": { default: Global }, "../models/PrivacyRequest.js": { default: Request },
    "../models/PrivacyExportGrant.js": { default: Grant }, "../models/PrivacyConsentEvent.js": { default: {} },
    "./privacyRequestService.js": { consumePrivacyChallenge: async (_patient, type, otp, work) => { if (type !== "access" || otp !== "123456") throw Error("Invalid verification"); return work({}); } },
  } };
}

test("export contains only verified memberships and matching tenant/patient clinical records", async () => {
  const f = exportFixture();
  const service = await load("src/services/privacyExportService.js", f.dependencies);
  const result = JSON.parse(await service.buildPrivacyExport("g1"));
  assert.equal(result.clinics.length, 1);
  assert.equal(result.clinics[0].clinic.slug, "a");
  assert.equal(result.limitations.unverifiedClinicMemberships, 1);
  assert.equal(result.clinics[0].records.consultations.length, 1);
  assert.equal(result.clinics[0].records.consultations[0].diagnosis, "Own clinical note");
  assert.equal(JSON.stringify(result).includes("Other patient secret"), false);
  assert.equal(JSON.stringify(result).includes("Unverified legacy secret"), false);
  assert.equal(JSON.stringify(result).includes("tokenVersion"), false);
});

test("export fails rather than silently truncating records beyond its limit", async () => {
  const f = exportFixture();
  f.data.consultations = Array.from({ length: 1001 }, (_, i) => ({ _id: `c${i}`, tenantId: "t1", patient: "p1", diagnosis: "data" }));
  const service = await load("src/services/privacyExportService.js", f.dependencies);
  await assert.rejects(service.buildPrivacyExport("g1"), e => e.status === 413);
});

test("download grants are hashed, patient-bound, short-lived and single-use", async () => {
  const f = exportFixture();
  const service = await load("src/services/privacyExportService.js", f.dependencies);
  const prepared = await service.preparePrivacyExport(account, "123456");
  assert.equal(f.grants.length, 1);
  assert.equal(f.grants[0].tokenHash, crypto.createHash("sha256").update(prepared.token).digest("hex"));
  assert.equal(JSON.stringify(f.grants).includes(prepared.token), false);
  await assert.rejects(service.consumePrivacyExport({ ...account, _id: "g2" }, prepared.token, async () => "{}"), e => e.status === 409);
  assert.equal(await service.consumePrivacyExport(account, prepared.token, async () => "{}"), "{}");
  await assert.rejects(service.consumePrivacyExport(account, prepared.token, async () => "{}"), e => e.status === 409);
});

test("account closure is disabled by default and cannot be triggered by a case-status edit", async () => {
  const previous = process.env.PRIVACY_ERASURE_ENABLED;
  process.env.PRIVACY_ERASURE_ENABLED = "false";
  try {
    const service = await load("src/services/privacyClosureService.js", {
      "node:crypto": { default: crypto }, mongoose: { default: mongoose }, bcryptjs: { default: { compare: async () => true } },
      ...Object.fromEntries(["GlobalPatient", "GlobalPatientOtp", "Patient", "Tenant", "PrivacyRequest", "PrivacyVerification", "PrivacyExportGrant", "PrivacyClosureReview", "PrivacyConsentEvent", "SuperAdmin"].map(name => [`../models/${name}.js`, { default: {} }])),
      "../utils/sessionTokens.js": { revokeSocketSessions() {} },
    });
    await assert.rejects(service.executeAccountClosure({ requestId: "r1", ownerId: "owner", password: "password", confirmation: "CLOSE GLOBAL ACCOUNT" }), e => e.status === 503);
    const route = read("src/routes/privacyRoutes.js");
    assert.match(route, /status === "fulfilled" \? \{ type: \{ \$nin: \["erasure", "correction", "identity_review"\] \} \}/);
  } finally { if (previous === undefined) delete process.env.PRIVACY_ERASURE_ENABLED; else process.env.PRIVACY_ERASURE_ENABLED = previous; }
});

test("clinical retention and identity boundaries remain explicit in closure and AI routes", () => {
  const closure = read("src/services/privacyClosureService.js");
  assert.match(closure, /Every linked clinic must complete its retention review/);
  assert.match(closure, /active visit, booking, reservation or referral/);
  assert.match(closure, /status: "disabled"/);
  assert.match(closure, /privacyContactDisabled: true/);
  assert.doesNotMatch(closure, /collection\("(?:consultations|tokens|appointments|patients|departmentreferrals)"\)\.deleteMany/);
  const ai = read("src/routes/aiRoutes.js");
  assert.equal((ai.match(/await hasExternalAiConsent\(req\.globalPatient\._id\)/g) || []).length, 4);
  assert.doesNotMatch(ai, /console\.error\("Gemini triage error:", data/);
});

test("reviewed closure blocks active visits and preserves clinic records while closing only the global account", async () => {
  const oldEnabled = process.env.PRIVACY_ERASURE_ENABLED;
  const oldPolicy = process.env.PRIVACY_RETENTION_POLICY_VERSION;
  process.env.PRIVACY_ERASURE_ENABLED = "true";
  process.env.PRIVACY_RETENTION_POLICY_VERSION = "approved-2026-v1";
  try {
    const state = { ...account, name: "Own Patient", phone: "9876543210", profileCompleted: true,
      allergies: ["example"], medicalHistory: ["history"], currentMedications: [], pastSurgeries: [],
      emergencyContact: { name: "Contact", phone: "9999999999" }, privacyRevision: 0 };
    const request = { _id: "r1", patient: "g1", type: "erasure", status: "pending", async save() { return this; } };
    const data = {
      patients: [{ _id: "p1", tenantId: "t1", globalPatientId: "g1", identityLink: { method: "verified_global_registration" }, name: "Clinic patient" }],
      tokens: [{ _id: "token1", tenantId: "t1", patient: "p1", status: "waiting", isArchived: false }],
      consultations: [{ _id: "c1", tenantId: "t1", patient: "p1", diagnosis: "Retained clinical record" }],
      followupplans: [{ _id: "f1", tenantId: "t1", patient: "p1", status: "pending" }],
    };
    const writes = [], revoked = [], consentEvents = [];
    const db = fakeDb(data, writes);
    const noDelete = { deleteMany: () => query({ deletedCount: 0 }) };
    const Global = {
      findById: () => query(state), findOne: () => query(state),
      async updateOne(filter, update) {
        if (state.status !== "active" || state.tokenVersion !== filter.tokenVersion) return { matchedCount: 0 };
        Object.assign(state, update.$set);
        state.tokenVersion += update.$inc.tokenVersion;
        state.privacyRevision += update.$inc.privacyRevision;
        return { matchedCount: 1 };
      },
    };
    const Request = { findOne: () => query(request) };
    const Consent = { findOne: () => query(consentEvents.at(-1) || null), async create(items) { consentEvents.push(...items); return items; } };
    const Review = { find: () => query([{ request: "r1", patient: "g1", tenantId: "t1", decision: "retain_clinical_records" }]) };
    const dependencies = {
      "node:crypto": { default: crypto },
      mongoose: { default: { ...mongoose, connection: { ...mongoose.connection, db } } },
      bcryptjs: { default: { compare: async (password, hash) => password === "correct-password" && hash === "stored-hash" } },
      "../models/GlobalPatient.js": { default: Global },
      "../models/GlobalPatientOtp.js": { default: noDelete },
      "../models/Patient.js": { default: {} },
      "../models/Tenant.js": { default: { findById: () => query({ _id: "t1", name: "Clinic A", slug: "a" }) } },
      "../models/PrivacyRequest.js": { default: Request },
      "../models/PrivacyVerification.js": { default: noDelete },
      "../models/PrivacyExportGrant.js": { default: noDelete },
      "../models/PrivacyClosureReview.js": { default: Review },
      "../models/PrivacyConsentEvent.js": { default: Consent },
      "../models/SuperAdmin.js": { default: { findOne: () => query({ _id: "owner1", passwordHash: "stored-hash", status: "active" }) } },
      "../utils/sessionTokens.js": { revokeSocketSessions: (_io, kind, id) => revoked.push({ kind, id }) },
    };
    const service = await load("src/services/privacyClosureService.js", dependencies);
    const args = { requestId: "r1", ownerId: "owner1", password: "correct-password", confirmation: "CLOSE GLOBAL ACCOUNT", io: {} };
    await assert.rejects(service.executeAccountClosure(args), e => e.status === 409);
    assert.equal(state.status, "active");
    assert.equal(request.status, "pending");
    data.tokens = [];
    await assert.rejects(service.executeAccountClosure({ ...args, password: "wrong" }), e => e.status === 403);
    const result = await service.executeAccountClosure(args);
    assert.equal(state.status, "disabled");
    assert.match(state.email, /^closed-g1@accounts\.invalid$/);
    assert.equal(state.name, "");
    assert.deepEqual(Array.from(state.allergies), []);
    assert.equal(state.tokenVersion, 1);
    assert.equal(state.privacyRevision, 1);
    assert.equal(data.patients[0].privacyContactDisabled, true);
    assert.equal(data.patients[0].name, "Clinic patient");
    assert.equal(data.consultations[0].diagnosis, "Retained clinical record");
    assert.equal(data.followupplans[0].status, "pending");
    assert.equal(request.status, "fulfilled");
    assert.equal(request.execution.kind, "global_account_closure");
    assert.equal(request.execution.retainedClinicCount, 1);
    assert.equal(result.retainedClinicCount, 1);
    assert.equal(consentEvents.at(-1).decision, "withdrawn");
    assert.deepEqual(JSON.parse(JSON.stringify(revoked)), [{ kind: "patient", id: "g1" }]);
    assert.equal(writes.some(w => ["patients", "consultations", "tokens", "appointments", "departmentreferrals"].includes(w.name) && w.deleted), false);
  } finally {
    if (oldEnabled === undefined) delete process.env.PRIVACY_ERASURE_ENABLED; else process.env.PRIVACY_ERASURE_ENABLED = oldEnabled;
    if (oldPolicy === undefined) delete process.env.PRIVACY_RETENTION_POLICY_VERSION; else process.env.PRIVACY_RETENTION_POLICY_VERSION = oldPolicy;
  }
});


test("external AI consent rejects missing or underage profiles without affecting withdrawal", async () => {
  const f = consentFixture();
  const service = await load("src/services/privacyConsentService.js", f.dependencies);
  assert.equal(service.isAdultForExternalAi(null), false);
  assert.equal(service.isAdultForExternalAi("2010-01-01", new Date("2026-09-09")), false);
  assert.equal(service.isAdultForExternalAi("2008-09-09", new Date("2026-09-09")), true);
  assert.equal(service.isAdultForExternalAi("2008-09-10", new Date("2026-09-09")), false);
});
