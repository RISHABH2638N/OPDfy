import test from "node:test";
import assert from "node:assert/strict";
import { requestFailureMessage } from "../src/requestErrors.js";
import { isSessionExpiryEligible } from "../src/authRouting.js";
test("uncertain mutations request status reconciliation rather than automatic resubmission",()=>{
 assert.match(requestFailureMessage({code:"ECONNABORTED"},"post"),/may already have completed/);
 assert.match(requestFailureMessage({code:"ETIMEDOUT"},"get"),/timed out/);
 assert.match(requestFailureMessage({code:"ERR_NETWORK"},"get"),/connection/);
 assert.equal(requestFailureMessage({code:"ERR_CANCELED"},"get"),"");
 assert.equal(requestFailureMessage({response:{status:409}},"post"),"");
});
test("owner MFA challenges and enrollment responses cannot spuriously expire another owner session",()=>{
 for(const path of ["/platform/auth/mfa/verify","/platform/auth/mfa/enroll","/platform/auth/mfa/enable"])assert.equal(isSessionExpiryEligible(path),false,path);
 assert.equal(isSessionExpiryEligible("/platform/security/audit-health"),true);
});
