// Renders the README media into ../assets — reproducibly, in pure Node (no native deps).
// GIFs (hero + knob sweeps) via gifenc; the static montage via a tiny built-in PNG encoder.
// Run with `npm run assets` (after `npm run build`).
import { create } from "../dist/helix-noise.js";
import gifencMod from "gifenc";
import zlib from "node:zlib";
import fs from "node:fs";

const { GIFEncoder, quantize, applyPalette } = gifencMod;
const TAU = Math.PI * 2;
const OUT = new URL("../assets/", import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

// ---------- field → grid, and shared drawing helpers ----------
function grid(f, w, h) {
  const U = new Float32Array(w * h), V = new Float32Array(w * h), H = new Float32Array(w * h), o = [0, 0, 0, 0, 0, 0];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { f.sampleUW((i / w) * TAU, (j / h) * TAU, 0, o); const k = j * w + i; U[k] = o[0]; V[k] = o[1]; H[k] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5]; }
  return { w, h, U, V, H };
}
const gbil = (G, A, x, y) => {
  let fx = (x / TAU) * G.w, fy = (y / TAU) * G.h; let x0 = Math.floor(fx), y0 = Math.floor(fy); const tx = fx - x0, ty = fy - y0;
  x0 = ((x0 % G.w) + G.w) % G.w; y0 = ((y0 % G.h) + G.h) % G.h; const x1 = (x0 + 1) % G.w, y1 = (y0 + 1) % G.h;
  const a = A[y0 * G.w + x0], b = A[y0 * G.w + x1], c = A[y1 * G.w + x0], d = A[y1 * G.w + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
};
const heat = (t) => { t = Math.min(1, Math.max(0, t)); if (t < 0.5) { const u = t / 0.5; return [0.05 + 0.10 * u, 0.14 + 0.62 * u, 0.28 + 0.5 * u]; } const u = (t - 0.5) / 0.5; return [0.15 + 0.82 * u, 0.76 + 0.24 * u, 0.78 + 0.22 * u]; };
const rng32 = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const BG = [0.02, 0.028, 0.038];

function toneRGBA(acc, w, h) {
  const o = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) { const v = BG[c] + acc[i * 3 + c], t = v / (v + 1); o[i * 4 + c] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(t, 0.85)))); }
    o[i * 4 + 3] = 255;
  }
  return o;
}
function rgbToRGBA(rgb, w, h) { const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { o[i * 4] = rgb[i * 3]; o[i * 4 + 1] = rgb[i * 3 + 1]; o[i * 4 + 2] = rgb[i * 3 + 2]; o[i * 4 + 3] = 255; } return o; }

