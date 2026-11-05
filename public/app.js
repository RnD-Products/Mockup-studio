import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const rad = THREE.MathUtils.degToRad;

/* ------------------------------------------------------------------ state */
const LAYOUTS = {
  p: { label: '3:4', r: 3 / 4 },
  v: { label: '9:16', r: 9 / 16 },
  s: { label: '1:1', r: 1 },
  f: { label: '4:3', r: 4 / 3 },
  h: { label: '16:9', r: 16 / 9 },
  d: { label: 'Dribbble', r: 4 / 3 },   // 1600×1200 canvas, flat 1440×1040 frame
};
const CAM_DEF = {
  h: { az: -28, el: 22, dist: 0.78, tx: 0, ty: 0.08, tz: -0.03, fov: 32 },
  v: { az: -30, el: 30, dist: 0.78, tx: 0, ty: 0.09, tz: -0.03, fov: 55 },
  p: { az: -30, el: 22, dist: 0.64, tx: -0.02, ty: 0.075, tz: 0.0, fov: 34 },
  s: { az: -28, el: 25, dist: 0.8, tx: 0, ty: 0.08, tz: -0.03, fov: 42 },
  f: { az: -28, el: 24, dist: 0.8, tx: 0, ty: 0.08, tz: -0.03, fov: 36 },
  d: { az: -28, el: 24, dist: 0.8, tx: 0, ty: 0.08, tz: -0.03, fov: 36 },
};
const CAM_PRESETS = {
  Hero: { az: -28, el: 22, dist: 0.78, tx: 0, ty: 0.08, tz: -0.03 },
  Front: { az: 0, el: 8, dist: 0.68, tx: 0, ty: 0.1, tz: -0.03 },
  'Top-down': { az: 0, el: 80, dist: 0.8, tx: 0, ty: 0.04, tz: 0 },
  Side: { az: -68, el: 14, dist: 0.8, tx: 0, ty: 0.09, tz: -0.03 },
  'Close-up': { az: -8, el: 12, dist: 0.42, tx: 0, ty: 0.12, tz: -0.05 },
};
const defaults = () => ({
  layout: 'p', device: 'macbook',
  cams: JSON.parse(JSON.stringify(CAM_DEF)),
  motion: 'none', motionAmt: 40, motionPreview: true,
  // source
  fit: 'cover', fill: '#000000', loop: true, speed: 1, sound: false, brightness: 1, customDur: 0,
  // background
  bgMode: 'original', c1: '#1b1d22', c2: '#5b6cff', c3: '#ff7ab6', useC3: false, angle: 135, bgKind: 'linear',
  props: true, tableShow: true, tableTint: '#ffffff', wallColor: null,
  // laptop / light
  lid: 108, rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, keyEl: 40, finish: 'Silver', bodyColor: '#cdd0d5', safe: false,
  logoSize: 0.12, logoX: -0.85, logoY: 0.85, logoOp: 1,
  text: '', font: '700 Inter, Helvetica, Arial, sans-serif', textColor: '#ffffff', textSize: 0.09, textX: 0, textY: -0.8, bodyColor: null, exposure: 0.95, env: 1.1, key: 1.5, keyAz: -35, keyColor: '#fff4e6',
  fill_: 0.15, shadow: 0.55,
  // export
  glow: 1, wallImgMode: 'fill', wallImgScale: 1, wallImgY: 0.45, wallImgX: 0, wallPreset: null, tableScale: 1,
  autoFit: true, interact: 2, capAuto: true, capW: 1440, capH: 1040, dribShadow: 0, dribRadius: 40, surface: 'default', block: true, blockSurface: false, blockScale: 1, blockX: 0, blockZ: 0, studioRot: 0, studioZ: 1.2, interior: 'none', contact: 0.8, kf: [], outDir: 'renders', askFolder: true,
  quality: 1080, fps: 30, mbps: 16,
});
let S = defaults();
let dirHandle = null, lastSaved = '';
const hadSaved = !!localStorage.getItem('mockup-studio-v27');
const LS_KEY = 'mockup-studio-v27';
try { Object.assign(S, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch {} };
S.cams = { ...JSON.parse(JSON.stringify(CAM_DEF)), ...S.cams };
// The local server (npm start) provides website recording and save-to-folder. A static host (e.g. Vercel) does not.
let hasServer = false;
fetch('/api/folders?dir=').then((r) => { hasServer = r.ok && (r.headers.get('content-type') || '').includes('json'); }).catch(() => {});
const cam = () => S.cams[S.layout];

/* ------------------------------------------------------------------ three */
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true;   // used to keep the screen glow on the block's top face
renderer.shadowMap.type = THREE.PCFShadowMap; // radius-blurred, soft edges
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.01, 30);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = false;
orbit.minDistance = 0.2; orbit.maxDistance = 2.5; orbit.maxPolarAngle = Math.PI * 0.49;

const keyLight = new THREE.DirectionalLight(0xffffff, 2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(4096, 4096); keyLight.shadow.normalBias = 0.0006;
Object.assign(keyLight.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.1, far: 4 });
keyLight.shadow.radius = 7; keyLight.shadow.bias = -0.0002;
scene.add(keyLight, keyLight.target);
const fillLight = new THREE.HemisphereLight(0xbfd0ff, 0x302418, 0.35);
scene.add(fillLight);

/* screen reflection: the panel lights the keyboard deck and the table in the colour it is currently showing */
RectAreaLightUniformsLib.init();
const screenLight = new THREE.RectAreaLight(0xffffff, 0, 0.3, 0.2);
scene.add(screenLight);
const glowSample = Object.assign(document.createElement('canvas'), { width: 6, height: 4 });
const glowCtx = glowSample.getContext('2d', { willReadFrequently: true });
const glowCol = new THREE.Color(0, 0, 0), glowTarget = new THREE.Color();
let glowLum = 0, glowDecal = null;
{
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  glowDecal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, color: 0x000000 }));
  glowDecal.rotation.x = -Math.PI / 2; glowDecal.renderOrder = 3;
  scene.add(glowDecal);
}
/** average colour of what the screen shows right now (smoothed so cuts don't flicker) */
function sampleScreen(snap = false) {
  glowCtx.drawImage(screenCanvas, 0, 0, glowSample.width, glowSample.height);
  const d = glowCtx.getImageData(0, 0, glowSample.width, glowSample.height).data;
  let r = 0, g = 0, b = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  glowTarget.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  if (snap) glowCol.copy(glowTarget); else glowCol.lerp(glowTarget, 0.2);
  glowLum = 0.2126 * glowCol.r + 0.7152 * glowCol.g + 0.0722 * glowCol.b;
}
const glowPlanes = [0, 1, 2, 3].map(() => new THREE.Plane()), _glowBox = new THREE.Box3(), _gx = new THREE.Vector3();
const _gc = new THREE.Vector3(), _gn = new THREE.Vector3(), _gt = new THREE.Vector3(), _gs = new THREE.Vector3();
/** place the light on the panel (follows the lid / rotation) and the soft glow on the table in front of it */
function updateGlow() {
  const m = dev?.screenMesh, on = S.glow > 0 && S.layout !== 'd' && !!m;
  screenLight.visible = on; glowDecal.visible = on;
  if (!on) return;
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox, sz = bb.getSize(_gs);
  // the thinnest axis of the panel is its normal
  const ax = sz.x <= sz.y && sz.x <= sz.z ? 'x' : sz.y <= sz.z ? 'y' : 'z';
  m.updateWorldMatrix(true, false);
  bb.getCenter(_gc).applyMatrix4(m.matrixWorld);
  _gn.set(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0).transformDirection(m.matrixWorld);
  _gt.setFromMatrixPosition(N.Laptop.matrixWorld).sub(_gc);                        // the front of the screen faces the keyboard
  if (_gn.dot(_gt) < 0) _gn.negate();
  const ws = new THREE.Vector3().setFromMatrixScale(m.matrixWorld), dims = ['x', 'y', 'z'].filter((k) => k !== ax).map((k) => sz[k] * ws[k]).sort((a, b) => b - a);
  screenLight.width = dims[0]; screenLight.height = dims[1];
  screenLight.position.copy(_gc).addScaledVector(_gn, 0.004);
  screenLight.lookAt(_gt.copy(_gc).add(_gn));
  const k = S.glow * S.brightness;
  screenLight.color.copy(glowCol); screenLight.intensity = 7 * k;
  // table glow: in front of the screen, fading as the device lifts off the surface
  const lift = Math.max(0, S.py), fade = 1 / (1 + lift * 14), yaw = rad(S.ry);
  const fw = Math.max(0.2, dims[0] * 1.5), fd = Math.max(0.2, foot.d * 1.6);
  glowDecal.visible = S.tableShow || (!!blockObj && S.block);
  glowDecal.scale.set(fw * (1 + lift * 3), fd * (1 + lift * 3), 1);
  glowDecal.rotation.z = yaw;
  glowDecal.position.set(S.px + Math.sin(yaw) * foot.d * 0.35, 0.0013, S.pz + Math.cos(yaw) * foot.d * 0.35);
  // on the concrete block the glow stays on its top face (otherwise it would hang in the air past the edge)
  const blk = blockObj && S.block ? (blockObj.visible ? blockObj : blockObj.userData.alt) : null;
  if (blk) {
    _glowBox.setFromObject(blk);
    glowPlanes[0].set(_gx.set(1, 0, 0), -_glowBox.min.x); glowPlanes[1].set(_gx.set(-1, 0, 0), _glowBox.max.x);
    glowPlanes[2].set(_gx.set(0, 0, 1), -_glowBox.min.z); glowPlanes[3].set(_gx.set(0, 0, -1), _glowBox.max.z);
  }
  const want = blk ? glowPlanes : null;
  if (glowDecal.material.clippingPlanes !== want) { glowDecal.material.clippingPlanes = want; glowDecal.material.needsUpdate = true; }
  glowDecal.material.color.copy(glowCol).multiplyScalar(0.55 * k * fade * Math.min(1, 0.35 + glowLum));
}

const catcher = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.5 }));
catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.0004; catcher.receiveShadow = true;
scene.add(catcher);

/* screen canvas → texture */
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 2048; screenCanvas.height = 1330; // 14" panel ratio
const sctx = screenCanvas.getContext('2d');
let screenTex = null, coverTex = null, dribTex = null;
const dribMat = new THREE.MeshBasicMaterial({ toneMapped: false });
const screenMat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
const coverMat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
/** size the screen canvas to the device's panel ratio and (re)create its texture(s) */
function setScreen(aspect, uv = {}, coverAspect = 0) {
  const L = 2048, w = aspect >= 1 ? L : Math.round(L * aspect), h = aspect >= 1 ? Math.round(L / aspect) : L;
  screenCanvas.width = w; screenCanvas.height = h;
  const mk = () => { const t = new THREE.CanvasTexture(screenCanvas); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8; return t; };
  screenTex?.dispose(); coverTex?.dispose();
  screenTex = mk(); screenMat.map = screenTex;
  const fx = uv.flipX ? -1 : 1, fy = uv.flipY ? -1 : 1;
  screenTex.repeat.set(fx, fy); screenTex.offset.set(uv.flipX ? 1 : 0, uv.flipY ? 1 : 0);
  if (uv.rot) { screenTex.center.set(0.5, 0.5); screenTex.rotation = rad(uv.rot); }
  coverTex = null; coverMat.map = null;
  if (coverAspect) {   // small outer screen: show a centred crop of the same content
    coverTex = mk(); coverMat.map = coverTex;
    const frac = Math.min(1, coverAspect / aspect);
    coverTex.repeat.set(frac * fx, fy); coverTex.offset.set(uv.flipX ? 0.5 + frac / 2 : 0.5 - frac / 2, uv.flipY ? 1 : 0);
  }
  screenMat.needsUpdate = coverMat.needsUpdate = true;
  dribTex?.dispose(); dribTex = new THREE.CanvasTexture(screenCanvas); dribTex.colorSpace = THREE.SRGBColorSpace; dribTex.anisotropy = 8; dribMat.map = dribTex; dribMat.needsUpdate = true;
}
let screenIsD = false;
/** the Dribbble layout shows the content flat at 1440:1040; every other layout uses the device's own panel ratio */
function syncScreen() {
  const d = S.layout === 'd'; if (d === screenIsD) return; screenIsD = d;
  if (d) setScreen(1440 / 1040); else setScreen(dev.cfg.aspect, dev.cfg.uv, dev.cfg.cover?.aspect || 0);
}

/* overlays (logo / text) rendered on top in a 2D ortho pass */
const ovScene = new THREE.Scene();
const ovCam = new THREE.OrthographicCamera(-16 / 9, 16 / 9, 1, -1, 0, 10); ovCam.position.z = 5;
const mkSprite = () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, toneMapped: false, depthTest: false })); s.visible = false; ovScene.add(s); return s; };
const logoSpr = mkSprite(), textSpr = mkSprite();
let logoImg = null, textKey = '';
function updateOverlays() {
  const as = ovCam.right;
  logoSpr.visible = !!logoImg;
  if (logoImg) {
    const h = S.logoSize * 2; logoSpr.scale.set(h * logoImg.width / logoImg.height, h, 1);
    logoSpr.position.set(S.logoX * as, S.logoY, 0); logoSpr.material.opacity = S.logoOp;
  }
  textSpr.visible = !!S.text;
  if (S.text) {
    const key = S.text + S.font + S.textColor;
    if (key !== textKey) {
      textKey = key;
      const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 200, f = S.font.replace(/^(\d+)\s/, '$1 ' + fs + 'px ');
      g.font = f; const w = Math.ceil(g.measureText(S.text).width) + 60; c.width = w; c.height = 300;
      g.font = f; g.fillStyle = S.textColor; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(S.text, w / 2, 150);
      textSpr.material.map?.dispose(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; textSpr.material.map = t; textSpr.material.needsUpdate = true; textSpr.userData.ar = w / 300;
    }
    const h = S.textSize * 2 * 1.5; textSpr.scale.set(h * textSpr.userData.ar, h, 1); textSpr.position.set(S.textX * as, S.textY, 0);
  }
}
/* ---- Dribbble shot: flat 1600×1200 canvas, 1440×1040 frame centred, the same rounded radius on all four corners ---- */
const DB = { W: 1600, H: 1200, fw: 1440, fh: 1040, rMax: 200 };
const dbScene = new THREE.Scene();
const dribFrame = new THREE.Mesh(new THREE.BufferGeometry(), dribMat);
const dribShadow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
dribShadow.position.set(0, -0.03, -0.1);
dbScene.add(dribShadow, dribFrame);
let dribKey = '';
/** (re)build the frame and its soft shadow for the current corner radius */
function buildDribFrame() {
  const rpx = Math.min(DB.rMax, Math.max(0, +S.dribRadius || 0));
  if (String(rpx) === dribKey) return; dribKey = String(rpx);
  const U = 2 / DB.H, w = DB.fw * U, h = DB.fh * U, r = Math.min(rpx * U, w / 2, h / 2);
  const sh = new THREE.Shape();
  if (r > 0) {
    sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2);
    sh.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false); sh.lineTo(w / 2, h / 2 - r);
    sh.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false); sh.lineTo(-w / 2 + r, h / 2);
    sh.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false); sh.lineTo(-w / 2, -h / 2 + r);
    sh.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  } else { sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); }
  const g = new THREE.ShapeGeometry(sh, 24), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  dribFrame.geometry.dispose(); dribFrame.geometry = g;
  const spread = 0.07;
  dribShadow.geometry.dispose(); dribShadow.geometry = new THREE.PlaneGeometry(w + 4 * spread, h + 4 * spread);
  dribShadow.material.map?.dispose(); dribShadow.material.map = shadowTex(w, h, spread, Math.max(r, 0.001)); dribShadow.material.needsUpdate = true;
}
function draw() {
  renderer.autoClear = false; renderer.clear();
  if (S.layout === 'd') renderer.render(dbScene, ovCam); else renderer.render(scene, camera);
  renderer.clearDepth(); renderer.render(ovScene, ovCam);
}

