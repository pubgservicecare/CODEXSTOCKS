// CODE X STOCKS — original battleground artwork generator.
//
// Draws layered, atmospheric landscape scenes as SVG (seeded, deterministic) and renders them to
// optimised WebP with sharp (already installed as a Next.js dependency). Everything here is
// original vector artwork: no game screenshots, no third-party images, no logos.
//
//   node scripts/art/generate-art.mjs            -> writes packages/ui/assets/art/*.webp
//   node scripts/art/generate-art.mjs --svg      -> also writes the source SVGs (for inspection)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "packages/ui/assets/art");
const W = 2560;
const H = 1440;

/* ----------------------------------------------------------------------------------------- */
/* helpers                                                                                   */
/* ----------------------------------------------------------------------------------------- */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const f = (n) => Math.round(n * 10) / 10;
let uid = 0;
const id = (p) => `${p}${++uid}`;

/** A terrain ridge as a list of points (y grows downward). */
function ridge(seed, { y, amp, freq = 2.2, rough = 0.5, n = 220, plateau = null, lift = null }) {
  const r = rng(seed);
  const ph = Array.from({ length: 5 }, () => r() * Math.PI * 2);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v =
      Math.sin(t * freq * 6.283 + ph[0]) * 0.5 +
      Math.sin(t * freq * 2.13 * 6.283 + ph[1]) * 0.28 * rough * 2 +
      Math.sin(t * freq * 5.31 * 6.283 + ph[2]) * 0.12 * rough * 2 +
      Math.sin(t * freq * 11.7 * 6.283 + ph[3]) * 0.05 * rough * 2 +
      (r() - 0.5) * 0.05 * rough;
    if (plateau !== null && v > plateau) v = plateau + (v - plateau) * 0.06;
    if (lift) v += lift(t);
    pts.push([t * W, y - v * amp]);
  }
  return pts;
}
const ridgeY = (pts, x) => {
  const i = Math.max(0, Math.min(pts.length - 2, Math.floor((x / W) * (pts.length - 1))));
  const [x0, y0] = pts[i];
  const [x1, y1] = pts[i + 1];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
};
const area = (pts) => `M0,${H} L${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" L")} L${W},${H} Z`;

/** Jagged fir silhouette. */
function pine(x, base, h, r) {
  const w = h * (0.26 + r() * 0.08);
  const steps = 7 + Math.floor(r() * 4);
  const right = [];
  const left = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const yy = base - h + t * h * 0.9;
    const half = w * t * (i % 2 ? 1 : 0.72) * (0.92 + r() * 0.16);
    right.push(`${f(x + half)},${f(yy)}`);
    left.unshift(`${f(x - half)},${f(yy)}`);
  }
  const tw = Math.max(1.5, h * 0.035);
  return `M${f(x)},${f(base - h)} L${right.join(" L")} L${f(x + tw)},${f(base - h * 0.1)} L${f(x + tw)},${f(base + 4)} L${f(x - tw)},${f(base + 4)} L${f(x - tw)},${f(base - h * 0.1)} L${left.join(" L")} Z`;
}
function forest(pts, seed, { from = 0, to = 1, every = 26, hMin = 30, hMax = 70, sink = 6, skip = 0.15 }) {
  const r = rng(seed);
  let d = "";
  for (let x = from * W; x < to * W; x += every * (0.6 + r() * 0.8)) {
    if (r() < skip) continue;
    d += pine(x, ridgeY(pts, x) + sink, hMin + r() * (hMax - hMin), r);
  }
  return d;
}

function house(x, base, s, { lit = null, r }) {
  const w = s * (1.1 + r() * 0.5);
  const h = s * (0.62 + r() * 0.2);
  const roof = s * 0.42;
  let out = `<path d="M${f(x)},${f(base)} L${f(x)},${f(base - h)} L${f(x + w / 2)},${f(base - h - roof)} L${f(x + w)},${f(base - h)} L${f(x + w)},${f(base)} Z"/>`;
  if (lit) {
    const ww = s * 0.14;
    out += `<g fill="${lit}">`;
    for (let k = 0; k < 2; k++) if (r() > 0.35) out += `<rect x="${f(x + w * (0.22 + k * 0.4))}" y="${f(base - h * 0.62)}" width="${f(ww)}" height="${f(ww * 1.2)}"/>`;
    out += `</g>`;
  }
  return out;
}
function waterTower(x, base, s) {
  const legs = [-0.32, -0.12, 0.12, 0.32].map((k) => `<path d="M${f(x + k * s * 0.6)},${f(base)} L${f(x + k * s * 0.42)},${f(base - s * 1.3)}" stroke-width="${f(s * 0.04)}"/>`).join("");
  const brace = `<path d="M${f(x - s * 0.19)},${f(base - s * 0.45)} L${f(x + s * 0.19)},${f(base - s * 0.85)} M${f(x + s * 0.19)},${f(base - s * 0.45)} L${f(x - s * 0.19)},${f(base - s * 0.85)}" stroke-width="${f(s * 0.025)}" fill="none"/>`;
  const tank = `<rect x="${f(x - s * 0.3)}" y="${f(base - s * 1.75)}" width="${f(s * 0.6)}" height="${f(s * 0.5)}" rx="${f(s * 0.05)}"/>`;
  const roof = `<path d="M${f(x - s * 0.34)},${f(base - s * 1.74)} L${f(x)},${f(base - s * 1.98)} L${f(x + s * 0.34)},${f(base - s * 1.74)} Z"/>`;
  return `<g>${legs}${brace}${tank}${roof}</g>`;
}
function radioTower(x, base, s, light) {
  const top = base - s * 3.2;
  let d = `M${f(x - s * 0.22)},${f(base)} L${f(x)},${f(top)} L${f(x + s * 0.22)},${f(base)}`;
  for (let k = 0; k < 9; k++) {
    const t0 = k / 9;
    const t1 = (k + 1) / 9;
    const y0 = base - (base - top) * t0;
    const y1 = base - (base - top) * t1;
    const w0 = s * 0.22 * (1 - t0);
    const w1 = s * 0.22 * (1 - t1);
    d += ` M${f(x - w0)},${f(y0)} L${f(x + w1)},${f(y1)} M${f(x + w0)},${f(y0)} L${f(x - w1)},${f(y1)}`;
  }
  const glow = id("g");
  return `<path d="${d}" fill="none" stroke-width="${f(s * 0.03)}"/>
  <defs><radialGradient id="${glow}"><stop offset="0" stop-color="${light}" stop-opacity="0.9"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient></defs>
  <circle cx="${f(x)}" cy="${f(top)}" r="${f(s * 0.5)}" fill="url(#${glow})" stroke="none"/><circle cx="${f(x)}" cy="${f(top)}" r="${f(s * 0.06)}" fill="${light}" stroke="none"/>`;
}