// static flow-streak image (tonemapped RGB) — used for sweeps and the montage
function flowU8(G, w, h, { particles = 3000, steps = 38, stepLen = 0.09, seed = 1 }) {
  const img = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { img[i * 3] = BG[0]; img[i * 3 + 1] = BG[1]; img[i * 3 + 2] = BG[2]; }
  const rnd = rng32(seed), sx = w / TAU, sy = h / TAU;
  const splat = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return; const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const add = (px, py, wt) => { const k = (py * w + px) * 3; img[k] += r * a * wt; img[k + 1] += g * a * wt; img[k + 2] += b * a * wt; };
    add(x0, y0, (1 - fx) * (1 - fy)); add(x0 + 1, y0, fx * (1 - fy)); add(x0, y0 + 1, (1 - fx) * fy); add(x0 + 1, y0 + 1, fx * fy);
  };
  for (let p = 0; p < particles; p++) {
    let x = rnd() * TAU, y = rnd() * TAU;
    for (let k = 0; k < steps; k++) {
      const u = gbil(G, G.U, x, y), v = gbil(G, G.V, x, y), hd = gbil(G, G.H, x, y);
      const nx = x + u * stepLen, ny = y + v * stepLen, teal = hd >= 0;
      const r = teal ? 0.18 : 0.96, g = teal ? 0.84 : 0.63, b = teal ? 0.75 : 0.24;
      if (Math.abs(nx - x) < TAU * 0.5 && Math.abs(ny - y) < TAU * 0.5) { const x0 = x * sx, y0 = y * sy, x1 = nx * sx, y1 = ny * sy; for (let t = 0; t < 3; t++) { const tt = t / 3; splat(x0 + (x1 - x0) * tt, y0 + (y1 - y0) * tt, r, g, b, 0.055); } }
      x = ((nx % TAU) + TAU) % TAU; y = ((ny % TAU) + TAU) % TAU;
    }
  }
  const o = new Uint8Array(w * h * 3);
  for (let i = 0; i < o.length; i++) { const v = img[i], t = v / (v + 1); o[i] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(t, 0.85)))); }
  return o;
}
function licU8(G, w, h, { seed = 1 }) {
  const img = new Float32Array(w * h * 3), noise = new Float32Array(w * h), rnd = rng32(seed);
  for (let i = 0; i < w * h; i++) noise[i] = rnd();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let acc = noise[j * w + i], n = 1, hx = 0;
    for (let dir = -1; dir <= 1; dir += 2) { let cx = i, cy = j; for (let st = 0; st < 12; st++) { const gx = (((cx | 0) % w) + w) % w, gy = (((cy | 0) % h) + h) % h, oo = gy * w + gx; const u = G.U[oo], v = G.V[oo], m = Math.hypot(u, v) || 1e-4; cx += (dir * u) / m * 0.9; cy += (dir * v) / m * 0.9; if (cx < 0 || cx >= w || cy < 0 || cy >= h) break; acc += noise[gy * w + gx]; n++; hx += G.H[oo]; } }
    const lum = Math.max(0, 0.28 + 1.2 * (acc / n - 0.5)), teal = hx >= 0, tr = teal ? 0.18 : 0.96, tg = teal ? 0.84 : 0.63, tb = teal ? 0.75 : 0.24, k = (j * w + i) * 3;
    img[k] = 0.03 + tr * 0.5 * lum; img[k + 1] = 0.04 + tg * 0.5 * lum; img[k + 2] = 0.055 + tb * 0.5 * lum;
  }
  const o = new Uint8Array(w * h * 3); for (let i = 0; i < o.length; i++) o[i] = Math.max(0, Math.min(255, Math.round(img[i] * 255))); return o;
}
function heatU8(G, w, h) {
  const o = new Uint8Array(w * h * 3);
  for (let k = 0; k < w * h; k++) { const hh = G.H[k], a = Math.min(1, Math.abs(hh / 2.2)), b = Math.pow(a, 0.7); let r, g, bl; if (hh >= 0) { r = 0.04 + 0.06 * b; g = 0.06 + 0.66 * b; bl = 0.05 + 0.56 * b; } else { r = 0.06 + 0.78 * b; g = 0.05 + 0.46 * b; bl = 0.04; } o[k * 3] = Math.round(r * 255); o[k * 3 + 1] = Math.round(g * 255); o[k * 3 + 2] = Math.round(bl * 255); }
  return o;
}
function contoursU8(G, w, h) {
  const o = new Uint8Array(w * h * 3), S = new Float32Array(w * h); let mx = 1e-6;
  for (let k = 0; k < w * h; k++) { S[k] = Math.hypot(G.U[k], G.V[k]); if (S[k] > mx) mx = S[k]; }
  const B = 7;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i, band = Math.floor((S[k] / mx) * B); const edge = (i > 0 && Math.floor((S[k - 1] / mx) * B) !== band) || (j > 0 && Math.floor((S[k - w] / mx) * B) !== band); const c = heat(band / (B - 1)), f = edge ? 0.35 : 1; o[k * 3] = Math.round(c[0] * f * 255); o[k * 3 + 1] = Math.round(c[1] * f * 255); o[k * 3 + 2] = Math.round(c[2] * f * 255); }
  return o;
}