const N = {}; // named nodes
let lookKey = '';
const orig = {};
const foot = { cx: 0, cz: 0, w: 0.31, d: 0.22 }; // footprint of the device on the table, in the rig's local space
let dev = null;                                   // the active device runtime

/* ---------------- device registry ---------------- */
const DEVICES = {
  macbook: { name: 'MacBook Pro 14"', file: 'devices/macbook-scene.glb', aspect: 1.55, screen: /ChangeThis/, ground: 'Ground', lid: 105, el: 22,
    hinge: { node: 'HingePivot', axis: 'x', sign: -1, rest: 0 } },
  'macbook-classic': { name: 'MacBook Pro 14" (classic)', file: 'macbook.glb', aspect: 1.535, screenNode: 'Screen', lid: 108, el: 22,
    hinge: { node: 'Lid', axis: 'x', sign: -1, rest: 110 }, body: (m) => m.color.getHexString() === '565457' && m.metalness > 0.9, finish: true },
};
const draco = new DRACOLoader().setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
const deviceCache = {};

async function buildDevice(id) {
  const cfg = DEVICES[id], g = await gltfLoader.loadAsync('models/' + cfg.file), model = g.scene;
  const pose = new THREE.Group(); pose.add(model); const rig = new THREE.Group(); rig.add(pose);
  if (cfg.rot) model.rotation.set(rad(cfg.rot[0]), rad(cfg.rot[1]), rad(cfg.rot[2]));
  const rt = { id, cfg, rig, pose, model, bodyMats: [], hingeNode: null, hingeRest: 0, ground: null };
  if (cfg.ground) {                                   // the mockup ships its own table: use it as the surface
    const gr = model.getObjectByName(cfg.ground);
    if (gr) {
      gr.removeFromParent();
      gr.material.toneMapped = false;                  // keep the file's original colours exactly
      // the file's ground is unlit, so shadows are drawn by a transparent copy of it laid on top
      const sh = new THREE.Mesh(gr.geometry, new THREE.ShadowMaterial({ opacity: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      sh.receiveShadow = true; sh.castShadow = false; sh.renderOrder = 1; gr.add(sh); gr.userData.sh = sh;
      gr.receiveShadow = true; gr.castShadow = false; rt.ground = gr; rt.groundY0 = gr.position.y;
    }
  }
  const seen = new Set();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const ms = [].concat(o.material);
    ms.forEach((m, k) => {
      const isScreen = cfg.screenNode ? o.name === cfg.screenNode : cfg.screen?.test(m.name);
      const isCover = cfg.cover?.match.test(m.name);
      if (isScreen) { if (Array.isArray(o.material)) o.material[k] = screenMat; else o.material = screenMat; o.castShadow = false; rt.screenMesh = o; }
      else if (isCover) { if (Array.isArray(o.material)) o.material[k] = coverMat; else o.material = coverMat; o.castShadow = false; }
      else if (cfg.body?.(m) && !seen.has(m)) { seen.add(m); rt.bodyMats.push(m); }
    });
  });
  rt.bodyMats.forEach((m) => { m.metalness = 0.3; m.roughness = 0.4; }); // satin anodised aluminium
  rt.origBody = rt.bodyMats[0]?.color.clone() || new THREE.Color(0xffffff);
  if (cfg.hinge) {
    rt.hingeNode = model.getObjectByName(cfg.hinge.node);
    rt.hingeRest = rt.hingeNode ? rt.hingeNode.rotation[cfg.hinge.axis] : 0;
  }
  return rt;
}
function poseDevice(rt) {
  const { cfg, rig, pose, model } = rt;
  if (rt.hingeNode) rt.hingeNode.rotation[cfg.hinge.axis] = rt.hingeRest + cfg.hinge.sign * rad((cfg.lid ?? 105) - cfg.hinge.rest);
  pose.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.position.set(0, 0, 0); rig.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(model);
  pose.position.y = -bb.min.y;                               // rest on the table
  if (rt.ground) { rt.ground.position.y = (rt.groundY0 || 0) - bb.min.y; rt.groundBase = rt.ground.position.y; }
  rig.updateMatrixWorld(true);
  // footprint = the parts that touch the table
  const fb = new THREE.Box3(), mb = new THREE.Box3(), any = new THREE.Box3();
  model.traverse((o) => { if (o.isMesh) { mb.setFromObject(o); if (mb.min.y < 0.004 && mb.max.y < 0.04) fb.union(mb); any.union(mb); } });
  if (fb.isEmpty()) model.traverse((o) => { if (o.isMesh) { mb.setFromObject(o); if (mb.min.y < 0.004) fb.union(mb); } });
  if (fb.isEmpty()) fb.copy(any);
  const cx = (fb.min.x + fb.max.x) / 2, cz = (fb.min.z + fb.max.z) / 2;
  pose.position.x -= cx; pose.position.z -= cz;              // footprint centred on the rig origin
  rig.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  Object.assign(rt, { foot: { cx: 0, cz: 0, w: fb.max.x - fb.min.x, d: fb.max.z - fb.min.z }, R: size.length() / 2 * 0.7, ty: Math.max(0.02, size.y * 0.4) });
}
async function loadDevice(id) {
  const rt = deviceCache[id] || (deviceCache[id] = await buildDevice(id));
  if (!rt.foot) poseDevice(rt);
  if (N.Laptop) N.Laptop.removeFromParent();
  N.Laptop = rt.rig; scene.add(rt.rig); dev = rt;
  if (N.Ground && N.Ground !== rt.ground) N.Ground.removeFromParent();
  N.Ground = rt.ground || null; if (N.Ground) scene.add(N.Ground);
  N.Wall.userData.z = rt.ground ? -1.2 : -0.9; N.Wall.position.z = N.Wall.userData.z;
  Object.assign(foot, rt.foot);
  setScreen(rt.cfg.aspect, rt.cfg.uv, rt.cfg.cover?.aspect || 0);
  orig.body = rt.origBody;
  return rt;
}

{
  const loader = new GLTFLoader();
  const env = await loader.loadAsync('models/scene.glb');
  scene.add(env.scene);                                      // table + wall from the Blender scene
  env.scene.traverse((o) => { N[o.name] = o; });
  N.Laptop.removeFromParent();                               // old built-in laptop, replaced by the real device models
  N.Table.receiveShadow = true;
  N.Wall.material = new THREE.MeshBasicMaterial({ toneMapped: false });   // flat, unlit: one even shade, no gradient band
  if (!DEVICES[S.device]) S.device = 'macbook';
  await loadDevice(S.device);
  orig.wall = new THREE.Color('#ecdfc8');
  { const tm0 = N.Table.material; Object.assign(orig, { tMap: tm0.map, tNormal: tm0.normalMap, tRough: tm0.roughness, tCoat: tm0.clearcoat || 0 }); }
}
document.getElementById('loading').remove();

/* ------------------------------------------------------------------ source */
const video = document.createElement('video');
video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous'; video.preload = 'auto';
const src = { kind: 'demo', el: null, start: 0, end: 8, label: 'Built-in demo' };
let image = null;
let playing = true;
let clock = 0;               // demo / image timeline (s)
let lastTs = performance.now();
const demoCanvas = document.createElement('canvas');
demoCanvas.width = 1600; demoCanvas.height = 1000;

function drawDemo(t) {
  const c = demoCanvas.getContext('2d'), W = 1600, H = 1000;
  const g = c.createLinearGradient(0, 0, W, H);
  const h = (t * 20) % 360;
  g.addColorStop(0, `hsl(${h},70%,18%)`); g.addColorStop(1, `hsl(${(h + 60) % 360},70%,38%)`);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = '#ffffff22';
  for (let i = 0; i < 6; i++) {
    const x = (W * (0.15 + 0.7 * ((i * 0.37 + t * 0.05) % 1)));
    c.beginPath(); c.arc(x, H * (0.2 + 0.12 * i), 70 + i * 22, 0, 7); c.fill();
  }
  c.fillStyle = '#fff'; c.textAlign = 'center';
  c.font = '700 120px -apple-system, Helvetica, Arial'; c.fillText('Your video here', W / 2, H / 2 - 10);
  c.font = '400 42px -apple-system, Helvetica, Arial'; c.globalAlpha = 0.8;
  c.fillText('Upload a video or capture a website →', W / 2, H / 2 + 70); c.globalAlpha = 1;
  c.fillStyle = '#fff'; c.fillRect(0, H - 10, W * ((t % 8) / 8), 10);
}

function sourceLen() { return Math.max(0.1, src.end - src.start); }

/* image-sequence source (website recordings) */
const frameCache = new Map();
let lastFrameEl = null;
const frameIdx = (t) => { const f = src.frames; let lo = 0, hi = f.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m].t <= t) lo = m; else hi = m - 1; } return lo; };
function loadFrame(i) {
  let e = frameCache.get(i);
  if (!e) {
    const im = new Image(); im.crossOrigin = 'anonymous'; const p = new Promise((r) => { im.onload = () => r(im); im.onerror = () => r(im); }); im.src = src.frames[i].url;
    e = { im, p }; frameCache.set(i, e);
    if (frameCache.size > 80) frameCache.delete(frameCache.keys().next().value);
  }
  return e;
}
function useFrames(frames, length, label) {
  frameCache.clear(); lastFrameEl = null; video.pause(); video.removeAttribute('src');
  S.customDur = 0; Object.assign(src, { kind: 'frames', start: 0, end: length, label, frames });
  clock = 0; playing = true; syncPlayBtn(); setStatus(`Loaded: ${label} (${length.toFixed(1)}s recording) · change the speed with the speed button in the timeline`);
}
async function loadFrames(url, label) {
  const m = await (await fetch(url)).json(), base = url.replace(/manifest\.json$/, '');
  useFrames(m.frames.map((f) => ({ t: f.t, url: base + f.f })), m.length, label);
}
/** hosted site: the /api/capture serverless function streams newline-delimited JSON (frames, then {done}) */
async function captureHosted(body, host, signal) {
  const r = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `The recording service answered ${r.status}. Try again, or run the app locally.`); }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', t0 = null, length = 0, meta = null, needed = 1; const frames = [], tiles = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
      const m = JSON.parse(line);
      if (m.error) throw new Error(m.error);
      if (m.info) {
        setStatus(`${m.info} (${host})`);
        const px = /Capturing the page \((\d+) px\)/.exec(m.info); if (px) needed = Math.max(1, Math.ceil(+px[1] / 3000));
        recUI.set(/Starting/.test(m.info) ? 0.05 : /Page loaded/.test(m.info) ? 0.25 : /Measuring/.test(m.info) ? 0.35 : px ? 0.45 : 0.1, m.info.split(' · ')[0]);
        continue;
      }
      if (m.image) { await loadImageURL('data:image/jpeg;base64,' + m.image, host); return; }
      if (m.tile) {
        const bin = atob(m.tile), arr = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        const img = new Image(); img.src = URL.createObjectURL(new Blob([arr], { type: 'image/jpeg' }));
        tiles.push({ y: m.y, h: m.h, img, ready: img.decode().catch(() => {}) });
        recUI.set(0.45 + 0.5 * Math.min(1, tiles.length / needed), `Capturing the page (${tiles.length} of ~${needed})`);
        setStatus(`Capturing ${host}… ${tiles.length} part${tiles.length > 1 ? 's' : ''}`);
      }
      if (m.f) {
        if (t0 === null) t0 = m.t;
        const bin = atob(m.f), arr = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        frames.push({ t: m.t - t0, url: URL.createObjectURL(new Blob([arr], { type: 'image/jpeg' })) });
        if (frames.length % 10 === 0) setStatus(`Recording ${host}… ${frames.length} frames received`);
      }
      if (m.done) { length = m.length; meta = m; }
    }
  }
  if (tiles.length && meta) { await Promise.all(tiles.map((t) => t.ready)); useScrollImage(tiles, meta, host, body.duration, body.speed); return; }
  if (!frames.length) throw new Error('The recording came back empty. Try again.');
  useFrames(frames, length || frames[frames.length - 1].t + 0.25, host);
}

/* page-image source (hosted capture): the app scrolls smoothly through tall page screenshots */
const vpCanvas = document.createElement('canvas');
function scrollYAt(t) {                    // trapezoid speed profile: ease in, steady, ease out
  const T = src.end, t0 = 0.5, Tm = Math.max(0.5, T - 0.8 - t0), ramp = Math.min(0.7, Tm / 3), v = src.maxY / Math.max(0.1, Tm - ramp);
  const u = Math.min(Tm, Math.max(0, t - t0));
  if (src.maxY <= 0) return 0;
  if (u < ramp) return v * u * u / (2 * ramp);
  if (u < Tm - ramp) return v * (ramp / 2 + (u - ramp));
  const d = Tm - u; return src.maxY - v * d * d / (2 * ramp);
}
function useScrollImage(tiles, meta, label, dur, speed) {
  const maxY = Math.max(0, meta.pageHeight - meta.viewH);
  const T = dur > 0 ? dur : Math.min(90, Math.max(4, maxY / Math.max(80, speed) + 1.6));
  frameCache.clear(); lastFrameEl = null; video.pause(); video.removeAttribute('src');
  vpCanvas.width = meta.width; vpCanvas.height = meta.viewH;
  S.customDur = 0; Object.assign(src, { kind: 'scrollimg', start: 0, end: T, label, tiles, W: meta.width, viewH: meta.viewH, maxY });
  clock = 0; playing = true; syncPlayBtn();
  setStatus(`Loaded: ${label} (${Math.round(meta.pageHeight)} px page, ${T.toFixed(1)}s scroll${meta.truncated ? ', first 30,000 px' : ''})`);
}
function drawScreen() {
  const W = screenCanvas.width, H = screenCanvas.height;
  sctx.fillStyle = S.fill; sctx.fillRect(0, 0, W, H);
  let el = null, sw = 0, sh = 0;
  if (src.kind === 'video') {
    if (video.readyState >= 2) { el = video; sw = video.videoWidth; sh = video.videoHeight; }
  } else if (src.kind === 'image' && image) {
    el = image; sw = image.naturalWidth; sh = image.naturalHeight;
  } else if (src.kind === 'scrollimg') {
    const y = scrollYAt(clock), g = vpCanvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, vpCanvas.width, vpCanvas.height);
    for (const t of src.tiles) { if (t.y + t.h < y || t.y > y + src.viewH) continue; g.drawImage(t.img, 0, t.y - y); }
    el = vpCanvas; sw = src.W; sh = src.viewH;
  } else if (src.kind === 'frames') {
    const i = frameIdx(clock), e = loadFrame(i);
    for (let k = 1; k <= 3 && i + k < src.frames.length; k++) loadFrame(i + k);
    if (e.im.complete && e.im.naturalWidth) lastFrameEl = e.im;
    if (lastFrameEl) { el = lastFrameEl; sw = el.naturalWidth; sh = el.naturalHeight; }
  } else if (src.kind === 'demo') {
    drawDemo(clock); el = demoCanvas; sw = 1600; sh = 1000;
  }
  if (!el || !sw) return;
  let dw = W, dh = H;
  const fills = S.fit === 'cover' || src.kind === 'frames' || src.kind === 'scrollimg';   // site recordings always fill the frame
  if (S.fit !== 'stretch') {
    const k = fills ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
    dw = sw * k; dh = sh * k;
  }
  const topAnchor = fills && dh > H && ['frames', 'scrollimg', 'image'].includes(src.kind);   // a site shot loses its bottom, never its top (nav bar)
  sctx.drawImage(el, (W - dw) / 2, topAnchor ? 0 : (H - dh) / 2, dw, dh);
}

