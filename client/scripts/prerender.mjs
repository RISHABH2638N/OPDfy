import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {build} from 'esbuild';import {loadEnv} from 'vite';
import {publicPages,notFoundMetadata,validateSiteOrigin,structuredData,jsonLd} from '../src/seo.js';
const env={...loadEnv('production',process.cwd(),''),...process.env};
const origin=validateSiteOrigin(env.PUBLIC_SITE_ORIGIN,env.QA_SYNTHETIC_BUILD==='1');
const output=path.resolve('dist'),template=fs.readFileSync(path.join(output,'index.html'),'utf8');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'opdfy-seo-'));
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hashes=Object.keys(publicPages).map(route=>"'sha256-"+createHash('sha256').update(jsonLd(structuredData(route,origin))).digest('base64')+"'").join(' ');
function documentFor(route,content,privateShell=false){
 const page=publicPages[route],info=page||(privateShell?{title:'OPDfy · Clinic & Patient Portal',description:'Secure access to OPDfy clinic and patient workspaces.'}:notFoundMetadata);
 let html=template.replace(/<title>[^<]*<\/title>/,'').replace(/<meta\s+name="description"[^>]*>/,'');
 html=html.replace(/script-src (?:'self'|&#39;self&#39;)/g,match=>match+" "+hashes);
 let tags=`<title>${esc(info.title)}</title>\n<meta data-opdfy-seo name="description" content="${esc(info.description)}">\n<meta data-opdfy-seo name="robots" content="${page?'index, follow':'noindex, nofollow'}">\n`;
 if(page){
  tags+=`<link data-opdfy-seo rel="canonical" href="${esc(origin+route)}">\n`;
  const social={'og:title':page.title,'og:description':page.description,'og:type':'website','og:site_name':'OPDfy','og:url':origin+route,'og:image':origin+'/social/opdfy.png','og:image:width':'1200','og:image:height':'630','og:image:alt':'OPDfy Clinic Edition — appointments, live queues and digital prescriptions'};
  tags+=Object.entries(social).map(([property,value])=>`<meta data-opdfy-seo property="${property}" content="${esc(value)}">`).join('\n');
  tags+=`\n<meta data-opdfy-seo name="twitter:card" content="summary_large_image">\n<meta data-opdfy-seo name="twitter:title" content="${esc(page.title)}">\n<meta data-opdfy-seo name="twitter:description" content="${esc(page.description)}">\n<meta data-opdfy-seo name="twitter:image" content="${esc(origin+'/social/opdfy.png')}">\n<script data-opdfy-seo type="application/ld+json">${jsonLd(structuredData(route,origin))}</script>`;
 }
 html=html.replace('</head>',tags+'\n</head>');
 return html.replace('<div id="root"></div>',`<div id="root"${privateShell?'':' data-prerendered="public"'}>${content}</div>`);
}
try{
 const bundle=path.join(temporary,'render.cjs');
 await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React from 'react';import {renderToString} from 'react-dom/server';import {MemoryRouter} from 'react-router-dom';import PublicWebsite from './src/PublicWebsite.jsx';import {ThemeProvider} from './src/ThemeContext.jsx';import {LanguageProvider} from './src/LanguageContext.jsx';import {RouteRecoveryBoundary} from './src/AppErrorBoundary.jsx';export function render(route){return renderToString(<ThemeProvider deferPreferences><LanguageProvider deferPreferences><MemoryRouter initialEntries={[route]}><RouteRecoveryBoundary><PublicWebsite/></RouteRecoveryBoundary></MemoryRouter></LanguageProvider></ThemeProvider>);}`},bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({VITE_API_URL:env.VITE_API_URL,VITE_SITE_ORIGIN:origin,VITE_BUILD_YEAR:String(new Date().getUTCFullYear())})},loader:{'.css':'empty'}});
 const {render}=createRequire(import.meta.url)(bundle);
 for(const route of Object.keys(publicPages)){const name=route==='/'?'index':route.slice(1);fs.writeFileSync(path.join(output,name+'.html'),documentFor(route,render(route)));}
 fs.writeFileSync(path.join(output,'app.html'),documentFor('/_application','',true));
 fs.writeFileSync(path.join(output,'404.html'),documentFor('/_missing',render('/_missing')));
 fs.writeFileSync(path.join(output,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+Object.keys(publicPages).map(route=>`  <url><loc>${esc(origin+route)}</loc></url>`).join('\n')+'\n</urlset>\n');
 fs.writeFileSync(path.join(output,'robots.txt'),`User-agent: *\nAllow: /\n\n# Operational routes use noindex HTTP headers and real authentication.\nSitemap: ${origin}/sitemap.xml\n`);
 console.log('Prerendered five public pages, noindex app/error shells, sitemap and robots. Canonical origin:',origin);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