// ---------- volumetric smoke (CPU raymarch through bake3D) ----------
// mirrors examples/smoke.html: bake3D velocity → semi-Lagrangian dye → front-to-back raymarch.
function smokeVolume(opts, DN, warm) {
  const f = create(opts), DNN = DN * DN * DN, vol = f.bake3D(DN), d = vol.data;
  const U = new Float32Array(DNN), V = new Float32Array(DNN), W = new Float32Array(DNN);
  let s = 0; for (let o = 0; o < DNN; o++) { const a = d[o * 4], b = d[o * 4 + 1], c = d[o * 4 + 2]; U[o] = a; V[o] = b; W[o] = c; s += a * a + b * b + c * c; }
  const sc = 0.36 / (Math.sqrt(s / DNN) || 1); for (let o = 0; o < DNN; o++) { U[o] *= sc; V[o] *= sc; W[o] *= sc; }
  let d1 = new Float32Array(DNN), d2 = new Float32Array(DNN), d3 = new Float32Array(DNN), e1 = new Float32Array(DNN), e2 = new Float32Array(DNN), e3 = new Float32Array(DNN);
  const KADV = 1.5, SPEED = opts.speed ?? 1, RISE = opts.rise ?? 0.4;
  const puff = (D, cx, cy, cz, rad, amt) => { const R = Math.ceil(rad * 2.4), i2 = 1 / (2 * rad * rad); for (let dz = -R; dz <= R; dz++) { const z = Math.round(cz) + dz; if (z < 0 || z >= DN) continue; for (let dy = -R; dy <= R; dy++) { const y = Math.round(cy) + dy; if (y < 0 || y >= DN) continue; for (let dx = -R; dx <= R; dx++) { const x = Math.round(cx) + dx; if (x < 0 || x >= DN) continue; D[(z * DN + y) * DN + x] += amt * Math.exp(-(dx * dx + dy * dy + dz * dz) * i2); } } } };
  let simT = 0;
  const step = () => {
    let t = d1; d1 = e1; e1 = t; t = d2; d2 = e2; e2 = t; t = d3; d3 = e3; e3 = t;
    const K = KADV * SPEED, DIS = 0.985; let o = 0;
    for (let z = 0; z < DN; z++) for (let y = 0; y < DN; y++) for (let x = 0; x < DN; x++, o++) {
      const px = x - U[o] * K, py = y - V[o] * K - RISE, pz = z - W[o] * K; let s1 = 0, s2 = 0, s3 = 0;
      if (px >= 0 && px < DN - 1 && py >= 0 && py < DN - 1 && pz >= 0 && pz < DN - 1) {
        const x0 = px | 0, y0 = py | 0, z0 = pz | 0, fx = px - x0, fy = py - y0, fz = pz - z0;
        const a0 = (z0 * DN + y0) * DN + x0, a1 = a0 + 1, a2 = a0 + DN, a3 = a2 + 1, a4 = a0 + DN * DN, a5 = a4 + 1, a6 = a4 + DN, a7 = a6 + 1;
        const w0 = (1 - fx) * (1 - fy) * (1 - fz), w1 = fx * (1 - fy) * (1 - fz), w2 = (1 - fx) * fy * (1 - fz), w3 = fx * fy * (1 - fz), w4 = (1 - fx) * (1 - fy) * fz, w5 = fx * (1 - fy) * fz, w6 = (1 - fx) * fy * fz, w7 = fx * fy * fz;
        s1 = e1[a0] * w0 + e1[a1] * w1 + e1[a2] * w2 + e1[a3] * w3 + e1[a4] * w4 + e1[a5] * w5 + e1[a6] * w6 + e1[a7] * w7;
        s2 = e2[a0] * w0 + e2[a1] * w1 + e2[a2] * w2 + e2[a3] * w3 + e2[a4] * w4 + e2[a5] * w5 + e2[a6] * w6 + e2[a7] * w7;
        s3 = e3[a0] * w0 + e3[a1] * w1 + e3[a2] * w2 + e3[a3] * w3 + e3[a4] * w4 + e3[a5] * w5 + e3[a6] * w6 + e3[a7] * w7;
      }
      d1[o] = s1 * DIS; d2[o] = s2 * DIS; d3[o] = s3 * DIS;
    }
  };
  const emit = () => { const a = DN * 0.32 + 3.5 * Math.sin(simT * 0.8), b = DN * 0.5 + 3.5 * Math.cos(simT * 0.6), c = DN * 0.68 + 3.5 * Math.sin(simT * 0.7 + 2), e = DN * 0.5 + 3.5 * Math.cos(simT * 0.9 + 1.1); puff(d1, a, 3.5, b, 2.1, 0.5); puff(d2, c, 3.5, e, 2.1, 0.5); };
  for (let k = 0; k < warm; k++) { simT += 0.03; emit(); step(); }
  return { get d1() { return d1; }, get d2() { return d2; }, get d3() { return d3; }, tick() { simT += 0.03; emit(); step(); }, DN };
}
function raymarchSmoke(vol, w, h, yaw, pitch, zoom) {
  const DN = vol.DN, d1 = vol.d1, d2 = vol.d2, d3 = vol.d3;
  const smp = (D, x, y, z) => { if (x < 0 || y < 0 || z < 0 || x >= DN - 1 || y >= DN - 1 || z >= DN - 1) return 0; const x0 = x | 0, y0 = y | 0, z0 = z | 0, fx = x - x0, fy = y - y0, fz = z - z0, o = (z0 * DN + y0) * DN + x0; const c00 = D[o] * (1 - fx) + D[o + 1] * fx, c10 = D[o + DN] * (1 - fx) + D[o + DN + 1] * fx, c01 = D[o + DN * DN] * (1 - fx) + D[o + DN * DN + 1] * fx, c11 = D[o + DN * DN + DN] * (1 - fx) + D[o + DN * DN + DN + 1] * fx; return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz; };
  const dd = 2.1 / zoom, cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const camPos = [dd * cp * sy, dd * sp, dd * cp * cy], fl = Math.hypot(camPos[0], camPos[1], camPos[2]), camF = [-camPos[0] / fl, -camPos[1] / fl, -camPos[2] / fl];
  const r = [camF[2], 0, -camF[0]], rl = Math.hypot(r[0], r[1], r[2]) || 1, camR = [r[0] / rl, r[1] / rl, r[2] / rl];
  const camU = [camR[1] * camF[2] - camR[2] * camF[1], camR[2] * camF[0] - camR[0] * camF[2], camR[0] * camF[1] - camR[1] * camF[0]];
  const fovT = 0.42, aspect = w / h, STEPS = 50, img = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ux = (i / w) * 2 - 1, uy = -((j / h) * 2 - 1);
    let rx = camF[0] + ux * fovT * aspect * camR[0] + uy * fovT * camU[0], ry = camF[1] + ux * fovT * aspect * camR[1] + uy * fovT * camU[1], rz = camF[2] + ux * fovT * aspect * camR[2] + uy * fovT * camU[2];
    const rn = Math.hypot(rx, ry, rz); rx /= rn; ry /= rn; rz /= rn;
    const ix = 1 / rx, iy = 1 / ry, iz = 1 / rz, t0x = (-0.5 - camPos[0]) * ix, t1x = (0.5 - camPos[0]) * ix, t0y = (-0.5 - camPos[1]) * iy, t1y = (0.5 - camPos[1]) * iy, t0z = (-0.5 - camPos[2]) * iz, t1z = (0.5 - camPos[2]) * iz;
    const tn = Math.max(Math.max(Math.min(t0x, t1x), Math.min(t0y, t1y)), Math.min(t0z, t1z)), tf = Math.min(Math.min(Math.max(t0x, t1x), Math.max(t0y, t1y)), Math.max(t0z, t1z));
    const g = uy * 0.5 + 0.5; let cr = 0.027 + 0.010 * (1 - g), cg = 0.039 + 0.016 * (1 - g), cb = 0.055 + 0.024 * (1 - g);
    if (tf > Math.max(tn, 0)) {
      let T = 1, ar = 0, ag = 0, ab = 0, t = Math.max(tn, 0); const dt = (tf - t) / STEPS; t += dt * 0.5;
      for (let k = 0; k < STEPS; k++) {
        const cx = (camPos[0] + rx * t + 0.5) * DN, cyy = (camPos[1] + ry * t + 0.5) * DN, cz = (camPos[2] + rz * t + 0.5) * DN;
        const s1 = smp(d1, cx, cyy, cz), s2 = smp(d2, cx, cyy, cz), s3 = smp(d3, cx, cyy, cz), sd = s1 + s2 + s3;
        if (sd > 0.004) {
          const a = 1 - Math.exp(-sd * 30 * dt), inv = 1 / sd, c0 = (0.20 * s1 + 0.96 * s2 + 0.88 * s3) * inv, c1 = (0.86 * s1 + 0.64 * s2 + 0.92 * s3) * inv, c2 = (0.77 * s1 + 0.25 * s2 + 0.96 * s3) * inv;
          const above = smp(d1, cx, cyy + 0.05 * DN, cz) + smp(d2, cx, cyy + 0.05 * DN, cz) + smp(d3, cx, cyy + 0.05 * DN, cz), sh = 0.30 + 0.70 * Math.exp(-above * 2.4);
          ar += T * a * c0 * sh; ag += T * a * c1 * sh; ab += T * a * c2 * sh; T *= 1 - a; if (T < 0.02) break;
        }
        t += dt;
      }
      cr = cr * T + ar; cg = cg * T + ag; cb = cb * T + ab;
    }
    const o = (j * w + i) * 3; img[o] = Math.min(255, 255 * Math.pow(cr, 0.909)); img[o + 1] = Math.min(255, 255 * Math.pow(cg, 0.909)); img[o + 2] = Math.min(255, 255 * Math.pow(cb, 0.909));
  }
  return img;
}

