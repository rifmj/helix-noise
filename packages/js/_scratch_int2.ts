// Cubic periodic box + tileable fields: now the wrap really is a torus, and a divergence-free
// flow must hold the occupancy spread at its Poisson value forever.
import { create } from "./src/index";
const TAU = Math.PI * 2;
const L = 22, H = L / 2, FS = TAU / L;
const NB = 6, NBIN = NB * NB * NB, NTR = 4096;

function mulberry32(s: number) {
  return function () { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const bins = new Int32Array(NBIN);
function cv(p: Float64Array, n: number) {
  bins.fill(0);
  for (let i = 0; i < n; i++) {
    const b0 = Math.min(NB - 1, (((p[3 * i] + H) / L) * NB) | 0);
    const b1 = Math.min(NB - 1, (((p[3 * i + 1] + H) / L) * NB) | 0);
    const b2 = Math.min(NB - 1, (((p[3 * i + 2] + H) / L) * NB) | 0);
    bins[(b0 * NB + b1) * NB + b2]++;
  }
  const mu = n / NBIN; let v = 0, mx = 0, mn = 1e9;
  for (let b = 0; b < NBIN; b++) { const d = bins[b] - mu; v += d * d; if (bins[b] > mx) mx = bins[b]; if (bins[b] < mn) mn = bins[b]; }
  return { cv: Math.sqrt(v / NBIN) / mu, mx, mn };
}
const wrap = (v: number) => (v > H ? v - L : v < -H ? v + L : v);

// gradient twin on the same integer lattice
function makeGrad(o: { modes: number; kmin: number; kmax: number; slope: number; seed: number; churn: number }) {
  const rng = mulberry32(o.seed);
  const kx: number[] = [], ky: number[] = [], kz: number[] = [], km: number[] = [], a: number[] = [], ph: number[] = [], om: number[] = [];
  for (let j = 0; j < o.modes; j++) {
    const kt = o.kmin + (o.kmax - o.kmin) * ((j + rng()) / o.modes);
    const u = 2 * rng() - 1, th = TAU * rng(), r = Math.sqrt(Math.max(0, 1 - u * u));
    let ix = Math.round(kt * r * Math.cos(th)), iy = Math.round(kt * r * Math.sin(th)), iz = Math.round(kt * u);
    if (ix === 0 && iy === 0 && iz === 0) ix = 1;
    const k = Math.hypot(ix, iy, iz);
    kx.push(ix); ky.push(iy); kz.push(iz); km.push(k);
    a.push(Math.pow(k, -o.slope) / k);
    ph.push(TAU * rng());
    om.push((rng() < 0.5 ? -1 : 1) * o.churn * Math.cbrt(o.kmin) * Math.pow(k, 2 / 3));
  }
  const N = o.modes; let sc = 1;
  const F = {
    sample(x: number, y: number, z: number, out: ArrayLike<number> & { [i: number]: number }, t: number) {
      let ux = 0, uy = 0, uz = 0;
      for (let j = 0; j < N; j++) {
        const c = a[j] * Math.cos(kx[j] * x + ky[j] * y + kz[j] * z + ph[j] + om[j] * t);
        ux += c * kx[j]; uy += c * ky[j]; uz += c * kz[j];
      }
      out[0] = ux * sc; out[1] = uy * sc; out[2] = uz * sc;
    },
    div(x: number, y: number, z: number, t: number) {
      let d = 0;
      for (let j = 0; j < N; j++) d -= a[j] * km[j] * km[j] * Math.sin(kx[j] * x + ky[j] * y + kz[j] * z + ph[j] + om[j] * t);
      return d * sc;
    },
  };
  const o3 = [0, 0, 0]; let s2 = 0, n = 0;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) for (let k = 0; k < 6; k++) {
    F.sample((i / 6) * TAU, (j / 6) * TAU, (k / 6) * TAU, o3, 0); s2 += o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2; n++;
  }
  sc = 1 / Math.sqrt(s2 / n);
  return F;
}

const MODES = 18, KMIN = 1, KMAX = 5, SLOPE = 1.4, CHURN = 0.35, SEED = 7;
const helix = create({ modes: MODES, slope: SLOPE, coherence: 0.45, helicity: 0.4, churn: CHURN, kmin: KMIN, kmax: KMAX, seed: SEED, tileable: true });
const grad = makeGrad({ modes: MODES, kmin: KMIN, kmax: KMAX, slope: SLOPE, seed: SEED, churn: CHURN });

const rs = mulberry32(20260726);
const pA = new Float64Array(3 * NTR), pB = new Float64Array(3 * NTR);
for (let i = 0; i < 3 * NTR; i++) { const v = (rs() * 2 - 1) * H; pA[i] = v; pB[i] = v; }
const q = new Float64Array(3 * NTR), vA = new Float64Array(3 * NTR);
const o3 = [0, 0, 0];
const W = 4, dt = 1 / 60;
let t = 0;
console.log(`box ${L}^3 (torus), bins ${NB}^3 = ${NBIN}, tracers ${NTR} each, mu = ${(NTR / NBIN).toFixed(1)}`);
console.log(`Poisson floor 1/sqrt(mu) = ${(1 / Math.sqrt(NTR / NBIN)).toFixed(4)}\n`);
console.log("  t(s)    div-free sigma/mu (max/min)     grad-phi sigma/mu (max/min)");
for (let fr = 0; fr <= 5400; fr++) {
  if (fr % 300 === 0) {
    const A = cv(pA, NTR), B = cv(pB, NTR);
    console.log(`  ${(fr / 60).toFixed(0).padStart(4)}    ${A.cv.toFixed(4).padStart(8)}  (${A.mx}/${A.mn})`.padEnd(48) +
      `${B.cv.toFixed(4).padStart(8)}  (${B.mx}/${B.mn})`);
  }
  for (let i = 0; i < 3 * NTR; i++) q[i] = pA[i] * FS;
  helix.sampleMany(q, vA, t);
  for (let i = 0; i < 3 * NTR; i++) pA[i] = wrap(pA[i] + vA[i] * W * dt);
  for (let i = 0; i < NTR; i++) {
    grad.sample(pB[3 * i] * FS, pB[3 * i + 1] * FS, pB[3 * i + 2] * FS, o3, t);
    pB[3 * i] = wrap(pB[3 * i] + o3[0] * W * dt);
    pB[3 * i + 1] = wrap(pB[3 * i + 1] + o3[1] * W * dt);
    pB[3 * i + 2] = wrap(pB[3 * i + 2] + o3[2] * W * dt);
  }
  t += dt;
}
const g9 = new Float64Array(9); const rp = mulberry32(99);
let dA = 0, dB = 0, uA = 0, uB = 0; const M = 4000;
for (let m = 0; m < M; m++) {
  const x = rp() * TAU, y = rp() * TAU, z = rp() * TAU;
  helix.sampleGrad(x, y, z, g9, t); const d = g9[0] + g9[4] + g9[8]; dA += d * d;
  const db = grad.div(x, y, z, t); dB += db * db;
  const s = helix.sample(x, y, z, t); uA += s[0] ** 2 + s[1] ** 2 + s[2] ** 2;
  grad.sample(x, y, z, o3, t); uB += o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2;
}
console.log(`\nanalytic rms div u:  div-free ${Math.sqrt(dA / M).toExponential(2)}   grad-phi ${Math.sqrt(dB / M).toExponential(2)}`);
console.log(`rms |u|:             div-free ${Math.sqrt(uA / M).toFixed(4)}   grad-phi ${Math.sqrt(uB / M).toFixed(4)}`);
