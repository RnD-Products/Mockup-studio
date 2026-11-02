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

export async function recordPage({
  browser, url, mode = 'scroll', duration = 0, speed = 350, width = 1440, height = 900,
  maxScrollSec = 28, warmupMs = 5000, gotoMs = 20000, quality = 55, minFrameGap = 0.05,
  skipIdle = false, prepare, onFrame, onInfo, onDone,
}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  if (prepare) await prepare(page);
  try {
    try { await page.goto(url, { waitUntil: 'load', timeout: gotoMs }); }
    catch (e) {
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

    if (mode === 'screenshot') return { image: await page.screenshot({ type: 'jpeg', quality: 88 }) };

    await page.evaluate(PROBE);
    await page.mouse.move(width / 2, height / 2);

    // 1) quick pass: trigger lazy-loaded content / infinite feeds and measure how far the page goes.
    //    Normal pages report a scroll position. Scroll-jacked / smooth-scroll sites (content moves by transform) don't,
    //    so for those we watch the pixels and count how much wheel travel still changes the picture.
    onInfo?.('Measuring the page');
    const shot = async () => createHash('md5').update(await page.screenshot({ type: 'jpeg', quality: 20 })).digest('hex');
    const t0w = Date.now(); let last = -1, stall = 0, reached = 0, sent = 0, changedAt = 0, native = false, h0 = null;
    while (Date.now() - t0w < warmupMs) {
      await page.mouse.wheel({ deltaY: 450 }); sent += 450; await sleep(65);
      const [p, M] = await page.evaluate(() => [__sp.pos(), __sp.max()]);
      reached = Math.max(reached, p); if (p > 0) native = true;
      if (!native && M <= 10) {                                   // no native scrolling: look at the pixels instead
        const h = await shot();
        if (h !== h0) { h0 = h; changedAt = sent; stall = 0; } else stall++;
        if (stall > 6) break;
      } else {
        stall = p === last ? stall + 1 : 0; last = p;
        if ((stall > 6 && p >= M - 2) || stall > 16) break;
      }
    }
    // back to the top
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
    const hijacked = !native && (await page.evaluate(() => __sp.max())) <= 10;
    let D = hijacked ? changedAt : Math.max(reached, await page.evaluate(() => __sp.max()));

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
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    await sleep(500);

    const fixed = +duration > 0;
    const scrollSec = fixed ? Math.min(+duration, maxScrollSec) : maxScrollSec;
    const pace = fixed && D > 0 ? D / scrollSec : Math.max(speed, D / scrollSec);
    onInfo?.(D > 0 ? `Recording (page is ~${Math.round(D)} px long)` : 'Recording');
    const t0 = Date.now(); let lt = t0, acc = 0, hold = 0, reason = 'time', sentRec = 0, lastP = -1, lastMoveAt = t0;
    for (;;) {
      const now = Date.now(), dt = Math.min(0.1, (now - lt) / 1000), el = now - t0; lt = now;
      if (el > (scrollSec + 3) * 1000) { reason = 'time limit'; break; }
      const [np, M] = await page.evaluate(() => [__sp.pos(), __sp.max()]);
      const p = hijacked ? sentRec : np, target = hijacked ? D : Math.max(D, M);
      if (target > 0 && p >= target - 2) { hold += dt; if (hold > (hijacked ? 1.0 : 0.5)) { reason = 'bottom'; break; } } else hold = 0;
      if (np !== lastP) { lastP = np; lastMoveAt = now; }
      const idleFor = hijacked ? now - lastFrameAt : now - lastMoveAt;      // slow machines send frames slowly, so normal pages are judged by scroll position
      if (el > 2500 && idleFor > 1800) { reason = 'nothing moves any more'; break; }
      const ramp = Math.min(1, el / 700), slow = target > 0 ? Math.min(1, Math.max(0.12, (target - p) / (pace * 0.55))) : 1;
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
