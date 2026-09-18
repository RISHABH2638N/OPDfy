import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../src/routes/patientAuthRoutes.js", import.meta.url), "utf8");
const model = readFileSync(new URL("../src/models/PatientSession.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../../client/src/api.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

test("remembered-device credential is opaque, hashed, HttpOnly and bounded", () => {
  assert.match(route, /crypto\.randomBytes\(48\)/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /httpOnly:\s*true/);
  assert.match(route, /secure:\s*process\.env\.NODE_ENV === "production"/);
  assert.match(route, /REMEMBER_DEVICE_DAYS/);
  assert.match(model, /expireAfterSeconds:\s*0/);
  assert.match(model, /tokenHash:[\s\S]*select:\s*false/);
  assert.match(model, /tokenVersionAtIssue:[\s\S]*select:\s*false/);
});

test("refresh rotates the opaque credential and checks revocation version", () => {
  assert.match(route, /findOneAndUpdate\([\s\S]*tokenHash:\s*currentHash[\s\S]*tokenHash:\s*nextHash/);
  assert.match(route, /tokenVersionAtIssue/);
  assert.match(route, /patient\.tokenVersion/);
  assert.match(route, /X-OPD-Client/);
  assert.match(app, /"X-OPD-Client"/);
});

test("patient access bearer token remains tab-scoped and logout revokes remembered sessions", () => {
  assert.match(client, /sessionStorage\.setItem\(PATIENT_TOKEN_KEY/);
  assert.doesNotMatch(client, /localStorage\.setItem\([^\n]*opd_patient_token/);
  assert.match(route, /PatientSession\.updateMany\([\s\S]*revokedAt/);
  assert.match(route, /\$inc:\s*\{\s*tokenVersion:\s*1\s*\}/);
  assert.match(client, /\/patient-auth\/forget-device/);
});
