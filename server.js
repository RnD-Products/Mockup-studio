import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { recordPage } from './lib/record.js';

const root = path.dirname(fileURLToPath(import.meta.url));
// In the packaged Mac app the code lives in a read-only bundle, so recordings / exports go to writable folders passed in by the app.
const dataDir = process.env.MOCKUP_DATA_DIR || root;                       // relative export folders (e.g. "renders") resolve here
const capDir = process.env.MOCKUP_CAPTURES_DIR || path.join(root, 'captures');
fs.mkdirSync(capDir, { recursive: true });

const app = express();
app.use(express.json());

// The hosted site (Vercel) can ask THIS local app to record localhost pages. Only your own site (and localhost) may call it.
const originOk = (o) => !!o && (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ||
  /^https:\/\/mockup-studio(-[a-z0-9-]+)?-reng-studio\.vercel\.app$/.test(o) ||
  (process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean).includes(o));
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (originOk(o)) {
    res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.get('/api/ping', (req, res) => res.json({ helper: true }));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.use('/vendor/mp4-muxer', express.static(path.join(root, 'node_modules/mp4-muxer/build')));
app.use('/captures', express.static(capDir));
app.use(express.static(path.join(root, 'public')));

// ---- folder browsing for the export dialog (local machine only)
const expand = (d) => {
  d = String(d || '').trim();
  if (!d) return os.homedir();
  if (d.startsWith('~')) d = path.join(os.homedir(), d.slice(1));
  return path.resolve(dataDir, d);
};
app.get('/api/folders', (req, res) => {
  let dir = expand(req.query.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) dir = os.homedir();
  let dirs = [];
  try {
    dirs = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || (d.isSymbolicLink() && (() => { try { return fs.statSync(path.join(dir, d.name)).isDirectory(); } catch { return false; } })())))
      .map((d) => d.name).sort((a, b) => a.localeCompare(b));
  } catch {}
  const places = ['Desktop', 'Movies', 'Downloads', 'Documents', 'Pictures']
    .map((n) => ({ name: n, path: path.join(os.homedir(), n) })).filter((p) => fs.existsSync(p.path));
  res.json({ path: dir, parent: path.dirname(dir), dirs, home: os.homedir(), places, project: dataDir });
});
app.post('/api/mkdir', (req, res) => {
  try {
    const name = path.basename(String(req.body.name || '').trim());
    if (!name) throw new Error('Enter a folder name');
    const p = path.join(expand(req.body.dir), name);
    fs.mkdirSync(p, { recursive: true });
    res.json({ path: p });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
app.post('/api/pick-folder', (req, res) => {
  if (process.platform !== 'darwin') return res.status(501).json({ error: 'Finder dialog is only available on macOS.' });
  execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose where to save the MP4")'], { timeout: 180000 }, (err, out) => {
    if (err) return res.status(200).json({ cancelled: true, error: String(err.message || err).split('\n')[0] });
    res.json({ path: out.trim().replace(/\/$/, '') });
  });
});

// Save a finished render into a folder chosen in the UI (absolute, ~/..., or relative to this project).
app.post('/api/save', express.raw({ type: '*/*', limit: '4gb' }), (req, res) => {
  try {
    const name = path.basename(String(req.query.name || 'mockup.mp4'));
    let dir = String(req.query.dir || 'renders').trim() || 'renders';
    if (dir.startsWith('~')) dir = path.join(process.env.HOME || '', dir.slice(1));
    dir = path.resolve(dataDir, dir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, req.body);
    res.json({ path: file });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Website capture: opens the page in the Google Chrome installed on this computer and records it (no ffmpeg needed).
// Works for any http(s) address, including localhost:3000 dev servers. Same recorder as the hosted site, without time limits.
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
const logFile = path.join(capDir, 'recorder.log');
const log = (m) => { try { fs.mkdirSync(capDir, { recursive: true }); fs.appendFileSync(logFile, `${new Date().toISOString()} ${m}\n`); } catch {} };

/** Starts Chrome ourselves (headless) and connects to it, so we see exactly what Chrome says when something goes wrong. */
async function launchChrome(extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--password-store=basic', '--use-mock-keychain', '--mute-audio', '--hide-scrollbars', '--ignore-certificate-errors',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-search-engine-choice-screen', '--disable-sync', '--disable-component-update', ...extra, 'about:blank'];
  const child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  const cleanup = () => { try { child.kill('SIGKILL'); } catch {} setTimeout(() => fs.rm(dir, { recursive: true, force: true }, () => {}), 1500); };
  try {
    const ws = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome did not start within 25 s')), 25000);
      child.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) { clearTimeout(timer); resolve(m[1]); } });
      child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`Chrome exited while starting (code ${c})`)); });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
    browser.on('disconnected', cleanup);
    return browser;
  } catch (e) {
    cleanup();
    const tail = err.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' | ').slice(0, 300);
    throw new Error(`${e.message}${tail ? ` — Chrome said: ${tail}` : ''}`);
  }
}
async function openBrowser() {
  try { return await launchChrome(); }
  catch (e1) {
    log(`Chrome start failed (${e1.message}); retrying in safe graphics mode`);
    try { return await launchChrome(['--disable-gpu', '--use-gl=swiftshader', '--disable-features=Vulkan']); }
    catch (e2) {
      log(`Retry failed too: ${e2.message}`);
      throw new Error(`Chrome would not start. ${e2.message}. Try quitting Google Chrome completely (⌘Q) and record again.`);
    }
  }
}

