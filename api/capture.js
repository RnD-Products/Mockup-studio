// Vercel serverless function: opens a PUBLIC web page in headless Chromium, scrolls it and streams the
// screencast frames back (newline-delimited JSON). Pages on localhost / private networks are refused:
// a hosted server cannot reach them (use the "Record screen" button, or run the app locally).
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import dns from 'node:dns/promises';
import net from 'node:net';
import { recordPage, capturePageTiles } from '../lib/record.js';

const LOCAL_MSG = "That address is only reachable from your own computer, so the live site can't open it directly. Start the local app (run npm start in the mockup-studio folder) and try again: the live site then uses it automatically.";
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
  // the hosted machine is small: record at most 1280 px wide (same aspect), which keeps frames fast and light
  let vw = Math.min(Math.max(+width || 1440, 320), 1920), vh = Math.min(Math.max(+height || 900, 240), 1200);
  if (vw > 1280) { vh = Math.round(vh * 1280 / vw); vw = 1280; }
  const T0 = Date.now(), ts = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (o) => res.write(JSON.stringify(o) + '\n');

  let browser;
  try {
    const local = !!process.env.CHROME_PATH;
    send({ info: 'Starting browser' });
    browser = await puppeteer.launch({
      args: local ? ['--no-sandbox', '--hide-scrollbars'] : await puppeteer.defaultArgs({ args: [...chromium.args, '--hide-scrollbars'], headless: 'shell' }),
      defaultViewport: null,
      executablePath: local ? process.env.CHROME_PATH : await chromium.executablePath(),
      headless: local ? true : 'shell',
    });
    const prepare = async (page) => {
      await page.setRequestInterception(true);
      page.on('request', async (r) => {                                  // never let the page reach private networks
        try { await assertPublicHost(new URL(r.url()).hostname); r.continue(); } catch { r.abort('blockedbyclient').catch(() => {}); }
      });
    };
    const onInfo = (m) => send({ info: `${m} · ${ts()}` });
    if (mode === 'screenshot') {
      const out = await recordPage({ browser, url: target.href, mode, width: vw, height: vh, gotoMs: 15000, skipIdle: true, prepare, onInfo });
      send({ image: Buffer.from(out.image).toString('base64') });
    } else {
      // The hosted machine is small, so a live screen recording would be choppy. Capture the whole page as tall image
      // tiles instead; the app scrolls through them smoothly (fast, smooth, any page length).
      const out = await capturePageTiles({
        browser, url: target.href, width: vw, height: vh, budgetMs: 30000, warmupMs: 3500, gotoMs: 15000, quality: 72, skipIdle: true,
        prepare, onInfo, onTile: (t) => send({ tile: t.data, y: t.y, h: t.h }),
      });
      send({ done: true, ...out, took: ts() });
    }
  } catch (e) {
    send({ error: e.code === 'LOCAL' || /blockedbyclient/.test(String(e)) ? LOCAL_MSG : String(e.message || e).split('\n')[0] });
  } finally {
    res.end();                                                              // the user already has everything: don't make them wait for the browser to shut down
    if (browser) { await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 2500))]); try { browser.process()?.kill('SIGKILL'); } catch {} }
  }
}
