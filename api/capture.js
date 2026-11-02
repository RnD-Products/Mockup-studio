// Vercel serverless function: opens a PUBLIC web page in headless Chromium, scrolls it and streams the
// screencast frames back (newline-delimited JSON). Pages on localhost / private networks are refused:
// a hosted server cannot reach them (use the "Record screen" button, or run the app locally).
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import dns from 'node:dns/promises';
import net from 'node:net';
import { recordPage } from '../lib/record.js';

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

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (o) => res.write(JSON.stringify(o) + '\n');

  let browser;
  try {
    const local = !!process.env.CHROME_PATH;
    browser = await puppeteer.launch({
      args: local ? ['--no-sandbox', '--hide-scrollbars'] : await puppeteer.defaultArgs({ args: [...chromium.args, '--hide-scrollbars'], headless: 'shell' }),
      defaultViewport: null,
      executablePath: local ? process.env.CHROME_PATH : await chromium.executablePath(),
      headless: local ? true : 'shell',
    });
    const out = await recordPage({
      browser, url: target.href, mode, duration, speed, width: vw, height: vh,
      maxScrollSec: 22, warmupMs: 4000, gotoMs: 15000, quality: 52, minFrameGap: 0.066,   // fits Vercel's 60 s function limit
      prepare: async (page) => {
        await page.setRequestInterception(true);
        page.on('request', async (r) => {                                  // never let the page reach private networks
          try { await assertPublicHost(new URL(r.url()).hostname); r.continue(); } catch { r.abort('blockedbyclient').catch(() => {}); }
        });
      },
      onFrame: ({ ts, data }) => send({ t: ts, f: data }),
      onInfo: (m) => send({ info: m }),
    });
    if (out.image) send({ image: Buffer.from(out.image).toString('base64') });
    else send({ done: true, length: out.length, frames: out.frames, pageHeight: out.pageHeight, ended: out.ended });
  } catch (e) {
    send({ error: e.code === 'LOCAL' || /blockedbyclient/.test(String(e)) ? LOCAL_MSG : String(e.message || e).split('\n')[0] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    res.end();
  }
}
