import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const toolsRoot=process.env.LIGHTHOUSE_RUNTIME_DIR;if(!toolsRoot)throw Error('Set LIGHTHOUSE_RUNTIME_DIR to a separate test-only npm installation of lighthouse 13.0.1.');
const require=createRequire(path.join(path.resolve(toolsRoot),'package.json'));
const {default:lighthouse}=await import(pathToFileURL(require.resolve('lighthouse')));const chromeLauncher=await import(pathToFileURL(require.resolve('chrome-launcher')));
import {startStaticSite} from './static-site.mjs';
const client=fileURLToPath(new URL('../',import.meta.url));if(process.env.QA_SYNTHETIC_BUILD!=='1')throw Error('Benchmark requires explicit QA_SYNTHETIC_BUILD=1 and a synthetic baseline build.');const baseline=process.env.QA_BASELINE_BUILD;if(!baseline)throw Error('Set QA_BASELINE_BUILD to the local baseline dist directory. No remote URL is accepted.');const out=process.env.QA_ARTIFACTS_DIR||path.join(client,'../../qa-results/benchmark');fs.mkdirSync(out,{recursive:true});const results=[];
for(const version of ['baseline','work']){
 const dir=client;const config=version==='baseline'?{}:JSON.parse(fs.readFileSync(path.join(dir,'vercel.json')));
 const site=await startStaticSite({directory:version==='baseline'?path.resolve(baseline):path.join(dir,'dist'),config,legacy:version==='baseline'});
 try{for(const mode of ['mobile','desktop'])for(let run=1;run<=3;run++){
  const chrome=await chromeLauncher.launch({chromePath:process.env.CHROMIUM_EXECUTABLE_PATH,chromeFlags:['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  try{const preset=mode==='desktop'?{formFactor:'desktop',screenEmulation:{mobile:false,width:1350,height:940,deviceScaleFactor:1,disabled:false},throttling:{rttMs:40,throughputKbps:10240,cpuSlowdownMultiplier:1,requestLatencyMs:0,downloadThroughputKbps:0,uploadThroughputKbps:0}}:{};
   const result=await lighthouse(site.origin,{port:chrome.port,output:'json',logLevel:'error',onlyCategories:['performance','accessibility','best-practices','seo'],blockedUrlPatterns:['https://*'],...preset});
   fs.writeFileSync(path.join(out,`${version}-${mode}-${run}.json`),JSON.stringify(result.lhr));
   const lhr=result.lhr,a=lhr.audits;const item={version,mode,run,lighthouseVersion:lhr.lighthouseVersion,fetchTime:lhr.fetchTime,settings:lhr.configSettings,categories:Object.fromEntries(Object.entries(lhr.categories).map(([k,v])=>[k,v.score])),metrics:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','speed-index'].map(k=>[k,a[k]?.numericValue])),lcpElement:a['largest-contentful-paint-element']?.details||a['lcp-breakdown-insight']?.details,runtimeError:lhr.runtimeError||null,warnings:lhr.runWarnings};results.push(item);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({syntheticLocal:true,compressed:true,externalApiBlocked:true,productionClaim:false,results},null,2));console.log(version,mode,run,JSON.stringify(item.categories),JSON.stringify(item.metrics));
  }finally{await chrome.kill();}
 }}finally{await site.close();}
}
