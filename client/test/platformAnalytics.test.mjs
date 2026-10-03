import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { translateUiText } from "../src/i18n.js";

test("platform analytics renders bilingual loading with no fabricated payments or patient counts", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "opdfy-platform-ui-"));
  try {
    const result = await build({ stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "jsx", contents: `
      import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
      import assert from 'node:assert/strict'; import { MemoryRouter } from 'react-router-dom';
      import PlatformAnalytics from './src/PlatformAnalytics.jsx'; import { LanguageProvider } from './src/LanguageContext.jsx';
      for (const language of ['en','hi']) {
        globalThis.localStorage = {getItem: () => language};
        const html = renderToStaticMarkup(<LanguageProvider><MemoryRouter><PlatformAnalytics/></MemoryRouter></LanguageProvider>);
        assert.ok(html.includes(language === 'hi' ? 'आपके क्लिनिक, एक नज़र में' : 'Your clinics, at a glance'));
        assert.ok(html.includes(language === 'hi' ? 'प्लेटफ़ॉर्म विश्लेषण लोड हो रहा है...' : 'Loading platform analytics...'));
        assert.match(html,/role="status"/); assert.doesNotMatch(html,/pa-metric|₹0|1299|1,299/);
      }` }, bundle: true, platform: "node", format: "cjs", write: false, loader: { ".css": "empty" },
      plugins: [{ name: "no-network", setup(builder) { builder.onResolve({ filter: /^\.\/api$/ }, args => args.importer.endsWith("PlatformAnalytics.jsx") ? { path: "test-api", namespace: "test" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export const platformApi = { get() { throw new Error("Unexpected network access during render"); } };' })); } }],
    });
    const filename = path.join(temporary, "render.cjs"); await writeFile(filename, result.outputFiles[0].contents); createRequire(import.meta.url)(filename);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("new platform activity and billing labels have Hindi translations", () => {
  for (const label of ["Platform Analytics", "Patients per day", "Patients per month", "Subscription collected", "Outstanding invoices", "Record invoice", "Record payment", "Feature adoption", "Attention needed", "Clinic subscription terms", "Generate invoice", "Select invoice", "Download PDF", "Invoice downloaded.", "Loading invoices..."]) assert.notEqual(translateUiText(label, "hi"), label);
});
