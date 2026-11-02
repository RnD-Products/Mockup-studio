// Shared page recorder (used by the Vercel function api/capture.js and by the local server).
// It scrolls like a person does — with real mouse-wheel events — so it works on normal pages, inner
// scroll areas (web apps), lazy-loaded pages, infinite feeds and smooth-scroll / scroll-jacked sites.
// The length is detected automatically: first a quick pass loads lazy content and measures the page,
// then the recording scrolls at a steady pace and stops when nothing moves any more.
import { createHash } from 'node:crypto';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the page: finds what actually scrolls (the page, or the biggest inner scroller).
const PROBE = `(() => {
  if (window.__sp) return true;
  const find = () => {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight - innerHeight > 10) return { win: true, el: se };
    let best = null, area = 0;
    for (const e of document.querySelectorAll('body *')) {
      if (!/(auto|scroll)/.test(getComputedStyle(e).overflowY) || e.scrollHeight - e.clientHeight < 10) continue;
      const a = e.clientWidth * e.clientHeight; if (a > area) { area = a; best = e; }
    }
    return best ? { win: false, el: best } : { win: true, el: se };
  };
  let t = find(), n = 0;
  window.__sp = {
    pos: () => { if (++n % 40 === 0) t = find(); return t.win ? scrollY : t.el.scrollTop; },
    max: () => (t.win ? Math.max(0, document.documentElement.scrollHeight - innerHeight) : t.el.scrollHeight - t.el.clientHeight),
    set: (y) => { t.win ? scrollTo(0, y) : (t.el.scrollTop = y); },
  };
  document.documentElement.style.scrollBehavior = 'auto';
  return true;
})()`;

// Runs inside the page: gets rid of cookie / consent banners without accepting anything.
const DISMISS = `(() => {
  const visible = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const no = /^(reject all|reject|decline all|decline|deny|only necessary|necessary only|use necessary cookies only|essential only|no,? thanks|no thanks|continue without accepting)$/i;
  for (const b of document.querySelectorAll('button, a, [role=button]')) {
    const t = (b.innerText || '').trim();
    if (t && t.length < 40 && no.test(t) && visible(b)) { try { b.click(); } catch {} break; }
  }
  const sel = '#onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, .cc-window, .cookie-banner, .cookie-consent, .cookies-banner, [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i], [role=dialog][aria-label*="consent" i]';
  for (const e of document.querySelectorAll(sel)) {
    const s = getComputedStyle(e);
    if ((s.position === 'fixed' || s.position === 'sticky') && e.getBoundingClientRect().height < innerHeight * 0.7) e.style.setProperty('display', 'none', 'important');
  }
})()`;


// Runs inside the page: a visible cursor (headless Chrome draws none) that follows the mouse.
const CURSOR = `(() => {
  if (window.__cur) return;
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transform:translate(-80px,-80px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))';
  c.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 2l16 9-7 2 4 8-3 1-4-8-6 5z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(c); window.__cur = c;
  addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
})()`;

// Runs inside the page: finds things worth pointing at in the current view, based on the site's structure.
const FIND = `(() => {
  const vw = innerWidth, vh = innerHeight, out = [], seen = new Set(); let id = 0;
  const geom = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 28 || r.height < 16 || (r.width > vw * 0.9 && r.height > vh * 0.7)) return null;
    if (r.bottom < 60 || r.top > vh - 60 || r.right < 10 || r.left > vw - 10) return null;
    const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.1 || s.pointerEvents === 'none') return null;
    const x = Math.min(vw - 20, Math.max(20, r.left + r.width / 2)), y = Math.min(vh - 50, Math.max(60, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y); if (!hit || !(e === hit || e.contains(hit) || hit.contains(e))) return null;
    return { x, y, w: r.width, h: r.height };
  };
  const add = (sel, kind, limit, ok) => {
    let n = 0;
    for (const e of document.querySelectorAll(sel)) {
      if (n >= limit || seen.has(e) || (ok && !ok(e))) continue;
      const g = geom(e); if (!g) continue;
      seen.add(e); e.setAttribute('data-c', String(++id)); out.push({ ...g, kind, id }); n++;
    }
  };
  add('header a, nav a, [role=navigation] a, header button, nav button', 'nav', 10);
  add('button, [role=button], a[class*=btn i], a[class*=button i], input[type=submit]', 'button', 12, (e) => !e.closest('header,nav'));
  add('summary, [aria-expanded="false"], [role=tab]:not([aria-selected="true"])', 'toggle', 8, (e) => !(e.matches('a[href]') && !(e.getAttribute('href') || '').startsWith('#')));
  add('article, [class*=card i], figure, li:has(img)', 'card', 10);
  add('img', 'image', 8);
  add('a[href]', 'link', 14, (e) => (e.innerText || '').trim().length > 1);
  return out;
})()`;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Human-like pointer movement: eased, slightly curved.
async function moveMouse(page, m, x, y, ms = 650) {
  const steps = Math.max(10, Math.round(ms / 16)), x0 = m.x, y0 = m.y, bow = rnd(-0.08, 0.08) * Math.hypot(x - x0, y - y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(x0 + (x - x0) * e + Math.sin(Math.PI * e) * bow, y0 + (y - y0) * e - Math.sin(Math.PI * e) * bow * 0.5);
    await sleep(ms / steps);
  }
  m.x = x; m.y = y;
}