/** Twin-engine transport silhouette, flying to the right. */
function plane(x, y, s, color) {
  const p = (px, py) => `${f(x + px * s)},${f(y + py * s)}`;
  return `<g fill="${color}">
  <path d="M${p(0, 10)} C${p(14, 2)} ${p(40, 1)} ${p(150, 2)} C${p(176, 2)} ${p(196, 5)} ${p(206, 9)} C${p(196, 13)} ${p(176, 15)} ${p(150, 15)} L${p(40, 16)} C${p(20, 16)} ${p(8, 14)} ${p(0, 10)} Z"/>
  <path d="M${p(16, 5)} L${p(2, -20)} L${p(12, -20)} L${p(36, 4)} Z"/>
  <path d="M${p(4, 9)} L${p(-6, 9)} L${p(-6, 12)} L${p(20, 12)} Z"/>
  <path d="M${p(88, 9)} L${p(132, 9)} L${p(112, 34)} L${p(98, 34)} Z" opacity="0.92"/>
  <ellipse cx="${f(x + 104 * s)}" cy="${f(y + 21 * s)}" rx="${f(9 * s)}" ry="${f(4 * s)}"/>
  <ellipse cx="${f(x + 120 * s)}" cy="${f(y + 17 * s)}" rx="${f(8 * s)}" ry="${f(3.5 * s)}"/>
  </g>`;
}
function parachute(x, y, s, canopy, line) {
  const r = 30 * s;
  const scallop = Array.from({ length: 5 }, (_, i) => {
    const x0 = x + r - (i * 2 * r) / 5;
    const x1 = x0 - (2 * r) / 5;
    return `Q${f((x0 + x1) / 2)},${f(y - r * 0.08)} ${f(x1)},${f(y)}`;
  }).join(" ");
  const ly = y + r * 1.25;
  return `<g>
  <path d="M${f(x - r)},${f(y)} Q${f(x - r)},${f(y - r * 0.95)} ${f(x)},${f(y - r * 0.98)} Q${f(x + r)},${f(y - r * 0.95)} ${f(x + r)},${f(y)} ${scallop} Z" fill="${canopy}"/>
  <path d="M${f(x - r * 0.35)},${f(y - r * 0.92)} Q${f(x - r * 0.45)},${f(y - r * 0.4)} ${f(x - r * 0.4)},${f(y)} M${f(x + r * 0.35)},${f(y - r * 0.92)} Q${f(x + r * 0.45)},${f(y - r * 0.4)} ${f(x + r * 0.4)},${f(y)}" stroke="${line}" stroke-opacity="0.35" stroke-width="${f(1.4 * s)}" fill="none"/>
  <path d="M${f(x - r)},${f(y)} L${f(x)},${f(ly)} L${f(x + r)},${f(y)} M${f(x - r * 0.4)},${f(y)} L${f(x)},${f(ly)} L${f(x + r * 0.4)},${f(y)}" stroke="${line}" stroke-width="${f(1 * s)}" fill="none" stroke-opacity="0.8"/>
  <rect x="${f(x - 3.4 * s)}" y="${f(ly)}" width="${f(6.8 * s)}" height="${f(12 * s)}" rx="${f(2 * s)}" fill="${line}"/>
  </g>`;
}
/** Standing player silhouette with helmet, backpack and rifle (facing right). */
function soldier(x, base, s, color) {
  const p = (px, py) => `${f(x + px * s)},${f(base + py * s)}`;
  return `<g fill="${color}">
  <path d="M${p(-7.5, -89)} C${p(-7.5, -97)} ${p(7, -98)} ${p(8, -90)} L${p(10, -88.5)} L${p(-8.5, -88)} Z"/>
  <path d="M${p(-4.5, -89)} L${p(5, -89)} L${p(4.6, -81)} L${p(-4, -81)} Z"/>
  <path d="M${p(-9.5, -82)} L${p(8.5, -82)} C${p(11, -76)} ${p(11, -64)} ${p(9.5, -48)} L${p(-8.5, -48)} C${p(-11, -60)} ${p(-11.5, -74)} ${p(-9.5, -82)} Z"/>
  <path d="M${p(-9, -81)} L${p(-17.5, -78)} C${p(-19, -70)} ${p(-19, -62)} ${p(-17, -56)} L${p(-9.5, -55)} Z"/>
  <path d="M${p(-8.5, -49)} L${p(-0.8, -49)} L${p(-2.4, -25)} L${p(-4.2, -1)} L${p(-11.6, -1)} L${p(-10.6, -4)} L${p(-8.6, -25)} Z"/>
  <path d="M${p(0.2, -49)} L${p(8.8, -49)} L${p(9.6, -27)} L${p(13.8, -1)} L${p(6.6, -1)} L${p(3.6, -26)} Z"/>
  <path d="M${p(-6, -64.5)} L${p(30, -75)} L${p(30.6, -72.4)} L${p(-5.2, -61.8)} Z"/>
  <path d="M${p(7, -68)} L${p(10.5, -69)} L${p(12.4, -61)} L${p(9, -60.2)} Z"/>
  <path d="M${p(4, -80)} C${p(10, -78)} ${p(14, -73)} ${p(15.5, -71)} L${p(13, -68)} C${p(10, -71)} ${p(5, -74)} ${p(2, -75)} Z"/>
  </g>`;
}
function smoke(x, base, s, r, tint) {
  let out = "";
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const cx = x + Math.sin(t * 3.2) * 18 * s + t * t * 260 * s;
    const cy = base - t * 520 * s;
    const rad = (14 + t * 90) * s * (0.85 + r() * 0.3);
    const col = mix(tint, "#8a6a66", Math.min(1, t * 1.3));
    out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="${col}" opacity="${f((0.55 - t * 0.45) * 100) / 100}"/>`;
  }
  return out;
}

/* ----------------------------------------------------------------------------------------- */
/* scene assembly                                                                            */
/* ----------------------------------------------------------------------------------------- */

function frame({ sky, body, grain = 0.07, vignette = 0.55 }) {
  const skyId = id("sky");
  const stops = sky.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="${skyId}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>
    <filter id="blur4" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="blur12" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12"/></filter>
    <filter id="blur30" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>
    <filter id="blur70" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.2 -0.35"/>
    </filter>
    <radialGradient id="vig" cx="0.5" cy="0.48" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${vignette}"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${skyId})"/>
  ${body}
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="${grain}"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`;
}

