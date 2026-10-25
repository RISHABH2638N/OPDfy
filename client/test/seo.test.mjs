import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {publicPages,validateSiteOrigin,isApplicationPath,structuredData,jsonLd} from '../src/seo.js';
test('SEO inventory has five unique titles/descriptions, no private routes or unsupported schema claims',()=>{
 assert.equal(Object.keys(publicPages).length,5);assert.equal(new Set(Object.values(publicPages).map(p=>p.title)).size,5);assert.equal(new Set(Object.values(publicPages).map(p=>p.description)).size,5);
 for(const route of Object.keys(publicPages)){assert.equal(isApplicationPath(route),false);const value=JSON.parse(jsonLd(structuredData(route,'https://seo-qa.example.invalid')));assert.equal(value['@context'],'https://schema.org');assert.ok(value['@graph'].some(x=>x['@type']==='WebPage'));assert.doesNotMatch(JSON.stringify(value),/aggregateRating|reviewCount|MedicalClinic|certification|offers/);}
});
test('canonical origin is explicit HTTPS and rejects unsafe or placeholder production settings',()=>{
 for(const value of ['', 'http://site.example','https://site.example/path','https://user:pass@site.example','https://site.example/?q=secret','https://site.example/#secret','https://localhost','https://seo-qa.example.invalid'])assert.throws(()=>validateSiteOrigin(value));
 assert.equal(validateSiteOrigin('https://seo-qa.example.invalid',true),'https://seo-qa.example.invalid');
});
test('sensitive route classification includes exact auth pages, deep links and operational displays',()=>{
 for(const p of ['/patient-login','/patient','/patient/ehr','/doctor/consents','/reception/scan','/admin/settings','/platform/login','/clinic/pending','/qr-checkin','/token','/display/test-only-key','/tv','/login'])assert.ok(isApplicationPath(p),p);
 for(const p of ['/not-a-page','/patients-public','/faqs'])assert.equal(isApplicationPath(p),false,p);
});
test('public navigation hints do not import API clients or Socket.IO and App stays lazy',()=>{
 const entry=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.match(entry,/lazy\(\(\) => import\("\.\/App.jsx"\)\)/);assert.match(entry,/hydrateRoot/);
 const session=fs.readFileSync(new URL('../src/publicSession.js',import.meta.url),'utf8');assert.doesNotMatch(session,/from .*api|socket|fetch\(/);assert.match(session,/opd_patient_token/);
});