// ---------- flowing water surface (ripple layers warped along the flow) ----------
function warpField(G, w, h) {
  const Dx = new Float32Array(w * h), Dy = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let x = (i / w) * TAU, y = (j / h) * TAU, ax = 0, ay = 0;
    for (let s = 0; s < 6; s++) { const u = gbil(G, G.U, x, y), v = gbil(G, G.V, x, y); x += u * 0.09; y += v * 0.09; ax += u * 0.09; ay += v * 0.09; }
    Dx[j * w + i] = ax; Dy[j * w + i] = ay;
  }
  return { Dx, Dy };
}
const WATER_LAYERS = [
  { dx: 1.0, dy: 0.25, f: 3.8, w: 1.00, sp: 1, ph: 0.0 },
  { dx: -0.35, dy: 1.0, f: 6.3, w: 0.58, sp: 1, ph: 1.7 },
  { dx: 0.72, dy: -0.62, f: 10.4, w: 0.34, sp: 2, ph: 3.1 },
  { dx: 0.2, dy: 0.9, f: 15.5, w: 0.18, sp: 3, ph: 0.9 },
].map(L => { const n = Math.hypot(L.dx, L.dy); return { ...L, dx: L.dx / n, dy: L.dy / n }; });
// t advancing 0→2π makes every layer's phase (sp∈{1,2,3}) return to start → seamless loop
function waterU8(G, warp, w, h, t, { warpAmp = 1.2, slope = 1.7, sunAng = 2.3 } = {}) {
  const img = new Uint8Array(w * h * 3);
  const Lx = Math.cos(sunAng) * 0.6, Ly = Math.sin(sunAng) * 0.6, HLx = Lx, HLy = Ly, HLz = 1.7, hln = Math.hypot(HLx, HLy, HLz), hx = HLx / hln, hy = HLy / hln, hz = HLz / hln;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, px = (i / w) * TAU + warpAmp * warp.Dx[k], py = (j / h) * TAU + warpAmp * warp.Dy[k];
    let hgt = 0, gx = 0, gy = 0;
    for (const L of WATER_LAYERS) { const arg = L.f * (L.dx * px + L.dy * py) - L.sp * t + L.ph, c = Math.cos(arg); hgt += L.w * Math.sin(arg); const gg = L.w * c * L.f; gx += gg * L.dx; gy += gg * L.dy; }
    let nx = -slope * gx, ny = -slope * gy, nz = 1; const nn = Math.hypot(nx, ny, nz); nx /= nn; ny /= nn; nz /= nn;
    const hn = hgt / 2.10, tt2 = Math.pow(hn * 0.5 + 0.5, 2);
    let r = 0.006 + 0.045 * tt2, g = 0.045 + 0.30 * tt2, b = 0.10 + 0.42 * tt2;
    const spec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 110); r += spec * 1.5; g += spec * 1.45; b += spec * 1.3;
    const caus = Math.pow(Math.max(0, hn), 7) * (0.4 + 0.6 * nz); r += caus * 0.45; g += caus * 1.05; b += caus * 0.95;
    const fres = Math.pow(1 - nz, 3); r += fres * 0.10; g += fres * 0.16; b += fres * 0.22;
    const o = k * 3; img[o] = Math.min(255, 255 * Math.pow(Math.max(0, r), 0.85)); img[o + 1] = Math.min(255, 255 * Math.pow(Math.max(0, g), 0.85)); img[o + 2] = Math.min(255, 255 * Math.pow(Math.max(0, b), 0.85));
  }
  return img;
}

