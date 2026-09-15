import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { validateImageDataUrl } from "../src/utils/imageValidation.js";

const routes = fs.readFileSync(new URL("../src/routes/platformRoutes.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../client/src/App.jsx", import.meta.url), "utf8");
const brandingCss = fs.readFileSync(new URL("../../client/src/platform-branding.css", import.meta.url), "utf8");

test("platform branding mutations require a Super Admin session", () => {
  assert.match(routes, /router\.put\("\/branding", protectSuperAdmin, brandingUpdateLimiter/);
  assert.match(routes, /platform_branding_updated/);
});

test("public branding endpoint is read-only and exposes no clinical query", () => {
  assert.match(routes, /router\.get\("\/branding\/public"/);
  assert.doesNotMatch(routes.match(/router\.get\("\/branding\/public"[\s\S]*?\n\}\);/)?.[0] || "", /Tenant|Patient|Token|Consultation/);
});

test("platform logo accepts validated raster data only", () => {
  const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  const maximumPng = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300 * 1024 - 8)]).toString("base64");
  const oversizedPng = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300 * 1024 - 7)]).toString("base64");
  assert.equal(validateImageDataUrl(png, { maxBytes: 300 * 1024 }).ok, true);
  assert.equal(validateImageDataUrl(maximumPng, { maxBytes: 300 * 1024 }).ok, true);
  assert.equal(validateImageDataUrl(oversizedPng, { maxBytes: 300 * 1024 }).ok, false);
  assert.equal(validateImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=").ok, false);
  assert.equal(validateImageDataUrl("javascript:alert(1)").ok, false);
});

test("public and portal headers consume the saved platform logo", () => {
  assert.match(app, /platform\/branding\/public/);
  assert.match(app, /platformBranding\.logoUrl/);
  assert.match(app, /platform-logo-\$\{platformLogoShape\}/);
  assert.match(app, /path="\/platform\/branding"/);
  assert.match(brandingCss, /platform-logo-square/);
  assert.match(brandingCss, /platform-logo-wide/);
  assert.match(brandingCss, /object-fit:contain/);
});