function sun(x, y, r, core, glow, big = 1) {
  const g1 = id("sg");
  const g2 = id("sg");
  return `<defs>
    <radialGradient id="${g1}"><stop offset="0" stop-color="${glow}" stop-opacity="0.75"/><stop offset="0.25" stop-color="${glow}" stop-opacity="0.32"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${g2}"><stop offset="0" stop-color="${core}"/><stop offset="0.7" stop-color="${core}"/><stop offset="1" stop-color="${core}" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="${x}" cy="${y}" r="${r * 16 * big}" fill="url(#${g1})"/>
  <circle cx="${x}" cy="${y}" r="${r * 1.25}" fill="url(#${g2})"/>`;
}
function rays(x, y, color, r, count = 9, op = 0.06) {
  let d = "";
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (0.62 + (i / count) * 0.9) + (r() - 0.5) * 0.1;
    const len = 2600;
    const w = 0.02 + r() * 0.035;
    d += `M${x},${y} L${f(x + Math.cos(a - w) * len)},${f(y + Math.sin(a - w) * len * -1)} L${f(x + Math.cos(a + w) * len)},${f(y + Math.sin(a + w) * len * -1)} Z `;
  }
  return `<path d="${d}" fill="${color}" opacity="${op}" filter="url(#blur30)"/>`;
}
function fogBand(y, h, color, op) {
  const g = id("fog");
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="0.5" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
  <rect x="0" y="${f(y - h / 2)}" width="${W}" height="${f(h)}" fill="url(#${g})"/>`;
}
function wisps(y, color, r, n = 7, op = 0.22) {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `<ellipse cx="${f(r() * W)}" cy="${f(y + (r() - 0.5) * 60)}" rx="${f(220 + r() * 420)}" ry="${f(18 + r() * 30)}" fill="${color}" opacity="${f(op * (0.5 + r() * 0.8) * 100) / 100}" filter="url(#blur30)"/>`;
  }
  return out;
}
function clouds(y, color, r, n = 6, op = 0.35) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const cx = r() * W;
    const cy = y + (r() - 0.5) * 120;
    for (let k = 0; k < 4; k++)
      out += `<ellipse cx="${f(cx + (k - 1.5) * (90 + r() * 60))}" cy="${f(cy + (r() - 0.5) * 20)}" rx="${f(160 + r() * 200)}" ry="${f(26 + r() * 26)}" fill="${color}" opacity="${f(op * (0.6 + r() * 0.6) * 100) / 100}" filter="url(#blur30)"/>`;
  }
  return out;
}
/** Layered ridges from far (index 0) to near, coloured with atmospheric perspective. */
function ridges(defs, far, near, seed, { fogColor, fogOp = 0.35, curve = 1.25 }) {
  const out = [];
  const pts = [];
  defs.forEach((d, i) => {
    const t = Math.pow(i / (defs.length - 1), curve);
    const p = ridge(seed + i * 101, d);
    pts.push(p);
    // Each entry = the ridge plus the fog that settles in the valley in front of it.
    const fog = fogColor && i < defs.length - 1 ? fogBand(d.y + d.amp * 0.15 + 30, 120 + (1 - t) * 120, fogColor, fogOp * (1 - t * 0.7)) : "";
    out.push(`<path d="${area(p)}" fill="${d.color ?? mix(far, near, t)}"/>${fog}`);
  });
  return { layers: out, pts };
}

/* ----------------------------------------------------------------------------------------- */
/* scenes                                                                                    */
/* ----------------------------------------------------------------------------------------- */

function sceneDusk() {
  const r = rng(11);
  const far = "#c27a66";
  const near = "#07080d";
  const defs = [
    { y: 0.62 * H, amp: 120, freq: 1.6, rough: 0.6 },
    { y: 0.67 * H, amp: 110, freq: 2.1, rough: 0.5 },
    { y: 0.72 * H, amp: 95, freq: 2.6, rough: 0.55 },
    { y: 0.79 * H, amp: 80, freq: 1.8, rough: 0.4 },
    { y: 0.86 * H, amp: 90, freq: 1.4, rough: 0.35, lift: (t) => (t > 0.62 ? (t - 0.62) * 2.8 : 0) },
    { y: 0.95 * H, amp: 120, freq: 1.1, rough: 0.3, lift: (t) => (t < 0.18 ? (0.18 - t) * 4 : t > 0.8 ? (t - 0.8) * 4.5 : 0) },
  ];
  const { layers, pts } = ridges(defs, far, near, 300, { fogColor: "#f2a868", fogOp: 0.42 });
  const sx = 0.71 * W;
  const sy = 0.585 * H;
  const silhouetteMid = mix(far, near, 0.48);
  const body = [
    sun(sx, sy, 52, "#fff4d6", "#ffb35c", 1.1),
    rays(sx, sy, "#ffd59a", r, 11, 0.07),
    clouds(0.3 * H, "#f7a07a", r, 5, 0.22),
    clouds(0.45 * H, "#ffc489", r, 4, 0.2),
    // contrail + aircraft + drop
    `<path d="M${f(0.08 * W)},${f(0.215 * H)} Q${f(0.3 * W)},${f(0.17 * H)} ${f(0.52 * W)},${f(0.155 * H)}" stroke="#ffe7c2" stroke-opacity="0.45" stroke-width="5" fill="none" filter="url(#blur4)"/>`,
    plane(0.52 * W, 0.135 * H, 1.25, "#1a1424"),
    parachute(0.555 * W, 0.255 * H, 1.0, "#2a1b26", "#1a1424"),
    parachute(0.6 * W, 0.32 * H, 0.82, "#33202a", "#1a1424"),
    parachute(0.515 * W, 0.37 * H, 0.66, "#3c2630", "#221a28"),
    parachute(0.645 * W, 0.405 * H, 0.55, "#45303a", "#2a1f2c"),
    parachute(0.585 * W, 0.46 * H, 0.45, "#523844", "#30242f"),
    layers[0], layers[1], layers[2],
    // hilltop compound and towers on the third ridge
    `<g fill="${silhouetteMid}" stroke="${silhouetteMid}">${radioTower(0.885 * W, ridgeY(pts[2], 0.885 * W) + 4, 34, "#ff5a4a")}</g>`,
    layers[3], layers[4],
    `<g fill="${mix(far, near, 0.6)}" stroke="${mix(far, near, 0.6)}">`,
    ...[0.775, 0.8, 0.835, 0.86].map((t) => house(t * W, ridgeY(pts[3], (t + 0.01) * W) + 6, 28 + r() * 10, { lit: "#ffb35c", r })),
    waterTower(0.82 * W, ridgeY(pts[3], 0.82 * W) + 8, 40),
    `</g>`,
    layers[5],
    wisps(0.8 * H, "#f6b07a", r, 6, 0.18),
    `<path d="${forest(pts[4], 21, { from: 0.68, to: 1.0, every: 22, hMin: 26, hMax: 60 })}" fill="${mix(far, near, 0.86)}"/>`,
    `<path d="${forest(pts[5], 22, { from: 0, to: 0.2, every: 34, hMin: 70, hMax: 170, sink: 10 })}" fill="${near}"/>`,
    `<path d="${forest(pts[5], 23, { from: 0.83, to: 1.0, every: 30, hMin: 90, hMax: 210, sink: 10 })}" fill="${near}"/>`,
    // airdrop crate with red smoke on the near ridge
    `<g filter="url(#blur12)">${smoke(0.735 * W, ridgeY(pts[4], 0.735 * W) - 6, 0.9, r, "#d2443c")}</g>`,
    `<circle cx="${f(0.735 * W)}" cy="${f(ridgeY(pts[4], 0.735 * W) - 6)}" r="40" fill="#ff5340" opacity="0.35" filter="url(#blur12)"/>`,
    `<rect x="${f(0.735 * W - 16)}" y="${f(ridgeY(pts[4], 0.735 * W) - 26)}" width="32" height="24" rx="2" fill="${mix(far, near, 0.85)}"/>`,
    soldier(0.665 * W, ridgeY(pts[4], 0.665 * W) + 2, 1.15, mix(far, near, 0.93)),
  ].join("\n");
  return frame({
    sky: [[0, "#0b1128"], [0.28, "#29244a"], [0.5, "#6e3a5a"], [0.63, "#c8654c"], [0.72, "#f0a25a"], [0.8, "#f8c77e"], [1, "#f8c77e"]],
    body,
    vignette: 0.6,
  });
}

function sceneDawn() {
  const r = rng(42);
  const far = "#8fa6ad";
  const near = "#08110d";
  const defs = [
    { y: 0.6 * H, amp: 90, freq: 1.4, rough: 0.5 },
    { y: 0.64 * H, amp: 70, freq: 2.2, rough: 0.5, lift: (t) => (t > 0.3 ? -0.6 : 0) },
    { y: 0.76 * H, amp: 70, freq: 2.4, rough: 0.45 },
    { y: 0.84 * H, amp: 80, freq: 1.7, rough: 0.4 },
    { y: 0.95 * H, amp: 110, freq: 1.2, rough: 0.3, lift: (t) => (t < 0.3 ? (0.3 - t) * 3 : 0) },
  ];
  const { layers, pts } = ridges(defs, far, near, 520, { fogColor: "#e9e4da", fogOp: 0.55 });
  const seaY = 0.655 * H;
  const g = id("sea");
  const bridgeY = seaY - 14;
  let cables = "";
  const t1 = 0.52 * W;
  const t2 = 0.74 * W;
  for (const [a, b] of [[0.3 * W, t1], [t1, t2], [t2, 0.97 * W]]) {
    const mid = (a + b) / 2;
    const sag = a === t1 ? 70 : 40;
    cables += `M${f(a)},${f(a === t1 || a === t2 ? bridgeY - 120 : bridgeY - 6)} Q${f(mid)},${f(bridgeY - 120 + sag + 40)} ${f(b)},${f(b === t1 || b === t2 ? bridgeY - 120 : bridgeY - 6)} `;
  }
  const hangers = Array.from({ length: 40 }, (_, i) => {
    const x = t1 + ((t2 - t1) * (i + 0.5)) / 40;
    const tt = (x - t1) / (t2 - t1);
    const cy = bridgeY - 120 + 4 * tt * (1 - tt) * 110;
    return `M${f(x)},${f(cy)} L${f(x)},${f(bridgeY)}`;
  }).join(" ");
  const bridgeCol = "#6f8389";
  const body = [
    sun(0.24 * W, 0.56 * H, 46, "#fffaf0", "#ffd9a8", 1.2),
    rays(0.24 * W, 0.56 * H, "#fff1d6", r, 9, 0.06),
    clouds(0.22 * H, "#ffffff", r, 6, 0.28),
    clouds(0.4 * H, "#ffe9d2", r, 4, 0.24),
    layers[0],
    `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d8cf"/><stop offset="1" stop-color="#8ea2a5"/></linearGradient></defs>`,
    `<rect x="0" y="${f(seaY)}" width="${W}" height="${f(H - seaY)}" fill="url(#${g})"/>`,
    `<ellipse cx="${f(0.24 * W)}" cy="${f(seaY + 40)}" rx="220" ry="60" fill="#fff4dd" opacity="0.55" filter="url(#blur30)"/>`,
    `<g stroke="${bridgeCol}" fill="${bridgeCol}">
      <rect x="${f(0.3 * W)}" y="${f(bridgeY)}" width="${f(0.67 * W)}" height="9"/>
      <rect x="${f(t1 - 9)}" y="${f(bridgeY - 128)}" width="18" height="${f(128 + (seaY - bridgeY) + 6)}"/>
      <rect x="${f(t2 - 9)}" y="${f(bridgeY - 128)}" width="18" height="${f(128 + (seaY - bridgeY) + 6)}"/>
      <path d="${cables}" fill="none" stroke-width="3"/>
      <path d="${hangers}" fill="none" stroke-width="1.2" stroke-opacity="0.8"/>
      ${Array.from({ length: 12 }, (_, i) => `<rect x="${f(0.3 * W + i * 0.056 * W)}" y="${f(bridgeY + 8)}" width="7" height="${f(seaY - bridgeY - 2)}"/>`).join("")}
    </g>`,
    `<rect x="0" y="${f(seaY - 30)}" width="${W}" height="60" fill="#e9e4da" opacity="0.35" filter="url(#blur30)"/>`,
    parachute(0.62 * W, 0.24 * H, 0.75, "#516066", "#3a474b"),
    parachute(0.68 * W, 0.3 * H, 0.55, "#5e6d72", "#45535a"),
    layers[2],
    wisps(0.74 * H, "#eeeae2", r, 7, 0.3),
    `<g fill="${mix(far, near, 0.55)}">${[0.12, 0.155, 0.19].map((t) => house(t * W, ridgeY(pts[2], t * W + 20) + 6, 30, { r })).join("")}</g>`,
    `<path d="${forest(pts[2], 31, { from: 0.25, to: 1, every: 20, hMin: 22, hMax: 48 })}" fill="${mix(far, near, 0.58)}"/>`,
    layers[3],
    `<path d="${forest(pts[3], 32, { from: 0, to: 1, every: 18, hMin: 34, hMax: 80, skip: 0.3 })}" fill="${mix(far, near, 0.78)}"/>`,
    layers[4],
    `<path d="${forest(pts[4], 33, { from: 0, to: 0.32, every: 30, hMin: 90, hMax: 220, sink: 12 })}" fill="${near}"/>`,
    `<path d="${forest(pts[4], 34, { from: 0.88, to: 1, every: 30, hMin: 110, hMax: 240, sink: 12 })}" fill="${near}"/>`,
  ].join("\n");
  return frame({ sky: [[0, "#7f9fb8"], [0.35, "#b9c7cf"], [0.55, "#ecdcc8"], [0.62, "#f6d2a8"], [1, "#f6d2a8"]], body, vignette: 0.45, grain: 0.06 });
}