// One natural thing a person might do on a pause: hover a menu item / button / card / image, or open + close a safe toggle.
async function doInteraction(page, m, level, { intro = false } = {}) {
  const cands = await page.evaluate(FIND).catch(() => []);
  if (!cands.length) return false;
  const of = (k) => cands.filter((c) => c.kind === k);
  let c, r = Math.random();
  if (intro) c = pick(of('nav').length ? of('nav') : of('button').length ? of('button') : cands);
  else if (of('toggle').length && r < (level >= 3 ? 0.4 : 0.2)) c = pick(of('toggle'));
  else if (r < 0.5 && of('button').length) c = pick(of('button'));
  else if (r < 0.75 && of('card').length) c = pick(of('card'));
  else if (r < 0.9 && of('image').length) c = pick(of('image'));
  else if (of('nav').length && r < 0.95) c = pick(of('nav'));
  else c = pick(cands);
  await moveMouse(page, m, c.x, c.y, rnd(500, 850));
  if (c.kind === 'toggle') {
    await sleep(250);
    await page.mouse.click(c.x, c.y);                      // open (an in-page toggle only — never a link)
    await sleep(rnd(900, 1500));
    await page.evaluate((id) => { const e = document.querySelector('[data-c="' + id + '"]'); if (e) e.click(); }, c.id).catch(() => {});   // and put it back
    await sleep(450);
  } else {
    await sleep(rnd(450, 900));
    if (c.kind === 'card' || c.kind === 'image') {         // a small drift across it, like reading
      await moveMouse(page, m, Math.max(20, c.x + rnd(-0.2, 0.2) * c.w), c.y + rnd(-0.12, 0.12) * c.h, 450);
      await sleep(rnd(200, 500));
    }
  }
  return true;
}

async function openPage(browser, url, { width, height, gotoMs, skipIdle, prepare, onInfo }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  if (prepare) await prepare(page);
  try { await page.goto(url, { waitUntil: 'load', timeout: gotoMs }); }
  catch (e) {
    await page.close().catch(() => {});
    if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(String(e))) throw new Error(`Can't reach ${new URL(url).origin}. Is it running on that port?`);
    if (/ERR_NAME_NOT_RESOLVED/.test(String(e))) throw new Error(`Can't find ${new URL(url).host}. Check the address.`);
    if (/blockedbyclient/i.test(String(e))) throw e;
    if (/Timeout|ERR_TIMED_OUT|ERR_CONNECTION/i.test(String(e))) throw new Error(`Couldn't load ${new URL(url).host} (it didn't answer in time).`);
    throw e;
  }
  onInfo?.('Page loaded');
  if (!skipIdle) await page.waitForNetworkIdle({ idleTime: 500, timeout: 2500 }).catch(() => {});
  await page.evaluate(DISMISS).catch(() => {});
  await sleep(500);
  return page;
}

// Quick wheel pass: loads lazy content / infinite feeds, measures how far the page goes, returns to the top.
// Scroll-jacked pages (no native scroll position) are measured by watching the pixels change.
async function measurePage(page, { width, height, warmupMs, onInfo }) {
  await page.evaluate(PROBE);
  await page.mouse.move(width / 2, height / 2);
  onInfo?.('Measuring the page');
  const shot = async () => createHash('md5').update(await page.screenshot({ type: 'jpeg', quality: 20 })).digest('hex');
  const t0w = Date.now(); let last = -1, stall = 0, reached = 0, sent = 0, changedAt = 0, native = false, h0 = null;
  while (Date.now() - t0w < warmupMs) {
    await page.mouse.wheel({ deltaY: 450 }); sent += 450; await sleep(65);
    const [p, M] = await page.evaluate(() => [__sp.pos(), __sp.max()]);
    reached = Math.max(reached, p); if (p > 0) native = true;
    if (!native) {                                              // the scroll position hasn't moved (yet): watch the pixels as well
      const h = await shot();
      if (h !== h0) { h0 = h; changedAt = sent; stall = 0; } else stall++;
      if (stall > 6 && !(M > 10 && sent < 3000)) break;
    } else {
      stall = p === last ? stall + 1 : 0; last = p;
      if ((stall > 6 && p >= M - 2) || stall > 16) break;
    }
  }
  await page.evaluate(() => __sp.set(0));
  if (native || reached > 0) {
    for (let i = 0; i < 60; i++) {
      const p = await page.evaluate(() => __sp.pos()); if (p <= 2) break;
      await page.mouse.wheel({ deltaY: -1500 }); await sleep(40);
    }
  } else {
    for (let rem = sent; rem > 0; rem -= 1500) { await page.mouse.wheel({ deltaY: -Math.min(1500, rem) }); await sleep(40); }
    await sleep(900);
  }
  await sleep(500);
  const M = await page.evaluate(() => __sp.max());
  const hijacked = !native;                                       // content moves without a scroll position (scroll-jacked / smooth-scroll)
  return { D: hijacked ? changedAt : Math.max(reached, M), hijacked };
}

