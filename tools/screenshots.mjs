// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// The game in the pictures is the computer playing itself from a fixed seed, and Math.random is seeded
// in the page, so the same pictures come out every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newGame, play, foldChanges, creases } from '../js/rules.js';
import { Engine } from '../js/ai.js';

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
const SEED = 11;
const PLIES = 17;

// The game: the computer against itself, up to a position where the side to move has a good fold.
let a = SEED;
const rnd = () => ((a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32);
const engine = new Engine(6);
let s = newGame(6);
const moves = [];
for (let i = 0; i < PLIES; i++) {
  const { move } = engine.choose(s, 'normal', rnd);
  moves.push(move);
  s = play(s, move).state;
}
let best = null;
for (const c of creases(6)) {
  const k = foldChanges(s.cells, 6, c.axis, c.line, s.turn).length;
  if (!best || k > best.k) best = { ...c, k };
}
console.log(`position after ${PLIES} moves; best fold ${best.axis}${best.line} changes ${best.k}`);

const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: viewport.width < 600, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    localStorage.setItem('blot.v1.seenRules', '1');
  }, SEED);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Plays the game into the page, so every print is the mirror of its blot.
async function setUp(page, asComputer) {
  await page.evaluate(() => blot.load({ cells: Array(36).fill(0), turn: 1, ply: 0, history: [] }, { mode: 'two' }));
  for (const m of moves) await page.evaluate((m) => blot.play(m), m);
  await page.waitForFunction(() => blot.idle());
  // Label it as a game against the computer, with you to move.
  if (asComputer) await page.evaluate((human) => blot.as('ai', human), s.turn);
}

// Starts the fold and holds it partway, `t` milliseconds into the first half.
async function holdFold(page, t) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate((b) => { blot.play({ type: 'fold', axis: b.axis, line: b.line }); }, best);
  await page.waitForTimeout(30);
  await page.evaluate((t) => document.getAnimations().forEach((x) => { x.pause(); x.currentTime = t; }), t);
  await page.waitForTimeout(80);
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await page.evaluate(() => document.getElementById('resume').hidden = true);
  await page.screenshot({ path: join(root, 'docs/phone-menu.png') });

  await setUp(page, true);
  await page.evaluate((b) => blot.preview(b.axis, b.line), best);
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(root, 'docs/phone-play.png') });

  await page.evaluate(() => blot.preview(null, null));
  await holdFold(page, 200);
  await page.screenshot({ path: join(root, 'docs/phone-fold.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: the real board, mid-fold, beside the name.
{
  const page = await open({ width: 1200, height: 630 }, 1);
  await setUp(page, false);
  await page.addStyleTag({ content: `
    .play { --paper-size: 440px !important; --tab: 0px !important; padding: 0 !important; }
    .topbar, .bar, .tab { display: none !important; }
    .stage { position: absolute; right: 110px; top: calc(50% - 50px); transform: translateY(-50%); }
    .og { position: absolute; left: 90px; top: 50%; transform: translateY(-50%); width: 480px; }
    .og h1 { font-size: 150px; margin: 0 0 10px; }
    .og p { font-size: 34px; line-height: 1.25; margin: 0; }
  ` });
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'og';
    d.innerHTML = '<h1>Blot</h1><p>Drop ink, fold the paper, and your wet ink prints across the crease.</p>';
    document.getElementById('play').append(d);
  });
  await holdFold(page, 200);
  const png = await page.screenshot();
  await writeFile(join(root, 'og.png'), await small(png));
  await page.context().close();
}

// Down to a 256-colour palette, which keeps the file small.
async function small(png) {
  try {
    const UPNG = require('upng-js');
    const img = UPNG.decode(png);
    return Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256));
  } catch { return png; }
}

await browser.close();
server.close();
console.log('screenshots written');