function sceneDesert() {
  const r = rng(77);
  const far = "#d08f63";
  const near = "#1a0e0a";
  const defs = [
    { y: 0.6 * H, amp: 130, freq: 1.3, rough: 0.3, plateau: 0.2 },
    { y: 0.66 * H, amp: 150, freq: 1.7, rough: 0.35, plateau: 0.25 },
    { y: 0.74 * H, amp: 120, freq: 1.2, rough: 0.3, plateau: 0.1 },
    { y: 0.85 * H, amp: 60, freq: 1.5, rough: 0.25 },
    { y: 0.96 * H, amp: 80, freq: 1.1, rough: 0.25 },
  ];
  const { layers, pts } = ridges(defs, far, near, 760, { fogColor: "#f6c38c", fogOp: 0.4 });
  const roadPts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    roadPts.push([0.5 * W + Math.sin(t * 2.2) * 0.25 * W * (1 - t) + (1 - t) * 0.1 * W, ridgeY(pts[3], 0.5 * W) + 10 + Math.pow(1 - t, 1.6) * (H - ridgeY(pts[3], 0.5 * W))]);
  }
  const road = roadPts.map(([x, y], i) => `${i ? "L" : "M"}${f(x - (y - roadPts[40][1]) * 0.28 - 3)},${f(y)}`).join(" ") +
    " " + roadPts.slice().reverse().map(([x, y]) => `L${f(x + (y - roadPts[40][1]) * 0.28 + 3)},${f(y)}`).join(" ") + " Z";
  const vx = 0.47 * W;
  const vy = ridgeY(pts[3], vx) + 60;
  const body = [
    sun(0.8 * W, 0.24 * H, 60, "#fff7e6", "#ffd08a", 1.3),
    rays(0.8 * W, 0.24 * H, "#ffe2ad", r, 10, 0.05),
    clouds(0.18 * H, "#ffe3c4", r, 4, 0.18),
    layers[0], layers[1], layers[2],
    wisps(0.73 * H, "#f7c995", r, 6, 0.3),
    layers[3],
    `<path d="${road}" fill="#3a2418" opacity="0.85"/>`,
    `<g filter="url(#blur12)" opacity="0.8">${Array.from({ length: 14 }, (_, i) => `<circle cx="${f(vx - 20 - i * 26)}" cy="${f(vy - 10 - i * 4)}" r="${f(16 + i * 5)}" fill="#e6b183" opacity="${f((0.6 - i * 0.035) * 100) / 100}"/>`).join("")}</g>`,
    `<g fill="#1d120d"><rect x="${f(vx - 18)}" y="${f(vy - 18)}" width="40" height="14" rx="3"/><rect x="${f(vx - 6)}" y="${f(vy - 28)}" width="20" height="12" rx="3"/><circle cx="${f(vx - 8)}" cy="${f(vy - 3)}" r="6"/><circle cx="${f(vx + 14)}" cy="${f(vy - 3)}" r="6"/></g>`,
    layers[4],
    parachute(0.3 * W, 0.2 * H, 0.7, "#8a5236", "#5a3424"),
  ].join("\n");
  return frame({ sky: [[0, "#4e79a6"], [0.3, "#9fb6c4"], [0.5, "#f1cf9c"], [0.62, "#f4ab6a"], [1, "#f4ab6a"]], body, vignette: 0.5 });
}

