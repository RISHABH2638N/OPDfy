import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {chromium} from 'playwright';import {startStaticSite} from '../../scripts/static-site.mjs';import {publicPages} from '../../src/seo.js';
const root=fileURLToPath(new URL('../../',import.meta.url));const output=process.env.QA_ARTIFACTS_DIR||path.join(root,'../../qa-results/seo');fs.mkdirSync(output,{recursive:true});
const results=[];let site,browser;const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'))),dist=path.join(root,'dist');
async function check(name,work){try{await work();results.push({name,status:'passed'});console.log('PASS',name);}catch(e){results.push({name,status:'failed',error:String(e.message).slice(0,3000)});console.log('FAIL',name,e.message);}}
try{
 site=await startStaticSite({directory:dist,config});
 const origin=process.env.PUBLIC_SITE_ORIGIN||'https://seo-qa.example.invalid';
 for(const [route,meta] of Object.entries(publicPages))await check('Initial public HTML '+route,async()=>{
  const res=await fetch(site.origin+route),html=await res.text();assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/html/);assert.equal(res.headers.get('x-robots-tag'),null);
  assert.ok(html.includes('<title>'+meta.title.replace(/&/g,'&amp;')+'</title>'));assert.ok(html.includes(meta.description));assert.match(html,/<h1[\s>]/);assert.equal((html.match(/rel="canonical"/g)||[]).length,1);assert.ok(html.includes(`href="${origin+route}"`));assert.match(html,/name="robots" content="index, follow"/);assert.match(html,/data-prerendered="public"/);
  for(const key of ['og:title','og:description','og:url','og:image','twitter:card'])assert.ok(html.includes(`="${key}"`),key);
  const schema=html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1];assert.ok(JSON.parse(schema)['@graph'].length>=3);const hash=createHash('sha256').update(schema).digest('base64');assert.ok(html.includes(hash),'CSP permits exactly generated structured data');
  assert.doesNotMatch(html,/SYNTHETIC_PROFILE|qa\.browser\.patient|opd_patient_token|accessKey=/);
 });
 await check('Sitemap and robots expose only canonical public URLs with correct HTTP content types',async()=>{
  const xml=await fetch(site.origin+'/sitemap.xml'),text=await xml.text();assert.equal(xml.status,200);assert.match(xml.headers.get('content-type'),/application\/xml/);assert.match(text,/<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);const urls=[...text.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);assert.deepEqual(urls,Object.keys(publicPages).map(p=>origin+p));assert.doesNotMatch(text,/<lastmod>|patient|display/);
  const robots=await fetch(site.origin+'/robots.txt'),body=await robots.text();assert.match(robots.headers.get('content-type'),/text\/plain/);assert.match(body,/Allow: \//);assert.ok(body.includes('Sitemap: '+origin+'/sitemap.xml'));assert.doesNotMatch(body,/Disallow:\s*\//);
 });
 await check('All discovered application routes get initial noindex/no-store and no public canonical',async()=>{
  const app=fs.readFileSync(path.join(root,'src/App.jsx'),'utf8');const routes=[...app.matchAll(/path="([^"]+)"/g)].map(m=>m[1]).filter(p=>p!=='*'&&!Object.hasOwn(publicPages,p)).map(p=>p.replace(/:[^/]+/g,'synthetic-only'));
  for(const route of [...routes,'/app.html']){const res=await fetch(site.origin+route),html=await res.text();assert.equal(res.status,200,route);assert.match(res.headers.get('x-robots-tag'),/noindex/,route);assert.equal(res.headers.get('cache-control'),'no-store');assert.match(html,/name="robots" content="noindex, nofollow"/);assert.doesNotMatch(html,/rel="canonical"|application\/ld\+json|data-prerendered="public"/);}
 });
 await check('Unknown public URL is HTTP404; aliases and trailing slashes redirect cleanly',async()=>{
  const res=await fetch(site.origin+'/definitely-unknown-seo');assert.equal(res.status,404);assert.match(await res.text(),/Page not found/);assert.match(res.headers.get('x-robots-tag'),/noindex/);
  for(const url of ['/faqs/','/faqs.html','/index.html']){const r=await fetch(site.origin+url,{redirect:'manual'});assert.equal(r.status,308);assert.ok(r.headers.get('location'));}
 });
 await check('Open Graph PNG, favicon and fingerprinted assets exist and use correct cache/type',async()=>{
  const png=await fetch(site.origin+'/social/opdfy.png');assert.equal(png.status,200);assert.match(png.headers.get('content-type'),/image\/png/);const b=Buffer.from(await png.arrayBuffer());assert.equal(b.readUInt32BE(16),1200);assert.equal(b.readUInt32BE(20),630);assert.ok(b.length<200000);assert.equal((await fetch(site.origin+'/favicon.svg')).status,200);
  const html=await (await fetch(site.origin)).text();for(const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)){const r=await fetch(site.origin+m[1]);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/immutable/);}
 });
 const launch={headless:true};if(process.env.CHROMIUM_EXECUTABLE_PATH){launch.executablePath=process.env.CHROMIUM_EXECUTABLE_PATH;launch.args=JSON.parse(process.env.CHROMIUM_ARGS_JSON||'[]');}browser=await chromium.launch(launch);
 for(const preferences of ['en-light','hi-dark'])await check('Production hydration, links, preferences and public navigation '+preferences,async()=>{
  const c=await browser.newContext({viewport:{width:390,height:844}});const errors=[],requests=[];
  await c.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===site.origin)return route.continue();if(u.pathname.endsWith('/platform/branding/public'))return route.fulfill({status:200,contentType:'application/json',body:'{"branding":{"productName":"OPDfy","logoUrl":""}}'});return route.abort();});await c.routeWebSocket('**',r=>r.close());
  if(preferences==='hi-dark')await c.addInitScript(()=>{localStorage.setItem('opd_ui_language','hi');localStorage.setItem('opd_color_theme','dark');});
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('request',r=>requests.push(r.url()));
  const xml=await (await fetch(site.origin+'/sitemap.xml')).text();assert.equal(await p.evaluate(text=>new DOMParser().parseFromString(text,'application/xml').querySelectorAll('parsererror').length,xml),0);await p.goto(site.origin);await p.locator('h1').waitFor();await p.waitForTimeout(500);assert.equal(await p.locator('html').getAttribute('lang'),preferences==='hi-dark'?'hi':'en');assert.equal(await p.locator('html').getAttribute('data-theme'),preferences==='hi-dark'?'dark':'light');assert.equal(await p.locator('h1').count(),1);
  for(const route of Object.keys(publicPages)){await p.goto(site.origin+route);await p.locator('main h1').waitFor();await p.waitForTimeout(150);assert.equal(await p.title(),publicPages[route].title);assert.equal(await p.locator('link[rel=canonical]').count(),1);
   for(const href of await p.locator('a[href]').evaluateAll(es=>es.map(e=>e.getAttribute('href')))){if(href.startsWith('mailto:'))continue;const u=new URL(href,p.url());if(u.origin!==site.origin)continue;const res=await fetch(u);assert.ok(res.status<400,href);if(u.hash&&u.pathname===new URL(p.url()).pathname)assert.equal(await p.locator('[id]').evaluateAll((es,id)=>es.some(e=>e.id===id),decodeURIComponent(u.hash.slice(1))),true,href);}
  }
  assert.deepEqual(errors,[]);assert.ok(!requests.some(url=>/\/assets\/(App-|qr-scanner-)/.test(url)),'Public-only navigation must not load private App/scanner chunks');
  await p.goto(site.origin);await p.locator('a[href="/patient-login"]').first().click();await p.getByRole('heading',{name:preferences==='hi-dark'?'रोगी लॉगिन':'Patient Sign In',exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,'/patient-login');assert.ok(await p.locator('input[autocomplete=username]').count());
  await c.close();
 });
}catch(e){results.push({name:'SEO suite setup',status:'failed',error:String(e.message)});}finally{await browser?.close();await site?.close();const counts={executed:results.length,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,skipped:0,blocked:0};fs.writeFileSync(path.join(output,'seo-results.json'),JSON.stringify({counts,results,limitations:['Local model of Vercel routes, not a deployed Vercel response.','No Search Console, field CWV or indexing verification.']},null,2));console.log(counts);if(counts.failed)process.exitCode=1;}