function timeNow() { return src.kind === 'video' ? video.currentTime - src.start : clock; }

function tickSource(dt) {
  if (src.kind === 'video') {
    if (playing && video.paused) video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();
    if (video.currentTime >= src.end - 0.03 || video.ended) {
      if (S.loop) { video.currentTime = src.start; if (playing) video.play().catch(() => {}); }
      else { playing = false; video.pause(); syncPlayBtn(); }
    }
  } else if (playing) {
    clock += dt * S.speed;
    if (clock > sourceLen()) { if (S.loop || src.kind === 'demo') clock = 0; else { clock = sourceLen(); playing = false; syncPlayBtn(); } }
  }
}

async function fixDuration(v) {
  // MediaRecorder / Playwright webm files report Infinity; force the browser to compute it.
  if (Number.isFinite(v.duration)) return;
  await new Promise((r) => { v.onseeked = r; v.currentTime = 1e8; });
  v.onseeked = null; v.currentTime = 0;
}

async function loadVideoURL(url, opts = {}) {
  video.src = url; video.load();
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('Could not load this video')); });
  await fixDuration(video);
  S.customDur = 0; Object.assign(src, { kind: 'video', start: opts.start || 0, end: opts.end || video.duration, label: opts.label || 'Video' });
  video.currentTime = src.start; video.playbackRate = S.speed; video.muted = !S.sound;
  playing = true; syncPlayBtn(); setStatus(`Loaded: ${src.label} (${sourceLen().toFixed(1)}s)`);
}
async function loadImageURL(url, label = 'Image') {
  image = new Image(); image.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { image.onload = res; image.onerror = () => rej(new Error('Could not load image')); image.src = url; });
  S.customDur = 0; Object.assign(src, { kind: 'image', start: 0, end: 6, label }); clock = 0; video.removeAttribute('src');
  setStatus(`Loaded: ${label}`);
}
async function loadFile(file) {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith('image/')) await loadImageURL(url, file.name);
    else await loadVideoURL(url, { label: file.name });
  } catch (e) { setStatus(e.message, true); }
}

const HELPER = 'http://localhost:4173';   // the local app (npm start), which can reach pages on this computer
async function findHelper() {
  try { const r = await fetch(HELPER + '/api/ping', { mode: 'cors' }); return r.ok && !!(await r.json()).helper; } catch { return false; }
}
/** What shape the page should be recorded in: the same shape as the frame it will be shown in, so nothing is cut off at the sides. */
const frameAspect = () => (S.layout === 'd' ? 1440 / 1040 : (dev?.cfg.aspect || 1.55));
function captureSize() {
  if (!S.capAuto) return { width: Math.round(S.capW), height: Math.round(S.capH) };
  const width = 1440, a = frameAspect();   // landscape frames all share one tall take (1440×1040): a wider frame only trims its top/bottom, never the sides
  return { width, height: Math.round(width / (a >= 1.2 ? Math.min(a, 1440 / 1040) : a)) };
}
let lastCap = null;
/** one recording per frame shape: the Dribbble frame and the laptop screen are different shapes, so each gets its own full-frame take */
const shotCache = {};
const shotKey = () => (S.layout === 'd' ? 'd' : 'm');
function rememberShot() {
  if (src.kind === 'frames' && lastCap) shotCache[shotKey()] = { src: { ...src }, cap: lastCap };
}
function restoreShot() {
  const c = shotCache[shotKey()];
  if (!c || !lastCap || c.cap.url !== lastCap.url || src.kind !== 'frames' || src.frames === c.src.frames) return false;
  frameCache.clear(); lastFrameEl = null; Object.assign(src, c.src); lastCap = c.cap; clock = 0;
  setStatus(`Showing the ${S.layout === 'd' ? 'Dribbble' : 'laptop'} recording of ${c.src.label}`); return true;
}

/* ---- progress bar while recording from a link (with Cancel) ---- */
let recCtrl = null;
const recUI = {
  bar: null,
  show(title) {
    this.hide();
    const fill = el('div', { className: 'fill' }), pct = el('span', { className: 'pct', textContent: '0%' }), sub = el('span', { className: 'rs', textContent: 'Starting…' });
    this.bar = el('div', { id: 'recBar' }, [
      el('div', {}, [el('div', { className: 'rt', textContent: title }), sub]),
      el('div', { style: 'display:flex;gap:12px;align-items:center' }, [pct, el('button', { textContent: 'Cancel', onclick: () => recCtrl?.abort() })]),
      el('div', { className: 'bar' }, [fill]),
    ]);
    this.fill = fill; this.pct = pct; this.sub = sub; document.body.append(this.bar);
  },
  set(p, text) { if (!this.bar) return; const v = Math.max(0, Math.min(1, p)); this.fill.style.width = (v * 100).toFixed(1) + '%'; this.pct.textContent = Math.round(v * 100) + '%'; if (text) this.sub.textContent = text; },
  hide() { this.bar?.remove(); this.bar = null; },
};
/** reads a newline-delimited JSON stream; calls onMsg for progress lines and returns the final {done} message */
async function readStream(r, onMsg) {
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', final = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
      const m = JSON.parse(line);
      if (m.error) throw new Error(m.error);
      if (m.done) final = m; else onMsg(m);
    }
  }
  if (!final) throw new Error('The recording stopped before it finished. Try again.');
  return final;
}
/** If the recording was made in a different shape than the frame now showing it, offer to re-record to fit. */
function checkFit() {
  let bar = document.getElementById('fitBar');
  const need = lastCap && S.capAuto && ['frames', 'scrollimg', 'image'].includes(src.kind) && lastCap.size.width / lastCap.size.height > frameAspect() + 0.04;   // only a recording WIDER than the frame loses its sides
  if (!need) { bar?.remove(); return; }
  const want = captureSize();
  if (!bar) { bar = el('div', { id: 'fitBar' }); document.getElementById('stage').append(bar); }
  bar.innerHTML = '';
  bar.append(el('span', { innerHTML: `Recorded at <b>${lastCap.size.width}×${lastCap.size.height}</b>, this frame is <b>${want.width}×${want.height}</b> — record it separately for this frame so nothing is cut off.` }),
    el('button', { className: 'go', textContent: S.layout === 'd' ? 'Record for Dribbble' : 'Re-record to fit', onclick: () => { bar.remove(); captureSite(lastCap.url, lastCap.mode, lastCap.dur, { set disabled(v) {} }, lastCap.speed); } }),
    el('button', { textContent: 'Keep', onclick: () => bar.remove() }));
}
async function captureSite(url, mode, dur, btn, speed = 700) {
  if (!url) return setStatus('Paste a website link first.', true);
  if (/^:?\d{2,5}$/.test(url)) url = 'http://localhost:' + url.replace(':', '');
  if (!/^https?:\/\//i.test(url)) url = (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|\d+\.\d+\.\d+\.\d+|[\w-]+\.local)(:|\/|$)/i.test(url) ? 'http://' : 'https://') + url;
  btn.disabled = true; setStatus(mode === 'scroll' ? `Recording ${url} … ${dur ? `(≈${dur + 6}s)` : '(auto-detecting scroll length)'}` : `Taking screenshot of ${url} …`);
  recCtrl = new AbortController(); recUI.show(mode === 'scroll' ? `Recording ${url}` : `Screenshot of ${url}`);
  try {
    const host = new URL(url).host, size = captureSize();
    let base = '';
    if (!hasServer) {
      if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|[\w-]+\.local)(:|\/|$)/i.test(host + '/')) {
        // a page on THIS computer: the hosted server can't see it, so ask the local app to record it
        setStatus('Looking for the local app on this computer…');
        if (!(await findHelper())) throw new Error('To record a localhost page from the live site, start the local app first: open Terminal in the mockup-studio folder and run  npm start  (keep it running). Allow the browser to connect to local devices if it asks, then try again.');
        base = HELPER;
        setStatus(`Recording ${url} through the local app…`);
      } else {                                                  // a public website: the hosted recorder does it
        await captureHosted({ url, mode, duration: dur, speed, ...size }, host, recCtrl.signal);
        lastCap = { url, mode, dur, speed, size }; checkFit();
        recUI.hide(); recCtrl = null; btn.disabled = false; return;
      }
    }
    const r = await fetch(base + '/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: recCtrl.signal,
      body: JSON.stringify({ url, mode, duration: dur, speed, interact: S.interact, stream: true, ...size }) });
    let j;
    if ((r.headers.get('content-type') || '').includes('ndjson')) j = await readStream(r, (m) => { if (m.p != null) recUI.set(m.p, m.t); });
    else { j = await r.json(); if (!r.ok) throw new Error(j.error || 'Capture failed'); }
    recUI.set(1, 'Loading the recording…');
    if (j.kind === 'frames') await loadFrames(base + j.url, new URL(url).host);
    else if (j.kind === 'image') await loadImageURL(base + j.url, new URL(url).host);
    else await loadVideoURL(base + j.url, { start: j.start, end: j.start + j.length, label: new URL(url).host });
    lastCap = { url, mode, dur, speed, size }; rememberShot(); checkFit();
  } catch (e) { setStatus(e.name === 'AbortError' ? 'Recording cancelled.' : e.message, e.name !== 'AbortError'); }
  recUI.hide(); recCtrl = null;
  btn.disabled = false;
}

/* ------------------------------------------------------------------ background */
let bgTex = null, bgImage = null;
function buildBackground() {
  const r = LAYOUTS[S.layout].r;
  const w = r >= 1 ? 1024 : Math.round(1024 * r), h = r >= 1 ? Math.round(1024 / r) : 1024;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (S.bgMode === 'image' && bgImage) {
    const k = Math.max(w / bgImage.width, h / bgImage.height);
    g.drawImage(bgImage, (w - bgImage.width * k) / 2, (h - bgImage.height * k) / 2, bgImage.width * k, bgImage.height * k);
  } else {
    let grad;
    if (S.bgMode === 'solid') { g.fillStyle = S.c1; g.fillRect(0, 0, w, h); }
    else {
      if (S.bgKind === 'radial') grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
      else {
        const a = (S.angle - 90) * Math.PI / 180, L = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
        const dx = Math.cos(a) * L / 2, dy = Math.sin(a) * L / 2;
        grad = g.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
      }
      grad.addColorStop(0, S.c1);
      if (S.useC3) { grad.addColorStop(0.5, S.c2); grad.addColorStop(1, S.c3); } else grad.addColorStop(1, S.c2);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }
  }
  bgTex?.dispose();
  bgTex = new THREE.CanvasTexture(c); bgTex.colorSpace = THREE.SRGBColorSpace;
  applyScene();
}

/* ------------------------------------------------------------------ apply state → scene */

