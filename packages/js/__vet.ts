// Adversarial replication of examples/composition.html's receipt.
// Every constant and every function below is copied verbatim from the page.
import * as HelixNoise from "./src/index";

const HX = 3.6, HZ = 2.25;
const RING_R = 1.5, RING_C = 0.42, RING_G = 1.6;
const STRAIN = 0.35, NU = 0.05, EPS = 1.0;
const SRC_C = 0.25;
const T = 1, Q = 0.6, LAM = 2, BB = 0.6, AA = 0.8;

function sourceLayer(c: number): any {
  return {
    sampleUW(x: number, y: number, z: number, o: any) { o[0] = c * x; o[1] = c * y; o[2] = c * z; o[3] = 0; o[4] = 0; o[5] = 0; return o; },
    sampleUA(x: number, y: number, z: number, o: any) { o[0] = c * x; o[1] = c * y; o[2] = c * z; o[3] = 0; o[4] = 0; o[5] = 0; return o; },
    sampleGrad(x: number, y: number, z: number, o: any) { for (let i = 0; i < 9; i++) o[i] = 0; o[0] = c; o[4] = c; o[8] = c; return o; },
  };
}
const ZERO: any = {
  sampleUW(x: number, y: number, z: number, o: any) { for (let i = 0; i < 6; i++) o[i] = 0; return o; },
  sampleUA(x: number, y: number, z: number, o: any) { for (let i = 0; i < 6; i++) o[i] = 0; return o; },
  sampleGrad(x: number, y: number, z: number, o: any) { for (let i = 0; i < 9; i++) o[i] = 0; return o; },
};

const MAKE: any = {
  ring: () => HelixNoise.createRing({ radius: RING_R, core: RING_C, circulation: RING_G, axis: [0, 0, 1] }),
  column: () => HelixNoise.strainedColumn({ strain: STRAIN, viscosity: NU, circulation: EPS, axis: [0, 0, 1] }),
  modes: () => HelixNoise.create({ modes: 20, seed: 7, slope: 1.8, coherence: 0.35, amplitude: 0.45, tileable: true }),
  source: () => sourceLayer(SRC_C),
};
const ORDER = ["ring", "column", "modes", "source"];

function wrapWarp(f: any, warp: string): any {
  return warp === "col" ? HelixNoise.collapse(f, { T, q: Q })
    : warp === "dss" ? HelixNoise.dssCollapse(f, { T, lambda: LAM, b: BB, a: AA })
      : f;
}
function scaleL(t: number, warp: string): number {
  if (warp === "none") return 1;
  const tau = Math.max(T - t, 1e-4);
  if (warp === "col") return Math.pow(tau, Q);
  const phase = ((-Math.log(tau) / Math.log(LAM)) % 1 + 1) % 1;
  return Math.pow(tau, BB) * (1 + 0.25 * Math.cos(2 * Math.PI * phase));
}

// --- probes: verbatim ---
const NP = 240;
const PX = new Float64Array(NP), PY = new Float64Array(NP), PZ = new Float64Array(NP);
{
  let s = 20260726;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < NP; i++) {
    if (i % 5 < 2) {
      const th = rnd() * 2 * Math.PI, ph = rnd() * 2 * Math.PI, q = RING_C * Math.sqrt(rnd());
      const rr = RING_R + q * Math.cos(ph);
      PX[i] = rr * Math.cos(th); PY[i] = rr * Math.sin(th); PZ[i] = q * Math.sin(ph);
    } else {
      PX[i] = (rnd() - 0.5) * 2 * HX; PY[i] = (rnd() - 0.5) * 2 * HX; PZ[i] = (rnd() - 0.5) * 2 * HZ;
    }
  }
}
const g9 = new Float64Array(9), s6 = new Float64Array(6), t6 = new Float64Array(6);

