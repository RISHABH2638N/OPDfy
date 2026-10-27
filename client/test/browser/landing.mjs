import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {startStaticSite} from '../../scripts/static-site.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const out=process.env.QA_ARTIFACTS_DIR||path.join(root,'../qa-results/landing');
fs.mkdirSync(out,{recursive:true});
const site=await startStaticSite({directory:path.join(root,'dist'),config:JSON.parse(fs.readFileSync(path.join(root,'vercel.json')))});
const launch={headless:true};
if(process.env.CHROMIUM_EXECUTABLE_PATH){launch.executablePath=process.env.CHROMIUM_EXECUTABLE_PATH;launch.args=JSON.parse(process.env.CHROMIUM_ARGS_JSON||'[]');}
const results=[],errors=[],external=[];
let browser;
async function check(name,work){try{await work();results.push({name,status:'passed'});console.log('PASS',name);}catch(e){results.push({name,status:'failed',error:e.message});console.log('FAIL',name,e.message);}}
async function context(width=1440,hi=false){
 const c=await browser.newContext({viewport:{width,height:width<768?844:1024},reducedMotion:'reduce'});
 await c.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin===site.origin)return route.continue();
  external.push(u.origin+u.pathname);
  if(u.pathname.endsWith('/platform/branding/public'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({branding:{productName:'OPDfy',logoUrl:''}})});
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 });
 await c.routeWebSocket('**',r=>r.close());
 if(hi)await c.addInitScript(()=>{localStorage.setItem('opd_ui_language','hi');localStorage.setItem('opd_color_theme','dark');});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(site.origin);await p.locator('h1').waitFor();await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(200);
 return {c,p};
}
async function axe(p,label){
 const r=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 fs.writeFileSync(path.join(out,'axe-'+label+'.json'),JSON.stringify(r.violations,null,2));
 assert.deepEqual(r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),[]);
}
try{
 browser=await chromium.launch({headless:true,...launch});
 for(const width of [360,390,768,1280,1363,1440,1536,1600])await check('Responsive layout '+width,async()=>{
  const {c,p}=await context(width);
  assert.equal(await p.locator('h1').count(),1);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const overflow=await p.locator('main *').evaluateAll(es=>es.filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&getComputedStyle(e).position!=='absolute'&&(b.right>innerWidth+2||b.left<-2);}).map(e=>({tag:e.tagName,class:e.className})));
  assert.deepEqual(overflow,[]);
  assert.ok(await p.evaluate(()=>document.fonts.check('700 60px "OPDfy Clinic Sans"')));
  const filename=width===1440?'desktop.png':width===390?'mobile.png':'user-'+width+'.png';
  await p.screenshot({path:path.join(out,filename),fullPage:true,animations:'disabled'});
  if(width===1536){await p.screenshot({path:path.join(out,'comp-size.png'),animations:'disabled'});fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify(await p.locator('.premium-header,.op-hero,h1,.op-hero-description,.op-hero .op-actions,.op-hero .op-preview,.op-visit-rail,.op-platform-heading').evaluateAll(es=>es.map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).font,letterSpacing:getComputedStyle(e).letterSpacing}))),null,2));}
  if(width===390||width===1440)await axe(p,'rest-'+width);
  await c.close();
 });
 await check('Pricing, FAQ, demo and keyboard behavior',async()=>{
  const {c,p}=await context();
  await p.getByRole('button',{name:'Yearly',exact:false}).click();
  for(const price of ['₹1,099','₹1,599','₹3,099','₹13,188','₹19,188','₹37,188'])assert.ok((await p.locator('#pricing').innerText()).includes(price),price);
  await p.getByRole('button',{name:'Monthly',exact:true}).click();
  for(const price of ['₹1,299','₹1,899','₹3,499'])assert.ok((await p.locator('#pricing').innerText()).includes(price),price);
  await p.locator('#questions summary').first().click();assert.ok(await p.locator('#questions details').first().getAttribute('open')!==null);
  await p.getByRole('button',{name:'Watch 2-Min Demo'}).click();await p.locator('dialog[open]').waitFor();
  await p.getByRole('button',{name:'Pause demo'}).click();await p.getByRole('button',{name:'Resume demo'}).waitFor();
  await p.getByRole('button',{name:'03 Consult & prescribe'}).click();assert.equal(await p.locator('.op-demo-caption h3').innerText(),'Consult & prescribe');
  await axe(p,'demo');
  await p.screenshot({path:path.join(out,'demo.png'),animations:'disabled'});
  await p.keyboard.press('Escape');assert.equal(await p.locator('dialog[open]').count(),0);
  assert.equal(await p.getByRole('button',{name:'Watch 2-Min Demo'}).evaluate(e=>e===document.activeElement),true);
  await p.getByRole('button',{name:'Open navigation menu'}).click();await p.getByRole('dialog',{name:'Menu & preferences'}).waitFor();
  await axe(p,'menu');await p.screenshot({path:path.join(out,'menu.png'),animations:'disabled'});
  await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open navigation menu');
  await c.close();
 });
 await check('Hindi, dark theme and mobile demo',async()=>{
  const {c,p}=await context(390,true);assert.equal(await p.locator('html').getAttribute('lang'),'hi');assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
  assert.ok((await p.locator('h1').innerText()).includes('क्लिनिक'));
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await axe(p,'hi-dark');await p.screenshot({path:path.join(out,'hi-dark.png'),fullPage:true,animations:'disabled'});
  await p.locator('.op-hero button').click();await p.locator('dialog[open]').waitFor();
  assert.equal(await p.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  await axe(p,'hi-demo');await p.screenshot({path:path.join(out,'mobile-demo.png'),animations:'disabled'});
  await p.keyboard.press('Escape');await c.close();
 });
 await check('Patient lookup validation and sign-in return destination',async()=>{
  const {c,p}=await context(390);await p.locator('#op-queue-code').fill('invalid !!!');await p.getByRole('button',{name:'Check My Queue Status'}).click();
  await p.getByRole('alert').waitFor();assert.equal(await p.locator('#op-queue-code').getAttribute('aria-invalid'),'true');await axe(p,'lookup-error');
  await p.locator('#op-queue-code').fill('A014');await p.getByRole('button',{name:'Check My Queue Status'}).click();await p.waitForURL('**/patient-login?returnTo=%2Fpatient');
  await c.close();
  const second=await context(390);await second.p.locator('#op-queue-code').fill('demo-clinic');await second.p.getByRole('button',{name:'Check My Queue Status'}).click();await second.p.waitForURL('**/patient-login?returnTo=%2Fpatient%2Fclinics%3Fq%3Ddemo-clinic');await second.c.close();
 });
 await check('Public rendering has no JavaScript errors',async()=>assert.deepEqual(errors,[]));
 if(process.argv.includes('--update-snapshot')&&results.every(r=>r.status==='passed')){
  // Explicit opt-in: update this redesigned page only, after functional checks.
  const {c,p}=await context(1366);await p.setViewportSize({width:1366,height:768});
  await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(200);
  const target=path.join(root,'test/browser/snapshots/landing.png');
  await p.screenshot({path:target,animations:'disabled',caret:'hide'});
  console.log('Landing baseline updated; review before committing:',target);
  await c.close();
 }
}finally{
 await browser?.close();await site.close();
 const counts={executed:results.length,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length};
 fs.writeFileSync(path.join(out,'landing-qa.json'),JSON.stringify({counts,results,externalRequestsIntercepted:[...new Set(external)],errors,limitations:['Local synthetic backend responses; no production API contacted.','No measured PageSpeed, field CWV or Search Console results.']},null,2));console.log(counts);
 if(counts.failed)process.exitCode=1;
}
