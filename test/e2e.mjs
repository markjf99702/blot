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
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
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

// A win against the computer counts as soon as the last move is made, even if you don't stay to watch it land.
const lastFold = Array.from({ length: 36 }, (_, i) => (i % 2 ? 1 : 2));
lastFold[2] = 0; lastFold[3] = 1 | 4;                // one blank square, facing wet red across the middle crease
const record = () => page.evaluate(() => JSON.parse(localStorage.getItem('blot.v1')).record);
const winByFolding = async () => {
  await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 35, history: [] }, { mode: 'ai', level: 'normal', human: 1 }), lastFold);
  await page.click('.tab-v0[data-line="3"]');
  await page.click('.tab-v0[data-line="3"]');
};
await winByFolding();
await page.reload();                                 // while the paper is still folding
assert.deepEqual(await record(), { normal: { w: 1, l: 0 } }, 'a win was lost when the page reloaded during the last fold');
await winByFolding();
await page.evaluate(() => { document.getElementById('toMenu').click(); document.getElementById('startTwo').click(); });
assert.deepEqual(await record(), { normal: { w: 2, l: 0 } }, 'a win was lost when a new game started during the last fold');
await idle();
// A finished game that an earlier version saved without counting is counted when the page opens.
await page.evaluate((cells) => {
  const saved = JSON.parse(localStorage.getItem('blot.v1'));
  Object.assign(saved.game, { mode: 'ai', level: 'hard', human: 1, over: true, recorded: false });
  saved.game.now.cells = cells;
  localStorage.setItem('blot.v1', JSON.stringify(saved));
}, lastFold.map((v, i) => (i === 2 ? 1 : v & 3)));
await page.reload();
assert.match(await page.textContent('#record'), /Normal: 2 won, 0 lost · Hard: 1 won, 0 lost/);

// The result waits for the last fold to land. Meanwhile the paper stays put and the top bar still works.
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 35, history: [] }), lastFold);
const landing = await page.evaluate(() => {
  const top = () => document.querySelector('.paper').getBoundingClientRect().top;
  const before = top();
  blot.play({ type: 'fold', axis: 'v', line: 3 });
  const b = document.getElementById('toMenu').getBoundingClientRect();
  return {
    folding: !!document.querySelector('.flap'),
    result: !document.getElementById('over').hidden,
    moved: Math.round(top() - before),
    menu: !!document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).closest('#toMenu'),
  };
});
assert.deepEqual(landing, { folding: true, result: false, moved: 0, menu: true }, 'the result came up before the last fold landed');
await idle();
assert.equal(await page.isVisible('#over'), true, 'no result once the last fold landed');
assert.match(await page.textContent('#overTitle'), /Red wins/);
await page.click('#overMenu');

// The mouse passing over a tab leaves the computer's fold preview alone...
const computerFolds = Array(36).fill(0);
for (const r of [0, 1, 2, 3]) { computerFolds[r * 6] = 1 | 4; computerFolds[r * 6 + 5] = 2 | 4; }
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 8, history: [] }, { mode: 'ai', level: 'hard', human: 2 }), computerFolds);
const hovered = await (await page.waitForFunction(() => {
  const status = document.getElementById('status');
  if (!status.textContent.includes('folds here')) return false;
  document.querySelector('.tab-h0[data-line="2"]').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  return { preview: !!document.querySelector('.paper > svg.ink .preview'), status: status.textContent };
}, null, { timeout: 15000 })).jsonValue();
assert.deepEqual(hovered, { preview: true, status: 'The computer folds here.' }, "the mouse over a tab wiped the computer's fold preview");
await idle();
// ...and doesn't show what your own fold prints before the paper lands.
const ownFold = Array(36).fill(0);
ownFold[6] = 1 | 4; ownFold[12] = 1 | 4; ownFold[29] = 2 | 4;
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 3, history: [] }), ownFold);
const early = await page.evaluate(() => {
  blot.play({ type: 'fold', axis: 'v', line: 3 });
  document.querySelector('.tab-h0[data-line="4"]').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  return !!document.querySelector('.paper > svg.ink .prints [data-i="11"]');
});
assert.equal(early, false, 'the mouse over a tab showed the prints before the fold landed');
await idle();

