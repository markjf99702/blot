// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);


const cells = () => page.evaluate(() => blot.game.now.cells);
const idle = () => page.waitForFunction(() => blot.idle(), null, { timeout: 10000 });

// The menu comes up first.
assert.equal(await page.isVisible('#menu'), true, 'no menu');

// A two-player game. The first time, How to play opens by itself.
await page.click('#startTwo');
assert.equal(await page.evaluate(() => document.getElementById('rules').open), true, 'how to play did not open the first time');
await page.click('#closeRules');

// Red drops a blot: it's wet, and it's Blue's turn.
const cell = (i) => page.locator('.cell').nth(i);
await cell(6).click(); await idle();                 // red, row 2 column 1
assert.equal((await cells())[6], 1 | 4, 'red blot is not wet red');
assert.match(await page.textContent('#status'), /Blue/);
await cell(35).click(); await idle();                // blue
await cell(12).click(); await idle();                // red, row 3 column 1
await cell(30).click(); await idle();                // blue

// Red picks the middle crease: the preview offers two prints, and folding makes them.
await page.click('.tab-v0[data-line="3"]');
assert.equal(await page.isVisible('#foldBtn'), true, 'no fold button after picking a crease');
assert.match(await page.textContent('#foldBtn'), /\+2/);
await page.click('#foldBtn');
await idle();
const after = await cells();
assert.equal(after[11], 1, 'the fold did not print onto row 2 column 6');
assert.equal(after[17], 1, 'the fold did not print onto row 3 column 6');
assert.equal(after[6], 1, 'red ink did not dry');
assert.equal(after[35], 2 | 4, 'blue ink should still be wet');

// Undo takes the fold back.
await page.click('#undo');
assert.equal((await cells())[11], 0, 'undo did not take back the fold');

// The last blank square ends the game.
await page.evaluate(() => blot.load({ cells: Array.from({ length: 36 }, (_, i) => (i === 0 ? 0 : i % 2 ? 1 : 2)), turn: 1, ply: 34, history: [] }));
await cell(0).click();
await idle();
assert.equal(await page.isVisible('#over'), true, 'no result at the end');
assert.match(await page.textContent('#overTitle'), /Red wins/);
await page.click('#overMenu');

// Against the computer as Blue: it moves first.
await page.click('[data-level="easy"]');
await page.click('[data-side="2"]');
await page.click('#startAi');
await page.waitForFunction(() => blot.game.now.ply >= 1, null, { timeout: 10000 });
await idle();
assert.equal(await page.evaluate(() => blot.game.now.turn), 2, "it isn't your turn after the computer's move");

// The offline copy lists every file the page needs.
const sw = await readFile(join(root, 'sw.js'), 'utf8');
for (const dir of ['js', 'css', 'fonts']) {
  for (const f of await readdir(join(root, dir))) assert.ok(sw.includes(`'${dir}/${f}'`), `sw.js doesn't list ${dir}/${f}`);
}

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
assert.ok(await page.title(), 'the page did not load offline');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
