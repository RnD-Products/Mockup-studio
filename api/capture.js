// Vercel serverless function: opens a PUBLIC web page in headless Chromium, scrolls it and streams the
// screencast frames back (newline-delimited JSON). Pages on localhost / private networks are refused:
// a hosted server cannot reach them (use the "Record screen" button, or run the app locally).
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import dns from 'node:dns/promises';
import net from 'node:net';

const LOCAL_MSG = "That address is only reachable from your own computer, so the hosted server can't open it. Use “Record screen” (share the tab), or run the app locally (npm start).";
const localErr = () => Object.assign(new Error(LOCAL_MSG), { code: 'LOCAL' });
const LOCAL_OK = process.env.ALLOW_LOCAL === '1';                 // only for testing on this machine

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') ||
    x.startsWith('fea') || x.startsWith('feb') || x.startsWith('::ffff:');
}
const hostCache = new Map();
async function assertPublicHost(host) {
  if (LOCAL_OK) return;
  host = host.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw localErr();
  if (!hostCache.has(host)) {
    hostCache.set(host, (async () => {
      if (net.isIP(host)) { if (isPrivateIp(host)) throw localErr(); return; }
      const addrs = await dns.lookup(host, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw localErr();
    })());
  }
  await hostCache.get(host);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { url, mode = 'scroll', duration = 0, speed = 350, width = 1440, height = 900 } = req.body || {};
  let target;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
    await assertPublicHost(target.hostname);
  } catch (e) {
    return res.status(400).json({ error: e.code === 'LOCAL' ? e.message : 'Enter a valid public link, e.g. https://example.com' });
  }
  const vw = Math.min(Math.max(+width || 1440, 320), 1920), vh = Math.min(Math.max(+height || 900, 240), 1200);
  const dur = +duration > 0 ? Math.min(Math.max(+duration, 2), 22) : 0;     // 0 = auto
  const pxPerSec = Math.min(Math.max(+speed || 350, 80), 1500);

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (o) => res.write(JSON.stringify(o) + '\n');

  let browser;
  try {
    const exe = process.env.CHROME_PATH || await chromium.executablePath();
    browser = await puppeteer.launch({
      args: process.env.CHROME_PATH ? ['--no-sandbox', '--hide-scrollbars'] : await puppeteer.defaultArgs({ args: [...chromium.args, '--hide-scrollbars'], headless: 'shell' }),
      defaultViewport: { width: vw, height: vh, deviceScaleFactor: 1 },
      executablePath: exe,
      headless: process.env.CHROME_PATH ? true : 'shell',
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', async (r) => {                                         // never let the page reach private networks
      try { await assertPublicHost(new URL(r.url()).hostname); r.continue(); } catch { r.abort('blockedbyclient').catch(() => {}); }
    });
    try {
      await page.goto(target.href, { waitUntil: 'load', timeout: 20000 });
    } catch (e) {
      if (/ERR_NAME_NOT_RESOLVED/.test(String(e))) throw new Error(`Can't find ${target.host}. Check the address.`);
      if (/ERR_CONNECTION|ERR_TIMED_OUT|Timeout/i.test(String(e))) throw new Error(`Couldn't load ${target.host} (it didn't answer in time).`);
      if (/blockedbyclient/i.test(String(e))) throw localErr();
      throw e;
    }
    await new Promise((r) => setTimeout(r, 1200));

    if (mode === 'screenshot') {
      const buf = await page.screenshot({ type: 'jpeg', quality: 88 });
      send({ image: Buffer.from(buf).toString('base64') });
      return res.end();
    }

    const cdp = await page.createCDPSession();
    let lastT = -1, n = 0, t0 = null;
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (t0 === null) t0 = metadata.timestamp;
      if (metadata.timestamp - lastT < 0.05) return;                          // ≤ 20 fps keeps the stream small
      lastT = metadata.timestamp; n++; send({ t: metadata.timestamp, f: data });
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: vw, maxHeight: vh, everyNthFrame: 1 });
    await new Promise((r) => setTimeout(r, 450));
    await page.evaluate(async ({ dur, speed }) => {
      document.documentElement.style.scrollBehavior = 'auto';
      const se = document.scrollingElement || document.documentElement;
      let target = { win: true, el: se };
      if (se.scrollHeight - innerHeight <= 10) {                               // web apps: scroll the biggest inner scroller
        let best = null, area = 0;
        for (const e of document.querySelectorAll('*')) {
          if (!/(auto|scroll)/.test(getComputedStyle(e).overflowY) || e.scrollHeight - e.clientHeight < 10) continue;
          const a = e.clientWidth * e.clientHeight; if (a > area) { area = a; best = e; }
        }
        if (best) target = { win: false, el: best };
      }
      const max = () => (target.win ? Math.max(0, document.documentElement.scrollHeight - innerHeight) : target.el.scrollHeight - target.el.clientHeight);
      const set = (y) => (target.win ? scrollTo(0, y) : (target.el.scrollTop = y));
      const pace = Math.max(speed, max() / 20);                                // long pages speed up so the whole page fits the time limit
      await new Promise((done) => {
        const t0 = performance.now(); let last = t0, y = 0, idle = 0;
        const step = (now) => {
          const dt = Math.min(0.1, (now - last) / 1000); last = now; const M = max();
          if (dur > 0) {
            const p = Math.min(1, (now - t0) / (dur * 1000)), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            set(M * e); return p < 1 ? requestAnimationFrame(step) : done();
          }
          const ramp = Math.min(1, (now - t0) / 800), slow = Math.min(1, Math.max(0.15, (M - y) / (pace * 0.6)));
          y = Math.min(M, y + pace * ramp * slow * dt); set(y);
          if (y >= M - 1) { idle += dt; if (idle > 0.6) return done(); } else idle = 0;
          if (now - t0 > 22000) return done();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, { dur, speed: pxPerSec });
    await new Promise((r) => setTimeout(r, 450));
    await cdp.send('Page.stopScreencast').catch(() => {});
    if (!n) throw new Error('The page did not produce any frames.');
    send({ done: true, length: Math.max(2, lastT - t0 + 0.25), frames: n });
  } catch (e) {
    send({ error: String(e.message || e).split('\n')[0] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    res.end();
  }
}