/* ---------------- surfaces (table) & interiors (wall) ---------------- */
const SURF = [
  { id: 'default', name: 'Mockup ground' },
  { id: 'studio', name: 'Studio wood', css: 'linear-gradient(120deg,#e0bd94,#9a6a46 50%,#1d1511)' },
  { id: 'walnut', name: 'Walnut wood', map: 'walnut.jpg', normal: 'walnut_n.jpg', rough: 0.45, thumb: 't_walnut.jpg' },
  { id: 'oak', name: 'Light oak', map: 'oak.jpg', normal: 'oak_n.jpg', rough: 0.5, thumb: 't_oak.jpg' },
  { id: 'whiteboard', name: 'White board', map: 'whiteboard.jpg', rough: 0.14, thumb: 't_whiteboard.jpg' },
  { id: 'marble', name: 'White marble', map: 'marble.jpg', rough: 0.12, thumb: 't_marble.jpg' },
  { id: 'concrete', name: 'Concrete', map: 'concrete.jpg', normal: 'concrete_n.jpg', rough: 0.85, repeat: [2, 2], thumb: 't_concrete.jpg' },
  { id: 'slate', name: 'Black slate', map: 'slate.jpg', normal: 'slate_n.jpg', rough: 0.4, thumb: 't_slate.jpg' },
  { id: 'blackwood', name: 'Black wood', map: 'blackwood.jpg', normal: 'blackwood_n.jpg', rough: 0.42, thumb: 't_blackwood.jpg' },
];
const INT = [
  { id: 'none', name: 'None', color: '#141416' },
  { id: 'cream', name: 'Cream' },
  { id: 'white', name: 'White', color: '#f3f2ee' },
  { id: 'grey', name: 'Warm grey', color: '#b8b3aa' },
  { id: 'charcoal', name: 'Charcoal', color: '#3b3c40' },
  { id: 'sage', name: 'Sage', color: '#a7b49f' },
  { id: 'blue', name: 'Dusty blue', color: '#9fb2c4' },
  { id: 'terracotta', name: 'Terracotta', color: '#d08a68' },
  { id: 'brick', name: 'Brick', map: 'brick.jpg', color: '#ffffff', thumb: 't_brick.jpg' },
  { id: 'slats', name: 'Wood slats', map: 'slats.jpg', color: '#ffffff', thumb: 't_slats.jpg' },
  { id: 'concrete', name: 'Concrete', map: 'concrete.jpg', color: '#ffffff', thumb: 't_concrete.jpg' },
];
const texLoader = new THREE.TextureLoader(), texCache = {};
function tex(name, srgb, repeat) {
  const key = name + repeat;
  if (!texCache[key]) {
    const t = texLoader.load('textures/' + name);
    t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8; texCache[key] = t;
  }
  return texCache[key];
}
const curSurf = () => SURF.find((s) => s.id === S.surface) || SURF[0];
/* your own wall image (uploaded): kept in this browser so it survives a reload */
/* ready-made room photos for the wall: cropped at the skirting board, so the room's furniture stands just behind the table */
const WALL_PRESETS = [
  { id: 'room-sage', name: 'Sage room', file: 'walls/room-sage.jpg', thumb: 'walls/t_room-sage.jpg', scale: 0.6, x: 0 },
  { id: 'room-blue', name: 'Blue room', file: 'walls/room-blue.jpg', thumb: 'walls/t_room-blue.jpg', scale: 0.55, x: 0 },
  { id: 'room-white', name: 'Sunlit room', file: 'walls/room-white.jpg', thumb: 'walls/t_room-white.jpg', scale: 0.52, x: 0 },
];
/** bottom of the picture on the table line, for the given size */
const wallBottomY = (im, k) => 2.4 * k / (im.width / im.height) / 2;
function loadWallPreset(id, apply = true) {
  const pr = WALL_PRESETS.find((w) => w.id === id); if (!pr) return;
  const im = new Image();
  im.onload = () => {
    setWallImage(im);
    if (apply) Object.assign(S, { wallPreset: id, interior: 'custom', bgMode: 'original', tableShow: true, wallImgMode: 'fill', wallImgScale: pr.scale, wallImgX: pr.x, wallImgY: wallBottomY(im, pr.scale) });
    lookKey = ''; buildBackground(); refreshControls(); save();
  };
  im.src = 'textures/' + pr.file;
}
const WALL_IMG_KEY = 'mockup-wall-image-v1', CUSTOM_INT = { id: 'custom', name: 'Your image', color: '#ffffff', custom: true };
let wallImg = null, wallTex = null, wallImgVer = 0;
function setWallImage(im) {
  wallImg = im; wallImgVer++;
  wallTex?.dispose(); wallTex = null;
  if (im) { wallTex = new THREE.Texture(im); wallTex.colorSpace = THREE.SRGBColorSpace; wallTex.flipY = false; wallTex.anisotropy = 8; wallTex.needsUpdate = true; }
}
/** fit the uploaded image on the wall: "fill" covers the whole visible wall once, "tile" repeats it at the chosen size */
function fitWallTex() {
  if (!wallTex || !wallImg) return;
  // the wall plane is 10 m wide and 3 m tall (u: left→right, v: top→bottom), starting 0.1 m below the table top
  const geo = N.Wall.geometry; if (!geo.boundingBox) geo.computeBoundingBox();
  const g = geo.boundingBox, ww = Math.max(g.max.x - g.min.x, g.max.z - g.min.z), wh = g.max.y - g.min.y, y0 = g.min.y;
  const imAR = wallImg.width / wallImg.height, k = S.wallImgScale || 1;
  if (S.wallImgMode === 'tile') {
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    const tileH = 0.5 * k, tileW = tileH * imAR;                                   // tile height in metres
    wallTex.repeat.set(ww / tileW, wh / tileH); wallTex.offset.set(0, 0);
  } else {
    // one picture centred behind the device, big enough to fill what the camera sees; "size" scales it, "height" moves it
    const visW = 2.4 * k, visH = visW / imAR, yc = S.wallImgY ?? 0.45;
    const uw = visW / ww, u0 = 0.5 + (S.wallImgX || 0) / ww - uw / 2, vh = visH / wh, vTop = 1 - (yc + visH / 2 - y0) / wh;
    wallTex.repeat.set(1 / uw, 1 / vh); wallTex.offset.set(-u0 / uw, -vTop / vh);
    // past its edges: room photos continue their plain wall and skirting board; your own image continues mirrored
    wallTex.wrapS = wallTex.wrapT = S.wallPreset ? THREE.ClampToEdgeWrapping : THREE.MirroredRepeatWrapping;
  }
  wallTex.needsUpdate = true;
}
try {
  const d = localStorage.getItem(WALL_IMG_KEY);
  if (S.wallPreset && WALL_PRESETS.some((w) => w.id === S.wallPreset)) setTimeout(() => loadWallPreset(S.wallPreset, false));
  else if (d) { const im = new Image(); im.onload = () => { setWallImage(im); lookKey = ''; applyScene?.(); }; im.src = d; }
  else if (S.interior === 'custom') S.interior = 'none';
} catch {}
const curInt = () => S.interior === 'custom' ? CUSTOM_INT : INT.find((s) => s.id === S.interior) || INT[0];
/* "Bottom block": the concrete plinth from the supplied file (its top carries a baked soft shadow) */
let blockObj = null, blockLoading = false;
async function ensureBlock() {
  if (blockObj || blockLoading) return; blockLoading = true;
  try {
    const g = await gltfLoader.loadAsync('models/devices/bottom.glb'); g.scene.updateMatrixWorld(true);
    let mesh = null; g.scene.traverse((o) => { if (o.isMesh && o.name === 'Box001') mesh = o; });
    const geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox(); const bb = geo.boundingBox;
    // put the file's own laptop position (x 3.79, z 1.62) at the origin and its top face at y = 0
    geo.translate(-3.79, -bb.max.y - 0.0004, -1.62);
    geo.computeBoundingBox();
    const map = mesh.material.map; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, toneMapped: false }));
    const sh = new THREE.Mesh(geo, new THREE.ShadowMaterial({ opacity: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    sh.receiveShadow = true; sh.renderOrder = 1; m.add(sh); m.userData.sh = sh; m.userData.h = bb.max.y - bb.min.y; m.userData.w = bb.max.x - bb.min.x;
    // same-size box that wears the chosen surface material (walnut, marble, white board…)
    const bw = bb.max.x - bb.min.x, bh = bb.max.y - bb.min.y, bd = bb.max.z - bb.min.z, bc = geo.boundingBox.getCenter(new THREE.Vector3());
    const ag = new THREE.BoxGeometry(bw, bh, bd); ag.translate(bc.x, bc.y, bc.z);
    const alt = new THREE.Mesh(ag, N.Table.material); alt.castShadow = true; alt.receiveShadow = true; alt.visible = false;
    m.castShadow = true; scene.add(m, alt); blockObj = m; N.Block = m; m.userData.alt = alt;
  } catch (e) { setStatus('Could not load the bottom block: ' + e.message, true); }
  blockLoading = false; applyScene();
}
/* "Studio wood": the domed wood table from the supplied file, with its baked studio-light falloff */
let studioObj = null, studioLoading = false;
function placeStudio() {                                       // slide / rotate the table, then drop it so its surface is at y = 0 under the device
  const m = studioObj; m.rotation.y = rad(S.studioRot); m.position.set(0, 0, S.studioZ * (S.tableScale || 1)); m.updateMatrixWorld(true);   // table size scales around the device
  const hit = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(m)[0];
  m.position.y = (hit ? -hit.point.y : 0) - (S.block && blockObj ? blockObj.userData.h * (S.blockScale || 1) * Math.max(0.5, foot.w / 0.391) : 0);
}
async function ensureStudio() {
  if (studioObj || studioLoading) return; studioLoading = true;
  try {
    const g = await gltfLoader.loadAsync('models/devices/table-scene.glb'); g.scene.updateMatrixWorld(true);
    let mesh = null; g.scene.traverse((o) => { if (o.isMesh && o.name === 'CONVESSO-002') mesh = o; });
    const geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox(); const c = geo.boundingBox.getCenter(new THREE.Vector3()); geo.translate(-c.x, 0, -c.z);
    geo.scale(9, 0.1, 9);                                   // wide and nearly flat so the laptop sits level
    const map = mesh.material.map; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, toneMapped: false, side: THREE.DoubleSide }));
    const sh = new THREE.Mesh(geo, new THREE.ShadowMaterial({ opacity: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    sh.receiveShadow = true; sh.renderOrder = 1; m.add(sh); m.userData.sh = sh; m.receiveShadow = true;
    geo.computeBoundingBox(); m.userData.half = (geo.boundingBox.max.z - geo.boundingBox.min.z) / 2;
    scene.add(m); studioObj = m; N.Studio = m;
  } catch (e) { setStatus('Could not load the studio table: ' + e.message, true); }
  studioLoading = false; applyScene();
}
function applyLook() {
  if (S.block && !blockObj) ensureBlock();
  if (S.surface === 'studio' && !studioObj) ensureStudio();
  const key = S.surface + '|' + S.interior + (S.interior === 'custom' ? '|' + wallImgVer + S.wallImgMode + S.wallImgScale + '|' + S.wallImgY + '|' + S.wallImgX + '|' + S.wallPreset : ''); if (key === lookKey) return; lookKey = key;
  const tm = N.Table.material, sp = curSurf(), rp = sp.repeat || [1, 1];
  if (sp.map) {
    tm.map = tex(sp.map, true, rp); tm.normalMap = sp.normal ? tex(sp.normal, false, rp) : null; tm.roughness = sp.rough; tm.clearcoat = 0;
  } else { tm.map = orig.tMap; tm.normalMap = orig.tNormal; tm.roughness = orig.tRough; tm.clearcoat = orig.tCoat; }
  tm.needsUpdate = true;
  const wm = N.Wall.material, ip = curInt();
  if (ip.custom) { fitWallTex(); wm.map = wallTex; }
  else wm.map = ip.map ? tex(ip.map, true, [5, 3]) : null;
  wm.needsUpdate = true;
}

/* soft contact shadows so the laptop looks placed on the surface (3 layers: edge occlusion, mid, wide) */
function shadowTex(w, h, spread, r) {
  const n = 192, Wp = w + 4 * spread, Hp = h + 4 * spread, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), id = g.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const px = Math.abs(((i + 0.5) / n - 0.5) * Wp) - w / 2 + r, py = Math.abs(((j + 0.5) / n - 0.5) * Hp) - h / 2 + r;
    const sdf = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r;
    const edge = Math.min(1, (2 * spread - Math.max(sdf, 0)) / spread);          // fade to exactly 0 at the plane border
    const a = sdf <= 0 ? 1 : Math.exp(-3 * sdf / spread) * Math.max(0, Math.min(1, edge));
    id.data.set([0, 0, 0, Math.round(a * 255)], (j * n + i) * 4);
  }
  g.putImageData(id, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let contactLayers = [];
const CONTACT_DEF = [
  { grow: -0.006, spread: 0.010, r: 0.012, o: 0.85, off: 0.000, y: 0.0011 },   // dark line right under the edges
  { grow: 0.000, spread: 0.030, r: 0.020, o: 0.40, off: 0.010, y: 0.0010 },
  { grow: 0.040, spread: 0.090, r: 0.040, o: 0.22, off: 0.028, y: 0.0009 },
];
function buildContact() {
  contactLayers.forEach((m) => { scene.remove(m); m.material.map.dispose(); m.material.dispose(); m.geometry.dispose(); });
  contactLayers = CONTACT_DEF.map((L) => {
    const gw = Math.max(0.02, foot.w + L.grow), gd = Math.max(0.02, foot.d + L.grow);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex(gw, gd, L.spread, Math.min(L.r, gw / 2, gd / 2)), transparent: true, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = L.y; m.renderOrder = 2; m.userData = { ...L, bw: gw + 4 * L.spread, bd: gd + 4 * L.spread };
    scene.add(m); return m;
  });
}
function applyContact() {
  const lift = Math.max(0, S.py), k = S.contact / (1 + lift * 14), sc = 1 + lift * 3;
  const yaw = rad(S.ry), cs = Math.cos(yaw), sn = Math.sin(yaw), la = rad(S.keyAz);
  contactLayers.forEach((m, i) => {
    const u = m.userData;
    m.position.x = S.px + foot.cx * cs + foot.cz * sn - Math.sin(la) * u.off;
    m.position.z = S.pz - foot.cx * sn + foot.cz * cs - Math.cos(la) * u.off;
    m.rotation.z = yaw; m.scale.set(u.bw * sc, u.bd * sc, 1);
    m.material.opacity = Math.min(1, u.o * (i === 0 ? k * k : k));
  });
}

function applyScene() {
  applyLook(); applyContact();
  if (dev.hingeNode) dev.hingeNode.rotation[dev.cfg.hinge.axis] = dev.hingeRest + dev.cfg.hinge.sign * rad(S.lid - dev.cfg.hinge.rest);
  N.Laptop.rotation.set(rad(S.rx), rad(S.ry), rad(S.rz));
  N.Laptop.position.set(S.px, S.py, S.pz);
  dev.bodyMats.forEach((m) => m.color.copy(S.bodyColor ? new THREE.Color(S.bodyColor) : orig.body));
  const ip = curInt();
  N.Wall.material.color.copy(S.wallColor ? new THREE.Color(S.wallColor) : ip.color ? new THREE.Color(ip.color) : orig.wall);
  N.Table.material.color.set(S.tableTint); if (N.Ground) N.Ground.material.color.set(S.tableTint);

  const original = S.bgMode === 'original';
  N.Wall.visible = original && ip.id !== 'none';
  const useGround = !!N.Ground && S.surface === 'default', useStudio = !!studioObj && S.surface === 'studio';
  const bs = (S.blockScale || 1) * Math.max(0.5, foot.w / 0.391);          // file's own laptop is 0.39 m wide
  const blockOn = !!blockObj && S.block, drop = blockOn ? blockObj.userData.h * bs : 0;
  if (blockObj) {
    const useAlt = blockOn && S.blockSurface && S.surface !== 'default' && S.surface !== 'studio', alt = blockObj.userData.alt;
    blockObj.visible = blockOn && !useAlt; alt.visible = useAlt && S.tableShow;
    [blockObj, alt].forEach((o) => { o.scale.setScalar(bs); o.position.set(S.blockX, 0, S.blockZ); });
    blockObj.userData.sh.material.opacity = Math.min(1, S.shadow * 0.9);
  }
  if (N.Wall.userData.y0 === undefined) N.Wall.userData.y0 = N.Wall.position.y;
  N.Wall.position.y = N.Wall.userData.y0 - drop;                          // wall always starts at the table level
  N.Table.position.y = -drop; if (N.Ground) N.Ground.position.y = (dev.groundBase ?? 0) - drop;
  // table size: shrink / grow every table surface around the device (height stays the same)
  const ts = S.tableScale || 1;
  N.Table.scale.set(ts, 1, ts);
  if (N.Ground) { if (!N.Ground.userData.s0) N.Ground.userData.s0 = N.Ground.scale.clone(); N.Ground.scale.set(N.Ground.userData.s0.x * ts, N.Ground.userData.s0.y, N.Ground.userData.s0.z * ts); }
  if (studioObj) studioObj.scale.set(ts, 1, ts);
  N.Wall.position.z = useStudio ? (S.studioZ - studioObj.userData.half) * ts + 0.01 : N.Wall.userData.z;   // wall meets the table's back edge
  if (N.Ground && S.tableShow && useGround && !blockOn && ts < 1) {                            // smaller mockup ground: bring the wall forward to its back edge
    const wg = N.Wall.geometry; if (!wg.boundingBox) wg.computeBoundingBox();
    N.Ground.updateMatrixWorld(true); const gb = new THREE.Box3().setFromObject(N.Ground);
    N.Wall.position.z = Math.max(N.Wall.position.z, gb.min.z - wg.boundingBox.min.z + 0.002);
  }
  if (S.tableShow && !useGround && !useStudio && !blockOn) {               // flat table: stand the wall right on its back edge (no dark gap behind it)
    const tg = N.Table.geometry, wg = N.Wall.geometry; if (!tg.boundingBox) tg.computeBoundingBox(); if (!wg.boundingBox) wg.computeBoundingBox();
    N.Wall.position.z = N.Table.position.z + tg.boundingBox.min.z * N.Table.scale.z - wg.boundingBox.min.z + 0.002;
  }
  N.Table.visible = S.tableShow && !useGround && !useStudio && !blockOn;
  if (studioObj) { studioObj.visible = S.tableShow && useStudio && !blockOn; placeStudio(); studioObj.userData.sh.material.opacity = Math.min(1, S.shadow * 0.9); }
  if (N.Ground) { N.Ground.visible = S.tableShow && useGround && !blockOn; N.Ground.userData.sh.material.opacity = Math.min(1, S.shadow * 0.9); }
  contactLayers.forEach((m) => { m.visible = !(useGround && S.tableShow) && !blockOn; });
  catcher.visible = !S.tableShow || blockOn; catcher.position.y = 0.0004 - drop;   // with the block on, only a soft shadow remains on the backdrop
  scene.background = original ? new THREE.Color(ip.id === 'none' || ip.map || ip.custom ? 0x141416 : (S.wallColor || ip.color || '#ecdfc8')) : S.bgMode === 'transparent' ? null : bgTex;

  dribMat.color.setScalar(S.brightness);
  dbScene.background = S.bgMode === 'transparent' ? null : S.bgMode === 'original' ? new THREE.Color(0xffffff) : bgTex;
  buildDribFrame();
  dribShadow.material.opacity = S.dribShadow; dribShadow.visible = S.dribShadow > 0;
  renderer.toneMappingExposure = S.exposure;
  scene.environmentIntensity = S.env;
  keyLight.intensity = S.key; keyLight.color.set(S.keyColor);
  const a = rad(S.keyAz);
  const ke = rad(S.keyEl);
  keyLight.position.set(Math.sin(a) * Math.cos(ke) * 2, Math.sin(ke) * 2, Math.cos(a) * Math.cos(ke) * 2);
  keyLight.target.position.set(0, 0, -0.02);
  fillLight.intensity = S.fill_;
  keyLight.shadow.intensity = S.shadow; catcher.material.opacity = S.shadow;
  screenMat.color.setScalar(S.brightness); coverMat.color.setScalar(S.brightness);
  video.playbackRate = S.speed; video.muted = !S.sound;
  renderer.setClearAlpha(S.bgMode === 'transparent' ? 0 : 1);
  updateOverlays();
}

/* ---------------- keyframes ---------------- */
const ANIM_G = ['rx', 'ry', 'rz', 'px', 'py', 'pz', 'lid', 'keyAz', 'keyEl', 'key'];
const ANIM_C = ['az', 'el', 'dist', 'tx', 'ty', 'fov'];
const curTs = () => timeNow() / S.speed;
function snapshotKey(t) { const v = {}; ANIM_G.forEach((k) => { v[k] = S[k]; }); return { t, v, c: JSON.parse(JSON.stringify(S.cams)) }; }
function toggleKey() {
  const t = Math.round(curTs() * 100) / 100, i = S.kf.findIndex((k) => Math.abs(k.t - t) < 0.06);
  if (i >= 0) S.kf.splice(i, 1); else { S.kf.push(snapshotKey(t)); S.kf.sort((x, y) => x.t - y.t); }
  save(); tickKey = '';
}
function applyAnim(ts) {
  const kf = S.kf; if (!kf.length) return;
  let a = kf[0], b = kf[0], p = 0;
  if (ts >= kf[kf.length - 1].t) a = b = kf[kf.length - 1];
  else if (ts > kf[0].t) for (let i = 0; i < kf.length - 1; i++) if (ts <= kf[i + 1].t) { a = kf[i]; b = kf[i + 1]; p = (ts - a.t) / (b.t - a.t); break; }
  const e = p * p * (3 - 2 * p), L = (x, y) => x + (y - x) * e;
  ANIM_G.forEach((k) => { S[k] = L(a.v[k], b.v[k]); });
  Object.keys(S.cams).forEach((l) => { if (a.c[l] && b.c[l]) ANIM_C.forEach((k) => { S.cams[l][k] = L(a.c[l][k], b.c[l][k]); }); });
  applyScene();
}

function applyCamera(p = 0) {
  const c = cam();
  let az = c.az, el = c.el, dist = c.dist, tx = c.tx;
  if (S.motion !== 'none') {
    const e = p * p * (3 - 2 * p), k = S.motionAmt / 100;
    switch (S.motion) {
      case 'orbit': az += 80 * k * (e - 0.5); break;
      case 'pushin': dist *= 1 - 0.5 * k * e; break;
      case 'pullout': dist *= 1 - 0.5 * k * (1 - e); break;
      case 'pan': tx += 0.35 * k * (e - 0.5); break;
      case 'rise': el += 40 * k * (e - 0.5); break;
      case 'float': az += 6 * k * Math.sin(p * Math.PI * 2); el += 3 * k * Math.sin(p * Math.PI * 4); break;
    }
  }
  const A = rad(az), E = rad(el);
  camera.fov = c.fov;
  orbit.target.set(tx, c.ty, c.tz);
  camera.position.set(tx + dist * Math.sin(A) * Math.cos(E), c.ty + dist * Math.sin(E), c.tz + dist * Math.cos(A) * Math.cos(E));
  camera.lookAt(orbit.target);
  camera.updateProjectionMatrix();
}

function syncCamFromOrbit() {
  const c = cam(), o = camera.position.clone().sub(orbit.target);
  c.dist = o.length(); c.el = THREE.MathUtils.radToDeg(Math.asin(o.y / c.dist)); c.az = THREE.MathUtils.radToDeg(Math.atan2(o.x, o.z));
  c.tx = orbit.target.x; c.ty = orbit.target.y; c.tz = orbit.target.z;
  save(); refreshControls();
}
let userOrbiting = false;
orbit.addEventListener('start', () => { userOrbiting = true; });
orbit.addEventListener('end', () => { userOrbiting = false; syncCamFromOrbit(); });

/* ------------------------------------------------------------------ sizing / layout */
const stage = document.getElementById('stage');
function setBuffer(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); ovCam.left = -w / h; ovCam.right = w / h; ovCam.updateProjectionMatrix(); updateOverlays(); }
function fitPreview() {
  const r = LAYOUTS[S.layout].r;
  const aw = stage.clientWidth - 24, ah = stage.clientHeight - 24;
  let w = aw, h = aw / r; if (h > ah) { h = ah; w = ah * r; }
  canvas.style.width = Math.max(10, w) + 'px'; canvas.style.height = Math.max(10, h) + 'px';
  const sf = $('safe'); sf.hidden = !S.safe;
  Object.assign(sf.style, { width: w * 0.88 + 'px', height: h * 0.8 + 'px', left: (stage.clientWidth - w * 0.88) / 2 + 'px', top: (stage.clientHeight - h * 0.8) / 2 + 'px' });
  const long = 1400, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = r >= 1 ? long : Math.round(long * r), bh = r >= 1 ? Math.round(long / r) : long;
  setBuffer(Math.round(bw * (dpr > 1 ? 1 : 1)), Math.round(bh));
}
new ResizeObserver(fitPreview).observe(stage);
function fitLaptop(l = S.layout) {
  const c = S.cams[l], r = LAYOUTS[l].r, R = dev.R;
  const v = rad(c.fov), h = 2 * Math.atan(Math.tan(v / 2) * r);
  c.dist = Math.min(2, Math.max(0.25, R / Math.sin(Math.min(v, h) / 2)));
  c.tx = 0; c.ty = dev.ty; c.tz = 0;
}
document.querySelectorAll('#modeTabs button').forEach((b) => b.onclick = () => setLayout(b.dataset.view === 'dribbble' ? 'd' : (S.lastLayout && S.lastLayout !== 'd' ? S.lastLayout : 'p')));
function setLayout(l) {
  if (l !== S.layout && S.autoFit) fitLaptop(l);
  S.layout = l; save(); syncScreen();
  $('app').classList.toggle('dribbble', l === 'd');
  document.querySelectorAll('#modeTabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === (l === 'd' ? 'dribbble' : 'mockup')));
  if (l !== 'd') S.lastLayout = l;
  document.querySelectorAll('button[data-l]').forEach((b) => b.classList.toggle('on', b.dataset.l === l));
  restoreShot(); fitPreview(); buildBackground(); refreshControls(); checkFit();
}

async function switchDevice(id) {
  if (!DEVICES[id] || id === S.device && dev?.id === id) return;
  setStatus(`Loading ${DEVICES[id].name}…`);
  try { await loadDevice(id); } catch (e) { setStatus('Could not load that device: ' + e.message, true); return; }
  S.device = id; S.kf = []; S.rx = S.ry = S.rz = S.px = S.py = S.pz = 0; S.bodyColor = null; S.finish = 'Silver';
  if (dev.cfg.lid != null) S.lid = dev.cfg.lid;
  Object.keys(LAYOUTS).forEach((l) => { S.cams[l] = { ...CAM_DEF[l], el: dev.cfg.el }; fitLaptop(l); });
  buildContact(); applyScene(); renderMocks(); refreshControls(); save(); setStatus(`${DEVICES[id].name} ready`);
}

/* ------------------------------------------------------------------ UI builder */
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); kids.forEach((k) => e.append(k)); return e; };
const refreshers = [];
const refreshControls = () => refreshers.forEach((f) => f());
function setStatus(msg, err = false) { const s = $('status'); s.textContent = msg; s.title = msg; s.classList.toggle('err', err); }