function sceneSnow() {
  const r = rng(5);
  const far = "#4b6187";
  const near = "#03050a";
  const defs = [
    { y: 0.58 * H, amp: 260, freq: 1.5, rough: 0.8, color: "url(#snowcap1)" },
    { y: 0.66 * H, amp: 170, freq: 2, rough: 0.7, color: "url(#snowcap2)" },
    { y: 0.76 * H, amp: 100, freq: 2.2, rough: 0.5 },
    { y: 0.86 * H, amp: 80, freq: 1.6, rough: 0.4 },
    { y: 0.96 * H, amp: 110, freq: 1.2, rough: 0.3 },
  ];
  const { layers, pts } = ridges(defs, far, near, 900, { fogColor: "#7d97c2", fogOp: 0.3 });
  // snow caps: the far ranges are lit pale at the peaks and fade into the blue night below
  const capGrad = (gid, top, bottom, from, to) =>
    `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="${f(from)}" x2="0" y2="${f(to)}"><stop offset="0" stop-color="${top}"/><stop offset="0.35" stop-color="${mix(top, bottom, 0.55)}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  const caps = `<defs>${capGrad("snowcap1", "#c9d7ee", mix(far, near, 0), 0.58 * H - 290, 0.62 * H)}${capGrad("snowcap2", "#8fa6cb", mix(far, near, Math.pow(0.25, 1.25)), 0.66 * H - 190, 0.7 * H)}</defs>`;
  let stars = "";
  for (let i = 0; i < 260; i++) stars += `<circle cx="${f(r() * W)}" cy="${f(r() * 0.55 * H)}" r="${f(0.6 + r() * 1.6)}" fill="#fff" opacity="${f((0.25 + r() * 0.75) * 100) / 100}"/>`;
  const aurora = [0, 1, 2].map((k) => {
    const y0 = 0.16 * H + k * 50;
    let d = `M0,${f(y0)}`;
    for (let i = 1; i <= 12; i++) d += ` Q${f(((i - 0.5) / 12) * W)},${f(y0 + Math.sin(i * 1.3 + k) * 90)} ${f((i / 12) * W)},${f(y0 + Math.sin(i * 0.7 + k * 2) * 40)}`;
    return `<path d="${d}" stroke="${["#4ff0c0", "#57b8ff", "#8a7dff"][k]}" stroke-width="${70 - k * 15}" fill="none" opacity="${0.16 - k * 0.03}" filter="url(#blur30)"/>`;
  }).join("");
  let snow = "";
  for (let i = 0; i < 380; i++) snow += `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(1 + r() * 2.6)}" fill="#e8f0ff" opacity="${f((0.2 + r() * 0.5) * 100) / 100}"/>`;
  const cabinX = 0.27 * W;
  const body = [
    stars,
    aurora,
    sun(0.78 * W, 0.2 * H, 30, "#f4f7ff", "#9fb8ff", 0.9),
    caps,
    layers[0],
    layers[1],
    layers[2],
    wisps(0.75 * H, "#7e98c4", r, 6, 0.22),
    `<g fill="${mix(far, near, 0.62)}">${house(cabinX, ridgeY(pts[2], cabinX + 30) + 6, 40, { lit: "#ffc66e", r })}${house(cabinX + 60, ridgeY(pts[2], cabinX + 90) + 6, 34, { lit: "#ffc66e", r })}</g>`,
    `<circle cx="${f(cabinX + 40)}" cy="${f(ridgeY(pts[2], cabinX + 30) - 18)}" r="60" fill="#ffb94a" opacity="0.18" filter="url(#blur30)"/>`,
    `<path d="${forest(pts[2], 41, { from: 0.35, to: 1, every: 18, hMin: 24, hMax: 52 })}" fill="${mix(far, near, 0.6)}"/>`,
    layers[3],
    `<path d="${forest(pts[3], 42, { from: 0, to: 1, every: 16, hMin: 40, hMax: 90, skip: 0.25 })}" fill="${mix(far, near, 0.82)}"/>`,
    layers[4],
    `<path d="${forest(pts[4], 43, { from: 0.72, to: 1, every: 28, hMin: 120, hMax: 260, sink: 14 })}" fill="${near}"/>`,
    `<g filter="url(#blur4)">${snow}</g>`,
  ].join("\n");
  return frame({ sky: [[0, "#03060f"], [0.35, "#0a1730"], [0.6, "#1c3358"], [1, "#2b4670"]], body, vignette: 0.6, grain: 0.08 });
}

