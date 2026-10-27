import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

test("landing renders bilingual patient dashboard guidance and portal links without the lookup form", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "opdfy-landing-"));
  try {
    const result = await build({
      stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "jsx", contents: `
        import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
        import {MemoryRouter} from 'react-router-dom'; import assert from 'node:assert/strict';
        import LandingPage from './src/LandingPage.jsx';
        import {LanguageProvider} from './src/LanguageContext.jsx';
        for(const language of ['en','hi']) {
          globalThis.localStorage={getItem:()=>language};
          const html=renderToStaticMarkup(<LanguageProvider><MemoryRouter><LandingPage/></MemoryRouter></LanguageProvider>);
          for(const route of ['/patient-login','/clinic/register','/login','/platform/login','/support','/privacy','/terms']) assert.ok(html.includes('href="'+route+'"'),route);
          assert.doesNotMatch(html,/op-patient-card|op-queue-code/); assert.match(html,/aria-labelledby="op-patient-overview-title"/); assert.match(html,/aria-labelledby="op-demo-title"/);
          for(const amount of ['₹1,299','₹1,899','₹3,499','₹1,999']) assert.ok(html.includes(amount),amount);
          assert.match(html,/aria-pressed="true"[^>]*>[^<]*(?:Monthly|मासिक)/);
          assert.ok(html.includes(language==='hi'?'3–5 डॉक्टर':'3–5 doctors'));
          assert.ok(html.includes(language==='hi'?'6–8 डॉक्टर':'6–8 doctors'));
          assert.ok(html.includes(language==='hi'?'हर महीने भुगतान':'Billed monthly'));
          assert.ok(html.includes(language==='hi'?'सभी योजनाओं में क्लिनिक संस्करण':'All plans include the core Clinic Edition'));
          assert.doesNotMatch(html,/₹999–₹1,199|₹1,499–₹1,799|3–6 doctors|Custom scope &amp; pricing/);
          assert.ok(html.includes(language==='hi'?'क्लिनिक का काम डिजिटल करें।':'Run a Paperless Clinic.'));
          assert.ok(html.includes(language==='hi'?'यह केवल उदाहरण है।':'Illustrative preview.'));
          assert.doesNotMatch(html,/HIPAA|End-to-End Encrypted|500\\+|10\\+ hours|No credit card required/);
        }
      ` }, bundle:true, platform:"node", format:"cjs", write:false,
    });
    const filename=path.join(temporary,"render.cjs"); await writeFile(filename,result.outputFiles[0].contents);
    createRequire(import.meta.url)(filename);
  } finally {await rm(temporary,{recursive:true,force:true});}
});