function section(parent, title, open = true, mode = 'both') {
  const d = el('div', { className: 'sec' + (open ? '' : ' closed') });
  const b = el('div', { className: 'sec-body' });
  d.append(el('div', { className: 'sec-title', textContent: title, onclick: () => d.classList.toggle('closed') }), b);
  d.dataset.mode = mode; parent.append(d); return b;
}
const lbl = (p, t) => p.append(el('div', { className: 'lbl', textContent: t }));
const note = (p, t) => p.append(el('p', { className: 'note', textContent: t }));
function btn(p, text, fn, cls = '') { const b = el('button', { className: 'btn ' + cls, textContent: text, onclick: (e) => fn(e.currentTarget) }); p.append(b); return b; }

function slider(p, label, o) {
  const i = el('input', { type: 'range', min: o.min, max: o.max, step: o.step ?? 1 });
  const v = el('b'); const w = el('div', { className: 'slider' }, [el('div', { className: 'fill' }), el('div', { className: 't' }, [el('span', { textContent: label }), v]), i]);
  const show = () => { const x = o.get(); i.value = x; w.style.setProperty('--p', ((x - o.min) / (o.max - o.min) * 100) + '%'); v.textContent = (o.fmt || ((n) => +(+n).toFixed(2)))(x); };
  i.oninput = () => { o.set(+i.value); show(); save(); };
  p.append(w); refreshers.push(show); show();
}
function seg(p, items, o) {
  const w = el('div', { className: 'seg' });
  const bs = items.map(([val, text]) => { const b = el('button', { textContent: text, onclick: () => { o.set(val); save(); refreshControls(); } }); if (o.data) b.dataset[o.data] = val; w.append(b); return [val, b]; });
  const show = () => bs.forEach(([val, b]) => b.classList.toggle('on', String(val) === String(o.get())));
  p.append(w); refreshers.push(show); show();
}
function field(p, label, input, cls = '') { const f = el('label', { className: 'field ' + cls }, [el('span', { textContent: label }), input]); p.append(f); return f; }
function selectField(p, label, o) {
  const s = el('select'); o.options.forEach(([v, t]) => s.append(el('option', { value: v, textContent: t })));
  s.onchange = () => { o.set(s.value); save(); refreshControls(); };
  field(p, label, s, 'select'); const show = () => { s.value = o.get(); }; refreshers.push(show); show();
}
function colorField(p, label, o) {
  const i = el('input', { type: 'color' });
  const show = () => { i.value = o.get() || o.fallback(); };
  i.oninput = () => { o.set(i.value); save(); };
  const f = field(p, label, i);
  if (o.resettable) f.append(el('button', { className: 'btn', textContent: '↺', title: 'Back to original', style: 'padding:2px 8px', onclick: (e) => { e.preventDefault(); o.set(null); save(); show(); } }));
  refreshers.push(show); show();
}
function checkField(p, label, o) {
  const i = el('input', { type: 'checkbox' }); i.onchange = () => { o.set(i.checked); save(); refreshControls(); };
  field(p, label, i); const show = () => { i.checked = !!o.get(); }; refreshers.push(show); show();
}
function textField(p, label, o, ph = '') {
  const i = el('input', { type: 'text', placeholder: ph, spellcheck: false }); i.oninput = () => { o.set(i.value); save(); };
  field(p, label, i, 'wide'); refreshers.push(() => { if (document.activeElement !== i) i.value = o.get(); }); i.value = o.get(); return i;
}
const A = (key) => ({ get: () => S[key], set: (v) => { S[key] = v; applyScene(); } });
const B = (key) => ({ get: () => S[key], set: (v) => { S[key] = v; buildBackground(); } });
const BG = (key) => ({ get: () => S[key], set: (v) => {
  S[key] = v;
  if (S.bgMode === 'original' || S.bgMode === 'transparent') { S.bgMode = 'gradient'; S.tableShow = false; refreshControls(); }
  buildBackground();
} });
const OV = (key) => ({ get: () => S[key], set: (v) => { S[key] = v; updateOverlays(); } });
const C = (key) => ({ get: () => cam()[key], set: (v) => { cam()[key] = v; } });

/* --- left: mockups & projects */
const MOCKS = [['All'], ['Favourites'], ['-'], ['Instagram Story', 'story'], ['iPad Pro', 'soon'], ['iPhone 17 Pro', 'soon'], ['MacBook Pro 14"', 'dev:macbook'], ['MacBook Pro 14" (classic)', 'dev:macbook-classic'], ['Pro Display XDR', 'soon'], ['Universal', 'soon'], ['iPad Air', 'soon'], ['iPhone Air', 'soon'], ['Scenes', 'soon'], ['Studio Display', 'soon']];
function renderMocks() {
  const q = $('search').value.toLowerCase(), ul = $('mockList'); ul.innerHTML = '';
  MOCKS.forEach(([name, kind]) => {
    if (name === '-') return ul.append(el('li', { className: 'hr' }));
    if (q && !name.toLowerCase().includes(q)) return;
    const id = kind?.startsWith('dev:') ? kind.slice(4) : null;
    ul.append(el('li', { textContent: name, className: kind === 'soon' ? 'soon' : id && id === S.device ? 'on' : '',
      onclick: () => { if (id) switchDevice(id); else if (kind === 'story') { setLayout('v'); setStatus('Instagram Story → 9:16 layout'); } else if (kind === 'dribbble') { setLayout('d'); setStatus('Dribbble shot → 1600×1200, frame 1440×1040'); } } }));
  });
}
$('search').oninput = renderMocks; renderMocks();
const PROJ_KEY = 'mockup-projects-v1';
const projects = () => { try { return JSON.parse(localStorage.getItem(PROJ_KEY) || '[]'); } catch { return []; } };
function renderProjects() {
  const ul = $('projList'); ul.innerHTML = ''; const list = projects();
  if (!list.length) ul.append(el('li', { className: 'soon', textContent: 'No saved projects', style: 'cursor:default' }));
  list.forEach((p, i) => ul.append(el('li', { className: 'proj', textContent: p.name, onclick: (e) => {
    if (e.offsetX > e.currentTarget.clientWidth - 30) { list.splice(i, 1); localStorage.setItem(PROJ_KEY, JSON.stringify(list)); renderProjects(); return; }
    S = { ...defaults(), ...p.state }; save(); setLayout(S.layout); buildBackground(); refreshControls(); setStatus(`Loaded project “${p.name}”`);
  } })));
}
document.querySelectorAll('.tabs2 button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs2 button').forEach((x) => x.classList.toggle('on', x === b));
  $('tabMockups').hidden = b.dataset.tab !== 'mockups'; $('tabProjects').hidden = b.dataset.tab !== 'projects'; renderProjects();
});
$('btnSaveProject').onclick = () => {
  const name = prompt('Project name', 'Project ' + (projects().length + 1)); if (!name) return;
  const list = projects(); list.push({ name, state: JSON.parse(JSON.stringify(S)) }); localStorage.setItem(PROJ_KEY, JSON.stringify(list)); renderProjects(); setStatus(`Saved “${name}”`);
};