// Keyboard focus comes back to the paper once it's your turn again: after a drop against the computer...
const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.tagName);
await page.evaluate(() => blot.load({ cells: Array(36).fill(0), turn: 1, ply: 0, history: [] }, { mode: 'ai', level: 'easy', human: 1 }));
await cell(0).focus();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForFunction(() => blot.game.now.ply === 2 && blot.idle(), null, { timeout: 10000 });
assert.equal(await focused(), 'Row 2, column 2: red, wet', 'keyboard focus fell off the paper after a drop');
// ...after a fold picked on its tab...
const bothWet = Array(36).fill(0);
bothWet[6] = 1 | 4; bothWet[29] = 2 | 4;
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 2, history: [] }), bothWet);
await page.focus('.tab-v0[data-line="3"]');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await idle();
assert.equal(await focused(), 'Fold between columns 3 and 4', 'keyboard focus fell off the paper after a fold');
// ...and after the Fold button.
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 2, history: [] }), bothWet);
await page.focus('.tab-v0[data-line="3"]');
await page.keyboard.press('Enter');
await page.focus('#foldBtn');
await page.keyboard.press('Enter');
await idle();
assert.match(await focused(), /^Row \d, column \d/, 'keyboard focus fell off the paper after the Fold button');

// A new blot pops up from small. (Console warnings count as problems too, so a keyframe the browser rejects fails here.)
await page.evaluate(() => blot.load({ cells: Array(36).fill(0), turn: 1, ply: 0, history: [] }));
const pop = await page.evaluate(() => {
  document.querySelectorAll('.cell')[20].click();
  return document.querySelector('.paper > svg.ink [data-i="20"]').getAnimations()
    .flatMap((a) => a.effect.getKeyframes()).filter((k) => k.transform).length;
});
assert.equal(pop, 3, 'a new blot did not pop');
await idle();

// Going to the menu while the computer shows where it will fold stops that move. It thinks again when you carry on.
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 8, history: [] }, { mode: 'ai', level: 'hard', human: 2 }), computerFolds);
await page.waitForFunction(() => {
  if (!document.getElementById('status').textContent.includes('folds here')) return false;
  document.getElementById('toMenu').click();
  return true;
}, null, { timeout: 15000 });
await page.waitForTimeout(2500);                     // longer than the preview and the fold
assert.equal(await page.evaluate(() => blot.game.now.ply), 8, 'the computer moved while you were on the menu');
await page.click('#resume');
await page.waitForFunction(() => blot.game.now.ply === 9 && blot.idle(), null, { timeout: 15000 });
// Nor does going there while your own fold is still playing out: the computer waits until you're back.
const redWet = Array(36).fill(0);
redWet[6] = 1 | 4;                                   // Blue has no wet ink, so the computer replies with a quick drop
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 2, history: [] }, { mode: 'ai', level: 'easy', human: 1 }), redWet);
await page.evaluate(() => { blot.play({ type: 'fold', axis: 'v', line: 3 }); document.getElementById('toMenu').click(); });
await page.waitForTimeout(3000);                     // longer than your fold and the computer's reply
assert.equal(await page.evaluate(() => blot.game.now.ply), 3, 'the computer moved behind the menu after your fold');
await page.click('#resume');
await page.waitForFunction(() => blot.game.now.ply === 4 && blot.idle(), null, { timeout: 15000 });

// A new game started while the last one's paper is still folding gets a clean sheet that takes taps straight away.
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 3, history: [] }), ownFold);
const sheet = await page.evaluate(() => {
  blot.play({ type: 'fold', axis: 'v', line: 3 });
  document.getElementById('toMenu').click();
  document.getElementById('startTwo').click();
  const b = document.querySelectorAll('.cell')[14].getBoundingClientRect();
  return {
    flap: !!document.querySelector('.flap'),
    clipped: document.querySelector('.paper > svg.ink').style.clipPath,
    tappable: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).classList.contains('cell'),
  };
});
assert.deepEqual(sheet, { flap: false, clipped: '', tappable: true }, "the last game's fold showed over the new one");
await idle();

// The spare tab at the far end of a crease is hidden from screen readers, so a tap on it picks the crease without focusing it.
await page.evaluate((cells) => blot.load({ cells, turn: 1, ply: 2, history: [] }), bothWet);
await page.click('.tab-v1[data-line="2"]');
assert.equal(await page.isVisible('#foldBtn'), true, 'the spare tab did not pick its crease');
assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-hidden')), null, 'the spare tab took focus');
await page.click('#cancelFold');
await page.click('#toMenu');

// Against the computer as Blue: it moves first.
await page.click('[data-level="easy"]');
await page.click('[data-side="2"]');
await page.click('#startAi');
await page.waitForFunction(() => blot.game.now.ply >= 1, null, { timeout: 10000 });
await idle();
assert.equal(await page.evaluate(() => blot.game.now.turn), 2, "it isn't your turn after the computer's move");

