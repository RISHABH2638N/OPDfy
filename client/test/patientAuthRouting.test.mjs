import test from "node:test";
import assert from "node:assert/strict";
import { sessionKindForRequest, isSessionExpiryEligible, shouldExpireSession } from "../src/authRouting.js";

test("patient routes never inherit staff identity", () => {
  for (const url of ["/patients/me", "/patients/me/appointments", "/feedback/patient/me",
    "/ai/chat", "/ai/triage", "/referrals/patient/me", "/patient-auth/me",
    "/patient-platform/clinics"]) {
    assert.equal(sessionKindForRequest(url), "patient", url);
  }
  for (const url of ["/auth/me", "/admin/activity-logs", "/referrals/doctors",
    "/referrals/123/quote", "/reception/tokens"]) {
    assert.equal(sessionKindForRequest(url), "staff", url);
  }
  assert.equal(sessionKindForRequest("/platform/overview"), "platform");
});

test("only a 401 for the current matching session can expire it", () => {
  const error = (status, url, token) => ({
    response: { status }, config: { url, headers: { Authorization: `Bearer ${token}` } },
  });
  assert.equal(shouldExpireSession(error(401,"/referrals/patient/me","patient-1"),"patient-1"),true);
  assert.equal(shouldExpireSession(error(401,"/referrals/patient/me","patient-1"),"patient-2"),false);
  assert.equal(shouldExpireSession(error(401,"/referrals/patient/me","patient-1"),null),false);
  assert.equal(shouldExpireSession(error(403,"/patients/me","patient-1"),"patient-1"),false);
  assert.equal(shouldExpireSession(error(500,"/patients/me","patient-1"),"patient-1"),false);
  assert.equal(shouldExpireSession({response:{status:401},config:{url:"/patients/me",headers:{}}},"patient-1"),false);
  assert.equal(shouldExpireSession(error(401,"/auth/me","staff-1"),"staff-1"),true);
});

test("login, OTP and logout requests never trigger global session expiry", () => {
  for (const url of ["/auth/login","/auth/logout","/patient-auth/send-otp",
    "/patient-auth/verify-otp","/patient-auth/logout","/platform/auth/login"]) {
    assert.equal(isSessionExpiryEligible(url),false,url);
  }
  assert.equal(isSessionExpiryEligible("/referrals/patient/me"),true);
});
