import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sessionKindForRequest } from "../src/authRouting.js";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const component = fs.readFileSync(new URL("../src/ClinicalConsentCenter.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/clinical-consent.css", import.meta.url), "utf8");
const identityReview = fs.readFileSync(new URL("../src/ClinicIdentityReviews.jsx", import.meta.url), "utf8");

test("clinical consent requests use the correct patient or staff credential", () => {
  assert.equal(sessionKindForRequest("/patients/me/clinical-consents"), "patient");
  assert.equal(sessionKindForRequest("/patients/me/clinical-consents/abc/decision"), "patient");
  assert.equal(sessionKindForRequest("/clinical-consents"), "staff");
});

test("consent center routes retain patient and staff role guards", () => {
  assert.match(app, /path="\/patient\/consents"[^\n]+PatientClinicRequiredRoute/);
  assert.match(app, /path="\/doctor\/consents"[^\n]+allowedRoles=\{\["doctor"\]\}/);
  assert.match(app, /path="\/reception\/consents"[^\n]+allowedRoles=\{\["receptionist"\]\}/);
  assert.match(app, /path="\/admin\/consents"[^\n]+allowedRoles=\{\["admin"\]\}/);
});

test("consent UI has Hindi copy and explicit dark-mode coverage", () => {
  assert.match(component, /उपचार सहमति केंद्र/);
  assert.match(component, /आपातकालीन इलाज में देरी नहीं होनी चाहिए/);
  assert.match(css, /html\[data-theme="dark"\] \.consent-disclaimer/);
  assert.match(css, /html\[data-theme="dark"\] \.consent-actor label/);
});

test("patient decision failures stay visible inside the consent modal", () => {
  assert.match(component, /decisionError&&<div className="login-error consent-decision-error" role="alert">/);
  assert.match(component, /identityReviewRequired/);
  assert.match(component, /navigate\("\/patient\/privacy"\)/);
  assert.match(component, /decision\.typedName\.trim\(\)/);
});

test("clinic admin has a guarded bilingual patient identity review workflow", () => {
  assert.match(app, /path="\/admin\/privacy\/identity"[^\n]+allowedRoles=\{\["admin"\]\}/);
  assert.match(identityReview, /\/privacy-clinic\/identity-reviews/);
  assert.match(identityReview, /रोगी पहचान समीक्षा/);
  assert.match(identityReview, /evidenceReference/);
  assert.match(identityReview, /reviewNote/);
});
