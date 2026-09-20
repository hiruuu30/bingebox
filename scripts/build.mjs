import { readdir, mkdir, rm, cp } from 'node:fs/promises';
import { extname } from 'node:path';
await rm('public', { recursive: true, force: true });
await mkdir('public');
const extensions = new Set(['.html', '.css', '.js', '.ico', '.xml', '.webmanifest']);
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (entry.isFile() && (extensions.has(extname(entry.name)) || entry.name === 'robots.txt')) {
    await cp(entry.name, `public/${entry.name}`);
  }
}
for (const dir of ['assets', 'data', 'workspace']) await cp(dir, `public/${dir}`, { recursive: true });
console.log('BingeBox static frontend prepared in public/');