// A damaged save doesn't stop the page: whatever isn't the shape the game saves is left out, and the rest is kept.
const other = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page2 = await other.newPage();
page2.on('pageerror', e => problems.push(e.message));
page2.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
await page2.goto(base);
const opensWith = async (raw) => {
  await page2.evaluate((raw) => { localStorage.setItem('blot.v1', raw); localStorage.setItem('blot.v1.seenRules', '1'); }, raw);
  await page2.reload();
  return page2.evaluate(() => ({
    menu: !document.getElementById('menu').hidden,
    checked: [...document.querySelectorAll('[aria-checked="true"]')].map((b) => b.textContent.trim()),
    record: document.getElementById('record').textContent,
  }));
};
for (const raw of ['null', '42', '[1,2]', '{oops',
  JSON.stringify({ prefs: { level: 'impossible', side: 7 }, record: { easy: 'x', hard: null } }),
  JSON.stringify({ game: { n: 6, now: { turn: 1 }, mode: 'two', past: [] } }),
  JSON.stringify({ game: { n: 6, now: { cells: [0, 0, 0], turn: 1, ply: 0, history: [], looks: [], last: -1 }, mode: 'two', past: [] } }),
  JSON.stringify({ game: { n: 6, now: { cells: Array(36).fill(0), turn: 1, ply: 0, history: [], looks: Array(36).fill(null), last: -1 }, mode: 'two' } }),
]) {
  assert.deepEqual(await opensWith(raw), { menu: true, checked: ['Normal', 'Red, first'], record: '' }, `the page did not open cleanly from the save ${raw}`);
}
await page2.click('#startAi');
await page2.locator('.cell').nth(0).click();
await page2.waitForFunction(() => blot.game.now.ply >= 1, null, { timeout: 10000 });
const good = JSON.parse(await page.evaluate(() => localStorage.getItem('blot.v1')));
good.record.easy = { w: 3, l: 1, d: 2 };              // the very first version also counted draws
await opensWith(JSON.stringify(good));
assert.equal(await page2.evaluate(() => JSON.stringify(blot.game.now.cells)), JSON.stringify(good.game.now.cells), 'a good save lost its game');
await page2.click('#toMenu');
assert.equal(await page2.textContent('#record'), 'Easy: 3 won, 1 lost · Normal: 2 won, 0 lost · Hard: 1 won, 0 lost');
await other.close();

// In dark mode Blue's dot in the score has the same light ring as the one on the menu, or it vanishes into the chip.
const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
const page3 = await dark.newPage();
await page3.goto(base);
assert.equal(await page3.evaluate(() => getComputedStyle(document.querySelector('.score.blue .pot')).boxShadow),
  await page3.evaluate(() => getComputedStyle(document.querySelector('.dot.blue')).boxShadow), "Blue's score dot has no ring");
await dark.close();

// With reduced motion the result card just appears; otherwise it rises into place.
const still = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page4 = await still.newPage();
await page4.goto(base);
const rise = (p) => p.evaluate(() => getComputedStyle(document.querySelector('.over-card')).animationName);
assert.equal(await rise(page4), 'none', 'the result card moves with reduced motion on');
assert.equal(await rise(page), 'rise');
await still.close();

// How to play opens at the top each time, with its moving examples in view.
await page.click('#helpBtn');
assert.ok(await page.evaluate(() => { const r = document.getElementById('rules'); r.scrollTop = 400; return r.scrollTop; }) > 0);
await page.click('#closeRules');
await page.click('#helpBtn');
assert.equal(await page.evaluate(() => document.getElementById('rules').scrollTop), 0, 'How to play opened where it was last scrolled to');
await page.click('#closeRules');

// On the menu each choice is one stop for the Tab key, on what's picked, and the up and down arrows move the pick too.
await page.click('#toMenu');
assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role=radio]')].map((b) => b.tabIndex)), [0, -1, -1, -1, 0], 'every option is a Tab stop');
await page.focus('[data-level="easy"]');
await page.keyboard.press('ArrowDown');
assert.equal(await page.getAttribute('[data-level="normal"]', 'aria-checked'), 'true', 'the down arrow did not pick the next level');
await page.keyboard.press('Tab');
assert.equal(await page.evaluate(() => document.activeElement.dataset.side), '2', 'Tab did not go straight to the picked ink');
await page.keyboard.press('ArrowUp');
assert.equal(await page.getAttribute('[data-side="1"]', 'aria-checked'), 'true', 'the up arrow did not pick the other ink');

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
