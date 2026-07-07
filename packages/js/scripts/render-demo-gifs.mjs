// Bespoke demo-card thumbnails that actually match each example (run: node scripts/render-demo-gifs.mjs).
// Each is its own renderer, reusing only the shipped field object:
//   million.gif → glowing 3-D particle volume (advected point cloud, additive)
//   tubes.gif   → shaded 3-D streamtubes (streamlines traced in 3-D, depth-sorted lit discs)
//   cirrus.gif  → sunset-cirrus sky (vertical gradient + sun + IBFV-advected white wisps)
// Pure Node, no browser — reproducible like scripts/render-assets.mjs. Writes into ../assets.
import { create } from "../dist/helix-noise.js";
import gifencMod from "gifenc";
import fs from "node:fs";
const { GIFEncoder, quantize, applyPalette } = gifencMod;
const TAU = Math.PI * 2, PI = Math.PI;
const OUT = new URL("../assets/", import.meta.url);

const rng32 = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function saveGIF(name, w, h, frames, delay, maxColors) {
  const enc = GIFEncoder(), ref = frames[(frames.length / 2) | 0];
  const palette = quantize(ref, maxColors, { format: "rgba4444" });
  frames.forEach((frame, i) => enc.writeFrame(applyPalette(frame, palette, "rgba4444"), w, h, { palette, delay, repeat: i === 0 ? 0 : undefined }));
  enc.finish();
  fs.writeFileSync(new URL(name, OUT), enc.bytes());
  console.log("  wrote", name, `${w}×${h} ${frames.length}f ${(enc.bytes().length / 1024 | 0)}kB`);
}
// additive tonemap (glow) and plain gamma tonemap
const toneAdd = (img, w, h, bg) => { const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { for (let c = 0; c < 3; c++) { const v = bg[c] + img[i * 3 + c], t = v / (v + 1); o[i * 4 + c] = clamp(Math.round(255 * Math.pow(t, 0.85)), 0, 255); } o[i * 4 + 3] = 255; } return o; };
const drnd = rng32(777);
const toneGamma = (img, w, h, g, dither = 0) => { const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { for (let c = 0; c < 3; c++) o[i * 4 + c] = clamp(Math.round(255 * Math.pow(clamp(img[i * 3 + c], 0, 1), g) + (dither ? (drnd() - 0.5) * dither : 0)), 0, 255); o[i * 4 + 3] = 255; } return o; };

// rotate a centred point by yaw (about Y) then pitch (about X), project with mild perspective
function project3(x, y, z, cyaw, syaw, cp, sp, cx, cy, scale) {
  let xr = x * cyaw - z * syaw, zr = x * syaw + z * cyaw;
  let yr = y * cp - zr * sp, zz = y * sp + zr * cp;
  const persp = 1 / (1 + zz * 0.05);
  return { x: cx + xr * scale * persp, y: cy - yr * scale * persp, z: zz, s: persp };
}