/* --- second column: transform, light, camera */
{
  const c = $('colTransform');
  const t = section(c, 'Transform');
  slider(t, 'X Rotation', { ...A('rx'), min: -90, max: 90, fmt: (v) => Math.round(v) + '°' });
  slider(t, 'Y Rotation', { ...A('ry'), min: -180, max: 180, fmt: (v) => Math.round(v) + '°' });
  slider(t, 'Z Rotation', { ...A('rz'), min: -90, max: 90, fmt: (v) => Math.round(v) + '°' });
  slider(t, 'X Position', { ...A('px'), min: -0.5, max: 0.5, step: 0.005 });
  slider(t, 'Y Position', { ...A('py'), min: -0.1, max: 0.6, step: 0.005 });
  slider(t, 'Z Position', { ...A('pz'), min: -0.6, max: 0.6, step: 0.005 });
  slider(t, 'Field of view', { ...C('fov'), min: 12, max: 90, fmt: (v) => Math.round(v) + '°' });
  slider(t, 'Lid', { ...A('lid'), min: 0, max: 135, fmt: (v) => Math.round(v) + '°' });
  const lidEl = t.lastElementChild; refreshers.push(() => { lidEl.style.display = dev.hingeNode ? '' : 'none'; });

  const l = section(c, 'Light direction');
  const pad = el('div', { className: 'pad' }), dot = el('i'); pad.append(dot); l.append(pad);
  const showPad = () => { dot.style.left = ((S.keyAz / 180 + 1) / 2 * 100) + '%'; dot.style.top = ((1 - (S.keyEl - 10) / 75) * 100) + '%'; };
  const movePad = (e) => { const r = pad.getBoundingClientRect(); const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    S.keyAz = (x * 2 - 1) * 180; S.keyEl = 10 + (1 - y) * 75; applyScene(); showPad(); save(); };
  pad.onpointerdown = (e) => { pad.setPointerCapture(e.pointerId); movePad(e); pad.onpointermove = movePad; };
  pad.onpointerup = () => { pad.onpointermove = null; };
  refreshers.push(showPad); showPad();
  slider(l, 'Intensity', { ...A('key'), min: 0, max: 6, step: 0.05 });
  colorField(l, 'Colour', A('keyColor'));
  slider(l, 'Soft fill', { ...A('fill_'), min: 0, max: 2, step: 0.02 });
  slider(l, 'Reflections', { ...A('env'), min: 0, max: 2.5, step: 0.05 });
  slider(l, 'Screen reflection', { ...A('glow'), min: 0, max: 3, step: 0.05, fmt: (v) => (v ? v.toFixed(2) : 'Off') });
  note(l, 'Light from the screen on the keyboard and the table. Its colour follows the video as it plays.');
  slider(l, 'Contact shadow', { ...A('contact'), min: 0, max: 1.5, step: 0.02 });
  slider(l, 'Shadow', { ...A('shadow'), min: 0, max: 1, step: 0.01 });

  const k = section(c, 'Camera', false);
  selectField(k, 'View', { get: () => '', set: (v) => { if (v) Object.assign(cam(), CAM_PRESETS[v]); }, options: [['', 'Choose…'], ...Object.keys(CAM_PRESETS).map((x) => [x, x])] });
  slider(k, 'Angle', { ...C('az'), min: -180, max: 180, fmt: (v) => Math.round(v) + '°' });
  slider(k, 'Height', { ...C('el'), min: 0, max: 88, fmt: (v) => Math.round(v) + '°' });
  slider(k, 'Distance', { ...C('dist'), min: 0.25, max: 2, step: 0.01 });
  slider(k, 'Shift X', { ...C('tx'), min: -0.4, max: 0.4, step: 0.005 });
  slider(k, 'Shift Y', { ...C('ty'), min: -0.1, max: 0.4, step: 0.005 });
  btn(k, 'Reset camera', () => { S.cams[S.layout] = { ...CAM_DEF[S.layout] }; save(); refreshControls(); });
  note(k, 'Drag the preview to orbit, scroll to zoom.');
}

