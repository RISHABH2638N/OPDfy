import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";

process.env.JWT_SECRET ||= "test-only-privacy-hmac-secret-not-for-production";
const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const mockModule = async (source, dependencies) => {
  const context = vm.createContext({ console, Buffer, process, setTimeout });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(async (specifier) => {
    if (!(specifier in dependencies)) throw Error(`Unexpected import: ${specifier}`);
    const exports = dependencies[specifier];
    return new vm.SyntheticModule(["default", ...Object.keys(exports).filter(k => k !== "default")], function () {
      this.setExport("default", exports.default ?? exports);
      for (const [key, value] of Object.entries(exports)) if (key !== "default") this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
};

const profile = (id = "account-a") => ({
  _id: id, email: "patient@example.invalid", name: "Verified patient", status: "active",
  profileCompleted: false, allergies: [], medicalHistory: [], currentMedications: [], pastSurgeries: [],
  async save() { this.saved = true; },
});
function membershipFixture(existing = null, legacy = null) {
  const writes = [];
  const queries = [];
  const Patient = {
    findOne(query) {
      queries.push(query);
      const result = query.globalPatientId ? existing : legacy;
      return { select: () => ({ lean: async () => result }), then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
    },
    async create(data) { writes.push(data); return { _id: "new-membership", ...data }; },
  };
  const context = { Patient, writes, queries };
  return context;
}

test("an unlinked legacy record cannot be claimed by possession of its contact email", async () => {
  const fx = membershipFixture(null, { _id: "legacy-a", email: "patient@example.invalid" });
  const mod = await mockModule(read("src/services/patientMembershipService.js"), {
    "../models/Patient.js": { default: fx.Patient },
    "../models/GlobalPatient.js": { default: {} },
    "./tenantExecutionContext.js": { runWithTenant: async (_id, work) => work() },
  });
  await assert.rejects(mod.resolvePatientMembership({ tenantId: "clinic-a", globalPatient: profile() }),
    error => error.status === 409 && error.code === "PATIENT_IDENTITY_REVIEW_REQUIRED");
  assert.equal(fx.writes.length, 0);
  assert.equal(fx.queries.some(q => q.email === "patient@example.invalid"), true);
});

test("existing explicit membership remains available without an email ownership claim", async () => {
  const existing = { _id: "existing", globalPatientId: "account-a", profileCompleted: false,
    async save() { this.saved = true; } };
  const fx = membershipFixture(existing);
  const mod = await mockModule(read("src/services/patientMembershipService.js"), {
    "../models/Patient.js": { default: fx.Patient },
    "../models/GlobalPatient.js": { default: {} },
    "./tenantExecutionContext.js": { runWithTenant: async (_id, work) => work() },
  });
  const result = await mod.resolvePatientMembership({ tenantId: "clinic-a", globalPatient: profile() });
  assert.equal(result._id, "existing");
  assert.equal(result.saved, undefined);
  assert.equal(fx.queries.some(q => Object.hasOwn(q, "email")), false);
});

test("new membership records verified identity provenance without importing legacy data", async () => {
  const fx = membershipFixture();
  const mod = await mockModule(read("src/services/patientMembershipService.js"), {
    "../models/Patient.js": { default: fx.Patient },
    "../models/GlobalPatient.js": { default: {} },
    "./tenantExecutionContext.js": { runWithTenant: async (_id, work) => work() },
  });
  const result = await mod.resolvePatientMembership({ tenantId: "clinic-a", globalPatient: profile() });
  assert.equal(result.identityLink.method, "verified_global_registration");
  assert.equal(fx.writes.length, 1);
});

test("login no longer imports legacy health profiles through a raw collection lookup", () => {
  const source = read("src/routes/patientAuthRoutes.js");
  assert.doesNotMatch(source, /collection\("patients"\)/);
  assert.match(source, /async function migrateLegacyProfileIfNeeded\(patient\)\s*\{\s*return patient;/);
});

test("privacy intake is global and does not inherit clinic context", () => {
  const app = read("src/app.js");
  assert.ok(app.indexOf('app.use("/api/privacy", privacyRoutes)') < app.indexOf('app.use("/api", tenantContext)'));
  const routes = read("src/routes/privacyRoutes.js");
  assert.match(routes, /router\.post\("\/requests", protectGlobalPatient/);
  assert.match(routes, /router\.get\("\/admin\/requests", protectSuperAdmin/);
  assert.doesNotMatch(routes, /deleteMany\(\{|GlobalPatient\.delete|Patient\.delete/);
});

test("privacy requests require a separate single-use OTP and do not automatically erase records", () => {
  const source = read("src/services/privacyRequestService.js");
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /findOneAndDelete/);
  assert.match(source, /connection\.transaction/);
  assert.match(source, /attempts: \{ \$lt: 5 \}/);
  assert.doesNotMatch(source, /GlobalPatient\.delete|Patient\.delete|deleteMany/);
});


function privacyFixture({ failMail = false } = {}) {
  let challenge = null;
  const requests = [];
  const sent = [];
  let nextId = 0;
  const patient = profile();
  const query = (value) => ({
    select() { return this; },
    session() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  });
  const Verification = {
    async findOne(filter) { return challenge && String(challenge.patient) === String(filter.patient) ? { ...challenge } : null; },
    findOneAndUpdate(filter, update, options = {}) {
      if (options.upsert) {
        if (challenge && challenge.expiresAt > new Date() && challenge.attempts < 5) {
          const err = Object.assign(new Error("Duplicate"), { code: 11000 });
          return query(Promise.reject(err));
        }
        challenge = { _id: `challenge-${++nextId}`, ...update.$set, attempts: 0 };
        return query({ ...challenge });
      }
      if (!challenge || String(challenge.patient) !== String(filter.patient) ||
          challenge.requestType !== filter.requestType || challenge.expiresAt <= new Date() ||
          challenge.attempts >= 5) return query(null);
      challenge.attempts++;
      return query({ ...challenge });
    },
    async deleteOne(filter) {
      if (challenge && String(challenge._id) === String(filter._id) && challenge.nonce === filter.nonce) {
        challenge = null;
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
    findOneAndDelete(filter) {
      if (!challenge || String(challenge._id) !== String(filter._id) ||
          challenge.nonce !== filter.nonce || challenge.otpHash !== filter.otpHash ||
          challenge.expiresAt <= new Date()) return query(null);
      const old = challenge;
      challenge = null;
      return query(old);
    },
  };
  const Request = {
    async create(items) {
      const item = items[0];
      if (requests.some(r => r.patient === item.patient && r.type === item.type &&
          ["pending", "in_review"].includes(r.status))) {
        throw Object.assign(new Error("Duplicate"), { code: 11000 });
      }
      const created = { _id: `request-${++nextId}`, ...item, status: "pending", createdAt: new Date() };
      requests.push(created);
      return [created];
    },
  };
  const mongoose = {
    Types: { ObjectId: class { constructor() { return `generated-${++nextId}`; } } },
    connection: { transaction: async (work) => work({}) },
  };
  return {
    patient, requests, sent,
    getChallenge: () => challenge,
    dependencies: {
      "node:crypto": { default: crypto },
      mongoose: { default: mongoose },
      "../models/PrivacyRequest.js": { default: Request },
      "../models/PrivacyVerification.js": { default: Verification },
      "./privacyIdentityReviewService.js": { validateIdentityReviewRequest: async () => {} },
      "../utils/sendEmail.js": { sendEmail: async (mail) => {
        if (failMail) throw Error("SMTP unavailable");
        sent.push(mail);
      } },
    },
  };
}

test("privacy request validation rejects arbitrary types, empty details and invalid clinic IDs", async () => {
  const fx = privacyFixture();
  const service = await mockModule(read("src/services/privacyRequestService.js"), fx.dependencies);
  assert.throws(() => service.validatePrivacyRequest({ type: "delete_everything", details: "A valid request." }), /valid privacy request type/);
  assert.throws(() => service.validatePrivacyRequest({ type: "erasure", details: "short" }), /10 to 2000/);
  assert.throws(() => service.validatePrivacyRequest({ type: "erasure", details: "Please close my account.", clinicSlug: { $ne: "" } }), /Invalid clinic/);
  assert.equal(service.validatePrivacyRequest({ type: "erasure", details: "Please close my account." }).type, "erasure");
});

test("fresh privacy OTP is distinct, bound to patient and request type, and cannot be replayed", async () => {
  const fx = privacyFixture();
  const service = await mockModule(read("src/services/privacyRequestService.js"), fx.dependencies);
  await service.issuePrivacyChallenge(fx.patient, "erasure");
  assert.equal(fx.sent.length, 1);
  assert.equal(fx.getChallenge().otpHash.length, 64);
  assert.doesNotMatch(fx.sent[0].text, /JWT_SECRET/);
  const otp = fx.sent[0].text.match(/\b\d{6}\b/)[0];
  const input = { type: "erasure", details: "Please review my account closure and retention.", otp };
  await assert.rejects(service.submitPrivacyRequest(fx.patient, { ...input, type: "access" }), /expired|attempt/i);
  await assert.rejects(service.submitPrivacyRequest(fx.patient, { ...input, otp: "000000" }), /Incorrect/);
  const request = await service.submitPrivacyRequest(fx.patient, input);
  assert.equal(request.status, "pending");
  assert.equal(request.type, "erasure");
  assert.equal(fx.requests.length, 1);
  assert.equal(fx.getChallenge(), null);
  await assert.rejects(service.submitPrivacyRequest(fx.patient, input), /expired|attempt/i);
  assert.equal(fx.requests.length, 1);
});

test("an active privacy challenge cannot be replaced by another send", async () => {
  const fx = privacyFixture();
  const service = await mockModule(read("src/services/privacyRequestService.js"), fx.dependencies);
  await service.issuePrivacyChallenge(fx.patient, "access");
  const first = fx.getChallenge();
  await assert.rejects(service.issuePrivacyChallenge(fx.patient, "erasure"), e => e.status === 429);
  assert.equal(fx.getChallenge().nonce, first.nonce);
  assert.equal(fx.sent.length, 1);
});

test("failed delivery removes only its own challenge and creates no privacy request", async () => {
  const fx = privacyFixture({ failMail: true });
  const service = await mockModule(read("src/services/privacyRequestService.js"), fx.dependencies);
  await assert.rejects(service.issuePrivacyChallenge(fx.patient, "erasure"), /SMTP unavailable/);
  assert.equal(fx.getChallenge(), null);
  assert.equal(fx.requests.length, 0);
});

test("verified membership provenance permits normal reusable profile synchronization", async () => {
  const existing = { _id: "existing", globalPatientId: "account-a", profileCompleted: false,
    identityLink: { method: "verified_global_registration" },
    async save() { this.saved = true; } };
  const fx = membershipFixture(existing);
  const mod = await mockModule(read("src/services/patientMembershipService.js"), {
    "../models/Patient.js": { default: fx.Patient },
    "../models/GlobalPatient.js": { default: {} },
    "./tenantExecutionContext.js": { runWithTenant: async (_id, work) => work() },
  });
  const result = await mod.resolvePatientMembership({ tenantId: "clinic-a", globalPatient: profile() });
  assert.equal(result.saved, true);
  assert.equal(result.name, "Verified patient");
});
