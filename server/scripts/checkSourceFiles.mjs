import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const errors = [];
let files = 0, imports = 0;
function resolves(base, specifier) {
  const filename = path.resolve(path.dirname(base), specifier.split(/[?#]/)[0]);
  return ['', '.js', '.jsx', '.mjs', '.json', '/index.js', '/index.jsx'].some(ext => fs.existsSync(filename + ext) && fs.statSync(filename + ext).isFile());
}
function scan(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(item.name)) continue;
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) { scan(filename); continue; }
    if (!/\.(?:js|jsx|mjs|css)$/.test(item.name)) continue;
    files++;
    const source = fs.readFileSync(filename, 'utf8');
    const pattern = item.name.endsWith('.css') ? /url\(\s*["']?(\.{1,2}\/[^"')\s]+)/g : /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g;
    for (const match of source.matchAll(pattern)) {
      imports++;
      if (!resolves(filename, match[1])) errors.push(`${path.relative(root, filename)}: ${match[1]}`);
    }
  }
}
for (const directory of ['client/src', 'server/src', 'server/scripts']) scan(path.join(root, directory));
if (errors.length) { console.error('Missing local imports:\n' + errors.join('\n')); process.exitCode = 1; }
else console.log(`Source check passed: ${files} files, ${imports} relative imports resolved.`);
