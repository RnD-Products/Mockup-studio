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

// Runs inside the page (authored as a normal function, then sent as text): finds things worth interacting with in the
// current view, based on the site's structure. Steppers, side-scrolling rows, carousels and card rows come first.
function findInPage() {
  const vw = innerWidth, vh = innerHeight, out = [];
  window.__cid = window.__cid || 0;
  const geom = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 14 || r.height < 12) return null;
    if (r.bottom < vh * 0.08 || r.top > vh * 0.92 || r.right < 6 || r.left > vw - 6) return null;
    const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.1 || s.pointerEvents === 'none') return null;
    const x = Math.min(vw - 12, Math.max(12, r.left + r.width / 2)), y = Math.min(vh * 0.92, Math.max(vh * 0.08, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y); if (!hit || !(e === hit || e.contains(hit) || hit.contains(e))) return null;
    return { x, y, w: r.width, h: r.height };
  };
  const cid = (e) => { if (!e.dataset.c) e.dataset.c = String(++window.__cid); return +e.dataset.c; };
  const label = (e) => ((e.innerText || '').trim() || (e.getAttribute('aria-label') || '').trim() || (e.getAttribute('title') || '').trim() || (e.value || '').trim());
  const safe = (e) => !(e.matches('a[href]') && !(e.getAttribute('href') || '').startsWith('#')) &&
    !(e.tagName === 'BUTTON' && e.form && (e.getAttribute('type') || 'submit') === 'submit') && !(e.tagName === 'INPUT' && e.type === 'submit') &&
    e.getAttribute('aria-disabled') !== 'true' && !e.disabled;

  // 1) number steppers: a "+" and "−" button (often around a quantity)
  const PLUS = /^(\+|＋|plus|increase|increment|add one|more)$/i, MINUS = /^(−|-|–|—|minus|decrease|decrement|less)$/i;
  const btns = [...document.querySelectorAll('button,[role=button],a[role=button],span[role=button],div[role=button],[class*=plus i],[class*=increase i],[class*=increment i],[class*=minus i],[class*=decrease i],[class*=decrement i],[class*=qty i] button,[class*=quantity i] button,[class*=stepper i] button,[class*=counter i] button')];
  const kindOf = (e) => {
    const l = label(e), c = (typeof e.className === 'string' ? e.className : ''), aria = ((e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).trim();
    if (l.length <= 12 && PLUS.test(l)) return 'plus';
    if (l.length <= 12 && MINUS.test(l)) return 'minus';
    if (/^(increase|plus|increment|add one|add more)\b/i.test(aria)) return 'plus';
    if (/^(decrease|minus|decrement|reduce|remove one)\b/i.test(aria)) return 'minus';
    if (!l && /(^|[ _-])(plus|increase|increment)([ _-]|$)/i.test(c)) return 'plus';
    if (!l && /(^|[ _-])(minus|decrease|decrement)([ _-]|$)/i.test(c)) return 'minus';
    return '';
  };
  const pluses = btns.filter((b) => kindOf(b) === 'plus' && safe(b)), minuses = btns.filter((b) => kindOf(b) === 'minus' && safe(b));
  for (const p of pluses.slice(0, 12)) {
    const g = geom(p); if (!g) continue;
    let m = null;
    for (let up = p.parentElement, d = 0; up && d < 4 && !m; up = up.parentElement, d++) m = minuses.find((x) => up.contains(x)) || null;
    const mg = m && geom(m);
    out.push({ kind: 'stepper', ...g, id: cid(p), mx: mg ? mg.x : null, my: mg ? mg.y : null });
  }

  // 2) rows that scroll sideways (overflow-x), and carousels with next / previous arrows
  let n = 0, hs = 0;
  for (const e of document.querySelectorAll('div,ul,ol,section,main,article,nav')) {
    if (++n > 2500 || hs >= 4) break;
    if (!/(auto|scroll)/.test(getComputedStyle(e).overflowX)) continue;
    const range = e.scrollWidth - e.clientWidth; if (range < 60 || e.clientWidth < 240 || e.clientHeight < 50) continue;
    const g = geom(e); if (g) { out.push({ kind: 'hscroll', ...g, id: cid(e), range }); hs++; }
  }
  // horizontal tracks that are moved by script (overflow hidden/clip with a much wider track inside): wheel sideways or drag
  let hd = 0, ns = 0;
  for (const e of document.querySelectorAll('section,div,ul,main,article')) {
    if (++ns > 2500 || hd >= 3) break;
    if (e === document.body || e === document.documentElement || !/(hidden|clip)/.test(getComputedStyle(e).overflowX)) continue;
    const range = e.scrollWidth - e.clientWidth; if (range < 140 || e.clientWidth < 380 || e.clientHeight < 80) continue;
    if (e.querySelectorAll('img,video,article,li,[class*=card i],[class*=slide i],[class*=item i],[class*=cell i]').length < 3) continue;
    const g = geom(e); if (g) { out.push({ kind: 'hdrag', ...g, id: cid(e), range }); hd++; }
  }
  const NEXT = '[class*="swiper-button-next" i],[class*="slick-next" i],[class*="carousel-control-next" i],[class*="owl-next" i],[class*="splide__arrow--next" i],[class*="next-arrow" i],[class*="arrow-next" i],[class*="arrow-right" i],[class*="btn-next" i],button[aria-label*="next" i],[role=button][aria-label*="next" i],[aria-label*="next slide" i]';
  const PREV = '[class*="swiper-button-prev" i],[class*="slick-prev" i],[class*="carousel-control-prev" i],[class*="owl-prev" i],[class*="splide__arrow--prev" i],[class*="prev-arrow" i],[class*="arrow-prev" i],[class*="arrow-left" i],[class*="btn-prev" i],button[aria-label*="prev" i],[role=button][aria-label*="prev" i]';
  let cs = 0;
  for (const nx of document.querySelectorAll(NEXT)) {
    if (cs >= 3 || !safe(nx) || /disabled/i.test(typeof nx.className === 'string' ? nx.className : '')) continue;
    const g = geom(nx); if (!g) continue;
    let pv = null;
    for (let up = nx.parentElement, d = 0; up && d < 5 && !pv; up = up.parentElement, d++) pv = up.querySelector(PREV);
    const pg = pv && safe(pv) && geom(pv);
    out.push({ kind: 'carousel', ...g, id: cid(nx), px: pg ? pg.x : null, py: pg ? pg.y : null }); cs++;
  }

  // tabs, pills, segmented controls, radio groups: click through them
  const groups = new Map();
  for (const t of document.querySelectorAll('[role=tab],[role=tablist] > *,[role=radio],[role=radiogroup] > *,[class*=tabs i] > button,[class*=tabs i] > li,[class*=tabs i] > a[href^="#"],[class*=segment i] > button,[class*=filter i] > button,[class*=pills i] > li,[class*=pills i] > button')) {
    const par = t.parentElement; if (!par) continue;
    if (!groups.has(par)) groups.set(par, []); groups.get(par).push(t);
  }
  let tg = 0;
  for (const [, items] of groups) {
    if (tg >= 3 || items.length < 2 || items.length > 10) continue;
    const ok = items.filter((t) => safe(t) && geom(t)); if (ok.length < 2) continue;
    const pts = ok.map((t) => { const g = geom(t); return { x: g.x, y: g.y, id: cid(t) }; });
    const selIdx = ok.findIndex((t) => t.getAttribute('aria-selected') === 'true' || t.getAttribute('aria-checked') === 'true' || /(^|[ _-])(active|selected|is-on|current|on)([ _-]|$)/i.test(typeof t.className === 'string' ? t.className : ''));
    out.push({ kind: 'tabs', x: pts[0].x, y: pts[0].y, id: pts[0].id, pts, sel: selIdx }); tg++;
  }

  // 3) a row of cards: hover across them one after another
  const cards = [...document.querySelectorAll('article,[class*=card i],li:has(img),figure')].filter((e) => geom(e)).slice(0, 60);
  const byParent = new Map();
  for (const c of cards) { const p = c.parentElement; if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(c); }
  let rows = 0;
  for (const [, kids] of byParent) {
    if (kids.length < 3 || rows >= 2) continue;
    const gs = kids.map((k) => geom(k)).filter(Boolean).sort((a, b) => a.x - b.x);
    if (gs.length >= 3 && Math.max(...gs.map((g) => g.y)) - Math.min(...gs.map((g) => g.y)) < 60) { out.push({ kind: 'cardrow', x: gs[0].x, y: gs[0].y, id: cid(kids[0]), pts: gs.slice(0, 4).map((g) => ({ x: g.x, y: g.y })) }); rows++; }
  }

  // a row of similar boxes (pricing plans, features, products…) even when nothing is called "card"
  let scanned = 0;
  for (const par of document.querySelectorAll('div,ul,section,ol')) {
    if (++scanned > 1500 || rows >= 2) break;
    const kids = [...par.children]; if (kids.length < 3 || kids.length > 8) continue;
    const gs = kids.map((k) => ({ k, r: k.getBoundingClientRect() })).filter(({ r }) => r.width >= 140 && r.width <= 640 && r.height >= 90 && r.height <= 700);
    if (gs.length < 3) continue;
    const tops = gs.map((g) => g.r.top), ws = gs.map((g) => g.r.width);
    if (Math.max(...tops) - Math.min(...tops) > 24 || Math.max(...ws) / Math.min(...ws) > 1.35) continue;
    const pts = gs.map((g) => geom(g.k)).filter(Boolean).sort((a, b) => a.x - b.x); if (pts.length < 3) continue;
    if (out.some((o) => o.kind === 'cardrow' && Math.abs(o.y - pts[0].y) < 40)) continue;
    out.push({ kind: 'cardrow', x: pts[0].x, y: pts[0].y, id: cid(gs[0].k), pts: pts.slice(0, 4).map((g) => ({ x: g.x, y: g.y })) }); rows++;
  }

  // 4) singles
  const add = (sel, kind, limit, ok) => {
    let k = 0;
    for (const e of document.querySelectorAll(sel)) {
      if (k >= limit || (ok && !ok(e))) continue;
      const g = geom(e); if (!g) continue; out.push({ kind, ...g, id: cid(e) }); k++;
    }
  };
  add('header a, nav a, [role=navigation] a, header button, nav button', 'nav', 8);
  add('button, [role=button], a[class*=btn i], a[class*=button i], input[type=submit]', 'button', 10, (e) => !e.closest('header,nav') && !kindOf(e));
  add('summary, [aria-expanded="false"]:not([role=tab])', 'toggle', 6, (e) => !(e.matches('a[href]') && !(e.getAttribute('href') || '').startsWith('#')));
  add('article, [class*=card i], figure, li:has(img)', 'card', 8);
  return out;
}
const FIND = '(' + findInPage.toString() + ')()';
const PRIO = new Set(['stepper', 'hscroll', 'hdrag', 'tabs', 'carousel', 'cardrow']);

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Human-like pointer movement: eased, slightly curved.
async function moveMouse(page, m, x, y, ms = 650) {
  const steps = Math.max(8, Math.round(ms / 16)), x0 = m.x, y0 = m.y, bow = rnd(-0.08, 0.08) * Math.hypot(x - x0, y - y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(x0 + (x - x0) * e + Math.sin(Math.PI * e) * bow, y0 + (y - y0) * e - Math.sin(Math.PI * e) * bow * 0.5);
    await sleep(ms / steps);
  }
  m.x = x; m.y = y;
}
async function clickAt(page, m, x, y, ms = rnd(320, 520)) { await moveMouse(page, m, x, y, ms); await sleep(110); await page.mouse.click(x, y); }

