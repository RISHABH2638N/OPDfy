import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { sessionKindForRequest, patientSessionSummary } from "../src/authRouting.js";
import { translateUiText } from "../src/i18n.js";

test("condition requests use the correct credential and condition records never enter cached session summaries", () => {
  assert.equal(sessionKindForRequest("/patients/me/conditions"), "patient");
  assert.equal(sessionKindForRequest("/tokens/test-token/conditions"), "staff");
  assert.equal(sessionKindForRequest("/admin/condition-insights"), "staff");
  assert.deepEqual(patientSessionSummary({ id: "test", conditionProfile: { entries: [{ code: "diabetes" }] } }), { id: "test" });
});
test("patient, doctor and aggregate report loading states render in both languages without invented counts", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "opdfy-condition-ui-"));
  try {
    const result = await build({
      stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "jsx", contents: `
        import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
        import assert from 'node:assert/strict';
        import HealthConditions, {ConditionInsights} from './src/HealthConditions.jsx';
        import {LanguageProvider} from './src/LanguageContext.jsx';
        for (const language of ['en','hi']) {
          globalThis.localStorage = {getItem: () => language};
          const render = child => renderToStaticMarkup(<LanguageProvider>{child}</LanguageProvider>);
          const patient = render(<HealthConditions/>);
          const doctor = render(<HealthConditions tokenId='test-token'/>);
          const admin = render(<ConditionInsights range={{fromDate:'2026-10-01',toDate:'2026-10-01'}}/>);
          assert.match(patient,/aria-busy="true"/); assert.match(doctor,/aria-busy="true"/);
          assert.ok(patient.includes(language==='hi'?'स्वास्थ्य स्थितियाँ':'Health Conditions'));
          assert.ok(doctor.includes(language==='hi'?'स्वास्थ्य स्थितियों की समीक्षा':'Review Health Conditions'));
          assert.ok(admin.includes(language==='hi'?'पुष्ट स्वास्थ्य स्थितियों के आँकड़े':'Confirmed Condition Insights'));
          assert.match(admin,/disabled=""/); assert.doesNotMatch(admin,/condition-stats/);
        }` },
      bundle: true, platform: "node", format: "cjs", write: false, loader: { ".css": "empty" },
      plugins: [{ name: "no-network", setup(builder) {
        builder.onResolve({ filter: /^\.\/api$/ }, args => args.importer.endsWith("HealthConditions.jsx") ? { path: "test-api", namespace: "test" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const api = { get() { throw new Error("Unexpected network access during render"); } };' }));
      } }],
    });
    const filename = path.join(temporary, "render.cjs"); await writeFile(filename, result.outputFiles[0].contents);
    createRequire(import.meta.url)(filename);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("all condition categories and verification states have Hindi labels", () => {
  for (const label of ["Diabetes", "High blood pressure (hypertension)", "Heart disease", "Stroke history", "Chronic kidney disease", "Asthma", "COPD / chronic breathing condition", "Cancer", "Thyroid disorder", "Chronic liver disease", "Other chronic condition", "Patient-reported / Pending review", "Doctor confirmed", "Not confirmed", "No known conditions", "Edit & Confirm"]) {
    assert.notEqual(translateUiText(label, "hi"), label);
  }
});
