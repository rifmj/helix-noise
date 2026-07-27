import { create } from "./src/index";
const TAU = Math.PI * 2;
const L = 22, H = L / 2, FS = TAU / L;
const NB = 6, NBIN = NB ** 3, NTR = 4096;
function mulberry32(s: number) {
  return function () { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const bins = new Int32Array(NBIN);
function cv(p: Float64Array, n: number) {
  bins.fill(0);
  for (let i = 0; i < n; i++) {
    const b0 = Math.min(NB - 1, (((p[3*i] + H) / L) * NB) | 0);
    const b1 = Math.min(NB - 1, (((p[3*i+1] + H) / L) * NB) | 0);
    const b2 = Math.min(NB - 1, (((p[3*i+2] + H) / L) * NB) | 0);
    bins[(b0 * NB + b1) * NB + b2]++;
  }
  const mu = n / NBIN; let v = 0, mx = 0, mn = 1e9;
  for (let b = 0; b < NBIN; b++) { const d = bins[b] - mu; v += d*d; if (bins[b] > mx) mx = bins[b]; if (bins[b] < mn) mn = bins[b]; }
  return { cv: Math.sqrt(v / NBIN) / mu, mx, mn };
}
const wrap = (v: number) => (v > H ? v - L : v < -H ? v + L : v);

function makeGrad(o: { modes: number; kmin: number; kmax: number; slope: number; seed: number; churn: number }) {
  const rng = mulberry32(o.seed), N = o.modes;
  const kx = new Float64Array(N), ky = new Float64Array(N), kz = new Float64Array(N),
    km = new Float64Array(N), a = new Float64Array(N), ph = new Float64Array(N), om = new Float64Array(N);
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
    N, km, a,
    sampleMany(pos: Float64Array, out: Float64Array, t: number) {
      const n = pos.length / 3;
      out.fill(0);
      for (let j = 0; j < N; j++) {
        const kxj = kx[j], kyj = ky[j], kzj = kz[j], p0 = ph[j] + om[j] * t, aj = a[j] * sc;
        for (let i = 0; i < n; i++) {
          const c = aj * Math.cos(kxj * pos[3*i] + kyj * pos[3*i+1] + kzj * pos[3*i+2] + p0);
          out[3*i] += c * kxj; out[3*i+1] += c * kyj; out[3*i+2] += c * kzj;
        }
      }
      return out;
    },
    sample(x: number, y: number, z: number, out: number[], t: number) {
      let ux = 0, uy = 0, uz = 0;
      for (let j = 0; j < N; j++) {
        const c = a[j] * Math.cos(kx[j]*x + ky[j]*y + kz[j]*z + ph[j] + om[j]*t);
        ux += c*kx[j]; uy += c*ky[j]; uz += c*kz[j];
      }
      out[0] = ux*sc; out[1] = uy*sc; out[2] = uz*sc; return out;
    },
    div(x: number, y: number, z: number, t: number) {
      let d = 0;
      for (let j = 0; j < N; j++) d -= a[j]*km[j]*km[j]*Math.sin(kx[j]*x + ky[j]*y + kz[j]*z + ph[j] + om[j]*t);
      return d * sc;
    },
    setScale(s: number) { sc = s; },
    getScale() { return sc; },
  };
  // RMS normalize on 2000 quasi-random points (a 6^3 lattice aliases integer k up to 5)
  const rr = mulberry32(4242), o3 = [0,0,0]; let s2 = 0;
  for (let m = 0; m < 2000; m++) { F.sample(rr()*TAU, rr()*TAU, rr()*TAU, o3, 0); s2 += o3[0]**2+o3[1]**2+o3[2]**2; }
  F.setScale(1 / Math.sqrt(s2 / 2000));
  return F;
}

for (const CHURN of [0.35, 0.8]) {
  const helix = create({ modes: 18, slope: 1.4, coherence: 0.45, helicity: 0.4, churn: CHURN, kmin: 1, kmax: 5, seed: 7, tileable: true });
  const grad = makeGrad({ modes: 18, kmin: 1, kmax: 5, slope: 1.4, seed: 7, churn: CHURN });
  const rs = mulberry32(20260726);
  const pA = new Float64Array(3*NTR), pB = new Float64Array(3*NTR);
  for (let i = 0; i < 3*NTR; i++) { const v = (rs()*2-1)*H; pA[i] = v; pB[i] = v; }
  const q = new Float64Array(3*NTR), vA = new Float64Array(3*NTR), vB = new Float64Array(3*NTR);
  const W = 4, dt = 1/60; let t = 0;
  const rowA: string[] = [], rowB: string[] = [];
  const t0 = performance.now();
  for (let fr = 0; fr <= 5400; fr++) {
    if (fr % 600 === 0) { rowA.push(cv(pA, NTR).cv.toFixed(3)); rowB.push(cv(pB, NTR).cv.toFixed(2)); }
    for (let i = 0; i < 3*NTR; i++) q[i] = pA[i]*FS;
    helix.sampleMany(q, vA, t);
    for (let i = 0; i < 3*NTR; i++) pA[i] = wrap(pA[i] + vA[i]*W*dt);
    for (let i = 0; i < 3*NTR; i++) q[i] = pB[i]*FS;
    grad.sampleMany(q, vB, t);
    for (let i = 0; i < 3*NTR; i++) pB[i] = wrap(pB[i] + vB[i]*W*dt);
    t += dt;
  }
  const ms = (performance.now() - t0) / 5401;
  console.log(`churn ${CHURN}: div-free  ${rowA.join(" ")}`);
  console.log(`churn ${CHURN}: grad-phi  ${rowB.join(" ")}`);
  console.log(`  ${(2*NTR).toLocaleString()} tracer samples/frame: ${ms.toFixed(2)} ms/frame (node)`);
  const rp = mulberry32(99), g9 = new Float64Array(9), o3 = [0,0,0];
  let dA=0,dB=0,uA=0,uB=0; const M = 4000;
  for (let m = 0; m < M; m++) {
    const x = rp()*TAU, y = rp()*TAU, z = rp()*TAU;
    helix.sampleGrad(x,y,z,g9,t); const d = g9[0]+g9[4]+g9[8]; dA += d*d;
    dB += grad.div(x,y,z,t)**2;
    const s = helix.sample(x,y,z,t); uA += s[0]**2+s[1]**2+s[2]**2;
    grad.sample(x,y,z,o3,t); uB += o3[0]**2+o3[1]**2+o3[2]**2;
  }
  console.log(`  rms div u: ${Math.sqrt(dA/M).toExponential(2)} / ${Math.sqrt(dB/M).toExponential(2)}    rms|u|: ${Math.sqrt(uA/M).toFixed(3)} / ${Math.sqrt(uB/M).toFixed(3)}\n`);
}
console.log("Poisson floor", (1/Math.sqrt(NTR/NBIN)).toFixed(4));