// What to do for each kind of thing found on the page.
const ACTIONS = {
  async stepper(page, m, c) {                       // press "+" a few times, then "−" once
    await clickAt(page, m, c.x, c.y);
    for (let k = 0, n = Math.round(rnd(1, 3)); k < n; k++) { await sleep(rnd(380, 560)); await page.mouse.click(c.x, c.y); }
    if (c.mx != null && Math.random() < 0.9) { await sleep(350); await clickAt(page, m, c.mx, c.my, rnd(260, 400)); await sleep(300); }
  },
  async hscroll(page, m, c) {                       // scroll the row sideways with real wheel events
    await moveMouse(page, m, c.x, c.y, rnd(420, 650)); await sleep(180);
    const total = Math.min(c.range, rnd(1.1, 2.2) * c.w), steps = 22;
    for (let k = 0; k < steps; k++) { await page.mouse.wheel({ deltaX: total / steps }); await sleep(26); }
    await sleep(rnd(350, 600));
    if (Math.random() < 0.5) { for (let k = 0; k < 12; k++) { await page.mouse.wheel({ deltaX: -total / 24 }); await sleep(26); } await sleep(250); }
  },
  async hdrag(page, m, c) {                         // a script-driven horizontal gallery: wheel sideways, or drag it, and check it really moved
    const probe = () => page.evaluate((id) => {
      const e = document.querySelector('[data-c="' + id + '"]'); if (!e) return null;
      let best = e, bw = 0; for (const k of e.querySelectorAll('*')) { const w = k.getBoundingClientRect().width; if (w > bw) { bw = w; best = k; } }
      return Math.round(best.getBoundingClientRect().left + e.scrollLeft);
    }, c.id).catch(() => null);
    const l0 = await probe();
    await moveMouse(page, m, c.x, c.y, rnd(420, 650)); await sleep(160);
    const total = Math.min(c.range, rnd(0.8, 1.4) * c.w);
    for (let k = 0; k < 22; k++) { await page.mouse.wheel({ deltaX: total / 22 }); await sleep(26); }
    await sleep(320);
    let l1 = await probe(), moved = l0 != null && l1 != null && Math.abs(l1 - l0) > 30;
    if (!moved) {                                    // some galleries only react to dragging
      const x0 = c.x + c.w * 0.28, x1 = c.x - c.w * 0.28;
      await moveMouse(page, m, x0, c.y, 280); await page.mouse.down();
      for (let k = 1; k <= 26; k++) { const t = k / 26, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await page.mouse.move(x0 + (x1 - x0) * e, c.y + Math.sin(t * Math.PI) * 6); await sleep(16); }
      await page.mouse.up(); m.x = x1; await sleep(450);
    }
    await sleep(rnd(450, 800));
    if (Math.random() < 0.5) { for (let k = 0; k < 12; k++) { await page.mouse.wheel({ deltaX: -total / 30 }); await sleep(26); } await sleep(300); }
  },
  async tabs(page, m, c) {                          // click through the other tabs / pills, then put the original one back
    const others = c.pts.map((p, i) => i).filter((i) => i !== c.sel).slice(0, 3);
    for (const i of others) { await clickAt(page, m, c.pts[i].x, c.pts[i].y, rnd(320, 520)); await sleep(rnd(750, 1150)); }
    if (c.sel >= 0) { await clickAt(page, m, c.pts[c.sel].x, c.pts[c.sel].y, rnd(320, 480)); await sleep(450); }
  },
  async carousel(page, m, c) {                      // next, next, (previous)
    await clickAt(page, m, c.x, c.y);
    for (let k = 0, n = Math.round(rnd(1, 2)); k < n; k++) { await sleep(rnd(850, 1150)); await page.mouse.click(c.x, c.y); }
    await sleep(rnd(500, 800));
    if (c.px != null && Math.random() < 0.5) { await clickAt(page, m, c.px, c.py, rnd(260, 400)); await sleep(600); }
  },
  async cardrow(page, m, c) {                       // hover across the row, card by card
    for (const p of c.pts.slice(0, Math.round(rnd(2, 4)))) { await moveMouse(page, m, p.x, p.y, rnd(300, 460)); await sleep(rnd(420, 680)); }
  },
  async card(page, m, c) { await moveMouse(page, m, c.x, c.y, rnd(420, 700)); await sleep(rnd(450, 800)); await moveMouse(page, m, c.x + rnd(-0.15, 0.15) * c.w, c.y + rnd(-0.1, 0.1) * c.h, 380); await sleep(250); },
  async button(page, m, c) { await moveMouse(page, m, c.x, c.y, rnd(420, 700)); await sleep(rnd(500, 900)); },
  async nav(page, m, c) { await moveMouse(page, m, c.x, c.y, rnd(420, 700)); await sleep(rnd(550, 950)); },
  async toggle(page, m, c) {                        // open an in-page accordion / tab, then put it back
    await clickAt(page, m, c.x, c.y); await sleep(rnd(800, 1300));
    await page.evaluate((id) => { const e = document.querySelector('[data-c="' + id + '"]'); if (e) e.click(); }, c.id).catch(() => {});
    await sleep(400);
  },
};
const WEIGHT = { stepper: 5, hscroll: 5, hdrag: 5, tabs: 4.5, carousel: 4, cardrow: 4, card: 2, button: 2, toggle: 1.2, nav: 1 };
function chooseCandidate(cands, done, { kinds, level } = {}) {
  const pool = cands.filter((c) => !done.has(c.id) && (!kinds || kinds.includes(c.kind)) && (c.kind !== 'toggle' || level >= 2));
  if (!pool.length) return null;
  let r = Math.random() * pool.reduce((a, c) => a + (WEIGHT[c.kind] || 1), 0);
  for (const c of pool) { r -= WEIGHT[c.kind] || 1; if (r <= 0) return c; }
  return pool[0];
}
// Smooth-scroll sites keep easing for a moment after scrolling stops, so wait until the target stops moving and re-read
// its position before pointing or clicking (otherwise clicks land where the element used to be).
async function settle(page, id) {
  let prev = null;
  for (let i = 0; i < 16; i++) {
    const r = await page.evaluate((id) => { const e = document.querySelector('[data-c="' + id + '"]'); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }, id).catch(() => null);
    if (!r) return false;
    if (prev && Math.abs(r[0] - prev[0]) < 1.5 && Math.abs(r[1] - prev[1]) < 1.5) return true;
    prev = r; await sleep(110);
  }
  return true;
}
async function runAction(page, m, c, done) {
  done.add(c.id);
  await settle(page, c.id);
  const fresh = await page.evaluate(FIND).catch(() => []);
  const c2 = fresh.find((x) => x.id === c.id && x.kind === c.kind);
  if (!c2) { done.delete(c.id); return false; }            // it moved out of view meanwhile: try again later
  await ACTIONS[c2.kind](page, m, c2);
  return true;
}