/* --- right column */
{
  const c = $('colRight');
  const m = section(c, 'Media');
  btn(m, 'Upload video or image…', () => $('fileVideo').click(), 'primary');
  lbl(m, 'Capture a website');
  const urlIn = el('input', { type: 'text', placeholder: 'https://your-website.com', spellcheck: false }); field(m, 'Link', urlIn, 'wide');
  let dur = 0, spd = 700;
  slider(m, 'Scroll length', { get: () => dur, set: (v) => { dur = v; }, min: 0, max: 40, fmt: (v) => (v ? v + 's' : 'Auto') });
  selectField(m, 'Pauses & hovers', { get: () => String(S.interact), set: (v) => { S.interact = +v; }, options: [['0', 'Off — plain scroll'], ['1', 'Light'], ['2', 'Natural'], ['3', 'Lively']] });
  note(m, 'While recording, it now and then pauses and points at things on the page (menu, buttons, cards, images, accordions), picked at random from the site’s structure. Never clicks links.');
  slider(m, 'Scroll speed (recording)', { get: () => spd, set: (v) => { spd = v; }, min: 200, max: 2500, step: 50, fmt: (v) => v + ' px/s' });
  seg(m, [[400, 'Slow'], [700, 'Normal'], [1100, 'Fast'], [1800, 'Very fast']], { get: () => spd, set: (v) => { spd = v; } });
  lbl(m, 'Recording size');
  checkField(m, 'Match the frame (auto)', { get: () => S.capAuto, set: (v) => { S.capAuto = v; } });
  const sizeNote = el('p', { className: 'note' }); m.append(sizeNote);
  slider(m, 'Width', { get: () => S.capW, set: (v) => { S.capW = v; }, min: 800, max: 2560, step: 10, fmt: (v) => v + ' px' });
  const wEl = m.lastElementChild; slider(m, 'Height', { get: () => S.capH, set: (v) => { S.capH = v; }, min: 500, max: 2000, step: 10, fmt: (v) => v + ' px' });
  const hEl = m.lastElementChild;
  refreshers.push(() => { const z = captureSize(); sizeNote.textContent = (S.capAuto ? 'Recording at ' : 'Recording at (manual) ') + z.width + '×' + z.height + (S.layout === 'd' ? ' — the Dribbble frame' : ' — the screen shape'); wEl.style.display = hEl.style.display = S.capAuto ? 'none' : ''; });
  const row = el('div', { className: 'row2' }); m.append(row);
  btn(row, 'Record scroll', (b) => captureSite(urlIn.value.trim(), 'scroll', dur, b, spd), 'primary');
  btn(row, 'Screenshot', (b) => captureSite(urlIn.value.trim(), 'screenshot', dur, b));
  note(m, 'Works with any link: live websites and localhost pages (e.g. localhost:3000).');
  selectField(m, 'Fit', { get: () => S.fit, set: (v) => { S.fit = v; }, options: [['cover', 'Fill (crop)'], ['contain', 'Fit'], ['stretch', 'Stretch']] });
  colorField(m, 'Letterbox', A('fill'));
  lbl(m, 'Playback speed (after recording)');
  slider(m, 'Speed', { get: () => S.speed, set: (v) => { S.speed = v; applyScene(); }, min: 0.25, max: 4, step: 0.05, fmt: (v) => v.toFixed(2).replace(/\.?0+$/, '') + '×' });
  seg(m, [[0.5, '0.5×'], [1, '1×'], [1.5, '1.5×'], [2, '2×'], [3, '3×']], { get: () => S.speed, set: (v) => { S.speed = v; applyScene(); } });
  note(m, 'Change this any time after recording: it speeds up or slows down the whole scroll, and the video length follows.');
  slider(m, 'Screen brightness', { ...A('brightness'), min: 0.3, max: 1.4, step: 0.02 });
  checkField(m, 'Loop', { get: () => S.loop, set: (v) => { S.loop = v; } });

  const db = section(c, 'Dribbble shot', true, 'dribbble');
  note(db, '1600×1200 canvas with a flat 1440×1040 frame in the centre. Your video or website recording fills the frame.');
  slider(db, 'Corner radius', { ...A('dribRadius'), min: 0, max: DB.rMax, step: 1, fmt: (v) => Math.round(v) + ' px' });
  seg(db, [[0, '0'], [16, '16'], [24, '24'], [40, '40'], [64, '64']], { get: () => S.dribRadius, set: (v) => { S.dribRadius = v; applyScene(); } });
  slider(db, 'Frame shadow', { ...A('dribShadow'), min: 0, max: 0.5, step: 0.01 });
  lbl(db, 'FPS');
  seg(db, [[15, '15'], [25, '25'], [30, '30'], [60, '60']], { get: () => S.fps, set: (v) => { S.fps = v; } });
  lbl(db, 'Background');
  selectField(db, 'Style', { get: () => S.bgMode, set: (v) => { S.bgMode = v; buildBackground(); },
    options: [['original', 'White'], ['solid', 'Solid colour'], ['gradient', 'Gradient'], ['image', 'Image'], ['transparent', 'Transparent (PNG)']] });
  const dpre = el('div', { style: 'display:grid;grid-template-columns:repeat(7,1fr);gap:6px' }); db.append(dpre);
  [['Sunset', '#ff9a5a', '#c1275e'], ['Ocean', '#0f2027', '#2c9fd9'], ['Violet', '#5b6cff', '#ff7ab6'], ['Mint', '#d4fc79', '#96e6a1'], ['Midnight', '#0b0b12', '#2a2f55'], ['Cream', '#f6eddc', '#d9c3a0'], ['Mono', '#ffffff', '#9a9a9a']].forEach(([n, c1, c2]) =>
    dpre.append(el('button', { title: n, style: `height:30px;border:0;border-radius:8px;cursor:pointer;background:linear-gradient(135deg,${c1},${c2})`,
      onclick: () => { Object.assign(S, { bgMode: 'gradient', bgKind: 'linear', c1, c2, useC3: false, angle: 135 }); buildBackground(); refreshControls(); save(); } })));
  colorField(db, 'Colour 1', B('c1'));
  colorField(db, 'Colour 2', B('c2'));
  slider(db, 'Gradient angle', { ...B('angle'), min: 0, max: 360, fmt: (v) => v + '°' });
  btn(db, 'Upload background image…', () => $('fileBg').click());

  const cv = section(c, 'Canvas', true, 'mockup');
  lbl(cv, 'Aspect');
  seg(cv, Object.entries(LAYOUTS).filter(([k]) => k !== 'd').map(([k, v]) => [k, v.label]), { get: () => S.layout, set: (v) => setLayout(v), data: 'l' });
  checkField(cv, 'Auto-fit on ratio change', { get: () => S.autoFit, set: (v) => { S.autoFit = v; } });
  btn(cv, 'Fit laptop to frame', () => { fitLaptop(); save(); refreshControls(); });
  lbl(cv, 'FPS');
  seg(cv, [[15, '15'], [25, '25'], [30, '30'], [60, '60']], { get: () => S.fps, set: (v) => { S.fps = v; } });
  lbl(cv, 'Safe area');
  seg(cv, [[0, 'Off'], [1, 'On']], { get: () => +S.safe, set: (v) => { S.safe = !!v; fitPreview(); } });

  const bg = section(c, 'Background', true, 'mockup');
  const grid = (items, get, set) => {
    const g = el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px' }); bg.append(g);
    const bs = items.map((it) => {
      const b = el('button', { title: it.name, onclick: () => { set(it.id); S.bgMode = 'original'; S.tableShow = true; if (items === SURF) { S.block = false; } buildBackground(); refreshControls(); save(); },
        style: `position:relative;height:50px;border:2px solid transparent;border-radius:9px;cursor:pointer;background:${it.thumb ? `center/cover url(textures/${it.thumb})` : (it.css || it.color || (it.id === 'default' ? '#2b2b2d' : '#ecdcc0'))}` },
        [el('span', { textContent: it.name, style: 'position:absolute;left:0;right:0;bottom:0;font-size:10px;padding:2px 3px;background:#000a;color:#fff;border-radius:0 0 6px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' })]);
      g.append(b); return [it.id, b];
    });
    refreshers.push(() => bs.forEach(([id, b]) => { b.style.borderColor = id === get() ? '#fff' : 'transparent'; }));
  };
  lbl(bg, 'Scenes (one-click looks)');
  const SCENES = [
    { id: 'block', name: 'Concrete block', set: { block: true, surface: 'default', interior: 'none' }, thumb: 't_concrete.jpg' },
    { id: 'walnut', name: 'Walnut table', set: { block: false, surface: 'walnut', interior: 'none' }, thumb: 't_walnut.jpg' },
    { id: 'studio', name: 'Studio wood', set: { block: false, surface: 'studio', interior: 'none' }, css: 'linear-gradient(120deg,#e0bd94,#9a6a46 50%,#1d1511)' },
    { id: 'cream-oak', name: 'Oak + cream wall', set: { block: false, surface: 'oak', interior: 'cream' }, thumb: 't_oak.jpg' },
    { id: 'ground', name: 'Mockup ground', set: { block: false, surface: 'default', interior: 'none' }, css: '#2b2b2d' },
    { id: 'marble', name: 'Marble block', set: { block: true, blockSurface: true, surface: 'marble', interior: 'white' }, thumb: 't_marble.jpg' },
    { id: 'slate', name: 'Slate + grey wall', set: { block: false, surface: 'slate', interior: 'grey' }, thumb: 't_slate.jpg' },
    { id: 'white', name: 'White board', set: { block: false, surface: 'whiteboard', interior: 'white' }, thumb: 't_whiteboard.jpg' },
    { id: 'brick', name: 'Wood + brick', set: { block: false, surface: 'walnut', interior: 'brick' }, thumb: 't_brick.jpg' },
  ];
  const sg = el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px' }); bg.append(sg);
  const sbs = SCENES.map((sc) => {
    const b = el('button', { title: sc.name,
      onclick: () => { Object.assign(S, { blockSurface: false }, sc.set, { bgMode: 'original', tableShow: true }); buildBackground(); refreshControls(); save(); },
      style: `position:relative;height:50px;border:2px solid transparent;border-radius:9px;cursor:pointer;background:${sc.thumb ? `center/cover url(textures/${sc.thumb})` : sc.css}` },
      [el('span', { textContent: sc.name, style: 'position:absolute;left:0;right:0;bottom:0;font-size:10px;padding:2px 3px;background:#000a;color:#fff;border-radius:0 0 6px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' })]);
    sg.append(b); return [sc, b];
  });
  refreshers.push(() => sbs.forEach(([sc, b]) => { b.style.borderColor = Object.entries(sc.set).every(([k, v]) => S[k] === v) && S.bgMode === 'original' ? '#fff' : 'transparent'; }));
  note(bg, 'Each scene sets the surface, wall and block together. Fine-tune below, or save a look with “Save to project”.');
  lbl(bg, 'Surface (table)');
  grid(SURF, () => S.surface, (v) => { S.surface = v; });
  lbl(bg, 'Interior (wall)');
  grid(INT, () => S.interior, (v) => { S.interior = v; });
  lbl(bg, 'Room photos (wall)');
  const rg = el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px' }); bg.append(rg);
  const rbs = WALL_PRESETS.map((w) => {
    const b = el('button', { title: w.name, onclick: () => loadWallPreset(w.id),
      style: `position:relative;height:50px;border:2px solid transparent;border-radius:9px;cursor:pointer;background:center/cover url(textures/${w.thumb})` },
      [el('span', { textContent: w.name, style: 'position:absolute;left:0;right:0;bottom:0;font-size:10px;padding:2px 3px;background:#000a;color:#fff;border-radius:0 0 6px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' })]);
    rg.append(b); return [w.id, b];
  });
  refreshers.push(() => rbs.forEach(([id, b]) => { b.style.borderColor = S.interior === 'custom' && S.wallPreset === id ? '#fff' : 'transparent'; }));
  const wrow = el('div', { className: 'row2' }); bg.append(wrow);
  btn(wrow, 'Upload wall image…', () => $('fileWall').click(), 'primary');
  const wallRm = btn(wrow, 'Remove', () => {
    setWallImage(null); S.wallPreset = null; try { localStorage.removeItem(WALL_IMG_KEY); } catch {}
    if (S.interior === 'custom') S.interior = 'none'; lookKey = ''; applyScene(); refreshControls(); save();
  });
  const w0 = bg.children.length;
  seg(bg, [['fill', 'Fill wall'], ['tile', 'Tile']], { get: () => S.wallImgMode, set: (v) => { S.wallImgMode = v; applyScene(); } });
  slider(bg, 'Wall image size', { get: () => S.wallImgScale, set: (v) => { S.wallImgScale = v; applyScene(); }, min: 0.3, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' });
  slider(bg, 'Wall image left / right', { get: () => S.wallImgX, set: (v) => { S.wallImgX = v; applyScene(); }, min: -2, max: 2, step: 0.01, fmt: (v) => Math.round(v * 100) + ' cm' });
  slider(bg, 'Wall image height', { get: () => S.wallImgY, set: (v) => { S.wallImgY = v; applyScene(); }, min: -0.2, max: 1.4, step: 0.01, fmt: (v) => Math.round(v * 100) + ' cm' });
  const wallEls = [...bg.children].slice(w0);
  refreshers.push(() => { const on = !!wallImg && S.interior === 'custom'; wallEls.forEach((e) => { e.style.display = on ? '' : 'none'; }); wallRm.style.display = wallImg ? '' : 'none'; });
  lbl(bg, 'Gradient presets');
  const PRE = [['Sunset', '#ff9a5a', '#c1275e'], ['Ocean', '#0f2027', '#2c9fd9'], ['Violet', '#5b6cff', '#ff7ab6'], ['Mint', '#d4fc79', '#96e6a1'], ['Midnight', '#0b0b12', '#2a2f55'], ['Cream', '#f6eddc', '#d9c3a0'], ['Mono', '#ffffff', '#9a9a9a']];
  const pw = el('div', { style: 'display:grid;grid-template-columns:repeat(7,1fr);gap:6px' }); bg.append(pw);
  PRE.forEach(([n, c1, c2]) => pw.append(el('button', { title: n, style: `height:30px;border:0;border-radius:8px;cursor:pointer;background:linear-gradient(135deg,${c1},${c2})`,
    onclick: () => { Object.assign(S, { bgMode: 'gradient', bgKind: 'linear', c1, c2, useC3: false, angle: 135, tableShow: false }); buildBackground(); refreshControls(); save(); } })));
  selectField(bg, 'Style', { get: () => S.bgMode, set: (v) => { S.bgMode = v; if (v !== 'original' && !S._tableTouched) S.tableShow = false; if (v === 'original') S.tableShow = true; buildBackground(); },
    options: [['original', 'Original'], ['solid', 'Solid colour'], ['gradient', 'Gradient'], ['image', 'Image'], ['transparent', 'Transparent (PNG)']] });
  colorField(bg, 'Colour 1', BG('c1'));
  selectField(bg, 'Gradient', { get: () => S.bgKind, set: (v) => { S.bgKind = v; buildBackground(); }, options: [['linear', 'Linear'], ['radial', 'Radial']] });
  colorField(bg, 'Colour 2', BG('c2'));
  checkField(bg, '3rd colour', BG('useC3'));
  colorField(bg, 'Colour 3', BG('c3'));
  slider(bg, 'Angle', { ...BG('angle'), min: 0, max: 360, fmt: (v) => v + '°' });
  btn(bg, 'Upload background image…', () => $('fileBg').click());
  lbl(bg, 'Original scene');
  checkField(bg, 'Show table', { get: () => S.tableShow, set: (v) => { S.tableShow = v; S._tableTouched = true; applyScene(); } });
  slider(bg, 'Table size', { get: () => S.tableScale, set: (v) => { S.tableScale = v; applyScene(); }, min: 0.25, max: 1.5, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' });
  slider(bg, 'Studio table rotation', { get: () => S.studioRot, set: (v) => { S.studioRot = v; applyScene(); }, min: -180, max: 180, fmt: (v) => Math.round(v) + '°' });
  slider(bg, 'Studio light position', { get: () => S.studioZ, set: (v) => { S.studioZ = v; applyScene(); }, min: -1.8, max: 2.2, step: 0.02 });
  lbl(bg, 'Bottom block');
  checkField(bg, 'Show block', { get: () => S.block, set: (v) => { S.block = v; applyScene(); } });
  note(bg, 'The block keeps its original concrete look. Picking a table surface turns it off so you see that surface.');
  checkField(bg, 'Block wears the chosen surface', { get: () => S.blockSurface, set: (v) => { S.blockSurface = v; applyScene(); } });
  slider(bg, 'Block size', { get: () => S.blockScale, set: (v) => { S.blockScale = v; applyScene(); }, min: 0.5, max: 2.5, step: 0.02, fmt: (v) => v.toFixed(2) + '×' });
  slider(bg, 'Block left / right', { get: () => S.blockX, set: (v) => { S.blockX = v; applyScene(); }, min: -0.8, max: 0.8, step: 0.005 });
  slider(bg, 'Block back / front', { get: () => S.blockZ, set: (v) => { S.blockZ = v; applyScene(); }, min: -0.8, max: 0.8, step: 0.005 });
  colorField(bg, 'Table tint', { get: () => S.tableTint, set: (v) => { S.tableTint = v; applyScene(); }, fallback: () => '#ffffff' });
  colorField(bg, 'Wall tint', { get: () => S.wallColor, set: (v) => { S.wallColor = v; applyScene(); }, fallback: () => '#' + orig.wall.getHexString(), resettable: true });
  btn(bg, 'Restore original background', () => { Object.assign(S, { bgMode: 'original', tableShow: true, tableTint: '#ffffff', wallColor: null, _tableTouched: false }); buildBackground(); refreshControls(); save(); });

  const lg = section(c, 'Logo', false);
  const lrow = el('div', { className: 'row2' }); lg.append(lrow);
  btn(lrow, 'Upload logo…', () => $('fileLogo').click(), 'primary');
  btn(lrow, 'Remove', () => { logoImg = null; logoSpr.material.map = null; updateOverlays(); });
  slider(lg, 'Size', { ...OV('logoSize'), min: 0.03, max: 0.6, step: 0.005 });
  slider(lg, 'X', { ...OV('logoX'), min: -1, max: 1, step: 0.01 });
  slider(lg, 'Y', { ...OV('logoY'), min: -1, max: 1, step: 0.01 });
  slider(lg, 'Opacity', { ...OV('logoOp'), min: 0, max: 1, step: 0.01 });

  const tx = section(c, 'Text', false);
  textField(tx, 'Text', { get: () => S.text, set: (v) => { S.text = v; updateOverlays(); } }, 'Add a headline');
  selectField(tx, 'Font', { get: () => S.font, set: (v) => { S.font = v; updateOverlays(); }, options: [['700 Inter, Helvetica, Arial, sans-serif', 'Sans bold'], ['400 Inter, Helvetica, Arial, sans-serif', 'Sans'], ['700 Georgia, "Times New Roman", serif', 'Serif bold'], ['400 Georgia, "Times New Roman", serif', 'Serif'], ['700 "Courier New", monospace', 'Mono']] });
  colorField(tx, 'Colour', OV('textColor'));
  slider(tx, 'Size', { ...OV('textSize'), min: 0.02, max: 0.3, step: 0.005 });
  slider(tx, 'X', { ...OV('textX'), min: -1, max: 1, step: 0.01 });
  slider(tx, 'Y', { ...OV('textY'), min: -1, max: 1, step: 0.01 });

  const au = section(c, 'Audio', false);
  checkField(au, 'Preview sound', { get: () => S.sound, set: (v) => { S.sound = v; applyScene(); } });
  note(au, 'Sound plays in the preview. Exported MP4s are silent for now.');

  const dv = section(c, 'Device', true, 'mockup');
  selectField(dv, '', { get: () => 'mac', set: () => {}, options: [['mac', 'MacBook Pro 14"']] });
  const f0 = dv.children.length;
  lbl(dv, 'Finish');
  const FINISH = { 'Space Black': null, Silver: '#cdd0d5', 'Space Gray': '#8b8c8f', Midnight: '#2e3642', Starlight: '#d8d1c7' };
  selectField(dv, '', { get: () => S.finish, set: (v) => { S.finish = v; S.bodyColor = FINISH[v]; applyScene(); }, options: Object.keys(FINISH).map((k) => [k, k]) });
  colorField(dv, 'Custom colour', { get: () => S.bodyColor, set: (v) => { S.bodyColor = v; S.finish = 'Space Black'; applyScene(); }, fallback: () => '#' + orig.body.getHexString(), resettable: true });
  const finishEls = [...dv.children].slice(f0); refreshers.push(() => { finishEls.forEach((e) => { e.style.display = dev.bodyMats.length ? '' : 'none'; }); });
  slider(dv, 'Exposure', { ...A('exposure'), min: 0.3, max: 2.2, step: 0.02 });
  btn(dv, 'Reset all controls', () => { if (!confirm('Reset every control to the original look?')) return; S = defaults(); save(); setLayout('h'); buildBackground(); refreshControls(); });
}

/* --- logo upload */
$('fileLogo').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return; const im = new Image();
  im.onload = () => { logoImg = im; const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; logoSpr.material.map = t; logoSpr.material.needsUpdate = true; updateOverlays(); };
  im.src = URL.createObjectURL(f); e.target.value = '';
};

/* --- timeline */
const btnPlay = $('btnPlay'), ruler = $('ruler'), durIn = $('durIn');
const syncPlayBtn = () => { btnPlay.textContent = playing ? '❚❚' : '▶'; };
btnPlay.onclick = () => { playing = !playing; syncPlayBtn(); };
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const timelineLen = () => S.customDur || sourceLen() / S.speed;
let tickKey = '', kfKey = '';
function jumpTs(ts) { const t = (ts * S.speed) % sourceLen(); if (src.kind === 'video') video.currentTime = src.start + t; else clock = t; if (S.kf.length) { applyAnim(ts); refreshControls(); } }
function updateTimeline(t) {
  const L = timelineLen(), ts = t / S.speed, p = Math.min(1, Math.max(0, ts / L));
  const key = L.toFixed(2) + ruler.clientWidth;
  if (key !== tickKey) {
    tickKey = key; const step = L <= 12 ? 1 : L <= 30 ? 2 : L <= 60 ? 5 : 10, ticks = $('ticks'); ticks.innerHTML = '';
    for (let s = 0; s <= L + 0.001; s += step) ticks.append(el('span', { textContent: Math.round(s) + 's', style: `left:${Math.min(97, Math.max(1, s / L * 100))}%` }));
  }
  const kk = S.kf.map((k) => k.t).join() + L.toFixed(2);
  if (kk !== kfKey) {
    kfKey = kk; const tr = $('track'); tr.querySelectorAll('.kf').forEach((n) => n.remove());
    S.kf.forEach((k) => {
      const d = el('i', { className: 'kf', title: 'Click: jump · Right-click: delete', onclick: () => jumpTs(k.t),
        oncontextmenu: (e) => { e.preventDefault(); S.kf = S.kf.filter((x) => x !== k); save(); tickKey = ''; kfKey = ''; } });
      d.style.left = `${Math.min(99, Math.max(1, k.t / L * 100))}%`; d.dataset.t = k.t; tr.append(d);
    });
  }
  const onKey = S.kf.some((k) => Math.abs(k.t - ts) < 0.06);
  $('btnKey').classList.toggle('on', onKey);
  $('track').querySelectorAll('.kf').forEach((n) => n.classList.toggle('on', Math.abs(+n.dataset.t - ts) < 0.06));
  $('playhead').style.left = (p * 100) + '%'; $('phLabel').textContent = ts.toFixed(1) + 's';
  $('time').textContent = `${fmtT(ts)} / ${fmtT(L)}`;
  if (document.activeElement !== durIn) durIn.value = Math.round(L * 10) / 10;
}
function seekFrac(e) {
  const r = ruler.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const t = (f * timelineLen() * S.speed) % sourceLen();
  if (src.kind === 'video') video.currentTime = src.start + t; else clock = t;
  if (S.kf.length) { applyAnim(f * timelineLen()); refreshControls(); }
}
ruler.onpointerdown = (e) => { ruler.setPointerCapture(e.pointerId); seekFrac(e); ruler.onpointermove = seekFrac; };
ruler.onpointerup = () => { ruler.onpointermove = null; };
durIn.onchange = () => { const v = +durIn.value; S.customDur = v > 0 ? v : 0; save(); tickKey = ''; };
$('btnKey').onclick = () => { toggleKey(); updateTimeline(timeNow()); };
$('btnAdd').onclick = () => $('fileVideo').click();
$('btnFull').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : $('stage').requestFullscreen?.(); };

/* --- popovers */
function popover(pop, trigger, build) {
  build(pop);
  trigger.onclick = (e) => {
    e.stopPropagation();
    const was = !pop.hidden; document.querySelectorAll('.pop').forEach((p) => { p.hidden = true; });
    if (was) return; pop.hidden = false; refreshControls();
    const r = trigger.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(innerWidth - 292, r.right - 280)) + 'px'; pop.style.bottom = (innerHeight - r.top + 8) + 'px';
  };
  pop.onclick = (e) => e.stopPropagation();
}
document.addEventListener('click', () => document.querySelectorAll('.pop').forEach((p) => { p.hidden = true; }));
popover($('popSpeed'), $('btnSpeed'), (p) => {
  lbl(p, 'Video speed');
  slider(p, 'Speed', { get: () => S.speed, set: (v) => { S.speed = v; applyScene(); }, min: 0.25, max: 4, step: 0.05, fmt: (v) => v.toFixed(2).replace(/\.?0+$/, '') + '×' });
  seg(p, [[0.5, '0.5×'], [1, '1×'], [1.5, '1.5×'], [2, '2×'], [3, '3×']], { get: () => S.speed, set: (v) => { S.speed = v; applyScene(); } });
  note(p, 'Speeds up or slows down the whole recording. The video length follows.');
});
refreshers.push(() => { $('btnSpeed').textContent = (+S.speed.toFixed(2)) + '×'; });
popover($('popMotion'), $('btnMotion'), (p) => {
  lbl(p, 'Camera motion');
  selectField(p, 'Motion', { get: () => S.motion, set: (v) => { S.motion = v; }, options: [['none', 'None'], ['orbit', 'Slow orbit'], ['pushin', 'Push in'], ['pullout', 'Pull out'], ['pan', 'Pan'], ['rise', 'Rise / tilt'], ['float', 'Gentle float']] });
  slider(p, 'Amount', { get: () => S.motionAmt, set: (v) => { S.motionAmt = v; }, min: 5, max: 100, fmt: (v) => v + '%' });
  checkField(p, 'Preview motion', { get: () => S.motionPreview, set: (v) => { S.motionPreview = v; } });
  note(p, 'Motion runs across the whole timeline and is included in the MP4.');
  lbl(p, 'Keyframes');
  note(p, 'Move to a time, set up the laptop / camera / light, press ◇ to add a keyframe. Repeat at another time — the values blend smoothly. Right-click a diamond to delete it.');
  btn(p, 'Clear all keyframes', () => { S.kf = []; save(); tickKey = ''; kfKey = ''; });
});
let exportBoth = false;
popover($('popExport'), $('btnExport'), (p) => {
  lbl(p, 'Export');
  seg(p, [[0, 'Current layout'], [1, 'Horizontal + vertical']], { get: () => +exportBoth, set: (v) => { exportBoth = !!v; } });
  lbl(p, 'Save to folder');
  const dest = el('p', { className: 'note' }); p.append(dest);
  const showDest = () => { dest.textContent = '📁 ' + (dirHandle ? dirHandle.name : (S.outDir || 'Downloads')); };
  refreshers.push(showDest); showDest();
  btn(p, 'Choose folder…', async () => { if (await chooseFolder()) showDest(); });
  selectField(p, 'Quality', { get: () => String(S.quality), set: (v) => { S.quality = +v; }, options: [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']] });
  slider(p, 'Bitrate', { get: () => S.mbps, set: (v) => { S.mbps = v; }, min: 4, max: 80, fmt: (v) => v + ' Mb/s' });
  btn(p, 'Export MP4', async () => {
    if (!(await chooseFolder())) return; // always ask where to save
    p.hidden = true; runExport(exportBoth && S.layout !== 'd' ? ['h', 'v'] : [S.layout]);
  }, 'primary');
  btn(p, 'Save PNG still', () => { p.hidden = true; savePNG(); });
});

/* --- files */
$('fileVideo').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
$('fileBg').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const im = new Image(); im.onload = () => { bgImage = im; S.bgMode = 'image'; S.tableShow = false; buildBackground(); refreshControls(); }; im.src = URL.createObjectURL(f); e.target.value = '';
};

$('fileWall').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  const im = new Image();
  im.onload = () => {
    // keep a resized copy (max 2048 px) so it loads fast and fits in the browser's storage
    const k = Math.min(1, 2048 / Math.max(im.width, im.height)), c = document.createElement('canvas');
    c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    setWallImage(c);
    try { localStorage.setItem(WALL_IMG_KEY, c.toDataURL('image/jpeg', 0.88)); } catch { setStatus('Wall image applied (too large to remember after a reload).'); }
    Object.assign(S, { interior: 'custom', bgMode: 'original', tableShow: true, wallPreset: null, wallImgX: 0 });
    lookKey = ''; buildBackground(); refreshControls(); save(); setStatus('Wall image applied');
  };
  im.onerror = () => setStatus('Could not read that image', true);
  im.src = URL.createObjectURL(f);
};

/* ------------------------------------------------------------------ loop */
let frameN = 0;
function frame(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
  tickSource(dt);
  drawScreen(); screenTex.needsUpdate = true; if (dribTex) dribTex.needsUpdate = true; if (coverTex) coverTex.needsUpdate = true;
  sampleScreen(); updateGlow();
  const t = timeNow(), len = sourceLen();
  const motionOn = S.motion !== 'none' && S.motionPreview;
  orbit.enabled = !motionOn;
  if (playing && S.kf.length && !exporting && !userOrbiting) { applyAnim(curTs()); if ((frameN = (frameN + 1) % 6) === 0) refreshControls(); }
  if (!userOrbiting) applyCamera(motionOn ? Math.min(1, Math.max(0, (t / S.speed) / timelineLen())) : 0);
  orbit.update();
  if (!exporting) draw();
  updateTimeline(t);
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ export */
let exporting = false, cancelled = false;
const bar = document.getElementById('exportBar'), fill = document.getElementById('exportFill'), msg = document.getElementById('exportMsg');
document.getElementById('btnCancel').onclick = () => { if (exporting) cancelled = true; else bar.hidden = true; };

function dims(layout, q) {
  if (layout === 'd') { const k = q >= 1440 ? 2 : 1; return [DB.W * k, DB.H * k]; }     // Dribbble: exactly 1600×1200 (or @2x)
  const r = LAYOUTS[layout].r, ev = (n) => Math.round(n / 2) * 2;
  return r >= 1 ? [ev(q * r), q] : [q, ev(q / r)];
}
function seekTo(v, t) {
  return new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 0.002 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 2000);
  });
}
async function pickCodec(w, h, fps, bitrate) {
  for (const codec of ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.4d4028', 'avc1.42e01f']) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch {}
  }
  throw new Error('This browser cannot encode H.264 at this size. Try a lower quality, or use Chrome / Edge / Safari.');
}

