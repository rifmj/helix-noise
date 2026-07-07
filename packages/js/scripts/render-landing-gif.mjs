// Renders the landing page's particle-streamline animation into ../assets/hero.gif —
// the "Silk" current: teal/amber fading trails advected through the live field. Pure Node
// (gifenc, no browser), reproducible. Seamless loop trick: a static field + a warmed-up
// steady-state particle flow, so every captured frame is statistically identical.
// This is the canonical hero renderer (render-assets.mjs deliberately skips hero.gif).
// Run: node scripts/render-landing-gif.mjs
import { create } from "../dist/helix-noise.js";
import gifencMod from "gifenc";
import fs from "node:fs";

const { GIFEncoder, quantize, applyPalette } = gifencMod;
const TAU = Math.PI * 2;
const OUT = new URL("../assets/", import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rng32 = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

// ── the landing's "Silk" current ──
const W = 512, H = 256;
const field = create({ modes: 46, slope: 2.4, helicity: 0.85, coherence: 0.8, seed: 7 });
const WS = 0.011;        // world scale: sample at pixel * WS  (matches the landing)
const SP = 1.35;         // advection speed per frame
const N = 3000;         // particles (scaled to area)
const FADE = 0.915;      // trail persistence per frame (landing fades ~0.075 toward the void)
const WARMUP = 80;       // frames to reach steady state before capture
const FRAMES = 40, DELAY = 44; // ~1.8 s loop

const TEAL = [53 / 255, 224 / 255, 199 / 255];
const AMBER = [246 / 255, 165 / 255, 66 / 255];
const BG = [5 / 255, 7 / 255, 11 / 255];

const acc = new Float32Array(W * H * 3);
const px = new Float32Array(N), py = new Float32Array(N), plife = new Float32Array(N);
const rnd = rng32(20260707);
for (let i = 0; i < N; i++) { px[i] = rnd() * W; py[i] = rnd() * H; plife[i] = rnd() * 260; }
const uw = [0, 0, 0, 0, 0, 0];

function splat(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const add = (pxi, pyi, wt) => { const k = (pyi * W + pxi) * 3; acc[k] += r * a * wt; acc[k + 1] += g * a * wt; acc[k + 2] += b * a * wt; };
  add(x0, y0, (1 - fx) * (1 - fy)); add(x0 + 1, y0, fx * (1 - fy));
  add(x0, y0 + 1, (1 - fx) * fy); add(x0 + 1, y0 + 1, fx * fy);
}

function step() {
  for (let i = 0; i < W * H * 3; i++) acc[i] *= FADE;   // fade the trails
  for (let i = 0; i < N; i++) {
    let x = px[i], y = py[i];
    field.sampleUW(x * WS, y * WS, 0, uw);              // static field → seamless loop
    const vx = uw[0], vy = uw[1];
    const hel = uw[0] * uw[3] + uw[1] * uw[4] + uw[2] * uw[5];
    const teal = hel >= 0, col = teal ? TEAL : AMBER;
    const sp = Math.min(1, Math.hypot(vx, vy) * 0.6);
    const a = 0.16 + 0.62 * sp;                          // brighter where it moves faster
    const nx = x + vx * SP, ny = y + vy * SP;
    for (let t = 0; t < 3; t++) { const tt = t / 3; splat(x + (nx - x) * tt, y + (ny - y) * tt, col[0], col[1], col[2], a * 0.62); }
    px[i] = nx; py[i] = ny;
    if (--plife[i] <= 0 || nx < -10 || nx > W + 10 || ny < -10 || ny > H + 10) {
      px[i] = rnd() * W; py[i] = rnd() * H; plife[i] = 150 + rnd() * 220;
    }
  }
}

function toneRGBA() {
  const o = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) { const v = BG[c] + acc[i * 3 + c], t = v / (v + 1); o[i * 4 + c] = clamp(Math.round(255 * Math.pow(t, 0.85)), 0, 255); }
    o[i * 4 + 3] = 255;
  }
  return o;
}

console.log("warming up…");
for (let i = 0; i < WARMUP; i++) step();
console.log("capturing", FRAMES, "frames…");
const frames = [];
for (let i = 0; i < FRAMES; i++) { step(); frames.push(toneRGBA()); }

const enc = GIFEncoder();
const ref = frames[(frames.length / 2) | 0];
const palette = quantize(ref, 128, { format: "rgba4444" });
frames.forEach((frame, i) => enc.writeFrame(applyPalette(frame, palette, "rgba4444"), W, H, { palette, delay: DELAY, repeat: i === 0 ? 0 : undefined }));
enc.finish();
fs.writeFileSync(new URL("hero.gif", OUT), enc.bytes());
console.log(`wrote hero.gif ${W}×${H} ${FRAMES}f ${(enc.bytes().length / 1024) | 0}kB`);