// ────────────────────────────── tubes.gif ──────────────────────────────
function tubesGIF() {
  const w = 440, h = 300, f = create({ modes: 22, slope: 2.2, helicity: 1.0, coherence: 0.5, seed: 8 });
  const NT = 46, STEPS = 250, dt = 0.03, o = [0, 0, 0, 0, 0, 0], rnd = rng32(3), lines = [];
  for (let s = 0; s < NT; s++) {
    let x = rnd() * TAU, y = rnd() * TAU, z = rnd() * TAU, hsum = 0; const pts = [];
    for (let k = 0; k < STEPS; k++) {
      f.sampleUW(x, y, z, o); pts.push([x - PI, y - PI, z - PI]); hsum += o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      x += o[0] * dt; y += o[1] * dt; z += o[2] * dt;
    }
    lines.push({ pts, teal: hsum >= 0 });
  }
  const N = 36, frames = [], cx = w / 2, cy = h / 2 + 6, scale = h * 0.17;
  const lx = -0.48, ly = -0.62, lz = 0.62;
  for (let fi = 0; fi < N; fi++) {
    const yaw = TAU * fi / N + 0.5, pitch = 0.34, cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const img = new Float32Array(w * h * 3); for (let i = 0; i < w * h; i++) { img[i * 3] = 0.018; img[i * 3 + 1] = 0.026; img[i * 3 + 2] = 0.036; }
    const discs = [];
    for (const L of lines) for (const p of L.pts) { const pr = project3(p[0], p[1], p[2], cyaw, syaw, cp, sp, cx, cy, scale); discs.push([pr.x, pr.y, pr.z, pr.s, L.teal]); }
    discs.sort((a, b) => b[2] - a[2]);                      // far first (larger z behind)
    for (const d of discs) {
      const r = 3.6 * d[3], fog = clamp(0.35 + 0.65 * (1 - (d[2] + 3.4) / 6.8), 0.2, 1);
      const teal = d[4], br = teal ? 0.16 : 0.98, bg = teal ? 0.86 : 0.66, bb = teal ? 0.80 : 0.30;
      const x0 = Math.max(0, (d[0] - r) | 0), x1 = Math.min(w - 1, Math.ceil(d[0] + r)), y0 = Math.max(0, (d[1] - r) | 0), y1 = Math.min(h - 1, Math.ceil(d[1] + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = (x - d[0]) / r, dy = (y - d[1]) / r, d2 = dx * dx + dy * dy; if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2), lamb = Math.max(0, dx * lx + dy * ly + nz * lz), spec = Math.pow(lamb, 10) * 0.7, shade = (0.16 + 0.84 * lamb) * fog;
        const a = d2 < 0.68 ? 1 : 1 - (d2 - 0.68) / 0.32, k = (y * w + x) * 3;
        const cr = br * shade + spec, cg = bg * shade + spec, cb = bb * shade + spec;
        img[k] = img[k] * (1 - a) + cr * a; img[k + 1] = img[k + 1] * (1 - a) + cg * a; img[k + 2] = img[k + 2] * (1 - a) + cb * a;
      }
    }
    frames.push(toneGamma(img, w, h, 0.9, 1.6));
  }
  saveGIF("tubes.gif", w, h, frames, 55, 128);
}

// ────────────────────────────── million.gif ────────────────────────────
function millionGIF() {
  const w = 440, h = 300, f = create({ modes: 40, slope: 1.7, helicity: 0.8, coherence: 0.64, seed: 9 });
  const NP = 60000, o = [0, 0, 0, 0, 0, 0], rnd = rng32(5), P = new Float32Array(NP * 3), dt = 0.05;
  for (let i = 0; i < NP; i++) { P[i * 3] = rnd() * TAU; P[i * 3 + 1] = rnd() * TAU; P[i * 3 + 2] = rnd() * TAU; }
  const advect = (n) => { for (let s = 0; s < n; s++) for (let i = 0; i < NP; i++) { const b = i * 3; f.sampleUW(P[b], P[b + 1], P[b + 2], o); P[b] = ((P[b] + o[0] * dt) % TAU + TAU) % TAU; P[b + 1] = ((P[b + 1] + o[1] * dt) % TAU + TAU) % TAU; P[b + 2] = ((P[b + 2] + o[2] * dt) % TAU + TAU) % TAU; } };
  advect(14);
  // soft 5×5 gaussian splat kernel → smooth glow instead of grain
  const KR = 2, KER = []; for (let dy = -KR; dy <= KR; dy++) for (let dx = -KR; dx <= KR; dx++) KER.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * 1.15 * 1.15))]);
  // fixed camera + persistent accumulator → the churn draws glowing filaments (like the real GPU cloud)
  const N = 30, frames = [], cx = w / 2, cy = h / 2, scale = h * 0.15;
  const yaw = 0.5, pitch = 0.26, cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const acc = new Float32Array(w * h * 3);
  for (let fi = 0; fi < N; fi++) {
    advect(1);
    for (let i = 0; i < acc.length; i++) acc[i] *= 0.82;
    for (let i = 0; i < NP; i++) {
      const b = i * 3; f.sampleUW(P[b], P[b + 1], P[b + 2], o);
      const hel = o[0] * o[3] + o[1] * o[4] + o[2] * o[5], teal = hel >= 0;
      const pr = project3(P[b] - PI, P[b + 1] - PI, P[b + 2] - PI, cyaw, syaw, cp, sp, cx, cy, scale);
      const px = pr.x | 0, py = pr.y | 0; if (px < KR || py < KR || px >= w - KR || py >= h - KR) continue;
      const near = clamp(0.35 + 0.65 * (1 - (pr.z + 3.4) / 6.8), 0.15, 1), inten = 0.16 * near;
      const br = (teal ? 0.16 : 0.98) * inten, bg = (teal ? 0.92 : 0.62) * inten, bb = (teal ? 0.84 : 0.24) * inten;
      for (const [dx, dy, wt] of KER) { const k = ((py + dy) * w + (px + dx)) * 3; acc[k] += br * wt; acc[k + 1] += bg * wt; acc[k + 2] += bb * wt; }
    }
    frames.push(toneAdd(acc, w, h, [0.015, 0.022, 0.032]));
  }
  saveGIF("million.gif", w, h, frames, 55, 160);
}

