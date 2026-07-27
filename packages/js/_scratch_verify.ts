// Checks the numbers printed by examples/murmuration.html.
// Mirrors the page exactly: same torus (L = 22, FS = 2π/L), same tileable field options, same
// gradient twin, same fixed 1/60 s Euler step, same 6³ occupancy bins, same 4096 tracers per field,
// same tracer seed. Run from packages/js:   node --import tsx verify.ts
import { create, version } from "./src/index";

const TAU = Math.PI * 2;
const L = 22, H = L / 2, FS = TAU / L;
const NB = 6, NBIN = NB ** 3, NTR = 4096, MU = NTR / NBIN;
const POISSON = 1 / Math.sqrt(MU);
const WSPD = 4, TDT = 1 / 60;
const MODES = 18, KMIN = 1, KMAX = 5, SLOPE = 1.4, SEED = 7, CHURN = 0.8;

function mulberry(s: number) {
  return function () { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeGradientField(o: { modes: number; kmin: number; kmax: number; slope: number; seed: number; churn: number }) {
  const N = o.modes, rng = mulberry(o.seed);
  const kx = new Float64Array(N), ky = new Float64Array(N), kz = new Float64Array(N);
  const km = new Float64Array(N), a = new Float64Array(N), ph = new Float64Array(N), om = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const kt = o.kmin + (o.kmax - o.kmin) * ((j + rng()) / N);
    const u = 2 * rng() - 1, th = TAU * rng(), r = Math.sqrt(Math.max(0, 1 - u * u));
    let ix = Math.round(kt * r * Math.cos(th)), iy = Math.round(kt * r * Math.sin(th)), iz = Math.round(kt * u);
    if (!ix && !iy && !iz) ix = 1;
    const k = Math.hypot(ix, iy, iz);
    kx[j] = ix; ky[j] = iy; kz[j] = iz; km[j] = k;
    a[j] = Math.pow(k, -o.slope) / k;
    ph[j] = TAU * rng();
    om[j] = (rng() < 0.5 ? -1 : 1) * o.churn * Math.cbrt(o.kmin) * Math.pow(k, 2 / 3);
  }
  let sc = 1;
  const F = {
    sample(x: number, y: number, z: number, out: number[] | Float64Array, t: number) {
      let ux = 0, uy = 0, uz = 0;
      for (let j = 0; j < N; j++) {
        const c = a[j] * Math.cos(kx[j] * x + ky[j] * y + kz[j] * z + ph[j] + om[j] * t);
        ux += c * kx[j]; uy += c * ky[j]; uz += c * kz[j];
      }
      out[0] = ux * sc; out[1] = uy * sc; out[2] = uz * sc; return out;
    },
    sampleMany(pos: Float64Array, out: Float64Array, t: number) {
      const n = pos.length / 3;
      out.fill(0);
      for (let j = 0; j < N; j++) {
        const kxj = kx[j], kyj = ky[j], kzj = kz[j], p0 = ph[j] + om[j] * t, aj = a[j] * sc;
        for (let i = 0; i < n; i++) {
          const c = aj * Math.cos(kxj * pos[3 * i] + kyj * pos[3 * i + 1] + kzj * pos[3 * i + 2] + p0);
          out[3 * i] += c * kxj; out[3 * i + 1] += c * kyj; out[3 * i + 2] += c * kzj;
        }
      }
      return out;
    },
    divergence(x: number, y: number, z: number, t: number) {
      let d = 0;
      for (let j = 0; j < N; j++) d -= a[j] * km[j] * km[j] * Math.sin(kx[j] * x + ky[j] * y + kz[j] * z + ph[j] + om[j] * t);
      return d * sc;
    },
    // not printed on the page — checks the *other* half of the claim, that the twin is curl-free
    curlMax(t: number, rng2: () => number) {
      let mx = 0;
      const h = 1e-4, o = [0, 0, 0], p = [0, 0, 0];
      for (let m = 0; m < 200; m++) {
        const x = rng2() * TAU, y = rng2() * TAU, z = rng2() * TAU;
        F.sample(x, y + h, z, o, t); F.sample(x, y - h, z, p, t); const c1 = (o[2] - p[2]) / (2 * h);
        F.sample(x, y, z + h, o, t); F.sample(x, y, z - h, p, t); const c2 = (o[1] - p[1]) / (2 * h);
        mx = Math.max(mx, Math.abs(c1 - c2));
      }
      return mx;
    },
  };
  const rr = mulberry(4242), o3 = [0, 0, 0];
  let s2 = 0;
  for (let m = 0; m < 2000; m++) { F.sample(rr() * TAU, rr() * TAU, rr() * TAU, o3, 0); s2 += o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2; }
  sc = 1 / Math.sqrt(s2 / 2000);
  return F;
}

const helix = create({
  modes: MODES, slope: SLOPE, kmin: KMIN, kmax: KMAX, seed: SEED,
  coherence: 0.45, helicity: 0.4, churn: CHURN, tileable: true,
});
const grad = makeGradientField({ modes: MODES, kmin: KMIN, kmax: KMAX, slope: SLOPE, seed: SEED, churn: CHURN });

const bins = new Int32Array(NBIN);
function occupancy(p: Float64Array) {
  bins.fill(0);
  for (let i = 0; i < NTR; i++) {
    const b0 = Math.min(NB - 1, (((p[3 * i] + H) / L) * NB) | 0);
    const b1 = Math.min(NB - 1, (((p[3 * i + 1] + H) / L) * NB) | 0);
    const b2 = Math.min(NB - 1, (((p[3 * i + 2] + H) / L) * NB) | 0);
    bins[(b0 * NB + b1) * NB + b2]++;
  }
  let v = 0, mx = 0, mn = 1e9, empty = 0;
  for (let b = 0; b < NBIN; b++) {
    const d = bins[b] - MU; v += d * d;
    if (bins[b] > mx) mx = bins[b];
    if (bins[b] < mn) mn = bins[b];
    if (bins[b] === 0) empty++;
  }
  return { cv: Math.sqrt(v / NBIN) / MU, max: mx, min: mn, empty };
}

const wrap = (v: number) => (v > H ? v - L : v < -H ? v + L : v);
const trA = new Float64Array(3 * NTR), trB = new Float64Array(3 * NTR);
const trQ = new Float64Array(3 * NTR), trV = new Float64Array(3 * NTR);
{ const rs = mulberry(20260726); for (let i = 0; i < 3 * NTR; i++) { const v = (rs() * 2 - 1) * H; trA[i] = v; trB[i] = v; } }

console.log(`helix-noise ${version} — murmuration.html receipt check`);
console.log(`torus ${L}^3 . bins ${NB}^3 = ${NBIN} . ${NTR} tracers per field . mu = ${MU.toFixed(1)}`);
console.log(`Poisson floor 1/sqrt(mu) = ${POISSON.toFixed(4)}   (the page prints 0.230)\n`);
console.log("   t(s)   sigma/mu dxA   max/min/empty     sigma/mu gradphi   max/min/empty");

let t = 0;
let worstA = 0, bestB = 0, maxBinB = 0;
for (let fr = 0; fr <= 10800; fr++) {   // 3 minutes at 60 fps
  const A = occupancy(trA), B = occupancy(trB);
  if (fr % 900 === 0) {
    console.log(`  ${(fr / 60).toFixed(0).padStart(5)}   ${A.cv.toFixed(4).padStart(10)}   ${`${A.max}/${A.min}/${A.empty}`.padStart(13)}` +
      `   ${B.cv.toFixed(3).padStart(16)}   ${`${B.max}/${B.min}/${B.empty}`.padStart(13)}`);
  }
  worstA = Math.max(worstA, Math.abs(A.cv - POISSON) / POISSON);
  if (fr > 300) bestB = Math.max(bestB, B.cv);
  maxBinB = Math.max(maxBinB, B.max);

  for (let i = 0; i < 3 * NTR; i++) trQ[i] = trA[i] * FS;
  helix.sampleMany(trQ, trV, t);
  for (let i = 0; i < 3 * NTR; i++) trA[i] = wrap(trA[i] + trV[i] * WSPD * TDT);
  for (let i = 0; i < 3 * NTR; i++) trQ[i] = trB[i] * FS;
  grad.sampleMany(trQ, trV, t);
  for (let i = 0; i < 3 * NTR; i++) trB[i] = wrap(trB[i] + trV[i] * WSPD * TDT);
  t += TDT;
}

// the divergence / amplitude receipt, exactly as the page computes it (analytic, no FD)
const g9 = new Float64Array(9), o6 = new Float64Array(6), o3 = [0, 0, 0];
const rp = mulberry(1234);
let da = 0, db = 0, ua = 0, ub = 0;
const M = 20000;
for (let m = 0; m < M; m++) {
  const x = rp() * TAU, y = rp() * TAU, z = rp() * TAU;
  helix.sampleGrad(x, y, z, g9, t);
  const d = g9[0] + g9[4] + g9[8]; da += d * d;
  const e = grad.divergence(x, y, z, t); db += e * e;
  helix.sampleUW(x, y, z, o6, t); ua += o6[0] ** 2 + o6[1] ** 2 + o6[2] ** 2;
  grad.sample(x, y, z, o3, t); ub += o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2;
}
const rmsDivA = Math.sqrt(da / M), rmsDivB = Math.sqrt(db / M);
const rmsUA = Math.sqrt(ua / M), rmsUB = Math.sqrt(ub / M);

console.log(`\nanalytic rms div(u)   dxA ${rmsDivA.toExponential(2)}    gradphi ${rmsDivB.toFixed(3)}`);
console.log(`rms |u| (matched)     dxA ${rmsUA.toFixed(3)}       gradphi ${rmsUB.toFixed(3)}`);
console.log(`max |curl u| of the gradient twin (FD, h=1e-4): ${grad.curlMax(t, mulberry(5)).toExponential(2)}`);

const pass = (b: boolean) => (b ? "PASS" : "FAIL");
console.log(`\n[${pass(worstA <= 0.25)}] dxA spread never leaves +-25% of the Poisson floor over 3 min ` +
  `(worst deviation ${(100 * worstA).toFixed(1)}%)`);
console.log(`[${pass(bestB >= 4)}] gradphi spread exceeds 4 (peak ${bestB.toFixed(2)}, ${(bestB / POISSON).toFixed(0)}x the floor)`);
console.log(`[${pass(maxBinB / NTR >= 0.15)}] gradphi piles >=15% of its tracers into one bin of 216 (peak ${maxBinB} = ${(100 * maxBinB / NTR).toFixed(0)}%)`);
console.log(`[${pass(rmsDivA < 1e-13)}] dxA divergence is roundoff (${rmsDivA.toExponential(2)})`);
console.log(`[${pass(rmsDivB > 0.5)}] gradphi divergence is O(1), the paired non-zero (${rmsDivB.toFixed(3)})`);
console.log(`[${pass(Math.abs(rmsUA - rmsUB) / rmsUA < 0.15)}] the two fields are amplitude-matched within 15%`);
