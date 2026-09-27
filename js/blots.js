// Ink splat shapes. Each blot is drawn from a seed inside a 100 × 100 square, so the same seed always
// makes the same splat, and a print is the same splat flipped across the crease.

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A closed, smooth path through points (Catmull-Rom turned into cubic Béziers).
function smooth(pts) {
  const n = pts.length;
  const f = (v) => v.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

const cache = new Map();

// { body, drops: [[x, y, r]...], shine } for a seed. `size` shrinks it a little for mud and previews.
export function splat(seed) {
  let s = cache.get(seed);
  if (s) return s;
  const r = rng(seed);
  const cx = 50 + (r() - 0.5) * 8, cy = 50 + (r() - 0.5) * 8;
  const base = 26 + r() * 5;
  const k = 24;
  // A few arms where the ink ran out further, and a gentle wobble everywhere else.
  const arms = [];
  const armCount = 3 + Math.floor(r() * 3);
  for (let a = 0; a < armCount; a++) arms.push({ at: r() * Math.PI * 2, len: 5 + r() * 11, w: 0.12 + r() * 0.16 });
  const ph1 = r() * 6.28, ph2 = r() * 6.28, ph3 = r() * 6.28;
  const pts = [];
  for (let i = 0; i < k; i++) {
    const t = (i / k) * Math.PI * 2;
    let rad = base + Math.sin(t * 2 + ph1) * 2.2 + Math.sin(t * 3 + ph2) * 2.6 + Math.sin(t * 5 + ph3) * 1.4;
    for (const arm of arms) {
      let dt = Math.abs(t - arm.at) % (Math.PI * 2);
      if (dt > Math.PI) dt = Math.PI * 2 - dt;
      rad += arm.len * Math.exp(-(dt * dt) / (2 * arm.w * arm.w));
    }
    rad = Math.min(rad, 44);
    pts.push([cx + Math.cos(t) * rad, cy + Math.sin(t) * rad]);
  }
  // Droplets thrown off past the arms.
  const drops = [];
  for (const arm of arms) {
    if (r() < 0.8) {
      const d = base + arm.len + 5 + r() * 5;
      const x = cx + Math.cos(arm.at) * d, y = cy + Math.sin(arm.at) * d;
      const rr = 2 + r() * 3;
      if (x > rr + 3 && x < 97 - rr && y > rr + 3 && y < 97 - rr) drops.push([x, y, rr]);
    }
  }
  if (r() < 0.6) {
    const t = r() * Math.PI * 2, d = base + 6 + r() * 6;
    const x = cx + Math.cos(t) * d, y = cy + Math.sin(t) * d, rr = 1.5 + r() * 2;
    if (x > 6 && x < 94 && y > 6 && y < 94) drops.push([x, y, rr]);
  }
  // The shine on wet ink runs along a smaller copy of the outline; only a short arc of it is drawn.
  const shine = smooth(pts.map(([x, y]) => [cx + (x - cx) * 0.7, cy + (y - cy) * 0.7]));
  const right = Math.max(...pts.map((q) => q[0]));
  s = { body: smooth(pts), drops, shine, cx, cy, right };
  cache.set(seed, s);
  return s;
}

// Mud: a smear, flatter and wider than a blot.
export function smear(seed) {
  const key = -seed - 1;
  let s = cache.get(key);
  if (s) return s;
  const r = rng(seed * 7 + 3);
  const cx = 50 + (r() - 0.5) * 6, cy = 50 + (r() - 0.5) * 6;
  const angle = r() * Math.PI;
  const pts = [];
  const k = 14;
  for (let i = 0; i < k; i++) {
    const t = (i / k) * Math.PI * 2;
    const rx = 36 + r() * 5, ry = 22 + r() * 6;
    const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
    pts.push([cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]);
  }
  const streaks = [];
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 9 + (r() - 0.5) * 4;
    const len = 20 + r() * 14;
    const x0 = cx + Math.cos(angle) * -len + Math.cos(angle + Math.PI / 2) * off;
    const y0 = cy + Math.sin(angle) * -len + Math.sin(angle + Math.PI / 2) * off;
    const x1 = cx + Math.cos(angle) * len + Math.cos(angle + Math.PI / 2) * off;
    const y1 = cy + Math.sin(angle) * len + Math.sin(angle + Math.PI / 2) * off;
    streaks.push([x0, y0, x1, y1]);
  }
  s = { body: smooth(pts), streaks };
  cache.set(key, s);
  return s;
}

// A fresh seed for a new blot.
export function newSeed() {
  return (Math.random() * 2 ** 31) >>> 0 || 1;
}