app.post('/api/capture', async (req, res) => {
  const { url, mode = 'scroll', duration = 0, speed = 700, width = 1440, height = 900, interact = 0, plan = '', stream = false } = req.body || {};
  let target;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
  } catch {
    return res.status(400).json({ error: 'Enter a valid link, e.g. http://localhost:3000' });
  }
  if (!CHROME) return res.status(500).json({ error: 'Google Chrome was not found on this computer. Install Chrome, or set CHROME_PATH.' });
  const id = Date.now().toString(36);
  // progress streaming (newline-delimited JSON) + cancel: if the app closes the request, the recording stops
  let cancelled = false, lastSent = 0;
  res.on('close', () => { if (!res.writableFinished) cancelled = true; });
  if (stream) { res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.flushHeaders?.(); }
  const emit = (o) => { if (stream && !cancelled) res.write(JSON.stringify(o) + '\n'); };
  const onProgress = (p, t) => { const now = Date.now(); if (now - lastSent > 150 || p >= 0.97) { lastSent = now; emit({ p: Math.min(0.99, p), t }); } };
  const finish = (code, obj) => { if (stream) { if (!cancelled) { emit(obj); res.end(); } } else res.status(code).json(obj); };
  let browser;
  try {
    emit({ p: 0.02, t: 'Starting Chrome' });
    browser = await openBrowser();
    const dir = path.join(capDir, id);
    const frames = [];
    let t0 = null;
    const out = await recordPage({
      browser, url: target.href, mode, duration: Number(duration) || 0, speed: Number(speed) || 700, width, height, interact: Number(interact) || 0, plan: String(plan || '').slice(0, 8000),
      maxScrollSec: 150, warmupMs: 20000, gotoMs: 45000, quality: 80, minFrameGap: 1 / 60, onProgress, isCancelled: () => cancelled,
      onFrame: ({ ts, data }) => {
        if (t0 === null) { t0 = ts; fs.mkdirSync(dir, { recursive: true }); }
        const f = `f${String(frames.length).padStart(5, '0')}.jpg`;
        fs.writeFileSync(path.join(dir, f), Buffer.from(data, 'base64'));
        frames.push({ t: ts - t0, f });
      },
    });
    if (out.image) {
      const file = `${id}.jpg`;
      fs.writeFileSync(path.join(capDir, file), out.image);
      return finish(200, { done: true, kind: 'image', url: `/captures/${file}` });
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ length: out.length, frames }));
    finish(200, { done: true, kind: 'frames', url: `/captures/${id}/manifest.json`, length: out.length, count: frames.length, pageHeight: out.pageHeight, ended: out.ended, plan: out.plan });
  } catch (e) {
    if (!cancelled) log(`capture of ${url} failed: ${e.message}`);
    finish(500, { error: String(e.message || e).split('\n')[0] });
  } finally {
    if (browser) { await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]); try { browser.disconnect(); } catch {} }
  }
});

/** Starts the app server. Resolves with the port in use (tries `port`, then any free port). */
export function startServer(port = Number(process.env.PORT) || 4173) {
  return new Promise((resolve, reject) => {
    const tryListen = (p) => {
      const srv = app.listen(p, '127.0.0.1', () => { const used = srv.address().port; console.log(`Mockup Studio → http://localhost:${used}`); resolve(used); });
      srv.on('error', (e) => { if (e.code === 'EADDRINUSE' && p !== 0) tryListen(0); else reject(e); });
    };
    tryListen(port);
  });
}
// `npm start` runs this file directly; the Mac app imports startServer() instead.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
