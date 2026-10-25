import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium as browserType } from 'playwright';
import { startBrowserFixture, totp } from '../../../server/test/helpers/browserFixture.js';
const project=fileURLToPath(new URL('../../../',import.meta.url));
const frontend='http://127.0.0.1:5175';
const artifacts=process.env.OPDFY_BROWSER_ARTIFACTS||fs.mkdtempSync(path.join(os.tmpdir(),'opdfy-browser-'));
fs.mkdirSync(artifacts,{recursive:true});
let fixture,browser,vite,mail=[],GlobalPatient;
async function localRequestsOnly(context) {
 const origins=new Set([frontend,fixture.apiOrigin]);
 await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   return origins.has(url.origin)||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();
 });
 await context.routeWebSocket('**',route=>{
   const origin=new URL(route.url()).origin.replace(/^ws/,'http');
   if(origins.has(origin))route.connectToServer();else route.close();
 });
}
const password='A private browser passphrase 2026!';
const newPassword='My changed browser passphrase 2026!';
const pageErrors=[];
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
async function verify(page,email){
 await page.getByRole('button',{name:'Send Verification Code',exact:true}).click();
 await page.getByRole('heading',{name:'Verify Email Code',exact:true}).waitFor();
 for(let n=0;n<100&&!mail.find(m=>m.to===email&&m.text.includes('code is'));n++)await pause();
 const message=mail.filter(m=>m.to===email&&m.text.includes('code is')).at(-1);
 assert.ok(message);
 await page.getByLabel('6-Digit Verification Code',{exact:true}).fill(message.text.match(/code is (\d{6})/)[1]);
 await page.getByRole('button',{name:'Verify Email',exact:true}).click();
 await page.getByRole('heading',{name:'Choose Username and Password',exact:true}).waitFor();
}
async function gotoLogin(page){
 await page.goto(frontend+'/patient-login');
 await page.getByRole('heading',{name:'Patient Sign In',exact:true}).waitFor();
}
try {
 fixture=await startBrowserFixture(frontend);mail=fixture.mail;GlobalPatient=fixture.GlobalPatient;
 vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5175','--strictPort'],{
  cwd:path.join(project,'client'),env:{...process.env,VITE_API_URL:fixture.apiOrigin+'/api',VITE_SOCKET_URL:fixture.apiOrigin},stdio:'ignore'});
 await new Promise(resolve=>setTimeout(resolve,600));
 if(vite.exitCode!==null)throw new Error('The local frontend test port is unavailable.');
 for(let i=0;i<150;i++){if(vite.exitCode!==null)throw new Error('Local frontend did not start.');try{if((await fetch(frontend)).ok)break;}catch{}await pause();}
 const launch={headless:true};
 if(process.env.CHROMIUM_EXECUTABLE_PATH){launch.executablePath=process.env.CHROMIUM_EXECUTABLE_PATH;launch.args=JSON.parse(process.env.CHROMIUM_ARGS_JSON||'[]');}
 browser=await browserType.launch(launch);
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 // Browser requests are confined to the local test app and backend.
 await localRequestsOnly(context);
 const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
 await gotoLogin(page);
 await page.getByRole('button',{name:'New patient? Create account',exact:true}).click();
 const email='browser-patient@example.invalid';
 await page.getByLabel('Patient Email Address',{exact:true}).fill(email);
 await verify(page,email);
 await page.getByLabel('Username',{exact:true}).fill('Browser.Patient');
 await page.getByLabel('New Password',{exact:true}).fill(password);
 await page.getByLabel('Confirm Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Show Password',exact:true}).click();
 assert.equal(await page.getByLabel('New Password',{exact:true}).getAttribute('type'),'text');
 await page.getByRole('button',{name:'Hide Password',exact:true}).click();
 await page.screenshot({path:path.join(artifacts,'patient-auth-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Save Password',exact:true}).click();
 await page.getByRole('heading',{name:'Patient Sign In',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Username or Email',{exact:true}).inputValue(),'browser.patient');
 const account=await GlobalPatient.findOne({email});assert.ok(account);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('opd_patient_token')),null);
 const mailBeforeLogin=mail.length;
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await page.waitForURL('**/patient/profile');
 const oldToken=await page.evaluate(()=>sessionStorage.getItem('opd_patient_token'));
 assert.ok(oldToken);assert.equal(mail.length,mailBeforeLogin);
 console.log('PASS desktop registration, password visibility and password login without email');
 await page.evaluate(()=>sessionStorage.clear());
 await gotoLogin(page);
 await page.getByRole('button',{name:'Set up / Forgot password',exact:true}).click();
 await page.getByLabel('Patient Email Address',{exact:true}).fill(email);
 await verify(page,email);
 assert.equal(await page.getByLabel('Username',{exact:true}).inputValue(),'browser.patient');
 assert.equal(await page.getByLabel('Username',{exact:true}).getAttribute('readonly'),'');
 await page.getByLabel('New Password',{exact:true}).fill(newPassword);
 await page.getByLabel('Confirm Password',{exact:true}).fill(newPassword);
 await page.getByRole('button',{name:'Save Password',exact:true}).click();
 await page.getByRole('heading',{name:'Patient Sign In',exact:true}).waitFor();
 const response=await fetch(fixture.apiOrigin+'/api/patient-auth/me',{headers:{Authorization:`Bearer ${oldToken}`}});
 assert.equal(response.status,401);
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Incorrect username/email'}).waitFor();
 await page.getByLabel('Username or Email',{exact:true}).fill(email.toUpperCase());
 await page.getByLabel('Password',{exact:true}).fill(newPassword);
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await page.waitForURL('**/patient/profile');
 assert.equal(String((await GlobalPatient.findOne({email}))._id),String(account._id));
 console.log('PASS browser password recovery, old-session revocation, email login and stable patient identity');
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await localRequestsOnly(mobile);
 const phone=await mobile.newPage();phone.on('pageerror',error=>pageErrors.push(error.message));
 await gotoLogin(phone);
 await phone.getByRole('button',{name:'New patient? Create account',exact:true}).click();
 const mobileEmail='browser-mobile@example.invalid';
 await phone.getByLabel('Patient Email Address',{exact:true}).fill(mobileEmail);await verify(phone,mobileEmail);
 await phone.getByLabel('Username',{exact:true}).fill('BROWSER.PATIENT');
 await phone.getByLabel('New Password',{exact:true}).fill(password);
 await phone.getByLabel('Confirm Password',{exact:true}).fill(password);
 await phone.getByRole('button',{name:'Save Password',exact:true}).click();
 await phone.getByRole('alert').filter({hasText:'This username is already taken'}).waitFor();
 await phone.getByLabel('Username',{exact:true}).fill('browser.mobile');
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
 await phone.screenshot({path:path.join(artifacts,'patient-auth-mobile.png'),fullPage:true});
 await phone.getByRole('button',{name:'Save Password',exact:true}).click();
 await phone.getByRole('heading',{name:'Patient Sign In',exact:true}).waitFor();
 await phone.evaluate(()=>localStorage.setItem('opd_ui_language','hi'));await phone.reload();
 await phone.getByLabel('यूज़रनेम या ईमेल',{exact:true}).waitFor();
 assert.equal(await phone.evaluate(()=>document.documentElement.lang),'hi');
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
 assert.deepEqual(pageErrors,[]);
 console.log('PASS mobile duplicate-username retry, no horizontal overflow and Hindi login labels');
 console.log('Patient browser checks passed against local app + disposable MongoDB; SMTP mocked.');
 const mfaContext=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 await localRequestsOnly(mfaContext);
 await mfaContext.addInitScript(()=>localStorage.setItem('opd_ui_language','en'));
 const ownerPage=await mfaContext.newPage();ownerPage.on('pageerror',e=>pageErrors.push(e.message));
 const owner=await fixture.seedOwner(password);
 await ownerPage.goto(frontend+'/platform/login');
 await ownerPage.getByLabel('Platform Email',{exact:true}).fill(owner.email);
 await ownerPage.getByLabel('Platform Password',{exact:true}).fill(password);
 await ownerPage.getByRole('button',{name:'Open Platform Console',exact:true}).click();
 await ownerPage.waitForURL('**/platform');
 await ownerPage.goto(frontend+'/platform/security');
 await ownerPage.getByLabel('Current platform password',{exact:true}).fill(password);
 await ownerPage.getByRole('button',{name:'Start authenticator enrollment',exact:true}).click();
 await ownerPage.getByRole('heading',{name:'Add OPDfy to your authenticator',exact:true}).waitFor();
 const setupSecret=await ownerPage.locator('.mfa-setup-key').innerText();
 await ownerPage.getByLabel('Authenticator code',{exact:true}).fill(totp(setupSecret));
 await ownerPage.getByRole('button',{name:'Enable authenticator protection',exact:true}).click();
 await ownerPage.getByRole('heading',{name:'Recovery codes',exact:true}).waitFor();
 const recovery=await ownerPage.locator('section[aria-labelledby="recovery-codes-title"] code').allInnerTexts();assert.equal(recovery.length,10);
 await ownerPage.getByText('Authenticator protection is enabled.',{exact:true}).waitFor();
 await ownerPage.getByLabel('I have stored my recovery codes safely',{exact:true}).check();
 await ownerPage.getByRole('button',{name:'Hide recovery codes',exact:true}).click();
 await ownerPage.screenshot({path:path.join(artifacts,'owner-security.png'),fullPage:true});
 await ownerPage.setViewportSize({width:390,height:844});
 assert.equal(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
 await ownerPage.setViewportSize({width:1280,height:900});
 await ownerPage.evaluate(()=>sessionStorage.clear());
 await ownerPage.goto(frontend+'/platform/login');
 await ownerPage.getByLabel('Platform Email',{exact:true}).fill(owner.email);
 await ownerPage.getByLabel('Platform Password',{exact:true}).fill(password);
 await ownerPage.getByRole('button',{name:'Open Platform Console',exact:true}).click();
 await ownerPage.getByLabel('Authenticator or recovery code',{exact:true}).fill(recovery[0]);
 assert.equal(await ownerPage.evaluate(()=>sessionStorage.getItem('opd_platform_token')),null);
 await ownerPage.getByRole('button',{name:'Verify and sign in',exact:true}).click();
 await ownerPage.waitForURL('**/platform');
 assert.ok(await ownerPage.evaluate(()=>sessionStorage.getItem('opd_platform_token')));
 console.log('PASS owner MFA enrollment, one-time recovery display and second-factor login');
 const queue=await fixture.seedQueue();
 const queueContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await queueContext.addInitScript(({token,slug})=>{localStorage.setItem('opd_ui_language','en');sessionStorage.setItem('opd_token',token);sessionStorage.setItem('opd_active_clinic_slug',slug);},queue);
 await localRequestsOnly(queueContext);
 const probe=await queueContext.newPage();probe.on('pageerror',e=>pageErrors.push(e.message));
 await probe.goto(frontend+'/test/browser/queue-fixture.html');
 await probe.locator('[data-testid="queue-state"]').getByText('ready',{exact:true}).waitFor();
 assert.equal(await probe.locator('[data-testid="queue-count"]').innerText(),'1');
 await probe.route('**/api/tokens/private',route=>route.abort('failed'));
 await probe.getByRole('button',{name:'Refresh queue probe',exact:true}).click();
 await probe.getByText('Queue updates are delayed',{exact:true}).waitFor();
 assert.equal(await probe.locator('[data-testid="queue-count"]').innerText(),'1');
 await probe.screenshot({path:path.join(artifacts,'queue-stale-mobile.png'),fullPage:true});
 await probe.unroute('**/api/tokens/private');await probe.getByRole('button',{name:'Retry queue refresh',exact:true}).click();
 await probe.locator('[data-testid="queue-state"]').getByText('ready',{exact:true}).waitFor();
 await probe.evaluate(async slug=>{const api=await import('/src/api.js');api.setActiveClinicSlug(slug);},queue.otherSlug);
 await probe.getByText('Queue is unavailable',{exact:true}).waitFor();
 assert.equal(await probe.locator('[data-testid="queue-count"]').innerText(),'0');
 assert.equal(await probe.getByText('Confirmed empty queue',{exact:true}).count(),0);
 console.log('PASS mobile queue stale-data preservation, manual recovery and clinic-change data clearing');
 let mutationRequests=0;
 await probe.route('**/api/synthetic-uncertain',async route=>{
   mutationRequests++;await new Promise(resolve=>setTimeout(resolve,200));
   await route.fulfill({status:200,contentType:'application/json',body:'{}'}).catch(()=>{});
 });
 const uncertain=await probe.evaluate(async()=>{
   const {api}=await import('/src/api.js');
   try{await api.post('/synthetic-uncertain',{}, {timeout:20});return '';}
   catch(error){return error.userMessage;}
 });
 assert.match(uncertain,/may already have completed/);assert.equal(mutationRequests,1);
 let held;
 await probe.route('**/api/tokens/private',route=>{held=route;});
 const started=probe.waitForRequest(request=>request.url().includes('/api/tokens/private'));
 await probe.getByRole('button',{name:'Refresh queue probe',exact:true}).click();await started;
 const aborted=probe.waitForEvent('requestfailed',request=>request.url().includes('/api/tokens/private'));
 await probe.getByRole('button',{name:'Unmount queue',exact:true}).click();await aborted;
 await held?.abort().catch(()=>{});
 console.log('PASS bounded mutation timeout without retry and abort-on-unmount cleanup');

 assert.deepEqual(pageErrors,[]);
 await probe.getByRole('button',{name:'Crash fixture',exact:true}).click();
 await probe.getByRole('heading',{name:'This screen could not be displayed',exact:true}).waitFor();
 assert.equal((await probe.locator('body').innerText()).includes('SYNTHETIC_PRIVATE_RENDER_VALUE'),false);
 assert.ok((await probe.locator('body').innerText()).includes('Your last action may already have completed.'));
 await probe.screenshot({path:path.join(artifacts,'render-recovery-mobile.png'),fullPage:true});
 console.log('PASS render-crash recovery fallback without exception details or automatic mutation retry');

 console.log('All local browser checks passed; synthetic database and mocked SMTP only.');
} catch(error) {
 if(browser) for(const context of browser.contexts())for(const page of context.pages()){
   console.log('Browser failure context',JSON.stringify({url:page.url(),headings:await page.locator('h1,h2').allTextContents(),labels:await page.locator('label').allTextContents()}));
 }
 throw error;
} finally {
 if(browser)await browser.close();if(fixture)await fixture.close();vite?.kill();
}