async function openPage(browser, url, { width, height, gotoMs, skipIdle, prepare, onInfo, onProgress }) {
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
  onInfo?.('Page loaded'); onProgress?.(0.14, 'Page loaded');
  if (!skipIdle) await page.waitForNetworkIdle({ idleTime: 500, timeout: 2500 }).catch(() => {});
  await page.evaluate(DISMISS).catch(() => {});
  await sleep(500);
  return page;
}

// Some sites show an intro / loader for several seconds and ignore scrolling until it is over: wait for that.
async function waitForReady(page, { width, height, onProgress, isCancelled, maxMs = 22000 }) {
  await page.evaluate(PROBE).catch(() => {}); await page.mouse.move(width / 2, height / 2);
  const t0 = Date.now(); let announced = false;
  for (;;) {
    if (isCancelled?.()) throw new Error('Recording cancelled');
    const st = await page.evaluate(() => ({
      loading: /(^|[ _-])(is-)?(loading|preloading|preload|splash|intro|booting)([ _-]|$)/i.test(document.documentElement.className + ' ' + document.body.className),
      max: __sp.max(), pos: __sp.pos(),
    })).catch(() => ({ loading: false, max: 0, pos: 0 }));
    if (!st.loading) {
      if (st.max <= 10 && Date.now() - t0 > 2500) return;                  // nothing to wait for
      await page.mouse.wheel({ deltaY: 160 }); await sleep(350);
      const p2 = await page.evaluate(() => __sp.pos()).catch(() => 0);
      if (p2 > st.pos + 10) { await page.evaluate(() => __sp.set(0)).catch(() => {}); for (let i = 0; i < 20 && (await page.evaluate(() => __sp.pos()).catch(() => 0)) > 2; i++) { await page.mouse.wheel({ deltaY: -400 }); await sleep(60); } await sleep(500); return; }
    }
    if (Date.now() - t0 > maxMs) return;
    if (!announced && Date.now() - t0 > 1200) { announced = true; onProgress?.(0.15, "Waiting for the page's intro to finish"); }
    await sleep(450);
  }
}