// ---------- GIF + PNG writers ----------
function saveGIF(name, w, h, frames, delay = 60, maxColors = 128) {
  const enc = GIFEncoder();
  const ref = frames[(frames.length / 2) | 0];
  const palette = quantize(ref, maxColors, { format: "rgba4444" });
  frames.forEach((frame, i) => {
    const index = applyPalette(frame, palette, "rgba4444");
    enc.writeFrame(index, w, h, { palette, delay, repeat: i === 0 ? 0 : undefined });
  });
  enc.finish();
  fs.writeFileSync(new URL(name, OUT), enc.bytes());
  console.log("  wrote", name, `${w}×${h} ${frames.length}f ${(enc.bytes().length / 1024 | 0)}kB`);
}
// minimal PNG (RGB8) for the static montage
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => { const t = Buffer.from(type, "ascii"), len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const cd = Buffer.concat([t, data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cd), 0); return Buffer.concat([len, cd, crc]); };
function savePNG(name, w, h, rgb) {
  const stride = w * 3, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  const idat = zlib.deflateSync(raw, { level: 9 }), ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(new URL(name, OUT), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]));
  console.log("  wrote", name, `${w}×${h}`);
}
function composite(W, H, panels) {
  const out = new Uint8Array(W * H * 3);
  for (const p of panels) for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) { const dx = p.x + x, dy = p.y + y; if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue; const s = (y * p.w + x) * 3, d = (dy * W + dx) * 3; out[d] = p.u8[s]; out[d + 1] = p.u8[s + 1]; out[d + 2] = p.u8[s + 2]; }
  return out;
}
const pingpong = (a, b, n) => { const v = []; for (let i = 0; i < n; i++) v.push(a + (b - a) * (i / (n - 1))); for (let i = n - 2; i > 0; i--) v.push(v[i]); return v; };

