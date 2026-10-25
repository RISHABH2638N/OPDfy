import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.resolve(process.env.QA_ARTIFACTS_DIR||path.join(root,'qa-results',new Date().toISOString().replace(/[:.]/g,'-')));fs.mkdirSync(output,{recursive:true});
const node=process.execPath,npm=process.platform==='win32'?'npm.cmd':'npm';const quick=process.argv.includes('--quick');
const phases=[
 ['inventory',root,node,['scripts/test-inventory.mjs'],30000],
 ['source',path.join(root,'server'),npm,['run','source:check'],30000],
 ['frontend',path.join(root,'client'),npm,['test'],60000],
 ['backend',path.join(root,'server'),node,['scripts/runTests.mjs','all',...(process.argv.includes('--coverage')?['--coverage']:[])],600000],
 ...quick?[]:[
 ['browser-existing',path.join(root,'client'),npm,['run','test:browser'],240000],
 ['browser-release',path.join(root,'client'),npm,['run','test:e2e'],600000],
 ['patient-ux',path.join(root,'client'),npm,['run','test:patient-ux'],240000],
 ['load',path.join(root,'server'),npm,['run','test:load'],90000],
 ],
 ['build',path.join(root,'client'),npm,['run','build'],120000],
 ...quick?[]:[['seo',path.join(root,'client'),npm,['run','test:seo'],120000]],
];
const summary={startedAt:new Date().toISOString(),syntheticOnly:true,mode:quick?'quick (no browser/load)':'complete',phases:[]};
for(const [name,cwd,command,args,timeout] of phases){console.log('QA phase:',name);const log=fs.openSync(path.join(output,name+'.log'),'w'),started=Date.now();const env={...process.env,QA_ARTIFACTS_DIR:output,QA_UPDATE_SNAPSHOTS:'0',PUBLIC_SITE_ORIGIN:'https://seo-qa.example.invalid',QA_SYNTHETIC_BUILD:'1',MONGOMS_VERSION:process.env.MONGOMS_VERSION||'7.0.24',VITE_API_URL:'https://qa-build-only.example.invalid/api',VITE_SOCKET_URL:'https://qa-build-only.example.invalid'};const child=spawn(command,args,{cwd,env,stdio:['ignore',log,log],shell:false,detached:process.platform!=='win32'});let timedOut=false;const timer=setTimeout(()=>{timedOut=true;try{if(process.platform==='win32')child.kill('SIGTERM');else process.kill(-child.pid,'SIGTERM');}catch{}},timeout);const code=await new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));});clearTimeout(timer);fs.closeSync(log);summary.phases.push({name,status:code===0&&!timedOut?'passed':'failed',exitCode:code,timedOut,ms:Date.now()-started,log:name+'.log'});fs.writeFileSync(path.join(output,'quality-summary.json'),JSON.stringify(summary,null,2));console.log(name,summary.phases.at(-1).status);}
summary.finishedAt=new Date().toISOString();summary.status=summary.phases.every(p=>p.status==='passed')?'passed':'failed';fs.writeFileSync(path.join(output,'quality-summary.json'),JSON.stringify(summary,null,2));console.log('QA results:',output);process.exitCode=summary.status==='passed'?0:1;
