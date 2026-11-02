import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.dirname(fileURLToPath(import.meta.url));
const capDir = path.join(root, 'captures');
fs.mkdirSync(capDir, { recursive: true });

const app = express();
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.use('/vendor/mp4-muxer', express.static(path.join(root, 'node_modules/mp4-muxer/build')));
app.use('/captures', express.static(capDir));
app.use(express.static(path.join(root, 'public')));
app.use(express.json());

// ---- folder browsing for the export dialog (local machine only)
const expand = (d) => {
  d = String(d || '').trim();
  if (!d) return os.homedir();
  if (d.startsWith('~')) d = path.join(os.homedir(), d.slice(1));
  return path.resolve(root, d);
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
  res.json({ path: dir, parent: path.dirname(dir), dirs, home: os.homedir(), places, project: root });
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
    dir = path.resolve(root, dir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, req.body);
    res.json({ path: file });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Website capture: opens the page in the installed Chrome and records it via screencast frames
// (no ffmpeg needed). Works for any http(s) address, including localhost:3000 dev servers.
app.post('/api/capture', async (req, res) => {
  const { url, mode = 'scroll', duration = 0, speed = 350, width = 1440, height = 900 } = req.body || {};
  let target;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
  } catch {
    return res.status(400).json({ error: 'Enter a valid link, e.g. http://localhost:3000' });
  }
  const dur = Number(duration) > 0 ? Math.min(Math.max(Number(duration), 2), 60) : 0; // 0 = auto-detect
  const pxPerSec = Math.min(Math.max(Number(speed) || 350, 80), 1500);
  const id = Date.now().toString(36);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    try {
      await page.goto(target.href, { waitUntil: 'load', timeout: 45000 });
    } catch (e) {
      if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(String(e))) throw new Error(`Can't reach ${target.origin}. Is your dev server running on that port?`);
      if (/ERR_NAME_NOT_RESOLVED/.test(String(e))) throw new Error(`Can't find ${target.host}. Check the address.`);
      throw e;
    }
    await page.waitForTimeout(1500);

    if (mode === 'screenshot') {
      const file = `${id}.png`;
      await page.screenshot({ path: path.join(capDir, file), type: 'png' });
      return res.json({ kind: 'image', url: `/captures/${file}` });
    }

    const dir = path.join(capDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const frames = [];
    const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      frames.push({ ts: metadata.timestamp, data });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    await page.waitForTimeout(500);
    await page.evaluate(async ({ dur, speed }) => {
      document.documentElement.style.scrollBehavior = 'auto';
      // find what actually scrolls: the page itself, or the biggest inner scroll container (web apps)
      const se = document.scrollingElement || document.documentElement;
      let target = { win: true, el: se };
      if (se.scrollHeight - innerHeight <= 10) {
        let best = null, area = 0;
        for (const e of document.querySelectorAll('*')) {
          if (!/(auto|scroll)/.test(getComputedStyle(e).overflowY) || e.scrollHeight - e.clientHeight < 10) continue;
          const a = e.clientWidth * e.clientHeight; if (a > area) { area = a; best = e; }
        }
        if (best) target = { win: false, el: best };
      }
      const max = () => (target.win ? Math.max(0, document.documentElement.scrollHeight - innerHeight) : target.el.scrollHeight - target.el.clientHeight);
      const set = (y) => (target.win ? scrollTo(0, y) : (target.el.scrollTop = y));
      await new Promise((done) => {
        const t0 = performance.now(); let last = t0, y = 0, idle = 0;
        const step = (n) => {
          const dt = Math.min(0.1, (n - last) / 1000); last = n; const M = max();
          if (dur > 0) {                                   // fixed length, eased
            const p = Math.min(1, (n - t0) / (dur * 1000)), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            set(M * e); return p < 1 ? requestAnimationFrame(step) : done();
          }
          const ramp = Math.min(1, (n - t0) / 800), slow = Math.min(1, Math.max(0.15, (M - y) / (speed * 0.6)));
          y = Math.min(M, y + speed * ramp * slow * dt); set(y);
          if (y >= M - 1) { idle += dt; if (idle > 0.7) return done(); } else idle = 0;   // wait briefly for lazy content to load in
          if (n - t0 > 90000) return done();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, { dur, speed: pxPerSec });
    await page.waitForTimeout(500);
    await cdp.send('Page.stopScreencast').catch(() => {});
    if (!frames.length) throw new Error('The page did not produce any frames.');

    const t0 = frames[0].ts;
    const out = [];
    frames.forEach((f, n) => {
      const t = f.ts - t0;
      if (out.length && t - out[out.length - 1].t < 1 / 60) return;
      const name = `f${String(n).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, name), Buffer.from(f.data, 'base64'));
      out.push({ t, f: name });
    });
    const length = Math.max(out[out.length - 1].t + 0.2, dur, 2);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ length, frames: out }));
    res.json({ kind: 'frames', url: `/captures/${id}/manifest.json`, length, count: out.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).split('\n')[0] });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const port = process.env.PORT || 4173;
app.listen(port, '127.0.0.1', () => console.log(`Mockup Studio → http://localhost:${port}`));