function divAnalytic(f: any, t: number, sc: number) {
  let rel = 0, live = false;
  for (let i = 0; i < NP; i++) {
    f.sampleGrad(PX[i] * sc, PY[i] * sc, PZ[i] * sc, g9, t);
    const d = g9[0] + g9[4] + g9[8];
    const s = Math.abs(g9[0]) + Math.abs(g9[4]) + Math.abs(g9[8]);
    if (s > 1e-300) { live = true; if (Math.abs(d) / s > rel) rel = Math.abs(d) / s; }
  }
  return { rel, live };
}
function divFD(f: any, t: number, sc: number, h: number) {
  let rel = 0, live = false;
  for (let i = 0; i < NP; i++) {
    const x = PX[i] * sc, y = PY[i] * sc, z = PZ[i] * sc;
    let d = 0, s = 0;
    f.sampleUW(x + h, y, z, s6, t); f.sampleUW(x - h, y, z, t6, t);
    let g = (s6[0] - t6[0]) / (2 * h); d += g; s += Math.abs(g);
    f.sampleUW(x, y + h, z, s6, t); f.sampleUW(x, y - h, z, t6, t);
    g = (s6[1] - t6[1]) / (2 * h); d += g; s += Math.abs(g);
    f.sampleUW(x, y, z + h, s6, t); f.sampleUW(x, y, z - h, t6, t);
    g = (s6[2] - t6[2]) / (2 * h); d += g; s += Math.abs(g);
    if (s > 1e-300) { live = true; if (Math.abs(d) / s > rel) rel = Math.abs(d) / s; }
  }
  return { rel, live };
}

const ex = (v: number) => (isFinite(v) ? v.toExponential(1) : "n/a").padStart(8);

// ===========================================================================
console.log("=== E1: every layer mask x every warp x several tau ===");
console.log("mask                     warp  tau      analytic       FD  |  ctlA     ctlF  |  separation  verdict");
let sepMin = Infinity, sepMax = 0, worstPassA = 0, bestFailA = Infinity;
for (let mask = 0; mask < 16; mask++) {
  const on = ORDER.filter((_, i) => mask & (1 << i));
  if (!on.length) continue;
  for (const warp of ["none", "col", "dss"]) {
    for (const tau of warp === "none" ? [1] : [1.0, 0.8, 0.55, 0.35, 0.2001]) {
      const t = T - tau;
      const parts = on.map((k) => MAKE[k]());
      const stack = parts.length === 1 ? parts[0] : HelixNoise.compose(...parts);
      const field = wrapWarp(stack, warp);
      const control = wrapWarp(sourceLayer(SRC_C), warp);
      const sc = scaleL(t, warp);
      const A = divAnalytic(field, t, sc), F = divFD(field, t, sc, 1e-4);
      const cA = divAnalytic(control, t, sc), cF = divFD(control, t, sc, 1e-4);
      const broken = on.includes("source");
      const sep = A.rel > 0 ? cA.rel / A.rel : NaN;
      if (!broken) { sepMin = Math.min(sepMin, sep); sepMax = Math.max(sepMax, sep); worstPassA = Math.max(worstPassA, A.rel); }
      else bestFailA = Math.min(bestFailA, A.rel);
      const okA = A.live && A.rel < 1e-9, okF = A.live && F.rel < 1e-2;
      const verdict = (okA ? "PASS" : "FAIL") + (okF ? "/pass" : "/fail") + (broken ? "  <-broken" : "") +
        ((okA !== !broken) ? "   *** MISCLASSIFIED ***" : "") + (A.live ? "" : "   [NOT LIVE]");
      // only print a readable subset + anything anomalous
      const anomalous = (okA !== !broken) || !A.live || (!broken && (sep < 8e14 || sep > 4e15));
      if (anomalous || tau === 1 || tau === 0.2001) {
        console.log(`${on.join("+").padEnd(24)} ${warp.padEnd(5)} ${tau.toFixed(3)} ${ex(A.rel)} ${ex(F.rel)}  |${ex(cA.rel)} ${ex(cF.rel)}  | ${ex(sep)}  ${verdict}${anomalous && !broken ? "   <<< OUTSIDE PROSE RANGE [8e14,4e15]" : ""}`);
      }
    }
  }
}
console.log(`\nsolenoidal separation range actually observed: ${sepMin.toExponential(2)} .. ${sepMax.toExponential(2)}   (page prose claims 8e14 .. 4e15)`);
console.log(`worst solenoidal analytic rel: ${worstPassA.toExponential(2)}   best broken analytic rel: ${bestFailA.toExponential(2)}\n`);
