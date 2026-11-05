// Copies the few browser libraries the app needs out of node_modules into public/vendor,
// so the app can be hosted as plain static files (e.g. on Vercel) with no server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'vendor');
const copy = (from, to) => {
  const src = path.join(root, 'node_modules', from), dst = path.join(out, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};

fs.rmSync(out, { recursive: true, force: true });
copy('three/build/three.module.js', 'three/build/three.module.js');
for (const f of [
  'controls/OrbitControls.js',
  'loaders/GLTFLoader.js',
  'loaders/DRACOLoader.js',
  'environments/RoomEnvironment.js',
  'utils/BufferGeometryUtils.js',
  'lights/RectAreaLightUniformsLib.js',
  'lights/RectAreaLightTexturesLib.js',
]) copy(`three/examples/jsm/${f}`, `three/examples/jsm/${f}`);
copy('three/examples/jsm/libs/draco/gltf', 'three/examples/jsm/libs/draco/gltf');
copy('mp4-muxer/build/mp4-muxer.mjs', 'mp4-muxer/mp4-muxer.mjs');
console.log('static vendor files ready in public/vendor');
