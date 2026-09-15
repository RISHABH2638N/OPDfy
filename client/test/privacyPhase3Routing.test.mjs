import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sessionKindForRequest } from "../src/authRouting.js";
const read = name => fs.readFileSync(new URL(`../${name}`,import.meta.url),"utf8");
test("Phase 3 patient, clinic and platform APIs use their own credential class",()=>{
 for(const path of ["/privacy/guardians","/privacy/guardians/507f1f77bcf86cd799439011/verify","/privacy/corrections","/privacy/corrections/507f1f77bcf86cd799439011"])
  assert.equal(sessionKindForRequest(path),"patient");
 for(const path of ["/privacy-clinic/guardians","/privacy-clinic/corrections","/privacy-clinic/corrections/507f1f77bcf86cd799439011/resolve","/privacy-clinic/retention"])
  assert.equal(sessionKindForRequest(path),"staff");
 for(const path of ["/privacy/admin/corrections","/privacy/admin/corrections/507f1f77bcf86cd799439011","/privacy/admin/retention","/privacy/admin/incidents/507f1f77bcf86cd799439011/events"])
  assert.equal(sessionKindForRequest(path),"platform");
});
test("Phase 3 portal routes retain their existing role guards",()=>{
 const app=read("src/App.jsx");
 assert.match(app,/path="\/platform\/privacy\/governance" element=\{<PlatformProtectedRoute><PrivacyPhase3Governance/);
 assert.match(app,/path="\/admin\/privacy\/reviews" element=\{<StaffProtectedRoute allowedRoles=\{\["admin"\]\}><PrivacyPhase3Clinic/);
 assert.match(read("src/PatientPrivacyCenter.jsx"),/<PrivacyGuardianControls \/>/);
 assert.match(read("src/PatientPrivacyCenter.jsx"),/<PrivacyCorrectionControls onCreated=\{load\} \/>/);
});
test("AI source indicators distinguish built-in help from outbound provider contact",()=>{
 const app=read("src/App.jsx"),ai=read("src/PrivacyPhase3Patient.jsx");
 assert.match(app,/externalAIContacted: data\.externalAIContacted === true/);
 assert.match(app,/Built-in help · no external AI contacted/);
 assert.match(app,/External AI contacted/);
 assert.doesNotMatch(ai,/dangerouslySetInnerHTML|document\.write/);
});
