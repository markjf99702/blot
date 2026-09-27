// The sheet of paper: drawing the ink, the fold tabs around the edge, previews, and the fold itself.

import { EMPTY, MUD, WET } from './rules.js';
import { splat, smear } from './blots.js';

const SVG = 'http://www.w3.org/2000/svg';
const U = 100; // one square, in SVG units
let uid = 0;

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const INK_NAME = { 1: 'red', 2: 'blue' };

export class Board {
  // host: an empty element. opts: { n, label, onCell(i), onTab(axis, line), onTabHover(axis, line) }.
  // Without onCell and onTab it only draws (the How to play examples).
  constructor(host, opts) {
    this.host = host;
    this.opts = opts;
    this.n = opts.n;
    this.id = 'b' + ++uid;
    this.host.classList.add('sheet');
    this.host.style.setProperty('--n', this.n);
    this.host.innerHTML = '';

    this.paper = el('div', 'paper');
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${this.n * U} ${this.n * U}`);
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.classList.add('ink');
    this.paper.append(this.svg);
    this.host.append(this.paper);

    if (opts.onCell) {
      this.grid = el('div', 'cells');
      this.grid.setAttribute('role', 'grid');
      this.grid.setAttribute('aria-label', opts.label || 'The paper');
      this.cellButtons = [];
      for (let r = 0; r < this.n; r++) {
        const row = el('div', 'cell-row');
        row.setAttribute('role', 'row');
        for (let c = 0; c < this.n; c++) {
          const b = el('button', 'cell');
          b.type = 'button';
          b.setAttribute('role', 'gridcell');
          const i = r * this.n + c;
          b.addEventListener('click', () => opts.onCell(i));
          b.addEventListener('keydown', (e) => this.keyNav(e, i));
          b.tabIndex = i === 0 ? 0 : -1;
          row.append(b);
          this.cellButtons.push(b);
        }
        this.grid.append(row);
      }
      this.paper.append(this.grid);
    }

    if (opts.onTab) {
      this.tabs = [];
      for (const axis of ['v', 'h']) {
        for (let k = 1; k < this.n; k++) {
          for (const end of [0, 1]) {
            const t = el('button', `tab tab-${axis} tab-${axis}${end}`);
            t.type = 'button';
            t.style.setProperty('--at', k / this.n);
            t.dataset.axis = axis;
            t.dataset.line = k;
            t.setAttribute('aria-label', axis === 'v'
              ? `Fold between columns ${k} and ${k + 1}`
              : `Fold between rows ${k} and ${k + 1}`);
            // Each crease has a tab at both ends; the far one is a spare for thumbs, hidden from screen readers.
            if (end === 1) {
              t.setAttribute('aria-hidden', 'true');
              t.tabIndex = -1;
            }
            t.innerHTML = '<i></i>';
            t.addEventListener('click', () => opts.onTab(axis, k));
            t.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && opts.onTabHover?.(axis, k));
            t.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && opts.onTabHover?.(null));
            this.tabs.push(t);
            this.host.append(t);
          }
        }
      }
    }
    this.view = null;
  }

  keyNav(e, i) {
    const n = this.n;
    const r = Math.floor(i / n), c = i % n;
    const to = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1] }[e.key];
    if (!to) return;
    e.preventDefault();
    const [rr, cc] = to;
    if (rr < 0 || cc < 0 || rr >= n || cc >= n) return;
    this.focusCell(rr * n + cc);
  }

  focusCell(i) {
    for (const b of this.cellButtons) b.tabIndex = -1;
    this.cellButtons[i].tabIndex = 0;
    this.cellButtons[i].focus();
  }

  // view: { cells, looks, marks: [{axis, line}], turn }
  // extra: { preview: { axis, line, changes, player }, canFold, pop: i }
  render(view, extra = {}) {
    this.view = view;
    this.extra = extra;
    draw(this.svg, this.n, view, extra, this.id);
    if (this.cellButtons) {
      view.cells.forEach((v, i) => {
        const b = this.cellButtons[i];
        const r = Math.floor(i / this.n) + 1, c = (i % this.n) + 1;
        b.setAttribute('aria-label', `Row ${r}, column ${c}: ${describe(v)}`);
        b.classList.toggle('blank', v === EMPTY);
        b.disabled = !!extra.locked;
        b.dataset.ink = v === EMPTY ? '' : v & 3;
      });
    }
    if (this.tabs) {
      for (const t of this.tabs) {
        const sel = extra.preview && extra.preview.axis === t.dataset.axis && extra.preview.line === +t.dataset.line;
        t.classList.toggle('on', !!sel);
        t.disabled = !extra.canFold || !!extra.locked;
      }
    }
    this.host.dataset.turn = view.turn || '';
  }

  // The pop of a fresh blot.
  pop(i) {
    if (reduceMotion()) return;
    const g = this.svg.querySelector(`[data-i="${i}"]`);
    if (!g) return;
    g.animate([
      { transform: g.getAttribute('transform') + ' translate(50 50) scale(.3) translate(-50 -50)', opacity: 0.2 },
      { transform: g.getAttribute('transform') + ' translate(50 50) scale(1.08) translate(-50 -50)', opacity: 1, offset: 0.7 },
      { transform: g.getAttribute('transform'), opacity: 1 },
    ], { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1.2)' });
  }

  // Folds the paper along a crease and back, switching from `before` to `after` while it's pressed.
  async fold(crease, before, after, player) {
    const { axis, line } = crease;
    const n = this.n;
    this.render(before, { locked: true, preview: null, canFold: false });
    if (reduceMotion()) {
      this.render(after, { locked: true });
      this.svg.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 200 });
      return;
    }
    // The smaller side folds over; when they match, the side with more of the folder's wet ink.
    const lo = line, hi = n - line;
    let flapLow = lo < hi;
    if (lo === hi) {
      let a = 0, b = 0;
      before.cells.forEach((v, i) => {
        if (v !== (player | WET)) return;
        const pos = axis === 'v' ? i % n : Math.floor(i / n);
        if (pos < line) a++; else b++;
      });
      flapLow = a >= b;
    }
    const size = flapLow ? lo : hi;
    const start = flapLow ? 0 : line;
    const pct = (x) => (x / n) * 100 + '%';

    const flap = el('div', `flap flap-${axis} ${flapLow ? 'low' : 'high'}`);
    const front = el('div', 'face front');
    const back = el('div', 'face back');
    const shadeF = el('div', 'shade'), shadeB = el('div', 'shade');
    const innerF = this.svg.cloneNode(true);
    const innerB = this.svg.cloneNode(true);
    for (const inner of [innerF, innerB]) {
      inner.classList.add('flap-art');
      inner.style.setProperty('--span', n / size);
      inner.style.setProperty('--off', -start / size);
    }
    const through = el('div', 'through');
    through.append(innerB);
    front.append(innerF, shadeF);
    back.append(through, shadeB);
    flap.append(front, back);
    if (axis === 'v') { flap.style.left = pct(start); flap.style.width = pct(size); }
    else { flap.style.top = pct(start); flap.style.height = pct(size); }
    this.paper.append(flap);

    // Hide the part of the sheet that has lifted off.
    const cut = (start / n) * 100;
    const inset = axis === 'v'
      ? (flapLow ? `inset(-40px -40px -40px ${cut + (size / n) * 100}%)` : `inset(-40px ${100 - cut}% -40px -40px)`)
      : (flapLow ? `inset(${cut + (size / n) * 100}% -40px -40px -40px)` : `inset(-40px -40px ${100 - cut}% -40px)`);
    this.paper.classList.add('folding');
    this.svg.style.clipPath = inset;
    const hideCells = this.grid;
    if (hideCells) hideCells.style.visibility = 'hidden';

    const rot = axis === 'v' ? 'rotateY' : 'rotateX';
    const sign = axis === 'v' ? (flapLow ? 1 : -1) : (flapLow ? -1 : 1);
    const T = 560;
    const turn = (from, to) => flap.animate(
      [{ transform: `${rot}(${from}deg)` }, { transform: `${rot}(${to}deg)` }],
      { duration: T, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
    const shade = (el, frames) => el.animate(frames, { duration: T, easing: 'linear', fill: 'forwards' });

    shade(shadeF, [{ opacity: 0 }, { opacity: 0.35, offset: 0.5 }, { opacity: 0.55 }]);
    shade(shadeB, [{ opacity: 0.6 }, { opacity: 0.35, offset: 0.5 }, { opacity: 0.04 }]);
    await turn(0, sign * 180).finished;

    // Pressed flat: the ink moves across now, out of sight.
    shadeB.animate([{ opacity: 0.04 }, { opacity: 0.14 }, { opacity: 0.04 }], { duration: 260 });
    await wait(260);
    draw(this.svg, n, after, { locked: true }, this.id);
    const fresh = this.svg.cloneNode(true);
    fresh.style.clipPath = '';
    fresh.classList.add('flap-art');
    fresh.style.setProperty('--span', n / size);
    fresh.style.setProperty('--off', -start / size);
    innerF.replaceWith(fresh);

    shade(shadeB, [{ opacity: 0.04 }, { opacity: 0.35, offset: 0.5 }, { opacity: 0.6 }]);
    shade(shadeF, [{ opacity: 0.55 }, { opacity: 0.35, offset: 0.5 }, { opacity: 0 }]);
    await turn(sign * 180, 0).finished;
    flap.remove();
    this.svg.style.clipPath = '';
    this.paper.classList.remove('folding');
    if (hideCells) hideCells.style.visibility = '';
    this.render(after, { locked: true });
  }
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function describe(v) {
  if (v === EMPTY) return 'blank';
  if ((v & 3) === MUD) return 'mud';
  return INK_NAME[v & 3] + (v & WET ? ', wet' : ', dry');
}

function place(i, n, look) {
  const x = (i % n) * U, y = Math.floor(i / n) * U;
  const fx = look && look.fx, fy = look && look.fy;
  return `translate(${x + (fx ? U : 0)} ${y + (fy ? U : 0)}) scale(${fx ? -1 : 1} ${fy ? -1 : 1})`;
}

// Draws the whole sheet into an <svg>.
function draw(svg, n, view, extra, id) {
  const W = n * U;
  svg.textContent = '';
  const defs = svgEl('defs');
  defs.innerHTML = `
    <filter id="${id}-paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".035 .06" numOctaves="3" seed="8" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 .96  0 0 0 0 .93  0 0 0 0 .87  0 0 0 .22 -.02" result="fibres"/>
      <feComposite in="fibres" in2="SourceGraphic" operator="over"/>
    </filter>
    <filter id="${id}-dry" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="3" seed="3" result="low"/>
      <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="1" seed="5" result="grain"/>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="3" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feColorMatrix in="low" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -.55 1.2" result="soak"/>
      <feComposite in="rough" in2="soak" operator="in"/>
    </filter>
    <filter id="${id}-print" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="2" seed="9" result="grain"/>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -.7 1.25" result="soak"/>
      <feComposite in="rough" in2="soak" operator="in"/>
    </filter>
    <filter id="${id}-wet" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="1" seed="5" result="grain"/>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.5" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="${id}-soft"><feGaussianBlur stdDeviation="1.1"/></filter>
    <pattern id="${id}-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="4" height="9" class="mud-hatch"/>
    </pattern>`;
  svg.append(defs);

  svg.append(svgEl('rect', { x: 0, y: 0, width: W, height: W, class: 'paper-bg' }));
  svg.append(svgEl('rect', { x: 0, y: 0, width: W, height: W, class: 'paper-fibre', filter: `url(#${id}-paper)` }));

  // Pencil lines between the squares.
  const grid = svgEl('g', { class: 'grid' });
  for (let k = 1; k < n; k++) {
    grid.append(svgEl('line', { x1: k * U, y1: 0, x2: k * U, y2: W }));
    grid.append(svgEl('line', { x1: 0, y1: k * U, x2: W, y2: k * U }));
  }
  svg.append(grid);

  // Old folds leave creases in the paper, deeper each time the same line is folded.
  const counts = new Map();
  for (const m of view.marks || []) counts.set(m.axis + m.line, (counts.get(m.axis + m.line) || 0) + 1);
  const creases = svgEl('g', { class: 'creases' });
  for (const [key, count] of counts) {
    const axis = key[0], line = +key.slice(1);
    const depth = Math.min(1, 0.45 + count * 0.2);
    const [x1, y1, x2, y2] = axis === 'v' ? [line * U, 0, line * U, W] : [0, line * U, W, line * U];
    const d = axis === 'v' ? [1.6, 0] : [0, 1.6];
    creases.append(svgEl('line', { x1: x1 - d[0], y1: y1 - d[1], x2: x2 - d[0], y2: y2 - d[1], class: 'crease-dark', opacity: depth }));
    creases.append(svgEl('line', { x1: x1 + d[0], y1: y1 + d[1], x2: x2 + d[0], y2: y2 + d[1], class: 'crease-light', opacity: depth }));
  }
  svg.append(creases);

  const dry = svgEl('g', { class: 'dry', filter: `url(#${id}-dry)` });
  const prints = svgEl('g', { class: 'prints', filter: `url(#${id}-print)` });
  const wet = svgEl('g', { class: 'wet', filter: `url(#${id}-wet)` });
  const shine = svgEl('g', { class: 'shine', filter: `url(#${id}-soft)` });
  const mud = svgEl('g', { class: 'muds', filter: `url(#${id}-dry)` });
  view.cells.forEach((v, i) => {
    if (v === EMPTY) return;
    const look = view.looks[i] || { seed: i + 1 };
    const k = v & 3;
    if (k === MUD) {
      const s = smear(look.seed);
      const g = svgEl('g', { transform: place(i, n, null), 'data-i': i });
      g.append(svgEl('path', { d: s.body, class: 'mud' }));
      g.append(svgEl('path', { d: s.body, fill: `url(#${id}-hatch)`, class: 'mud-grain' }));
      for (const [x0, y0, x1, y1] of s.streaks) {
        g.append(svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'mud-streak' }));
      }
      mud.append(g);
      return;
    }
    const s = splat(look.seed);
    const g = svgEl('g', { transform: place(i, n, look), 'data-i': i, class: `ink-${INK_NAME[k]}` });
    g.append(svgEl('path', { d: s.body }));
    for (const [x, y, r] of s.drops) g.append(svgEl('circle', { cx: x, cy: y, r }));
    if (v & WET) {
      g.append(svgEl('path', { d: s.body, class: 'rim' }));
      wet.append(g);
      // The light comes from the top left whichever way the blot is flipped.
      const from = look.fx ? (look.fy ? 2 : 77) : (look.fy ? 27 : 52);
      const h = svgEl('g', { transform: place(i, n, look) });
      h.append(svgEl('path', { d: s.shine, class: 'gloss', pathLength: 100, 'stroke-dasharray': '17 83', 'stroke-dashoffset': -from }));
      shine.append(h);
    } else (look.print ? prints : dry).append(g);
  });
  svg.append(dry, prints, mud, wet, shine);

