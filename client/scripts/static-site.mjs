// Local verification model for the shipped Vercel routes, not a claim about deployed headers.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
export async function startStaticSite({directory,config,legacy=false}){
 const root=path.resolve(directory),routes=config?.routes||[];
 const server=http.createServer((req,res)=>{
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);}catch{res.writeHead(400);return res.end();}
  let dest=pathname,status=200;const headers={};
  const fileFor=value=>{const file=path.resolve(root,'.'+value);return file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()?file:null;};
  for(const route of routes){
   if(route.handle==='filesystem'){if(fileFor(pathname)){dest=pathname;break;}continue;}
   const regex=new RegExp(route.src);if(!regex.test(pathname))continue;
   Object.assign(headers,Object.fromEntries(Object.entries(route.headers||{}).map(([key,value])=>[key,pathname.replace(regex,value)])));
   if(route.continue)continue;
   status=route.status||200;
   if(status>=300&&status<400){res.writeHead(status,headers);return res.end();}
   dest=route.dest?pathname.replace(regex,route.dest):pathname;break;
  }
  if(legacy&&!fileFor(dest))dest='/index.html';
  const file=fileFor(dest);if(!file){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found');}
  let bytes=fs.readFileSync(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2'};
  headers['Content-Type'] ||= types[path.extname(file)]||'application/octet-stream';
  if(req.headers['accept-encoding']?.includes('gzip')){bytes=zlib.gzipSync(bytes);headers['Content-Encoding']='gzip';headers.Vary='Accept-Encoding';}
  headers['Content-Length']=bytes.length;res.writeHead(status,headers);res.end(req.method==='HEAD'?undefined:bytes);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
