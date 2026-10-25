import {build} from 'esbuild';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opdfy-public-ssr-'));const output=path.join(dir,'test.cjs');
try{await build({entryPoints:['test/publicPages.ssr.jsx'],bundle:true,platform:'node',format:'cjs',outfile:output,logLevel:'silent'});await import(pathToFileURL(output));}finally{fs.rmSync(dir,{recursive:true,force:true});}
