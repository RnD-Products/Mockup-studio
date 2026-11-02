// Copies the web app (server, recorder, UI + 3D files) from the project root into desktop/web so it can be packaged.
// Run `npm run build` in the project root first (it creates public/vendor).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..'), dst = path.resolve(here, '..', 'web');
if (!fs.existsSync(path.join(root, 'public', 'vendor'))) throw new Error('public/vendor is missing — run "npm run build" in the project root first.');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const f of ['server.js']) fs.cpSync(path.join(root, f), path.join(dst, f));
fs.cpSync(path.join(root, 'lib'), path.join(dst, 'lib'), { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(dst, 'public'), { recursive: true });
fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify({ type: 'module' }));   // keep ESM inside the bundle
console.log('web app copied to desktop/web');