function sceneStorm() {
  const r = rng(91);
  const far = "#5f7480";
  const near = "#070a0d";
  const defs = [
    { y: 0.6 * H, amp: 100, freq: 1.5, rough: 0.5 },
    { y: 0.67 * H, amp: 90, freq: 2, rough: 0.5 },
    { y: 0.77 * H, amp: 80, freq: 2.3, rough: 0.45 },
    { y: 0.87 * H, amp: 80, freq: 1.5, rough: 0.35 },
    { y: 0.97 * H, amp: 110, freq: 1.2, rough: 0.3 },
  ];
  const { layers, pts } = ridges(defs, far, near, 1200, { fogColor: "#8fa4ae", fogOp: 0.3 });
  // the closing "zone": a curved translucent energy wall sweeping across the valley
  const wall = id("wall");
  const clip = id("clip");
  const baseAt = (x) => 0.7 * H + Math.pow((x - 0.55 * W) / (0.75 * W), 2) * -0.32 * H;
  let bottom = "";
  for (let i = 0; i <= 60; i++) bottom += `${i ? "L" : "M"}${f((i / 60) * W)},${f(baseAt((i / 60) * W))} `;
  let topEdge = "";
  for (let i = 60; i >= 0; i--) topEdge += `L${f((i / 60) * W)},${f(baseAt((i / 60) * W) - 0.42 * H)} `;
  const wallPath = `${bottom}${topEdge}Z`;
  let streaks = "";
  for (let i = 0; i < 160; i++) {
    const x = r() * W;
    const b = baseAt(x);
    streaks += `M${f(x)},${f(b)} L${f(x)},${f(b - 60 - r() * 340)} `;
  }
  const bolt = (() => {
    let x = 0.2 * W;
    let y = 0.05 * H;
    let d = `M${f(x)},${f(y)}`;
    for (let i = 0; i < 9; i++) {
      x += (r() - 0.45) * 60;
      y += 34 + r() * 30;
      d += ` L${f(x)},${f(y)}`;
    }
    return d;
  })();
  const body = [
    clouds(0.12 * H, "#0e141a", r, 7, 0.55),
    clouds(0.3 * H, "#2b3742", r, 6, 0.45),
    `<path d="${bolt}" stroke="#cfe6ff" stroke-width="3" fill="none" opacity="0.7"/><path d="${bolt}" stroke="#7fb6ff" stroke-width="16" fill="none" opacity="0.25" filter="url(#blur12)"/>`,
    layers[0], layers[1],
    `<defs><linearGradient id="${wall}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#4aa3ff" stop-opacity="0.55"/><stop offset="0.45" stop-color="#2f7dff" stop-opacity="0.16"/><stop offset="1" stop-color="#2f7dff" stop-opacity="0"/></linearGradient><clipPath id="${clip}"><path d="${wallPath}"/></clipPath></defs>`,
    `<path d="${wallPath}" fill="url(#${wall})"/>`,
    `<g clip-path="url(#${clip})"><path d="${streaks}" stroke="#a8d4ff" stroke-width="2" opacity="0.18" fill="none"/></g>`,
    `<path d="${bottom}" stroke="#8fd0ff" stroke-width="5" fill="none" opacity="0.9"/><path d="${bottom}" stroke="#4aa3ff" stroke-width="40" fill="none" opacity="0.35" filter="url(#blur12)"/>`,
    layers[2],
    `<g fill="${mix(far, near, 0.6)}" stroke="${mix(far, near, 0.6)}">${[0.6, 0.63, 0.665, 0.7].map((t) => house(t * W, ridgeY(pts[2], t * W + 20) + 6, 32, { lit: "#ffcf7a", r })).join("")}${waterTower(0.735 * W, ridgeY(pts[2], 0.735 * W) + 8, 44)}</g>`,
    `<path d="${forest(pts[2], 51, { from: 0, to: 0.55, every: 18, hMin: 22, hMax: 50 })}" fill="${mix(far, near, 0.6)}"/>`,
    layers[3],
    `<path d="${forest(pts[3], 52, { from: 0, to: 1, every: 18, hMin: 40, hMax: 90, skip: 0.3 })}" fill="${mix(far, near, 0.84)}"/>`,
    layers[4],
    soldier(0.3 * W, ridgeY(pts[4], 0.3 * W) + 4, 1.5, near),
    `<path d="${forest(pts[4], 53, { from: 0, to: 0.12, every: 30, hMin: 120, hMax: 250, sink: 12 })}" fill="${near}"/>`,
  ].join("\n");
  return frame({ sky: [[0, "#0b1016"], [0.4, "#26323d"], [0.62, "#55697a"], [1, "#6f8696"]], body, vignette: 0.6 });
}

