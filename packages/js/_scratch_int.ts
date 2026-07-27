// Which integrator keeps a divergence-free flow volume-preserving well enough that the
// occupancy spread stays at its Poisson value for a minute of wall clock?
import { create } from "./src/index";
const TAU = Math.PI * 2;
const BX = 12, BY = 7, BZ = 12, NBX = 6, NBY = 4, NBZ = 6, NBIN = NBX * NBY * NBZ, NTR = 3072;

function mulberry32(s: number) {
  return function () { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const bins = new Int32Array(NBIN);
function cv(p: Float64Array, n: number) {
  bins.fill(0);
  for (let i = 0; i < n; i++) {
    const bx = Math.min(NBX - 1, (((p[3 * i] + BX) / (2 * BX)) * NBX) | 0);
    const by = Math.min(NBY - 1, (((p[3 * i + 1] + BY) / (2 * BY)) * NBY) | 0);
    const bz = Math.min(NBZ - 1, (((p[3 * i + 2] + BZ) / (2 * BZ)) * NBZ) | 0);
    bins[(bx * NBY + by) * NBZ + bz]++;
  }
  const mu = n / NBIN; let v = 0;
  for (let b = 0; b < NBIN; b++) { const d = bins[b] - mu; v += d * d; }
  return Math.sqrt(v / NBIN) / mu;
}
const wrap = (v: number, h: number) => (v > h ? v - 2 * h : v < -h ? v + 2 * h : v);

for (const cfg of [
  { name: "euler  kmax5 FS.42 W4", order: 1, kmax: 5, FS: 0.42, W: 4 },
  { name: "rk2    kmax5 FS.42 W4", order: 2, kmax: 5, FS: 0.42, W: 4 },
  { name: "rk4    kmax5 FS.42 W4", order: 4, kmax: 5, FS: 0.42, W: 4 },
  { name: "rk4    kmax4 FS.36 W3", order: 4, kmax: 4, FS: 0.36, W: 3 },
  { name: "rk2    kmax4 FS.36 W3", order: 2, kmax: 4, FS: 0.36, W: 3 },
]) {
  const f = create({ modes: 18, slope: 1.4, coherence: 0.45, helicity: 0.4, churn: 0.35, kmin: 1, kmax: cfg.kmax, seed: 7 });
  const rs = mulberry32(20260726);
  const p = new Float64Array(3 * NTR);
  for (let i = 0; i < NTR; i++) {
    p[3 * i] = (rs() * 2 - 1) * BX; p[3 * i + 1] = (rs() * 2 - 1) * BY; p[3 * i + 2] = (rs() * 2 - 1) * BZ;
  }
  const q = new Float64Array(3 * NTR), k1 = new Float64Array(3 * NTR), k2 = new Float64Array(3 * NTR),
    k3 = new Float64Array(3 * NTR), k4 = new Float64Array(3 * NTR);
  const S = cfg.FS, W = cfg.W;
  const stage = (src: Float64Array, out: Float64Array, t: number) => {
    for (let i = 0; i < 3 * NTR; i++) q[i] = src[i] * S;
    f.sampleMany(q, out, t);
    for (let i = 0; i < 3 * NTR; i++) out[i] *= W;
  };
  const dt = 1 / 60; let t = 0;
  const row: string[] = [];
  for (let fr = 0; fr <= 3600; fr++) {
    if (fr % 600 === 0) row.push(cv(p, NTR).toFixed(3));
    if (cfg.order === 1) {
      stage(p, k1, t);
      for (let i = 0; i < NTR; i++) { p[3*i]=wrap(p[3*i]+k1[3*i]*dt,BX); p[3*i+1]=wrap(p[3*i+1]+k1[3*i+1]*dt,BY); p[3*i+2]=wrap(p[3*i+2]+k1[3*i+2]*dt,BZ); }
    } else if (cfg.order === 2) {
      stage(p, k1, t);
      for (let i = 0; i < 3 * NTR; i++) k3[i] = p[i] + k1[i] * dt * 0.5;
      stage(k3, k2, t + dt * 0.5);
      for (let i = 0; i < NTR; i++) { p[3*i]=wrap(p[3*i]+k2[3*i]*dt,BX); p[3*i+1]=wrap(p[3*i+1]+k2[3*i+1]*dt,BY); p[3*i+2]=wrap(p[3*i+2]+k2[3*i+2]*dt,BZ); }
    } else {
      stage(p, k1, t);
      for (let i = 0; i < 3 * NTR; i++) q[i] = p[i] + k1[i] * dt * 0.5; // reuse via temp
      const tmp = new Float64Array(3 * NTR); tmp.set(q);
      stage(tmp, k2, t + dt * 0.5);
      for (let i = 0; i < 3 * NTR; i++) tmp[i] = p[i] + k2[i] * dt * 0.5;
      stage(tmp, k3, t + dt * 0.5);
      for (let i = 0; i < 3 * NTR; i++) tmp[i] = p[i] + k3[i] * dt;
      stage(tmp, k4, t + dt);
      for (let i = 0; i < NTR; i++) {
        for (let c = 0; c < 3; c++) {
          const j = 3 * i + c;
          const v = (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]) / 6;
          p[j] = wrap(p[j] + v * dt, c === 0 ? BX : c === 1 ? BY : BZ);
        }
      }
    }
    t += dt;
  }
  console.log(cfg.name.padEnd(24), "sigma/mu @ t=0,10,20,30,40,50,60s:", row.join("  "));
}
console.log("\nPoisson floor 1/sqrt(mu) =", (1 / Math.sqrt(NTR / NBIN)).toFixed(4));