// Quick wheel pass: loads lazy content / infinite feeds, measures how far the page goes, returns to the top.
// Scroll-jacked pages (no native scroll position) are measured by watching the pixels change.
async function measurePage(page, { width, height, warmupMs, onInfo, onProgress, isCancelled }) {
  await page.evaluate(PROBE);
  await page.mouse.move(width / 2, height / 2);
  onInfo?.('Measuring the page');
  const shot = async () => createHash('md5').update(await page.screenshot({ type: 'jpeg', quality: 20 })).digest('hex');
  const t0w = Date.now(); let last = -1, stall = 0, reached = 0, sent = 0, changedAt = 0, native = false, h0 = null;
  while (Date.now() - t0w < warmupMs) {
    if (isCancelled?.()) throw new Error('Recording cancelled');
    onProgress?.(0.16 + 0.14 * Math.min(1, (Date.now() - t0w) / warmupMs), 'Measuring the page');
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
    await waitForReady(page, { width, height, maxMs: 12000 });
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
  browser, url, mode = 'scroll', duration = 0, speed = 700, width = 1440, height = 900,
  maxScrollSec = 28, warmupMs = 5000, gotoMs = 20000, quality = 55, minFrameGap = 0.05,
  skipIdle = false, interact = 0, prepare, onFrame, onInfo, onDone, onProgress, isCancelled, onDebug,
}) {
  const page = await openPage(browser, url, { width, height, gotoMs, skipIdle, prepare, onInfo, onProgress });
  try {
    if (mode === 'screenshot') return { image: await page.screenshot({ type: 'jpeg', quality: 88 }) };
    await waitForReady(page, { width, height, onProgress, isCancelled });
    const { D, hijacked } = await measurePage(page, { width, height, warmupMs, onInfo, onProgress, isCancelled });
    onProgress?.(0.3, 'Starting the recording');

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
    const done = new Set(), url0 = page.url();
    if (level >= 2) {                                        // intro: point at the site's menu before scrolling
      const nav = chooseCandidate(await page.evaluate(FIND).catch(() => []), done, { kinds: ['nav', 'button'], level });
      if (nav) { onInfo?.('Recording (pointing at the menu)'); await runAction(page, mouse, nav, done).catch(() => {}); await moveMouse(page, mouse, width / 2, height / 2, 420); await sleep(250); }
    }
    const gap = () => height * (level === 1 ? rnd(3.0, 5.0) : level === 2 ? rnd(2.0, 3.5) : rnd(1.3, 2.3));

    const fixed = +duration > 0;
    const scrollSec = fixed ? Math.min(+duration, maxScrollSec) : maxScrollSec;
    const pace = fixed && D > 0 ? D / scrollSec : Math.max(speed, D / scrollSec);
    onInfo?.(D > 0 ? `Recording (page is ~${Math.round(D)} px long)` : 'Recording');
    const t0 = Date.now(); let lt = t0, acc = 0, hold = 0, reason = 'time', sentRec = 0, lastP = -1, lastMoveAt = t0, rampFrom = t0, pausedMs = 0, pauses = 0, nextPauseAt = level ? gap() : Infinity, nextCheckAt = 0, lastProg = 0;
    // human-like pacing: speed drifts up and down, short breaks, a pause to "read" each new heading, now and then a small scroll back
    let paceMul = 1, mulTarget = 1, nextMulAt = t0 + 800, nextMicroAt = t0 + rnd(1800, 3800), nextHeadAt = t0 + 900, backDone = level < 2 || Math.random() < 0.35, backAt = rnd(0.3, 0.65);
    const readP = level === 3 ? 0.8 : level === 2 ? 0.6 : 0.35;
    for (;;) {
      const now = Date.now(), dt = Math.min(0.45, (now - lt) / 1000), el = now - t0; lt = now;
      if (el > (scrollSec + 3) * 1000 + pausedMs) { reason = 'time limit'; break; }
      if (isCancelled?.()) { reason = 'cancelled'; break; }
      const [np, M] = await page.evaluate(() => [__sp.pos(), __sp.max()]);
      const p = hijacked ? sentRec : np, target = hijacked ? D : Math.max(D, M);
      if (now - lastProg > 180) { lastProg = now; onProgress?.(0.3 + 0.66 * Math.min(1, target > 0 ? p / target : 0.5), 'Recording'); }
      if (target > 0 && p >= target - 2) { hold += dt; if (hold > (hijacked ? 1.0 : 0.5)) { reason = 'bottom'; break; } } else hold = 0;
      if (np !== lastP) { lastP = np; lastMoveAt = now; }
      const idleFor = now - Math.max(lastMoveAt, lastFrameAt);                // either a moving scroll position or fresh frames means it is still going
      if (el > 2500 && idleFor > 1800) { reason = 'nothing moves any more'; break; }
      const canPause = level > 0 && pauses < 24 && target - p > height * 0.12;
      if (canPause && now >= nextCheckAt) {                                    // look at what is on screen right now and act on it
        nextCheckAt = now + 250;
        const cands = await page.evaluate(FIND).catch(() => []);
        onDebug?.({ p: Math.round(p), target: Math.round(target), kinds: cands.map((x) => x.kind).join(',') });
        const scheduled = p >= nextPauseAt;
        let c = chooseCandidate(cands.filter((x) => PRIO.has(x.kind)), done, { level });           // steppers, side-scrollers, carousels, card rows: always worth it
        if (!c && scheduled && Math.random() < (level === 3 ? 0.85 : level === 2 ? 0.55 : 0.3)) c = chooseCandidate(cands, done, { kinds: ['button', 'card', 'toggle'], level });
        if (scheduled) nextPauseAt = p + gap();
        if (c) {
          const t1 = Date.now(); pauses++;
          onProgress?.(0.3 + 0.66 * Math.min(1, target > 0 ? p / target : 0.5), `Interacting: ${({ hscroll: 'scrolling a row sideways', hdrag: 'moving a gallery sideways', stepper: 'pressing + / −', tabs: 'clicking tabs', carousel: 'flipping a carousel', cardrow: 'hovering cards', toggle: 'opening an accordion', card: 'hovering a card', button: 'hovering a button', nav: 'pointing at the menu' })[c.kind] || 'pointing at the page'}`);
          await sleep(rnd(150, 320));
          await runAction(page, mouse, c, done).catch(() => {});
          await moveMouse(page, mouse, width / 2, height / 2, 380); await sleep(rnd(120, 300));
          if (page.url() !== url0) {                                           // never end up on another page
            await page.goBack({ waitUntil: 'load', timeout: 8000 }).catch(() => {});
            await page.evaluate(PROBE).catch(() => {}); await page.evaluate(CURSOR).catch(() => {});
          }
          pausedMs += Date.now() - t1; rampFrom = Date.now(); lt = rampFrom; lastMoveAt = lastFrameAt = rampFrom; acc = 0; continue;
        }
      }
      if (level > 0 && target - p > height * 0.4) {
        if (now >= nextMulAt) { mulTarget = rnd(0.72, 1.28); nextMulAt = now + rnd(700, 1500); }
        paceMul += (mulTarget - paceMul) * 0.07;
        let rest = 0;
        if (now >= nextMicroAt) { rest = rnd(180, 520); nextMicroAt = now + rest + rnd(1800, 4200); }          // a short breath
        else if (now >= nextHeadAt) {                                                                          // a new heading came into view: read it
          nextHeadAt = now + 450;
          const head = await page.evaluate(() => {
            const vh = innerHeight;
            for (const e of document.querySelectorAll('h1,h2,h3,[class*=title i],[class*=heading i]')) {
              if (e.dataset.read) continue; const r = e.getBoundingClientRect(); if (r.height < 14 || r.width < 60) continue;
              if (r.top > vh * 0.18 && r.top < vh * 0.5) { e.dataset.read = '1'; const s = getComputedStyle(e); if (s.visibility !== 'hidden' && +s.opacity > 0.2) return true; }
            }
            return false;
          }).catch(() => false);
          if (head && Math.random() < readP) rest = rnd(600, 1300);
        }
        if (!backDone && target > 0 && p / target > backAt) {                                                 // glance back up, then carry on
          backDone = true; const t1 = Date.now();
          for (let k = 0, n = Math.round(rnd(7, 12)); k < n; k++) { await page.mouse.wheel({ deltaY: -rnd(14, 26) }); await sleep(26); }
          await sleep(rnd(450, 800)); pausedMs += Date.now() - t1; rest = 0; lt = Date.now(); acc = 0; continue;
        }
        if (rest) { const t1 = Date.now(); await sleep(rest); pausedMs += Date.now() - t1; lt = Date.now(); lastMoveAt = lastFrameAt = lt; acc = 0; continue; }
      } else paceMul = 1;
      const approach = 1;
      const ramp = Math.min(1, (now - rampFrom) / 350), slow = (target > 0 ? Math.min(1, Math.max(0.12, (target - p) / (pace * 0.55))) : 1) * approach;
      acc += pace * paceMul * ramp * slow * dt;
      const dy = Math.floor(acc); acc -= dy;
      for (let left = dy; left > 0;) { const st = Math.min(left, 150); await page.mouse.wheel({ deltaY: st }); sentRec += st; left -= st; if (left > 0) await sleep(10); }
      await sleep(14);
    }
    onProgress?.(0.97, 'Finishing');
    await sleep(500);
    await cdp.send('Page.stopScreencast').catch(() => {});
    if (reason === 'cancelled') throw new Error('Recording cancelled');
    if (!n) throw new Error('The page did not produce any frames.');
    const info = { frames: n, length: Math.max(2, lastT - t00 + 0.25), pageHeight: Math.round(D), ended: reason };
    if (onDone) await onDone(page, info);
    return info;
  } finally {
    await page.close().catch(() => {});
  }
}

// exposed for tests
export const __internals = { ACTIONS, FIND, moveMouse, chooseCandidate, PROBE, CURSOR };