// Hosted-friendly capture: the whole page as tall JPEG tiles. The app then scrolls through them smoothly, which is
// fast and smooth even on a small machine. (Fixed headers appear once; videos/animations are not captured.)
export async function capturePageTiles({
  browser, url, width = 1280, height = 800, tileH = 3000, maxPageH = 30000, budgetMs = 30000, warmupMs = 3500,
  gotoMs = 15000, quality = 72, skipIdle = true, tileTimeoutMs = 12000, keepPageOpen = false, prepare, onTile, onInfo,
}) {
  const t0 = Date.now();
  const page = await openPage(browser, url, { width, height, gotoMs, skipIdle, prepare, onInfo });
  try {
    const { D, hijacked } = await measurePage(page, { width, height, warmupMs, onInfo });
    // web apps that scroll inside a box: let the page grow to the content's full height so a normal full-page capture works
    let unlocked = false;
    if ((await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)) <= 10 && D > 0) {
      unlocked = await page.evaluate(() => {
        const sc = [...document.querySelectorAll('body *')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight - e.clientHeight > 10)
          .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
        if (!sc) return false;
        for (let e = sc; e && e !== document.documentElement; e = e.parentElement) {
          for (const [k, v] of [['overflow', 'visible'], ['height', 'auto'], ['max-height', 'none'], ['min-height', '0']]) e.style.setProperty(k, v, 'important');
        }
        document.documentElement.style.setProperty('overflow', 'visible', 'important'); document.documentElement.style.setProperty('height', 'auto', 'important');
        return true;
      }).catch(() => false);
      await sleep(400);
    }
    // freeze animations so heavy landing pages settle and screenshots finish quickly
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' }).catch(() => {});
    await page.evaluate(() => { document.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch {} }); }).catch(() => {});
    const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    const pageH = Math.min(maxPageH, Math.max(height, docH));
    onInfo?.(`Capturing the page (${Math.round(pageH)} px)`);
    let y = 0, count = 0;
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot timeout')), ms))]);
    let slow = false;
    while (y < pageH && (count === 0 || Date.now() - t0 < budgetMs)) {
      const h = Math.min(tileH, pageH - y);
      const left = Math.max(4000, budgetMs - (Date.now() - t0));
      try {
        const buf = await withTimeout(page.screenshot({ type: 'jpeg', quality, clip: { x: 0, y, width, height: h }, captureBeyondViewport: true }), Math.min(tileTimeoutMs, left));
        onTile({ y, h, data: Buffer.from(buf).toString('base64') }); count++; y += h;
      } catch (e) {
        slow = true;
        if (count > 0) break;                                              // keep what we have
        try {                                                              // heavy page: one plain screenshot of the top of the page
          await page.evaluate(() => __sp.set(0)).catch(() => {});
          const buf = await withTimeout(page.screenshot({ type: 'jpeg', quality: 60 }), 10000);
          onTile({ y: 0, h: height, data: Buffer.from(buf).toString('base64') }); count++; y = height; break;
        } catch { throw new Error("This page is too heavy for the hosted recorder. Run the local app (npm start) to record it."); }
      }
    }
    return { width, viewH: height, pageHeight: Math.round(y), fullHeight: Math.round(docH), tiles: count, truncated: y < Math.min(docH, pageH) || docH > maxPageH, slow, scrollJacked: hijacked, unlocked };
  } finally { if (!keepPageOpen) page.close().catch(() => {}); }
}

