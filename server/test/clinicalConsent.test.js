import test from "node:test";
import assert from "node:assert/strict";
import { appendConsentEvent, cleanConsentRequest, effectiveConsentStatus, normalizePersonName } from "../src/utils/clinicalConsent.js";

const now = new Date("2030-01-01T10:00:00.000Z");

test("consent request accepts bounded bilingual clinical information", () => {
  const result = cleanConsentRequest({
    category: "procedure", language: "hi", validUntil: "2030-01-02T10:00:00.000Z",
    title: "Minor procedure consent", explanation: "The clinician proposes a minor procedure after examination.",
    expectedBenefits: "Expected symptom relief.", materialRisks: "Bleeding, pain or infection.",
    alternatives: "Observation or referral.", refusalConsequences: "Symptoms may continue.",
  }, now);
  assert.equal(result.category, "procedure");
  assert.equal(result.language, "hi");
  assert.equal(result.materialRisks, "Bleeding, pain or infection.");
});

test("procedure consent requires risks and a short-lived validity window", () => {
  assert.throws(() => cleanConsentRequest({ category: "procedure", language: "en", validUntil: "2030-01-02T10:00:00.000Z", title: "Procedure", explanation: "A sufficiently detailed proposed treatment explanation." }, now), /Material risks/);
  assert.throws(() => cleanConsentRequest({ category: "general_treatment", language: "en", validUntil: "2031-01-02T10:00:00.000Z", title: "Consultation", explanation: "A sufficiently detailed proposed treatment explanation." }, now), /between 15 minutes and 30 days/);
});

test("effective status reports expiry without erasing the recorded state", () => {
  const consent = { status: "active", validUntil: new Date("2030-01-01T09:00:00.000Z") };
  assert.equal(effectiveConsentStatus(consent, now), "expired");
  assert.equal(consent.status, "active");
  assert.equal(effectiveConsentStatus({ status: "withdrawn", validUntil: consent.validUntil }, now), "withdrawn");
});

test("typed-name comparison is case and whitespace tolerant", () => {
  assert.equal(normalizePersonName("  Rishabh   Mishra "), normalizePersonName("rishabh mishra"));
});

test("consent audit history is bounded", () => {
  const consent = { events: [] };
  appendConsentEvent(consent, { action: "requested", actorType: "staff", actorId: "staff-1" });
  assert.equal(consent.events.length, 1);
  assert.throws(() => appendConsentEvent({ events: Array.from({ length: 50 }, () => ({})) }, { action: "cancelled" }), /history is full/);
});