/* Folder browser (served by the local server, so it works in any browser — no pop-up dialogs needed). */
function pickFolderModal() {
  return new Promise((resolve) => {
    const back = el('div', { className: 'fm-back' }), box = el('div', { className: 'fm' }); back.append(box);
    const title = el('div', { className: 'fm-title', textContent: 'Choose where to save the MP4' });
    const pathIn = el('input', { type: 'text', spellcheck: false });
    const up = el('button', { className: 'btn', textContent: '↑', title: 'Parent folder' });
    const places = el('div', { className: 'fm-places' });
    const list = el('div', { className: 'fm-list' });
    const newIn = el('input', { type: 'text', placeholder: 'New folder name', spellcheck: false });
    const newBtn = el('button', { className: 'btn', textContent: 'Create' });
    const err = el('div', { className: 'fm-err' });
    const finder = el('button', { className: 'btn', textContent: 'Use Finder dialog…' });
    const cancel = el('button', { className: 'btn', textContent: 'Cancel' });
    const ok = el('button', { className: 'btn primary', textContent: 'Save here' });
    box.append(title, el('div', { className: 'fm-row' }, [up, pathIn]), places, list,
      el('div', { className: 'fm-row' }, [newIn, newBtn]), err, el('div', { className: 'fm-foot' }, [finder, el('span', { style: 'flex:1' }), cancel, ok]));
    document.body.append(back);
    let cur = '', parent = '';
    const close = (v) => { back.remove(); resolve(v); };
    async function load(dir) {
      err.textContent = '';
      try {
        const j = await (await fetch('/api/folders?dir=' + encodeURIComponent(dir || ''))).json();
        cur = j.path; parent = j.parent; pathIn.value = cur; list.innerHTML = ''; places.innerHTML = '';
        [{ name: '🏠 Home', path: j.home }, { name: '📁 Project', path: j.project }, ...j.places].forEach((p) => places.append(el('button', { className: 'btn', textContent: p.name, onclick: () => load(p.path) })));
        if (!j.dirs.length) list.append(el('div', { className: 'fm-empty', textContent: 'No sub-folders here' }));
        j.dirs.forEach((n) => list.append(el('div', { className: 'fm-item', textContent: '📁 ' + n, ondblclick: () => load(cur + '/' + n), onclick: () => load(cur + '/' + n) })));
      } catch (e) { err.textContent = 'Could not read folders: ' + e.message; }
    }
    up.onclick = () => load(parent);
    pathIn.onkeydown = (e) => { if (e.key === 'Enter') load(pathIn.value); };
    newBtn.onclick = async () => {
      const r = await fetch('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: cur, name: newIn.value }) });
      const j = await r.json(); if (!r.ok) { err.textContent = j.error; return; } newIn.value = ''; load(j.path);
    };
    finder.onclick = async () => {
      finder.disabled = true; finder.textContent = 'Waiting for Finder…';
      try {
        const j = await (await fetch('/api/pick-folder', { method: 'POST' })).json();
        if (j.path) return close(j.path);
        err.textContent = j.error && !j.cancelled ? j.error : 'Finder dialog was cancelled.';
      } catch (e) { err.textContent = e.message; }
      finder.disabled = false; finder.textContent = 'Use Finder dialog…';
    };
    cancel.onclick = () => close(null);
    ok.onclick = () => close(pathIn.value.trim() === cur || !pathIn.value.trim() ? cur : pathIn.value.trim());
    load(S.outDir && S.outDir !== 'renders' ? S.outDir : '');
  });
}
async function chooseFolder() {
  if (!hasServer) { setStatus('Hosted version: the MP4 downloads to your browser’s Downloads folder.'); return true; }
  const p = await pickFolderModal();
  if (!p) return false;
  S.outDir = p; dirHandle = null; save(); return true;
}
async function deliver(blob, name) {
  if (dirHandle) {
    try {
      if ((await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
        const fh = await dirHandle.getFileHandle(name, { create: true }), w = await fh.createWritable();
        await w.write(blob); await w.close(); return `Saved ${name} → ${dirHandle.name}`;
      }
    } catch (e) { console.warn(e); }
  }
  if (S.outDir && hasServer) {
    try {
      const r = await fetch(`/api/save?name=${encodeURIComponent(name)}&dir=${encodeURIComponent(S.outDir)}`, { method: 'POST', body: blob });
      const j = await r.json(); if (!r.ok) throw new Error(j.error); return `Saved → ${j.path}`;
    } catch (e) { setStatus('Folder save failed (' + e.message + '), downloading instead', true); }
  }
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return `Downloaded ${name}`;
}
async function exportOne(layout, tag) {
  const [w, h] = dims(layout, S.quality);
  const fps = S.fps;
  const len = (S.customDur || sourceLen() / S.speed);
  const total = Math.max(1, Math.round(len * fps));
  const cfg = await pickCodec(w, h, fps, S.mbps * 1e6);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h }, fastStart: 'in-memory' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { encErr = e; } });
  enc.configure(cfg);

  const t0 = performance.now();
  const prevLayout = S.layout, wasPlaying = playing;
  S.layout = layout; syncScreen(); buildBackground(); setBuffer(w, h); playing = false; video.pause(); syncPlayBtn();
  try {
    for (let i = 0; i < total; i++) {
      if (cancelled) throw new Error('Export cancelled');
      if (encErr) throw encErr;
      const t = i / fps;
      applyAnim(t);
      const st = (t * S.speed) % sourceLen();
      if (src.kind === 'video') await seekTo(video, src.start + st);
      else { clock = st; if (src.kind === 'frames') await loadFrame(frameIdx(st)).p; }
      drawScreen(); screenTex.needsUpdate = true; if (dribTex) dribTex.needsUpdate = true; if (coverTex) coverTex.needsUpdate = true;
      sampleScreen(i === 0); updateGlow();
      applyCamera(S.motion !== 'none' ? Math.min(1, t / len) : 0);
      draw();
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 3 === 0) {
        const done = (i + 1) / total, el_ = (performance.now() - t0) / 1000, eta = Math.max(0, Math.round(el_ / done - el_));
        fill.style.width = (100 * done).toFixed(1) + '%';
        msg.innerHTML = `<b>Rendering ${tag}${LAYOUTS[layout].label} · ${w}×${h}</b><div class="pct">${Math.round(done * 100)}%</div><div class="sub">Frame ${i + 1} of ${total} · about ${eta}s left</div>`;
        await new Promise((r) => setTimeout(r));
      }
    }
    await enc.flush(); muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    lastSaved = await deliver(blob, `mockup-${LAYOUTS[layout].label.replace(':', 'x')}-${w}x${h}.mp4`);
  } finally {    try { enc.close(); } catch {}
    S.layout = prevLayout; syncScreen(); playing = wasPlaying; syncPlayBtn(); fitPreview(); buildBackground();
  }
}
async function runExport(layouts) {
  if (exporting) return;
  if (!('VideoEncoder' in window)) return setStatus('MP4 export needs a browser with WebCodecs (Chrome, Edge or Safari 17+).', true);
  exporting = true; cancelled = false; bar.hidden = false; fill.style.width = '0'; $('btnCancel').textContent = 'Cancel';
  let ok = false;
  try {
    for (let i = 0; i < layouts.length; i++) await exportOne(layouts[i], layouts.length > 1 ? `(${i + 1}/${layouts.length}) ` : '');
    setStatus(lastSaved); ok = true;
  } catch (e) { setStatus(e.message, true); }
  exporting = false;
  fill.style.width = ok ? '100%' : '0';
  msg.innerHTML = ok ? `<b>✓ Export finished</b><div class="sub">${lastSaved}</div>` : `<b>Export stopped</b><div class="sub">${$('status').textContent}</div>`;
  $('btnCancel').textContent = 'Close'; if (S.kf.length) { applyAnim(curTs()); refreshControls(); }
}
function savePNG() {
  const [w, h] = dims(S.layout, S.quality);
  setBuffer(w, h); applyCamera(0); draw();
  canvas.toBlob((b) => {
    const a = el('a', { href: URL.createObjectURL(b), download: `mockup-${w}x${h}.png` }); document.body.append(a); a.click(); a.remove();
    fitPreview();
  });
}

/* ------------------------------------------------------------------ go */
buildContact();
if (!hadSaved) { Object.keys(LAYOUTS).forEach((l) => { S.cams[l] = { ...CAM_DEF[l], el: dev.cfg.el }; fitLaptop(l); }); S.lid = dev.cfg.lid ?? S.lid; }
setLayout(S.layout);
syncPlayBtn();
buildBackground();
requestAnimationFrame(frame);
window.__mockup = { get S() { return S; }, src, video, setLayout, applyScene, foot, get dev() { return dev; }, switchDevice, loadDevice, N };
