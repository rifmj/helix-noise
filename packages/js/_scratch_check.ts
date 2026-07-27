// Receipt check for examples/murmuration.html
// Reproduces exactly the two steering fields and the occupancy-spread measurement the page prints.
import { create } from "./src/index";

const TAU = Math.PI * 2;

// ---- box / measurement grid (must match the page) -------------------------
const BX = 12, BY = 7, BZ = 12;      // half-extents
const NBX = 6, NBY = 4, NBZ = 6;     // occupancy bins
const NBIN = NBX * NBY * NBZ;
const FS = 0.42;                     // world -> field coordinate scale
const NTR = 3072;                    // tracers per steering mode
const WIND = 4.0;                    // world speed gain

function mulberry32(s: number) {
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the compressible twin: u = grad(phi), same band / slope / churn law ----
function makeGradientField(o: {
  modes: number; kmin: number; kmax: number; slope: number; seed: number; churn: number; amplitude: number;
}) {
  const N = o.modes, rng = mulberry32(o.seed);
  const kx = new Float64Array(N), ky = new Float64Array(N), kz = new Float64Array(N);
  const km = new Float64Array(N), a = new Float64Array(N), ph = new Float64Array(N), om = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const k = o.kmin + (o.kmax - o.kmin) * ((j + rng()) / N);
    const u = 2 * rng() - 1, th = TAU * rng(), r = Math.sqrt(Math.max(0, 1 - u * u));
    km[j] = k; kx[j] = k * r * Math.cos(th); ky[j] = k * r * Math.sin(th); kz[j] = k * u;
    a[j] = Math.pow(k, -o.slope) / k;                 // |u_j| = a*k = k^-slope, same amplitude law
    ph[j] = TAU * rng();
    om[j] = (rng() < 0.5 ? -1 : 1) * o.churn * Math.cbrt(o.kmin) * Math.pow(k, 2 / 3);
  }
  let sc = 1;
  const f = {
    sample(x: number, y: number, z: number, out: number[], t: number) {
      let ux = 0, uy = 0, uz = 0;
      for (let j = 0; j < N; j++) {
        const c = Math.cos(kx[j] * x + ky[j] * y + kz[j] * z + ph[j] + om[j] * t) * a[j];
        ux += c * kx[j]; uy += c * ky[j]; uz += c * kz[j];
      }
      out[0] = ux * sc; out[1] = uy * sc; out[2] = uz * sc; return out;
    },
    div(x: number, y: number, z: number, t: number) {           // analytic: -sum a k^2 sin(phi)
      let d = 0;
      for (let j = 0; j < N; j++) d -= a[j] * km[j] * km[j] * Math.sin(kx[j] * x + ky[j] * y + kz[j] * z + ph[j] + om[j] * t);
      return d * sc;
    },
    curl(x: number, y: number, z: number, t: number) {          // identically 0 by construction
      return 0;
    },
  };
  // RMS-normalize on a 5^3 lattice, exactly like the library does at build time
  const o3 = [0, 0, 0]; let s2 = 0, n = 0;
  for (let i = 0; i < 5; i++) for (let j2 = 0; j2 < 5; j2++) for (let k2 = 0; k2 < 5; k2++) {
    f.sample((i / 5) * TAU, (j2 / 5) * TAU, (k2 / 5) * TAU, o3, 0);
    s2 += o3[0] * o3[0] + o3[1] * o3[1] + o3[2] * o3[2]; n++;
  }
  sc = o.amplitude / Math.sqrt(s2 / n);
  return f;
}

const FOPT = { modes: 18, slope: 1.4, coherence: 0.45, helicity: 0.4, churn: 0.35, kmin: 1, kmax: 5, seed: 7 };
const helix = create(FOPT);
const grad = makeGradientField({ modes: 18, slope: 1.4, kmin: 1, kmax: 5, seed: 7, churn: 0.35, amplitude: 1 });

// ---- occupancy spread ------------------------------------------------------
const bins = new Int32Array(NBIN);
function spread(p: Float64Array, n: number) {
  bins.fill(0);
  for (let i = 0; i < n; i++) {
    const bx = Math.min(NBX - 1, ((p[3 * i] + BX) / (2 * BX) * NBX) | 0);
    const by = Math.min(NBY - 1, ((p[3 * i + 1] + BY) / (2 * BY) * NBY) | 0);
    const bz = Math.min(NBZ - 1, ((p[3 * i + 2] + BZ) / (2 * BZ) * NBZ) | 0);
    bins[(bx * NBY + by) * NBZ + bz]++;
  }
  const mu = n / NBIN;
  let v = 0, mx = 0, mn = Infinity;
  for (let b = 0; b < NBIN; b++) { const d = bins[b] - mu; v += d * d; if (bins[b] > mx) mx = bins[b]; if (bins[b] < mn) mn = bins[b]; }
  return { cv: Math.sqrt(v / NBIN) / mu, max: mx, min: mn, mu };
}

// ---- run both tracer clouds from an identical uniform seed -----------------
const rs = mulberry32(20260726);
const pA = new Float64Array(3 * NTR), pB = new Float64Array(3 * NTR);
for (let i = 0; i < NTR; i++) {
  pA[3 * i] = pB[3 * i] = (rs() * 2 - 1) * BX;
  pA[3 * i + 1] = pB[3 * i + 1] = (rs() * 2 - 1) * BY;
  pA[3 * i + 2] = pB[3 * i + 2] = (rs() * 2 - 1) * BZ;
}
const wrap = (v: number, h: number) => (v > h ? v - 2 * h : v < -h ? v + 2 * h : v);

