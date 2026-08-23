import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'dist/server/prerendered-routes');
const client = resolve(root, 'dist/client');

for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const from = resolve(source, entry.name);
  if (entry.name === 'index.html' || entry.name === '404.html') {
    await copyFile(from, resolve(client, entry.name));
  } else if (entry.name.endsWith('.html')) {
    const route = entry.name.slice(0, -5);
    const routeDir = resolve(client, route);
    await mkdir(routeDir, { recursive: true });
    await copyFile(from, resolve(routeDir, 'index.html'));
    await copyFile(from, resolve(client, entry.name));
  } else if (entry.name.endsWith('.rsc')) {
    await copyFile(from, resolve(client, entry.name));
  }
}

console.log('已把预渲染首页、证明页和 404 页面整理到静态发布目录。');
