import test from "node:test";
import assert from "node:assert/strict";
import { sessionKindForRequest, shouldExpireSession } from "../src/authRouting.js";

test("global privacy requests use the patient identity", () => {
  for (const path of ["/privacy/types", "/privacy/me", "/privacy/verification", "/privacy/requests"]) {
    assert.equal(sessionKindForRequest(path), "patient");
  }
});
test("platform privacy review never inherits patient or staff credentials", () => {
  assert.equal(sessionKindForRequest("/privacy/admin/requests"), "platform");
  assert.equal(sessionKindForRequest("/privacy/admin/requests/507f1f77bcf86cd799439011"), "platform");
});
test("privacy requests remain eligible for current-session expiry handling", () => {
  assert.equal(shouldExpireSession({ response: { status: 401 }, config: { url: "/privacy/me", headers: { Authorization: "Bearer current" } } }, "current"), true);
  assert.equal(shouldExpireSession({ response: { status: 401 }, config: { url: "/privacy/me", headers: { Authorization: "Bearer old" } } }, "current"), false);
});

test("Phase 2 consent and export endpoints use only patient credentials", () => {
  for (const path of ["/privacy/consents", "/privacy/exports/prepare", "/privacy/exports/download", "/privacy/closure/507f1f77bcf86cd799439011"]) {
    assert.equal(sessionKindForRequest(path), "patient");
  }
});
test("Clinic retention review uses staff credentials, never platform or patient tokens", () => {
  assert.equal(sessionKindForRequest("/privacy-clinic/requests"), "staff");
  assert.equal(sessionKindForRequest("/privacy-clinic/requests/507f1f77bcf86cd799439011/closure-review"), "staff");
  assert.equal(sessionKindForRequest("/privacy/admin/requests/507f1f77bcf86cd799439011/closure/execute"), "platform");
});