const scaled = new Float64Array(3 * NTR);
const outv = new Float64Array(3 * NTR);
const o3 = [0, 0, 0];
function stepA(dt: number, t: number) {                 // divergence-free steering (the library)
  for (let i = 0; i < 3 * NTR; i++) scaled[i] = pA[i] * FS;
  helix.sampleMany(scaled, outv, t);
  for (let i = 0; i < NTR; i++) {
    pA[3 * i] = wrap(pA[3 * i] + outv[3 * i] * WIND * dt, BX);
    pA[3 * i + 1] = wrap(pA[3 * i + 1] + outv[3 * i + 1] * WIND * dt, BY);
    pA[3 * i + 2] = wrap(pA[3 * i + 2] + outv[3 * i + 2] * WIND * dt, BZ);
  }
}
function stepB(dt: number, t: number) {                 // compressible steering u = grad(phi)
  for (let i = 0; i < NTR; i++) {
    grad.sample(pB[3 * i] * FS, pB[3 * i + 1] * FS, pB[3 * i + 2] * FS, o3, t);
    pB[3 * i] = wrap(pB[3 * i] + o3[0] * WIND * dt, BX);
    pB[3 * i + 1] = wrap(pB[3 * i + 1] + o3[1] * WIND * dt, BY);
    pB[3 * i + 2] = wrap(pB[3 * i + 2] + o3[2] * WIND * dt, BZ);
  }
}

const poisson = 1 / Math.sqrt(NTR / NBIN);
console.log(`helix-noise ${(await import("./src/index")).version} — murmuration receipt check`);
console.log(`box ${2 * BX}x${2 * BY}x${2 * BZ}, bins ${NBX}x${NBY}x${NBZ} = ${NBIN}, tracers ${NTR} each, mu = ${(NTR / NBIN).toFixed(1)}`);
console.log(`Poisson floor 1/sqrt(mu) = ${poisson.toFixed(4)}\n`);
console.log("   t(s)   sigma/mu div-free   sigma/mu grad-phi   max/min div-free   max/min grad-phi");
let t = 0; const dt = 1 / 60;
for (let f = 0; f <= 3600; f++) {
  if (f % 300 === 0) {
    const A = spread(pA, NTR), B = spread(pB, NTR);
    console.log(
      `  ${t.toFixed(1).padStart(5)}   ${A.cv.toFixed(4).padStart(15)}   ${B.cv.toFixed(4).padStart(17)}` +
      `   ${(A.max + "/" + A.min).padStart(16)}   ${(B.max + "/" + B.min).padStart(16)}`
    );
  }
  stepA(dt, t); stepB(dt, t); t += dt;
}

// ---- the divergence receipt, analytic, at random probe points --------------
const g9 = new Float64Array(9);
const rp = mulberry32(99);
let dA = 0, dB = 0, uA = 0, uB = 0;
const M = 4000;
for (let m = 0; m < M; m++) {
  const x = (rp() * 2 - 1) * BX * FS, y = (rp() * 2 - 1) * BY * FS, z = (rp() * 2 - 1) * BZ * FS;
  helix.sampleGrad(x, y, z, g9, t);
  const d = g9[0] + g9[4] + g9[8]; dA += d * d;
  const db = grad.div(x, y, z, t); dB += db * db;
  helix.sample(x, y, z, t).forEach((c) => (uA += c * c));
  grad.sample(x, y, z, o3, t); uB += o3[0] * o3[0] + o3[1] * o3[1] + o3[2] * o3[2];
}
console.log(`\nanalytic rms div(u):   div-free ${Math.sqrt(dA / M).toExponential(2)}   grad-phi ${Math.sqrt(dB / M).toExponential(2)}`);
console.log(`rms |u| (amplitude match): div-free ${Math.sqrt(uA / M).toFixed(4)}   grad-phi ${Math.sqrt(uB / M).toFixed(4)}`);

// ---- and the same divergence by central differences, same h for both -------
const h = 2e-3;
const a6 = [0, 0, 0, 0, 0, 0], b6 = [0, 0, 0, 0, 0, 0];
const rp2 = mulberry32(99);
let fA = 0, fB = 0;
for (let m = 0; m < M; m++) {
  const x = (rp2() * 2 - 1) * BX * FS, y = (rp2() * 2 - 1) * BY * FS, z = (rp2() * 2 - 1) * BZ * FS;
  let d = 0;
  helix.sampleUW(x + h, y, z, a6, t); helix.sampleUW(x - h, y, z, b6, t); d += (a6[0] - b6[0]) / (2 * h);
  helix.sampleUW(x, y + h, z, a6, t); helix.sampleUW(x, y - h, z, b6, t); d += (a6[1] - b6[1]) / (2 * h);
  helix.sampleUW(x, y, z + h, a6, t); helix.sampleUW(x, y, z - h, b6, t); d += (a6[2] - b6[2]) / (2 * h);
  fA += d * d;
  let e = 0;
  grad.sample(x + h, y, z, o3, t); e += o3[0]; grad.sample(x - h, y, z, o3, t); e -= o3[0];
  grad.sample(x, y + h, z, o3, t); e += o3[1]; grad.sample(x, y - h, z, o3, t); e -= o3[1];
  grad.sample(x, y, z + h, o3, t); e += o3[2]; grad.sample(x, y, z - h, o3, t); e -= o3[2];
  fB += (e / (2 * h)) * (e / (2 * h));
}
console.log(`FD rms div(u) h=${h}:   div-free ${Math.sqrt(fA / M).toExponential(2)}   grad-phi ${Math.sqrt(fB / M).toExponential(2)}`);