// NOTE: the three demo-card thumbnails (million/tubes/cirrus.gif) are rendered by a dedicated
// script — `node scripts/render-demo-gifs.mjs` — because each is a bespoke renderer (3-D particle
// volume, shaded streamtubes, a sunset-cirrus sky) rather than a flat flow-streak field.

// ---------- build ----------
console.log("rendering assets…");

// hero.gif is rendered by scripts/render-landing-gif.mjs (the landing's Silk-current
// particle animation) — not here, so `npm run assets` never overwrites it.

// knob-sweep GIFs — same seed, one dial animates; you watch the field morph
function sweep(name, param, a, b) {
  const w = 480, h = 200, vals = pingpong(a, b, 12), frames = [];
  for (const val of vals) { const opts = { modes: 34, slope: 1.5, helicity: 0.7, coherence: 0.5, seed: 5, [param]: val }; frames.push(rgbToRGBA(flowU8(grid(create(opts), w, h), w, h, { particles: 2400, steps: 36, seed: 2 }), w, h)); }
  saveGIF(name, w, h, frames, 75, 128);
}
sweep("knob-helicity.gif", "helicity", -1, 1);
sweep("knob-coherence.gif", "coherence", 0, 1);
sweep("knob-spectrum.gif", "slope", 2.6, 1.0);

// smoke.gif — volumetric smoke raymarched through bake3D, camera orbiting one full turn
{
  const w = 420, h = 260, vol = smokeVolume({ modes: 44, slope: 2.4, helicity: 0.9, coherence: 0.6, seed: 2027 }, 48, 90);
  const N = 40, frames = [];
  for (let i = 0; i < N; i++) { vol.tick(); frames.push(rgbToRGBA(raymarchSmoke(vol, w, h, 0.6 + TAU * i / N, 0.22, 1.15), w, h)); }
  saveGIF("smoke.gif", w, h, frames, 60, 160);
}

// water.gif — flowing water surface, seamless loop (t sweeps one full period)
{
  const w = 460, h = 270, wf = create({ modes: 40, slope: 1.7, helicity: 0.6, coherence: 0.55, seed: 9 });
  const G = grid(wf, 160, 100), warp = warpField(G, w, h), N = 44, frames = [];
  for (let i = 0; i < N; i++) frames.push(rgbToRGBA(waterU8(G, warp, w, h, TAU * i / N), w, h));
  saveGIF("water.gif", w, h, frames, 55, 160);
}

// looks.png — one field, four renderers (static montage)
{
  const pw = 560, ph = 340, gap = 8, W = pw * 2 + gap, H = ph * 2 + gap, f = create({ modes: 46, slope: 1.5, helicity: 0.8, coherence: 0.55, seed: 11 }), G = grid(f, pw, ph);
  savePNG("looks.png", W, H, composite(W, H, [
    { u8: flowU8(G, pw, ph, { particles: 3200, steps: 40, seed: 4 }), w: pw, h: ph, x: 0, y: 0 },
    { u8: licU8(G, pw, ph, { seed: 4 }), w: pw, h: ph, x: pw + gap, y: 0 },
    { u8: heatU8(G, pw, ph), w: pw, h: ph, x: 0, y: ph + gap },
    { u8: contoursU8(G, pw, ph), w: pw, h: ph, x: pw + gap, y: ph + gap },
  ]));
}
console.log("done.");