/* ----------------------------------------------------------------------------------------- */
/* render                                                                                    */
/* ----------------------------------------------------------------------------------------- */

const scenes = { dusk: sceneDusk, dawn: sceneDawn, desert: sceneDesert, snow: sceneSnow, storm: sceneStorm };

// [name, scene, width, height, crop focus x (0..1), quality]
const outputs = [
  ["hero-dusk-2560", "dusk", 2560, 1440, 0.5, 74],
  ["hero-dusk-1440", "dusk", 1440, 810, 0.5, 76],
  ["hero-dusk-portrait", "dusk", 900, 1200, 0.66, 76],
  ["scene-dawn", "dawn", 1600, 900, 0.5, 76],
  ["scene-desert", "desert", 1600, 900, 0.5, 76],
  ["scene-snow", "snow", 1600, 900, 0.5, 76],
  ["scene-storm", "storm", 1600, 900, 0.5, 76],
  ["card-dusk", "dusk", 800, 500, 0.66, 74],
  ["card-dawn", "dawn", 800, 500, 0.55, 74],
  ["card-desert", "desert", 800, 500, 0.5, 74],
  ["card-snow", "snow", 800, 500, 0.32, 74],
  ["card-storm", "storm", 800, 500, 0.6, 74],
  ["login-snow", "snow", 1400, 1600, 0.3, 76],
  ["login-dusk", "dusk", 1400, 1600, 0.66, 76],
];

mkdirSync(OUT, { recursive: true });
const rendered = {};
for (const [name, fn] of Object.entries(scenes)) {
  const svg = fn();
  if (process.argv.includes("--svg")) writeFileSync(resolve(OUT, `${name}.svg`), svg);
  rendered[name] = await sharp(Buffer.from(svg), { density: 72 }).png().toBuffer();
  console.log(`rendered ${name}`);
}
for (const [file, scene, w, h, fx, q] of outputs) {
  const scale = Math.max(w / W, h / H);
  const sw = Math.round(W * scale);
  const sh = Math.round(H * scale);
  const left = Math.max(0, Math.min(sw - w, Math.round(sw * fx - w / 2)));
  const top = Math.max(0, Math.round((sh - h) * 0.55));
  const buf = await sharp(rendered[scene]).resize(sw, sh).extract({ left, top, width: w, height: h }).webp({ quality: q, effort: 6, smartSubsample: true }).toBuffer();
  writeFileSync(resolve(OUT, `${file}.webp`), buf);
  console.log(`${file}.webp  ${w}x${h}  ${(buf.length / 1024).toFixed(0)} KB`);
}
