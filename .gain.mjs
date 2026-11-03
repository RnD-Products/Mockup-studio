import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, defaultViewport: null, args: ['--hide-scrollbars'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1040 });
const t0 = Date.now();
await page.goto('https://spectacular-bavarois-09fcaa.netlify.app/', { waitUntil: 'load' });
// when does the loading state end?
let loadedAt = null; for (let i = 0; i < 80; i++) { const l = await page.evaluate(() => document.body.classList.contains('is-loading')); if (!l) { loadedAt = ((Date.now() - t0) / 1000).toFixed(1); break; } await new Promise(r => setTimeout(r, 250)); }
console.log('loading state ended after (s):', loadedAt);
await page.mouse.move(720, 520);
const sample = () => page.evaluate(() => Math.round(document.scrollingElement.scrollTop || scrollY));
console.log('start pos', await sample());
let sent = 0; const log = [];
for (let i = 0; i < 40; i++) { await page.mouse.wheel({ deltaY: 40 }); sent += 40; await new Promise(r => setTimeout(r, 30)); if (i % 8 === 7) log.push(`sent ${sent} -> pos ${await sample()}`); }
console.log(log.join('\n')); await new Promise(r => setTimeout(r, 800)); console.log('after settling: sent', sent, '-> pos', await sample(), '(gain', (await sample() / sent).toFixed(2) + ')');
await browser.close();