// ────────────────────────────── cirrus.gif ─────────────────────────────
function cirrusGIF() {
  const w = 440, h = 300, f = create({ modes: 34, slope: 1.6, helicity: 0.4, coherence: 0.45, seed: 12 });
  // 2-D flow slice with jetstream anisotropy (mostly horizontal)
  const U = new Float32Array(w * h), V = new Float32Array(w * h), o = [0, 0, 0, 0, 0, 0];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { f.sampleUW((i / w) * TAU, (j / h) * TAU, 0, o); const k = j * w + i; U[k] = o[0] * 1.7 + 0.9; V[k] = o[1] * 0.5; }   // +0.9 = mean wind
  // IBFV dye — advect a noise texture along the flow so it combs into fibrous wisps
  const rnd = rng32(21), dye = new Float32Array(w * h), noise = new Float32Array(w * h);
  const reNoise = () => { for (let i = 0; i < w * h; i++) noise[i] = rnd() < 0.22 ? rnd() * rnd() : 0; };   // sparse seeds → delicate wisps
  reNoise(); dye.set(noise);
  const sample = (A, x, y) => { x = (x % w + w) % w; y = clamp(y, 0, h - 1.001); const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0, x1 = (x0 + 1) % w, y1 = Math.min(h - 1, y0 + 1); return (A[y0 * w + x0] * (1 - tx) + A[y0 * w + x1] * tx) * (1 - ty) + (A[y1 * w + x0] * (1 - tx) + A[y1 * w + x1] * tx) * ty; };
  const advectDye = () => { const nd = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; const bx = i - U[k] * 1.5, by = j - V[k] * 1.5; nd[k] = sample(dye, bx, by) * 0.94 + noise[k] * 0.06; } dye.set(nd); };
  for (let s = 0; s < 30; s++) advectDye();                 // warm the streaks in
  // sunset sky + a small warm sun low on the right
  const skyTop = [0.13, 0.19, 0.44], skyBot = [0.99, 0.70, 0.44], sun = [1.25, 1.05, 0.78];
  const sunx = w * 0.73, suny = h * 0.86;
  const N = 40, frames = [];
  for (let fi = 0; fi < N; fi++) {
    reNoise(); advectDye();
    const img = new Float32Array(w * h * 3);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, t = Math.pow(j / h, 1.35);
      let r = skyTop[0] + (skyBot[0] - skyTop[0]) * t, g = skyTop[1] + (skyBot[1] - skyTop[1]) * t, b = skyTop[2] + (skyBot[2] - skyTop[2]) * t;
      const dx = i - sunx, dy = j - suny, r2 = dx * dx + dy * dy, sd = Math.exp(-r2 / (2 * 30 * 30)), gl = Math.exp(-r2 / (2 * 120 * 120));
      r += sun[0] * (sd * 0.85 + gl * 0.24); g += sun[1] * (sd * 0.85 + gl * 0.20); b += sun[2] * (sd * 0.85 + gl * 0.16);
      const wisp = clamp((sample(dye, i, j) - 0.24) * 4.0, 0, 1), a = Math.pow(wisp, 1.4) * 0.8;   // sparse, soft white cirrus
      r = r * (1 - a) + 0.99 * a; g = g * (1 - a) + 0.99 * a; b = b * (1 - a) + 1.0 * a;
      img[k * 3] = r; img[k * 3 + 1] = g; img[k * 3 + 2] = b;
    }
    frames.push(toneGamma(img, w, h, 0.9, 2.2));
  }
  saveGIF("cirrus.gif", w, h, frames, 60, 200);
}

console.log("rendering demo gifs…");
tubesGIF();
millionGIF();
cirrusGIF();
console.log("done.");