  const p = extra && extra.preview;
  if (p) svg.append(previewLayer(n, view, p));
  if (extra && extra.last >= 0) {
    const i = extra.last;
    svg.append(svgEl('rect', {
      x: (i % n) * U + 6, y: Math.floor(i / n) * U + 6, width: U - 12, height: U - 12, rx: 14, class: 'last',
    }));
  }
}

function previewLayer(n, view, p) {
  const W = n * U;
  const g = svgEl('g', { class: `preview by-${INK_NAME[p.player]}` });
  // Shade what the fold can't reach.
  const reach = Math.min(p.line, n - p.line);
  const lo = (p.line - reach) * U, hi = (p.line + reach) * U;
  const shades = p.axis === 'v'
    ? [[0, 0, lo, W], [hi, 0, W - hi, W]]
    : [[0, 0, W, lo], [0, hi, W, W - hi]];
  for (const [x, y, w, h] of shades) if (w > 0 && h > 0) g.append(svgEl('rect', { x, y, width: w, height: h, class: 'out-of-reach' }));

  // Which of the folder's blots press, and what they leave.
  const pressing = new Set();
  for (const c of p.changes) pressing.add(c.from);
  for (const i of pressing) {
    const x = (i % n) * U, y = Math.floor(i / n) * U;
    g.append(svgEl('rect', { x: x + 5, y: y + 5, width: U - 10, height: U - 10, rx: 16, class: 'source' }));
  }
  for (const c of p.changes) {
    const src = view.looks[c.from] || { seed: c.from + 1 };
    if (c.kind === 'mud') {
      const s = smear(src.seed);
      const m = svgEl('g', { transform: place(c.at, n, null), class: 'ghost-mud' });
      m.append(svgEl('path', { d: s.body }));
      g.append(m);
    } else {
      const look = mirrorLook(src, p.axis);
      const s = splat(look.seed);
      const m = svgEl('g', { transform: place(c.at, n, look), class: 'ghost' });
      m.append(svgEl('path', { d: s.body }));
      for (const [x, y, r] of s.drops) m.append(svgEl('circle', { cx: x, cy: y, r }));
      g.append(m);
    }
  }
  const [x1, y1, x2, y2] = p.axis === 'v' ? [p.line * U, -6, p.line * U, W + 6] : [-6, p.line * U, W + 6, p.line * U];
  g.append(svgEl('line', { x1, y1, x2, y2, class: 'fold-line' }));
  return g;
}

// The look of a print: the source blot flipped across the crease.
export function mirrorLook(src, axis) {
  return {
    seed: src.seed,
    fx: axis === 'v' ? !src.fx : !!src.fx,
    fy: axis === 'h' ? !src.fy : !!src.fy,
    print: true,
  };
}