export async function recordPage({
  browser, url, mode = 'scroll', duration = 0, speed = 350, width = 1440, height = 900,
  maxScrollSec = 28, warmupMs = 5000, gotoMs = 20000, quality = 55, minFrameGap = 0.05,
  skipIdle = false, interact = 0, prepare, onFrame, onInfo, onDone,
}) {
  const page = await openPage(browser, url, { width, height, gotoMs, skipIdle, prepare, onInfo });
  try {
    if (mode === 'screenshot') return { image: await page.screenshot({ type: 'jpeg', quality: 88 }) };
    const { D, hijacked } = await measurePage(page, { width, height, warmupMs, onInfo });

    // 2) the recording
    const cdp = await page.createCDPSession();
    let t00 = null, lastT = -1, n = 0, lastFrameAt = Date.now();
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      lastFrameAt = Date.now();
      if (t00 === null) t00 = metadata.timestamp;
      if (metadata.timestamp - lastT < minFrameGap) return;
      lastT = metadata.timestamp; n++; onFrame({ ts: metadata.timestamp, data });
    });
    const level = Math.max(0, Math.min(3, Math.round(+interact || 0))), mouse = { x: width / 2, y: height / 2 };
    if (level > 0) { await page.evaluate(CURSOR).catch(() => {}); await page.mouse.move(mouse.x, mouse.y); }
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    await sleep(500);
    if (level >= 2) {                                        // intro: point at the site's menu before scrolling
      onInfo?.('Recording (pointing at the menu)');
      if (await doInteraction(page, mouse, level, { intro: true }).catch(() => false)) { await moveMouse(page, mouse, width / 2, height / 2, 500); await sleep(400); }
    }
    const gap = () => height * (level === 1 ? rnd(2.0, 3.5) : level === 2 ? rnd(1.2, 2.4) : rnd(0.8, 1.6));

    const fixed = +duration > 0;
    const scrollSec = fixed ? Math.min(+duration, maxScrollSec) : maxScrollSec;
    const pace = fixed && D > 0 ? D / scrollSec : Math.max(speed, D / scrollSec);
    onInfo?.(D > 0 ? `Recording (page is ~${Math.round(D)} px long)` : 'Recording');
    const t0 = Date.now(); let lt = t0, acc = 0, hold = 0, reason = 'time', sentRec = 0, lastP = -1, lastMoveAt = t0, rampFrom = t0, pausedMs = 0, pauses = 0, nextPauseAt = level ? gap() : Infinity;
    for (;;) {
      const now = Date.now(), dt = Math.min(0.1, (now - lt) / 1000), el = now - t0; lt = now;
      if (el > (scrollSec + 3) * 1000 + pausedMs) { reason = 'time limit'; break; }
      const [np, M] = await page.evaluate(() => [__sp.pos(), __sp.max()]);
      const p = hijacked ? sentRec : np, target = hijacked ? D : Math.max(D, M);
      if (target > 0 && p >= target - 2) { hold += dt; if (hold > (hijacked ? 1.0 : 0.5)) { reason = 'bottom'; break; } } else hold = 0;
      if (np !== lastP) { lastP = np; lastMoveAt = now; }
      const idleFor = now - Math.max(lastMoveAt, lastFrameAt);                // either a moving scroll position or fresh frames means it is still going
      if (el > 2500 && idleFor > 1800) { reason = 'nothing moves any more'; break; }
      const canPause = level > 0 && pauses < 14 && target - p > height * 0.7;
      if (canPause && p >= nextPauseAt) {                                      // a natural break: stop, maybe point at something, carry on
        const t1 = Date.now(); pauses++;
        const r = Math.random(), many = level === 3 ? (r < 0.4 ? 3 : 2) : level === 2 ? (r < 0.3 ? 2 : 1) : (r < 0.35 ? 1 : 0);
        await sleep(rnd(350, 700));
        for (let k = 0; k < many; k++) { if (!(await doInteraction(page, mouse, level).catch(() => false))) break; }
        if (many) await moveMouse(page, mouse, width / 2, height / 2, 450);
        await sleep(rnd(400, 900));
        pausedMs += Date.now() - t1; nextPauseAt = p + gap(); rampFrom = Date.now(); lt = rampFrom; lastMoveAt = lastFrameAt = rampFrom; acc = 0; continue;
      }
      const approach = canPause ? Math.min(1, Math.max(0.18, (nextPauseAt - p) / (pace * 0.45))) : 1;   // ease to a stop before a break
      const ramp = Math.min(1, (now - rampFrom) / 700), slow = (target > 0 ? Math.min(1, Math.max(0.12, (target - p) / (pace * 0.55))) : 1) * approach;
      acc += pace * ramp * slow * dt;
      const dy = Math.floor(acc); acc -= dy;
      if (dy > 0) { await page.mouse.wheel({ deltaY: dy }); sentRec += dy; }
      await sleep(14);
    }
    await sleep(500);
    await cdp.send('Page.stopScreencast').catch(() => {});
    if (!n) throw new Error('The page did not produce any frames.');
    const info = { frames: n, length: Math.max(2, lastT - t00 + 0.25), pageHeight: Math.round(D), ended: reason };
    if (onDone) await onDone(page, info);
    return info;
  } finally {
    await page.close().catch(() => {});
  }
}
