import test from "node:test";
import assert from "node:assert";
import HelixNoise, { create, createAtoms, HelixField, abc, twoScale, shellPeak, rolloff, condensate, C_TWO_SCALE, exactNS, nsDeveloped, nsForced, NS_TARGETS, createRing, collidingRings, compose, ringSpeed } from "../src/index";
import type { Vec3, FlowField } from "../src/types";
import { runWasm } from "../src/wasm";

const TAU = 2 * Math.PI;

test("selfTest: transversality is machine zero (divergence-free by construction)", () => {
  const r = HelixNoise.selfTest();
  assert.ok(r.transversality < 1e-12, `transversality ${r.transversality} not ~0`);
});

test("selfTest: finite-difference divergence is small (O(h^2) truncation only)", () => {
  const r = HelixNoise.selfTest();
  assert.ok(r.fdDivergenceRms < 1e-3, `fd divergence ${r.fdDivergenceRms} too large`);
});

test("relative helicity tracks the helicity knob p", () => {
  const r = HelixNoise.selfTest();
  assert.ok(r.rhoVsP["1"] > 0.6, `p=+1 should be strongly positive, got ${r.rhoVsP["1"]}`);
  assert.ok(r.rhoVsP["-1"] < -0.6, `p=-1 should be strongly negative, got ${r.rhoVsP["-1"]}`);
  assert.ok(Math.abs(r.rhoVsP["0"]) < 0.2, `p=0 should be near zero, got ${r.rhoVsP["0"]}`);
  assert.ok(r.rhoVsP["1"] > r.rhoVsP["0"] && r.rhoVsP["0"] > r.rhoVsP["-1"], "rho(p) should be monotone");
});

test("sample returns a divergence-free triple; magnitudes are finite", () => {
  const f = create({ modes: 32, helicity: 0.5, seed: 3 });
  const u = f.sample(1.1, 2.2, 3.3);
  assert.equal(u.length, 3);
  assert.ok(u.every(Number.isFinite), "velocity components finite");
});

test("sampleUW writes velocity (0..2) and vorticity (3..5) without allocating", () => {
  const f = create({ modes: 24, seed: 9 });
  const out = new Float64Array(6);
  const r = f.sampleUW(0.5, 1.5, 2.5, out);
  assert.strictEqual(r, out, "returns the same buffer");
  assert.ok(Array.from(out).every(Number.isFinite));
});

test("tileable field is exactly 2π-periodic", () => {
  const f = create({ tileable: true, modes: 40, seed: 5 });
  const a = f.sample(1.3, 2.1, 0.7);
  const b = f.sample(1.3 + TAU, 2.1 - TAU, 0.7 + 3 * TAU);
  const err = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  assert.ok(err < 1e-10, `periodicity error ${err}`);
});

test("set() re-tunes in place and flips helicity sign", () => {
  const f = create({ modes: 48, helicity: 1 });
  const p1 = f.relativeHelicity(10);
  f.set({ helicity: -1 });
  const p2 = f.relativeHelicity(10);
  assert.ok(p1 > 0 && p2 < 0, `expected sign flip, got ${p1} then ${p2}`);
});

test("deterministic: same seed gives identical samples", () => {
  const a = create({ seed: 42, modes: 32 }).sample(1, 2, 3);
  const b = create({ seed: 42, modes: 32 }).sample(1, 2, 3);
  assert.deepStrictEqual(a, b);
});

test("bake3D produces RGBA float data whose voxels match sample()", () => {
  const n = 8;
  const f = create({ modes: 32, helicity: 0.6, seed: 4 });
  const b = f.bake3D(n);
  assert.equal(b.size, n);
  assert.equal(b.data.length, n * n * n * 4);
  const x = 3, y = 5, z = 2, p = ((z * n + y) * n + x) * 4;
  const s = f.sample((x / n) * TAU, (y / n) * TAU, (z / n) * TAU);
  assert.ok(
    Math.abs(b.data[p] - s[0]) < 1e-6 && Math.abs(b.data[p + 1] - s[1]) < 1e-6 && Math.abs(b.data[p + 2] - s[2]) < 1e-6,
    "voxel velocity matches sample"
  );
});

test("bake2D produces a slice whose texels match sample()", () => {
  const nx = 16, ny = 10;
  const f = create({ modes: 24, seed: 8 });
  const b = f.bake2D(nx, ny, 0.5);
  assert.equal(b.width, nx);
  assert.equal(b.height, ny);
  const i = 7, j = 4, p = (j * nx + i) * 4;
  const s = f.sample((i / nx) * TAU, (j / ny) * TAU, 0.5);
  assert.ok(Math.abs(b.data[p] - s[0]) < 1e-6 && Math.abs(b.data[p + 1] - s[1]) < 1e-6, "texel velocity matches sample");
});

// ---------------------------------------------------------------------------
// Mode layout: low-discrepancy directions + stratified spectrum
// ---------------------------------------------------------------------------

function minPairwiseAngle(f: HelixField): number {
  let mn = Infinity;
  for (let i = 0; i < f.N; i++) {
    for (let j = i + 1; j < f.N; j++) {
      const d =
        (f.kx[i] * f.kx[j] + f.ky[i] * f.ky[j] + f.kz[i] * f.kz[j]) / (f.km[i] * f.km[j]);
      mn = Math.min(mn, Math.acos(Math.max(-1, Math.min(1, d))));
    }
  }
  return mn;
}

test("fibonacci layout: directions are low-discrepancy (min pairwise angle ≫ random)", () => {
  for (const seed of [1, 7, 33]) {
    const fib = new HelixField({ modes: 48, seed });
    const rnd = new HelixField({ modes: 48, seed, layout: "random" });
    const aFib = minPairwiseAngle(fib), aRnd = minPairwiseAngle(rnd);
    // Fibonacci spacing for N=48 is ~sqrt(4π/N)=0.51 rad; iid pairs collide far closer.
    assert.ok(aFib > 0.3, `fib min angle ${aFib} too small (seed ${seed})`);
    assert.ok(aFib > 2 * aRnd, `fib ${aFib} not ≫ random ${aRnd} (seed ${seed})`);
  }
});

test("fibonacci layout: stratified wavenumbers cover the band without gaps", () => {
  const f = new HelixField({ modes: 48, seed: 3, kmin: 1, kmax: 6.2 });
  const km = Array.from(f.km).sort((a, b) => a - b);
  const w = (6.2 - 1) / 48;
  assert.ok(km[0] >= 1 && km[km.length - 1] <= 6.2, "wavenumbers inside the band");
  let maxGap = 0;
  for (let i = 1; i < km.length; i++) maxGap = Math.max(maxGap, km[i] - km[i - 1]);
  assert.ok(maxGap <= 2.001 * w, `max spectral gap ${maxGap} exceeds 2 strata (${2 * w})`);
});

test('layout "random" gives a different field than the default (and stays deterministic)', () => {
  const a = create({ seed: 4, layout: "random" }).sample(1, 2, 3);
  const b = create({ seed: 4, layout: "random" }).sample(1, 2, 3);
  const c = create({ seed: 4 }).sample(1, 2, 3);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
});

// ---------------------------------------------------------------------------
// Time evolution: churn, coherent sweep, viscous decay
// ---------------------------------------------------------------------------

test("t = 0 is a no-op: time knobs never reshape the spatial field", () => {
  const f = create({ modes: 32, seed: 11, churn: 2, coherence: 0.4, decay: 0.3 });
  assert.deepStrictEqual(f.sample(1, 2, 3), f.sample(1, 2, 3, 0));
  const g = create({ modes: 32, seed: 11, coherence: 0.4 }); // default churn/decay
  assert.deepStrictEqual(f.sample(1, 2, 3), g.sample(1, 2, 3));
  g.set({ churn: 5, decay: 0.1 }); // re-tuning time knobs keeps t = 0 samples identical
  assert.deepStrictEqual(f.sample(1, 2, 3), g.sample(1, 2, 3));
});

test("churn animates the field; churn 0 freezes it exactly", () => {
  const live = create({ modes: 32, seed: 9, churn: 1 });
  const d = live.sample(1, 2, 3, 0).map((v, i) => v - live.sample(1, 2, 3, 0.5)[i]);
  assert.ok(Math.hypot(...(d as [number, number, number])) > 1e-3, "field should evolve with t");
  const frozen = create({ modes: 32, seed: 9, churn: 0 });
  assert.deepStrictEqual(frozen.sample(1, 2, 3, 7.7), frozen.sample(1, 2, 3, 0));
});

test("coherent sweep: at coherence 1 with one center the whole field translates rigidly", () => {
  const f = new HelixField({ modes: 40, seed: 6, centers: 1, coherence: 1, churn: 0.7 });
  const vx = f.cvx[0], vy = f.cvy[0], vz = f.cvz[0];
  assert.ok(Math.hypot(vx, vy, vz) > 1e-3, "center sweep velocity should be nonzero");
  for (const t of [0.6, 2.3]) {
    for (const [x, y, z] of [[1, 2, 3], [0.4, 5.5, 2.2]] as const) {
      const a = f.sample(x, y, z, t);
      const b = f.sample(x - vx * t, y - vy * t, z - vz * t, 0);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(a[i] - b[i]) < 1e-10, `sweep identity broken: ${a[i]} vs ${b[i]}`);
      }
    }
  }
});

test("decay: a single mode decays exactly by the viscous NS factor e^(-νk²t)", () => {
  const nu = 0.3;
  const f = new HelixField({ modes: 1, seed: 2, decay: nu, churn: 0 });
  const k2 = f.km[0] * f.km[0];
  for (const t of [0.5, 2]) {
    const u0 = f.sample(1.1, 0.7, 2.9, 0);
    const ut = f.sample(1.1, 0.7, 2.9, t);
    const fac = Math.exp(-nu * k2 * t);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(ut[i] - fac * u0[i]) < 1e-12, `decay factor off at t=${t}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Batch samplers
// ---------------------------------------------------------------------------

test("sampleMany equals per-point sampleUW (tile remainders, t and decay active)", () => {
  const f = create({ modes: 24, seed: 13, churn: 1.2, coherence: 0.5, decay: 0.1 });
  const n = 777; // 3 full tiles + remainder
  const rnd = (i: number) => ((i * 2654435761) % 1000) / 1000; // deterministic positions
  const pos = new Float64Array(3 * n).map((_, i) => rnd(i) * 10 - 5);
  // Far-field points: exercise the batch kernel's fast-sincos guard on both sides
  // (|φ| just below 1e6 → Cody–Waite path; |φ| above → Math.sin/cos fallback).
  for (let i = 0; i < 24; i++) pos[3 * i] = (i % 2 ? -1 : 1) * (9e4 + i * 9e3);
  const t = 1.234;
  const batch = f.sampleMany(pos, undefined, t);
  assert.equal(batch.length, 3 * n);
  const uw = [0, 0, 0, 0, 0, 0];
  let worst = 0;
  for (let i = 0; i < n; i++) {
    f.sampleUW(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], uw, t);
    for (let m = 0; m < 3; m++) worst = Math.max(worst, Math.abs(batch[3 * i + m] - uw[m]));
  }
  assert.ok(worst < 1e-12, `batch/scalar mismatch ${worst}`);
});

test("wasm SIMD kernel equals the JS batch kernel (forced side-by-side)", () => {
  const f = new HelixField({ modes: 32, seed: 13, churn: 1.2, coherence: 0.5, decay: 0.05 });
  const n = 501; // odd → exercises the pair padding
  const pos = new Float64Array(3 * n).map((_, i) => Math.sin(i * 12.9898) * 6);
  const t = 0.8;
  const amps = (f as unknown as { _amps(t: number): Float64Array })._amps(t);
  const viaWasm = new Float64Array(6 * n);
  const ran = runWasm(f, amps, pos, viaWasm, t, true, f._scale);
  assert.ok(ran, "wasm kernel should be available on Node 20+ (SIMD)");
  const viaJS = new Float64Array(6 * n);
  f._noWasm = true;
  f.sampleManyUW(pos, viaJS, t);
  f._noWasm = false;
  let worst = 0;
  for (let i = 0; i < viaJS.length; i++) worst = Math.max(worst, Math.abs(viaWasm[i] - viaJS[i]));
  assert.ok(worst < 1e-12, `wasm/js kernel mismatch ${worst}`);
  // end-to-end: the default path (which routes through wasm here) matches the scalar sampler
  const e2e = f.sampleMany(pos, undefined, t);
  const uw = [0, 0, 0, 0, 0, 0];
  let w2 = 0;
  for (let i = 0; i < n; i++) {
    f.sampleUW(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], uw, t);
    for (let m = 0; m < 3; m++) w2 = Math.max(w2, Math.abs(e2e[3 * i + m] - uw[m]));
  }
  assert.ok(w2 < 1e-12, `default batch vs scalar mismatch ${w2}`);
});

test("sampleManyUW equals per-point sampleUW (velocity + vorticity, Float32Array io)", () => {
  const f = create({ modes: 32, seed: 21 });
  const n = 300;
  const pos = new Float32Array(3 * n).map(() => 0); // filled below, deterministic
  for (let i = 0; i < pos.length; i++) pos[i] = Math.sin(i * 12.9898) * 4;
  const out = f.sampleManyUW(pos, new Float32Array(6 * n));
  const uw = [0, 0, 0, 0, 0, 0];
  let worst = 0;
  for (let i = 0; i < n; i++) {
    f.sampleUW(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], uw);
    for (let m = 0; m < 6; m++) worst = Math.max(worst, Math.abs(out[6 * i + m] - uw[m]));
  }
  assert.ok(worst < 1e-5, `f32 batch mismatch ${worst}`); // f32 storage rounding only
  assert.throws(() => f.sampleManyUW(pos, new Float32Array(3)), /out needs/);
});

// ---------------------------------------------------------------------------
// Vector potential, SDF boundaries, divergence-free bake
// ---------------------------------------------------------------------------

test("potential: finite-difference curl of A reproduces the velocity", () => {
  const f = create({ modes: 32, seed: 5, coherence: 0.4, churn: 1, decay: 0.1 });
  const h = 1e-3, t = 0.8;
  const pot = (x: number, y: number, z: number) => f.potential(x, y, z, t);
  let worst = 0;
  for (const [x, y, z] of [[1, 2, 3], [0.3, 5.1, 2.2], [4.4, 0.9, 3.7]] as const) {
    const ap = pot(x, y + h, z), am = pot(x, y - h, z);
    const bp = pot(x, y, z + h), bm = pot(x, y, z - h);
    const cp = pot(x + h, y, z), cm = pot(x - h, y, z);
    const curl = [
      (ap[2] - am[2]) / (2 * h) - (bp[1] - bm[1]) / (2 * h),
      (bp[0] - bm[0]) / (2 * h) - (cp[2] - cm[2]) / (2 * h),
      (cp[1] - cm[1]) / (2 * h) - (ap[0] - am[0]) / (2 * h),
    ];
    const u = f.sample(x, y, z, t);
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(curl[i] - u[i]));
  }
  assert.ok(worst < 1e-4, `curl(A) − u = ${worst} (should be O(h²) truncation only)`);
});

const SPHERE_C = [Math.PI, Math.PI, Math.PI] as const, SPHERE_R = 1.2;
const sphereSdf = (x: number, y: number, z: number): number =>
  Math.hypot(x - SPHERE_C[0], y - SPHERE_C[1], z - SPHERE_C[2]) - SPHERE_R;
const sphereGrad = (x: number, y: number, z: number): number[] => {
  const r = Math.hypot(x - SPHERE_C[0], y - SPHERE_C[1], z - SPHERE_C[2]) || 1;
  return [(x - SPHERE_C[0]) / r, (y - SPHERE_C[1]) / r, (z - SPHERE_C[2]) / r];
};
const onSphere = (th: number, ph2: number, rad: number): [number, number, number] => [
  SPHERE_C[0] + rad * Math.sin(th) * Math.cos(ph2),
  SPHERE_C[1] + rad * Math.sin(th) * Math.sin(ph2),
  SPHERE_C[2] + rad * Math.cos(th),
];

test("withBoundary: wall-normal flux vanishes at the wall, zero inside, base field far away", () => {
  const f = create({ modes: 32, seed: 8, coherence: 0.5 });
  const b = f.withBoundary(sphereSdf, { thickness: 0.8, gradient: sphereGrad });
  for (const [th, ph2] of [[0.4, 1.1], [1.3, 4.0], [2.2, 2.6], [1.7, 5.5]] as const) {
    const p = onSphere(th, ph2, SPHERE_R + 1e-9); // a hair off the wall (d = 0 itself is ±1 ulp)
    const u = b.sample(p[0], p[1], p[2], 0.3);
    const u0 = f.sample(p[0], p[1], p[2], 0.3);
    const n = sphereGrad(p[0], p[1], p[2]);
    const un = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
    const un0 = u0[0] * n[0] + u0[1] * n[1] + u0[2] * n[2];
    const mag = Math.hypot(u[0], u[1], u[2]);
    assert.ok(mag > 1e-3, "wall flow should be a nonzero tangential slip");
    // Exact structure: u_b·n = ramp(d/th)·(u·n) — the slip term ∇d×A is tangent identically,
    // so the normal flux dies with the ramp (~2e-9 here, 9 orders below the slip speed).
    assert.ok(Math.abs(un) <= 2.4e-9 * Math.abs(un0) + 1e-12, `normal leak ${un} at wall`);
    const pin = onSphere(th, ph2, 0.5 * SPHERE_R); // inside the obstacle
    assert.deepStrictEqual(b.sample(pin[0], pin[1], pin[2]), [0, 0, 0]);
    const pfar = onSphere(th, ph2, SPHERE_R + 0.81); // beyond the influence band
    assert.deepStrictEqual(b.sample(pfar[0], pfar[1], pfar[2], 1.5), f.sample(pfar[0], pfar[1], pfar[2], 1.5));
  }
});

test("withBoundary: still divergence-free inside the influence band (FD check)", () => {
  const f = create({ modes: 32, seed: 8, coherence: 0.5 });
  const b = f.withBoundary(sphereSdf, { thickness: 0.8, gradient: sphereGrad });
  const h = 2e-3;
  let worst = 0;
  for (const [th, ph2, rad] of [[0.7, 0.9, 1.5], [1.9, 3.2, 1.7], [2.5, 5.0, 1.35]] as const) {
    const [x, y, z] = onSphere(th, ph2, rad); // 0 < d < thickness
    let d = 0;
    const ap = b.sample(x + h, y, z), am = b.sample(x - h, y, z);
    const bp = b.sample(x, y + h, z), bm = b.sample(x, y - h, z);
    const cp = b.sample(x, y, z + h), cm = b.sample(x, y, z - h);
    d += (ap[0] - am[0]) / (2 * h) + (bp[1] - bm[1]) / (2 * h) + (cp[2] - cm[2]) / (2 * h);
    worst = Math.max(worst, Math.abs(d));
  }
  assert.ok(worst < 5e-3, `bounded-field FD divergence ${worst}`);
});

test("withBoundary: vorticity (FD) matches the base field away from the wall", () => {
  const f = create({ modes: 24, seed: 4 });
  const b = f.withBoundary(sphereSdf, { thickness: 0.6, gradient: sphereGrad });
  const w = b.vorticity(0.8, 0.9, 1.0), w0 = f.vorticity(0.8, 0.9, 1.0);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(w[i] - w0[i]) < 1e-3, `vorticity off: ${w[i]} vs ${w0[i]}`);
});

test("bakePotential3D + shader-style FD curl: discretely divergence-free, unlike baked velocity", () => {
  const n = 20;
  const f = create({ modes: 24, seed: 6 });
  const pot = f.bakePotential3D(n);
  const vel = f.bake3D(n);
  // Trilinear interpolation of a baked RGBA volume (periodic wrap), channel c ∈ {0,1,2}.
  const tri = (bake: Float32Array, x: number, y: number, z: number, c: number): number => {
    const g = (v: number) => ((v / TAU) * n + n) % n;
    const fx = g(x), fy = g(y), fz = g(z);
    const i0 = fx | 0, j0 = fy | 0, k0 = fz | 0;
    const dx = fx - i0, dy = fy - j0, dz = fz - k0;
    let acc = 0;
    for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      const w = (di ? dx : 1 - dx) * (dj ? dy : 1 - dy) * (dk ? dz : 1 - dz);
      const idx = ((((k0 + dk) % n) * n + ((j0 + dj) % n)) * n + ((i0 + di) % n)) * 4 + c;
      acc += w * bake[idx];
    }
    return acc;
  };
  const h = 0.3 * (TAU / n);
  // velocity from the potential texture: central-difference curl of the trilinear samples
  const uFromA = (x: number, y: number, z: number): number[] => [
    (tri(pot.data, x, y + h, z, 2) - tri(pot.data, x, y - h, z, 2)) / (2 * h) -
      (tri(pot.data, x, y, z + h, 1) - tri(pot.data, x, y, z - h, 1)) / (2 * h),
    (tri(pot.data, x, y, z + h, 0) - tri(pot.data, x, y, z - h, 0)) / (2 * h) -
      (tri(pot.data, x + h, y, z, 2) - tri(pot.data, x - h, y, z, 2)) / (2 * h),
    (tri(pot.data, x + h, y, z, 1) - tri(pot.data, x - h, y, z, 1)) / (2 * h) -
      (tri(pot.data, x, y + h, z, 0) - tri(pot.data, x, y - h, z, 0)) / (2 * h),
  ];
  const uFromTex = (x: number, y: number, z: number): number[] =>
    [tri(vel.data, x, y, z, 0), tri(vel.data, x, y, z, 1), tri(vel.data, x, y, z, 2)];
  const div = (u: (x: number, y: number, z: number) => number[], x: number, y: number, z: number): number =>
    (u(x + h, y, z)[0] - u(x - h, y, z)[0]) / (2 * h) +
    (u(x, y + h, z)[1] - u(x, y - h, z)[1]) / (2 * h) +
    (u(x, y, z + h)[2] - u(x, y, z - h)[2]) / (2 * h);
  let worstA = 0, worstU = 0, mag = 0;
  for (const [x, y, z] of [[1.7, 2.3, 3.1], [4.4, 1.2, 5.0], [2.9, 4.8, 0.9]] as const) {
    worstA = Math.max(worstA, Math.abs(div(uFromA, x, y, z)));
    worstU = Math.max(worstU, Math.abs(div(uFromTex, x, y, z)));
    const u = uFromA(x, y, z);
    mag = Math.max(mag, Math.hypot(u[0], u[1], u[2]));
  }
  assert.ok(mag > 0.1, "reconstructed velocity should be nonzero");
  assert.ok(worstA < 1e-6, `curl-of-potential path leaks divergence: ${worstA}`);
  assert.ok(worstA < worstU / 100, `no advantage over baked velocity (${worstA} vs ${worstU})`);
});

// ---------------------------------------------------------------------------
// Sparse-atom engine
// ---------------------------------------------------------------------------

test("atoms: divergence-free and the analytic vorticity matches an FD curl", () => {
  const f = createAtoms({ octaves: 3, seed: 7, helicity: 0.6, churn: 1 });
  const h = 1e-4, t = 0.7;
  let worstDiv = 0, worstCurl = 0, mag = 0;
  for (const [x, y, z] of [[1.1, 2.2, 3.3], [0.4, 5.0, 2.6], [3.9, 1.7, 0.8]] as const) {
    const sx1 = f.sample(x + h, y, z, t), sx0 = f.sample(x - h, y, z, t);
    const sy1 = f.sample(x, y + h, z, t), sy0 = f.sample(x, y - h, z, t);
    const sz1 = f.sample(x, y, z + h, t), sz0 = f.sample(x, y, z - h, t);
    worstDiv = Math.max(worstDiv, Math.abs(
      (sx1[0] - sx0[0]) / (2 * h) + (sy1[1] - sy0[1]) / (2 * h) + (sz1[2] - sz0[2]) / (2 * h)));
    const curlFD = [
      (sy1[2] - sy0[2]) / (2 * h) - (sz1[1] - sz0[1]) / (2 * h),
      (sz1[0] - sz0[0]) / (2 * h) - (sx1[2] - sx0[2]) / (2 * h),
      (sx1[1] - sx0[1]) / (2 * h) - (sy1[0] - sy0[0]) / (2 * h),
    ];
    const w = f.vorticity(x, y, z, t);
    for (let i = 0; i < 3; i++) worstCurl = Math.max(worstCurl, Math.abs(w[i] - curlFD[i]));
    mag = Math.max(mag, Math.hypot(...f.sample(x, y, z, t)));
  }
  assert.ok(mag > 0.1, "field should be nonzero");
  assert.ok(worstDiv < 1e-5, `atom-field divergence ${worstDiv}`);
  assert.ok(worstCurl < 1e-4, `analytic vorticity vs FD curl: ${worstCurl}`);
});

test("atoms: potential is exact (FD curl of ΣW·A reproduces the velocity)", () => {
  const f = createAtoms({ octaves: 2, seed: 3 });
  const h = 1e-4;
  const pot = (x: number, y: number, z: number) => f.potential(x, y, z);
  let worst = 0;
  for (const [x, y, z] of [[1.5, 2.0, 3.0], [4.2, 0.8, 2.1]] as const) {
    const ay1 = pot(x, y + h, z), ay0 = pot(x, y - h, z);
    const az1 = pot(x, y, z + h), az0 = pot(x, y, z - h);
    const ax1 = pot(x + h, y, z), ax0 = pot(x - h, y, z);
    const curlA = [
      (ay1[2] - ay0[2]) / (2 * h) - (az1[1] - az0[1]) / (2 * h),
      (az1[0] - az0[0]) / (2 * h) - (ax1[2] - ax0[2]) / (2 * h),
      (ax1[1] - ax0[1]) / (2 * h) - (ay1[0] - ay0[0]) / (2 * h),
    ];
    const u = f.sample(x, y, z);
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(curlA[i] - u[i]));
  }
  assert.ok(worst < 1e-5, `curl(A) − u = ${worst}`);
});

test("atoms: relative helicity tracks p; deterministic across instances and cache states", () => {
  const rp = createAtoms({ helicity: 1, seed: 11 }).relativeHelicity(10);
  const rn = createAtoms({ helicity: -1, seed: 11 }).relativeHelicity(10);
  const r0 = createAtoms({ helicity: 0, seed: 11 }).relativeHelicity(10);
  assert.ok(rp > 0.5 && rn < -0.5 && Math.abs(r0) < 0.25, `rho(p): ${rp}, ${r0}, ${rn}`);
  const a = createAtoms({ seed: 5 }), b = createAtoms({ seed: 5 });
  const u1 = a.sample(2.2, 3.3, 4.4);
  a.sample(50.5, -12.2, 7.7); // touch distant cells
  assert.deepStrictEqual(a.sample(2.2, 3.3, 4.4), u1, "cache re-read identical");
  assert.deepStrictEqual(b.sample(2.2, 3.3, 4.4), u1, "fresh instance identical");
});

test("atoms: spatially-varying helicity — each half of the domain gets its own handedness", () => {
  const mid = 6;
  const f = createAtoms({
    octaves: 2, seed: 9, radius: 1.2,
    helicityField: (x) => (x < mid ? 1 : -1),
  });
  const o = [0, 0, 0, 0, 0, 0];
  const rho = (x0: number): number => {
    let H = 0, un = 0, wn = 0;
    const ng = 8, span = 3.6;
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      f.sampleUW(x0 + (i / ng) * span, 0.3 + (j / ng) * span, 0.5 + (k / ng) * span, o);
      H += o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      un += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      wn += o[3] * o[3] + o[4] * o[4] + o[5] * o[5];
    }
    return H / (Math.sqrt(un * wn) || 1);
  };
  const left = rho(mid - 5), right = rho(mid + 1.4); // both wells inside their halves
  assert.ok(left > 0.4, `left half should be right-handed, got ${left}`);
  assert.ok(right < -0.4, `right half should be left-handed, got ${right}`);
});

test("atoms: octaves add fine detail (velocity-gradient RMS grows)", () => {
  // Shallow slope so higher octaves carry real energy: expected grad-RMS ratio for
  // slope 0.8 over 3 octaves is √(4.06/1.44) ≈ 1.68 after unit-RMS normalization.
  const g = (oct: number): number => {
    const f = createAtoms({ octaves: oct, seed: 4, slope: 0.8 });
    const h = 1e-3;
    let s = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const x = 0.37 + i * 0.11, y = 1.3 + i * 0.07, z = 2.1 + i * 0.05;
      const a = f.sample(x + h, y, z), b = f.sample(x - h, y, z);
      s += ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / (4 * h * h); n++;
    }
    return Math.sqrt(s / n);
  };
  const g1 = g(1), g3 = g(3);
  assert.ok(g3 > 1.4 * g1, `3 octaves should be sharper than 1 (grad RMS ${g3} vs ${g1})`);
});

test("atoms: t = 0 is bit-exact; churn animates; churn 0 freezes", () => {
  const f = createAtoms({ seed: 2, churn: 2 });
  assert.deepStrictEqual(f.sample(1, 2, 3), f.sample(1, 2, 3, 0));
  const d = f.sample(1, 2, 3, 0).map((v, i) => v - f.sample(1, 2, 3, 1.5)[i]);
  assert.ok(Math.hypot(...(d as [number, number, number])) > 1e-4, "churn should evolve the field");
  const froz = createAtoms({ seed: 2, churn: 0 });
  assert.deepStrictEqual(froz.sample(1, 2, 3, 9.9), froz.sample(1, 2, 3, 0));
});

test("atoms: withBoundary composes (free-slip wall on the atom engine)", () => {
  const f = createAtoms({ octaves: 2, seed: 6 });
  const b = f.withBoundary(sphereSdf, { thickness: 0.8, gradient: sphereGrad });
  const p = onSphere(1.1, 2.0, SPHERE_R + 1e-9);
  const u = b.sample(p[0], p[1], p[2]);
  const u0 = f.sample(p[0], p[1], p[2]);
  const n = sphereGrad(p[0], p[1], p[2]);
  const un = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
  const un0 = u0[0] * n[0] + u0[1] * n[1] + u0[2] * n[2];
  assert.ok(Math.hypot(u[0], u[1], u[2]) > 1e-4, "nonzero slip at the wall");
  assert.ok(Math.abs(un) <= 2.4e-9 * Math.abs(un0) + 1e-12, `normal leak ${un}`);
  const pin = onSphere(1.1, 2.0, 0.4 * SPHERE_R);
  assert.deepStrictEqual(b.sample(pin[0], pin[1], pin[2]), [0, 0, 0]);
});

test("atoms glsl(): emits the hash-regenerating shader; constant params only", () => {
  const f = createAtoms({ octaves: 2, atomsPerCell: 4, seed: 7, anisotropy: -0.5 });
  const src = f.glsl({ name: "hx", potential: true });
  assert.ok(src.includes("vec3 hx(vec3 p, float t)"), "velocity function");
  assert.ok(src.includes("vec3 hxCurl(vec3 p, float t)"), "curl by default");
  assert.ok(src.includes("vec3 hxPot(vec3 p, float t)"), "potential opt-in");
  assert.ok(src.includes("hx_OSEED"), "per-octave seeds baked");
  assert.ok(src.includes("hx_AXIS"), "anisotropy baked when nonzero");
  assert.ok(!f.glsl({ name: "hx" }).includes("hxPot"), "potential stays opt-in");
  // JS callbacks cannot be ported — must refuse loudly
  assert.throws(() => createAtoms({ helicityField: () => 1 }).glsl(), /constant parameters/);
  assert.throws(() => createAtoms({ spectrum: (k) => k }).glsl(), /constant parameters/);
  // (GPU execution referee: compiled & rendered in WebGL2, worst |cpu−gpu| ≈ 1.3e-6 — see README)
});

// ---------------------------------------------------------------------------
// Spectrum designer & anisotropy
// ---------------------------------------------------------------------------

test("spectrum: a custom amplitude law replaces the power law exactly", () => {
  const law = (k: number) => (k < 3 ? 1 : 0); // band-limit to k < 3
  const f = new HelixField({ modes: 48, seed: 5, spectrum: law });
  for (let j = 0; j < f.N; j++) {
    assert.strictEqual(f.a[j], law(f.km[j]), `a[${j}] should follow the custom law`);
  }
  const u = f.sample(1, 2, 3);
  assert.ok(u.every(Number.isFinite) && Math.hypot(...u) > 1e-3, "field is alive and finite");
  // atoms accept the same option (frozen into atoms; set() flushes)
  const g0 = createAtoms({ seed: 3, octaves: 2 });
  const g1 = createAtoms({ seed: 3, octaves: 2, spectrum: (k) => 1 / (1 + k * k) });
  assert.notDeepStrictEqual(g0.sample(1, 2, 3), g1.sample(1, 2, 3), "law should reshape the atom field");
  assert.ok(g1.sample(1, 2, 3).every(Number.isFinite));
});

test("anisotropy (spectral): wavevectors avoid the axis at γ<0 and hug it at γ>0", () => {
  const meanAlign = (gam: number): number => {
    const f = new HelixField({ modes: 64, seed: 7, anisotropy: gam, axis: [0, 0, 1] });
    let s = 0;
    for (let j = 0; j < f.N; j++) s += Math.abs(f.kz[j]) / f.km[j];
    return s / f.N;
  };
  const streaks = meanAlign(-0.95), iso = meanAlign(0), layers = meanAlign(3);
  assert.ok(streaks < 0.15, `γ=−0.95 should flatten k̂ away from the axis (got ${streaks})`);
  assert.ok(iso > 0.35 && iso < 0.65, `γ=0 should stay isotropic (got ${iso})`);
  assert.ok(layers > 0.75, `γ=+3 should align k̂ with the axis (got ${layers})`);
});

test("anisotropy (atoms): γ<0 makes the field streak along the axis (weak z-dependence)", () => {
  // Phase variation along the axis is suppressed; the isotropic window envelope still
  // contributes, so compare the z/x variation ratio against the isotropic field's.
  const ratio = (gam: number): number => {
    const f = createAtoms({ octaves: 2, seed: 8, anisotropy: gam, axis: [0, 0, 1] });
    const d = 0.35;
    let dz = 0, dx = 0;
    for (let i = 0; i < 30; i++) {
      const x = 0.4 + i * 0.23, y = 1.1 + i * 0.17, z = 2.0 + i * 0.11;
      const u0 = f.sample(x, y, z);
      const uz = f.sample(x, y, z + d), ux = f.sample(x + d, y, z);
      dz += (uz[0] - u0[0]) ** 2 + (uz[1] - u0[1]) ** 2 + (uz[2] - u0[2]) ** 2;
      dx += (ux[0] - u0[0]) ** 2 + (ux[1] - u0[1]) ** 2 + (ux[2] - u0[2]) ** 2;
    }
    return dz / dx;
  };
  const rIso = ratio(0), rStreak = ratio(-0.95);
  assert.ok(rStreak < 0.55 * rIso, `axis variation should drop vs isotropic (${rStreak} vs ${rIso})`);
});

test("atoms: sampleMany / sampleManyUW equal the per-point loop", () => {
  const f = createAtoms({ octaves: 2, seed: 12, churn: 1 });
  const n = 120, t = 0.9;
  const pos = new Float64Array(3 * n).map((_, i) => ((i * 37) % 100) / 8);
  const b3 = f.sampleMany(pos, undefined, t);
  const b6 = f.sampleManyUW(pos, undefined, t);
  const uw = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    f.sampleUW(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], uw, t);
    for (let m = 0; m < 3; m++) assert.ok(Math.abs(b3[3 * i + m] - uw[m]) < 1e-14);
    for (let m = 0; m < 6; m++) assert.ok(Math.abs(b6[6 * i + m] - uw[m]) < 1e-14);
  }
  assert.throws(() => f.sampleMany(pos, new Float64Array(3)), /out needs/);
});

test("glsl({ potential: true }) emits <name>Pot matching potential()", () => {
  const f = new HelixField({ modes: 16, seed: 3, coherence: 0.5, churn: 1.2, helicity: 0.4 });
  const src = f.glsl({ name: "hx", potential: true });
  assert.ok(src.includes("vec3 hxPot(vec3 p, float t)"), "emits the potential function");
  assert.ok(!f.glsl({ name: "hx" }).includes("hxPot"), "potential is opt-in");
  // Reimplement the emitted formula in JS and compare against potential().
  const t = 0.7;
  for (const [x, y, z] of [[1, 2, 3], [4.2, 0.4, 5.5]] as const) {
    let ax = 0, ay = 0, az = 0;
    for (let j = 0; j < f.N; j++) {
      const phi = f.kx[j] * x + f.ky[j] * y + f.kz[j] * z + f.ph[j] + f.om[j] * t;
      const km = Math.hypot(f.kx[j], f.ky[j], f.kz[j]);
      const c = Math.cos(phi), sn = Math.sin(phi), g = f.s[j] / km;
      ax += g * f.a[j] * (c * f.e1x[j] - f.s[j] * sn * f.e2x[j]);
      ay += g * f.a[j] * (c * f.e1y[j] - f.s[j] * sn * f.e2y[j]);
      az += g * f.a[j] * (c * f.e1z[j] - f.s[j] * sn * f.e2z[j]);
    }
    const jsA = [ax * f._scale, ay * f._scale, az * f._scale];
    const A = f.potential(x, y, z, t);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(jsA[i] - A[i]) < 1e-9, "GLSL potential formula matches");
  }
});

test("glsl() emits the exact same formula as sample()", () => {
  const f = new HelixField({ modes: 20, helicity: 0.7, coherence: 0.3, seed: 2, churn: 1.5, decay: 0.25 });
  // Evaluate the emitted GLSL formula in JS from the field's baked mode data + scale.
  function glslEval(px: number, py: number, pz: number, t: number): [number, number, number] {
    let ux = 0, uy = 0, uz = 0;
    for (let j = 0; j < f.N; j++) {
      const phi = f.kx[j] * px + f.ky[j] * py + f.kz[j] * pz + f.ph[j] + f.om[j] * t;
      const k2 = f.kx[j] * f.kx[j] + f.ky[j] * f.ky[j] + f.kz[j] * f.kz[j];
      const a = f.a[j] * Math.exp(-f.nu * k2 * t);
      const c = Math.cos(phi), s = Math.sin(phi);
      ux += a * (c * f.e1x[j] - f.s[j] * s * f.e2x[j]);
      uy += a * (c * f.e1y[j] - f.s[j] * s * f.e2y[j]);
      uz += a * (c * f.e1z[j] - f.s[j] * s * f.e2z[j]);
    }
    return [ux * f._scale, uy * f._scale, uz * f._scale];
  }
  for (const t of [0, 0.9]) {
    for (const p of [[1, 2, 3], [0.3, 5.1, 2.2], [4, 4, 4]] as const) {
      const a = f.sample(p[0], p[1], p[2], t);
      const b = glslEval(p[0], p[1], p[2], t);
      assert.ok(
        Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9,
        `GLSL formula equals sample at ${p}, t=${t}`
      );
    }
  }
  const src = f.glsl({ name: "myField" });
  assert.ok(src.includes("vec3 myField(vec3 p, float t)"), "emits the time-aware function");
  assert.ok(src.includes("vec3 myField(vec3 p)"), "emits the t = 0 overload");
  assert.ok(src.includes("myField_OM["), "bakes the phase rates");
  assert.ok(src.includes("myField_NU"), "bakes the decay rate when decay > 0");
  assert.ok(src.includes("myField_N = 20"), "bakes the mode count");
  assert.ok(src.includes("vec3 myFieldCurl(vec3 p)"), "emits curl by default");
});

// ---------------------------------------------------------------------------
// Ellipticity — the polarization axis (chi = ellipticity * s)
// ---------------------------------------------------------------------------

/** One tileable mode with |k| = 2 and a fixed sign, so the grid quadrature below is exact. */
function oneMode(eps: number): HelixField {
  return new HelixField({ modes: 1, seed: 3, tileable: true, kmin: 2, kmax: 2, helicity: 1, ellipticity: eps });
}

test("ellipticity: chi = eps * s, clamped to [0, 1], default 1 (Beltrami)", () => {
  const f = create({ modes: 8, seed: 1 }) as unknown as HelixField;
  for (let j = 0; j < f.N; j++) assert.equal(f.chi[j], f.s[j], "default is fully circular");
  const g = create({ modes: 8, seed: 1, ellipticity: 0.25 }) as unknown as HelixField;
  for (let j = 0; j < g.N; j++) assert.ok(Math.abs(g.chi[j] - 0.25 * g.s[j]) < 1e-18);
  const hi = create({ modes: 4, seed: 1, ellipticity: 3 }) as unknown as HelixField;
  const lo = create({ modes: 4, seed: 1, ellipticity: -1 }) as unknown as HelixField;
  for (let j = 0; j < 4; j++) {
    assert.equal(Math.abs(hi.chi[j]), 1, "eps > 1 clamps to circular");
    assert.equal(lo.chi[j], 0, "eps < 0 clamps to linear");
  }
});

test("ellipticity consumes no RNG draws: the mode arrays are bit-identical across eps", () => {
  const a = create({ modes: 12, seed: 1, helicity: 0.3, coherence: 0.4 }) as unknown as HelixField;
  const b = create({ modes: 12, seed: 1, helicity: 0.3, coherence: 0.4, ellipticity: 0.3 }) as unknown as HelixField;
  const keys = ["kx", "ky", "kz", "km", "e1x", "e1y", "e1z", "e2x", "e2y", "e2z", "s", "a", "ph", "om"] as const;
  for (const k of keys) {
    for (let j = 0; j < a.N; j++) {
      assert.equal(a[k][j], b[k][j], `${k}[${j}] must be bit-identical (draw sequence unchanged)`);
    }
  }
});

test("ellipticity: single-mode helicity density is pointwise constant (u·w = a²κχ)", () => {
  for (const eps of [0, 0.3, 0.5, 1]) {
    const f = oneMode(eps);
    const vals: number[] = [];
    for (let i = 0; i < 8; i++) vals.push(f.helicityDensity(i * 0.7, i * 1.3, i * 2.1));
    const mx = Math.max(...vals), mn = Math.min(...vals);
    const spread = Math.abs(mx - mn) / (Math.abs(mx) || 1);
    assert.ok(spread < 1e-12, `eps=${eps}: u·w spread ${spread} should be machine zero`);
  }
});

test("ellipticity: relative helicity of one mode is exactly 2χ/(1+χ²)", () => {
  for (const eps of [0, 0.25, 0.5, 0.75, 1]) {
    const f = oneMode(eps);
    const chi = f.chi[0];
    const want = (2 * chi) / (1 + chi * chi);
    assert.ok(Math.abs(f.relativeHelicity(12) - want) < 1e-12, `eps=${eps}: rho should be ${want}`);
  }
  assert.ok(HelixNoise.selfTest().ellipticityRho < 1e-10, "selfTest reports the same known answer");
});

test("ellipticity: rms(w)/rms(u) stays |k| for every eps (vorticity intensity unchanged)", () => {
  for (const eps of [0, 0.5, 1]) {
    const f = oneMode(eps);
    const o = [0, 0, 0, 0, 0, 0];
    let su = 0, sw = 0;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) for (let k = 0; k < 12; k++) {
      f.sampleUW((i / 12) * TAU, (j / 12) * TAU, (k / 12) * TAU, o);
      su += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      sw += o[3] * o[3] + o[4] * o[4] + o[5] * o[5];
    }
    assert.ok(Math.abs(Math.sqrt(sw / su) - f.km[0]) < 1e-12, `eps=${eps}: rms ratio must equal |k|`);
  }
});

test("ellipticity: elliptic modes stay divergence-free and keep an exact potential", () => {
  const r = HelixNoise.selfTest();
  assert.ok(r.fdDivergenceRmsElliptic < 1e-4, "FD divergence at eps=0.5 is O(h²) truncation only");

  const f = create({ modes: 16, seed: 9, ellipticity: 0.5, helicity: 0.4 });
  const h = 1e-3;
  const curlOf = (fn: (x: number, y: number, z: number) => number[], x: number, y: number, z: number): number[] => {
    const ap = fn(x, y + h, z), am = fn(x, y - h, z);
    const bp = fn(x, y, z + h), bm = fn(x, y, z - h);
    const cp = fn(x + h, y, z), cm = fn(x - h, y, z);
    return [
      (ap[2] - am[2]) / (2 * h) - (bp[1] - bm[1]) / (2 * h),
      (bp[0] - bm[0]) / (2 * h) - (cp[2] - cm[2]) / (2 * h),
      (cp[1] - cm[1]) / (2 * h) - (ap[0] - am[0]) / (2 * h),
    ];
  };
  let wErr = 0, uErr = 0;
  for (const [x, y, z] of [[1, 2, 3], [0.3, 5.1, 2.2], [4.4, 0.9, 3.7]] as const) {
    const w = f.vorticity(x, y, z), wf = curlOf((a, b, c) => f.sample(a, b, c), x, y, z);
    const u = f.sample(x, y, z), uf = curlOf((a, b, c) => f.potential(a, b, c), x, y, z);
    for (let i = 0; i < 3; i++) {
      wErr = Math.max(wErr, Math.abs(w[i] - wf[i]));
      uErr = Math.max(uErr, Math.abs(u[i] - uf[i]));
    }
  }
  assert.ok(wErr < 1e-3, `analytic vorticity vs FD curl at eps=0.5: ${wErr}`);
  assert.ok(uErr < 1e-3, `curl(A) vs u at eps=0.5: ${uErr}`);
});

test("ellipticity: batch kernels match the scalar sampler at eps ≠ 1 (wasm falls back for uw)", () => {
  const f = create({ modes: 20, seed: 4, ellipticity: 0.4, churn: 1 });
  const n = 300, pos = new Float64Array(3 * n);
  for (let i = 0; i < 3 * n; i++) pos[i] = Math.sin(i * 1.7) * 3;
  const t = 0.25;
  const uw = f.sampleManyUW(pos, undefined, t);
  const u3 = f.sampleMany(pos, undefined, t);
  const o = [0, 0, 0, 0, 0, 0];
  let e6 = 0, e3 = 0;
  for (let i = 0; i < n; i++) {
    f.sampleUW(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], o, t);
    for (let c = 0; c < 6; c++) e6 = Math.max(e6, Math.abs(uw[6 * i + c] - o[c]));
    for (let c = 0; c < 3; c++) e3 = Math.max(e3, Math.abs(u3[3 * i + c] - o[c]));
  }
  assert.ok(e6 < 1e-12, `sampleManyUW vs sampleUW: ${e6}`);
  assert.ok(e3 < 1e-9, `sampleMany (wasm u-path) vs sampleUW: ${e3}`);

  // The wasm backend must decline uw batches when the modes are not Beltrami.
  const out = new Float64Array(6 * n);
  const ok = runWasm(f as unknown as HelixField, (f as unknown as HelixField).a, pos, out, t, true, 1);
  assert.equal(ok, false, "runWasm declines the elliptic vorticity path");
});

test("ellipticity: emitted GLSL bakes chi and switches to the general curl/potential bodies", () => {
  const bel = create({ modes: 6, seed: 2 }).glsl({ name: "bel", potential: true });
  assert.ok(bel.includes("bel_S[j] * length(bel_K[j]) * tv"), "eps=1 keeps the Beltrami shortcut");

  const ell = create({ modes: 6, seed: 2, ellipticity: 0.5 });
  const src = ell.glsl({ name: "ell", potential: true });
  assert.ok(src.includes("length(ell_K[j]) * tw"), "elliptic curl uses the two-term body");
  assert.ok(src.includes("tw / length(ell_K[j])"), "elliptic potential uses A = w/κ²");
  assert.ok(/ell_S\[6\] = float\[6\]\(0?\.?5|ell_S\[6\] = float\[6\]\(-0/.test(src) || src.includes("0.5000000"),
    "P_S carries chi = ±0.5, not the raw signs");

  // Evaluate the emitted formula the way the shader would, and compare to the sampler.
  const f = ell as unknown as HelixField;
  for (const [x, y, z] of [[1, 2, 3], [0.3, 5.1, 2.2]] as const) {
    let ux = 0, uy = 0, uz = 0, wx = 0, wy = 0, wz = 0;
    for (let j = 0; j < f.N; j++) {
      const phi = f.kx[j] * x + f.ky[j] * y + f.kz[j] * z + f.ph[j];
      const c = Math.cos(phi), s = Math.sin(phi), a = f.a[j], ch = f.chi[j];
      ux += a * (c * f.e1x[j] - ch * s * f.e2x[j]);
      uy += a * (c * f.e1y[j] - ch * s * f.e2y[j]);
      uz += a * (c * f.e1z[j] - ch * s * f.e2z[j]);
      const km = f.km[j];
      wx += km * a * (ch * c * f.e1x[j] - s * f.e2x[j]);
      wy += km * a * (ch * c * f.e1y[j] - s * f.e2y[j]);
      wz += km * a * (ch * c * f.e1z[j] - s * f.e2z[j]);
    }
    const u = f.sample(x, y, z), w = f.vorticity(x, y, z);
    assert.ok(Math.abs(u[0] - ux * f._scale) < 1e-9 && Math.abs(u[2] - uz * f._scale) < 1e-9, "shader velocity matches");
    assert.ok(Math.abs(w[0] - wx * f._scale) < 1e-9 && Math.abs(w[2] - wz * f._scale) < 1e-9, "shader curl matches");
  }
});

test("ellipticity: at eps = 0 the field is achiral regardless of the helicity slider", () => {
  for (const p of [-1, 0.5, 1]) {
    const f = create({ modes: 40, seed: 6, helicity: p, ellipticity: 0, tileable: true });
    assert.ok(Math.abs(f.relativeHelicity(10)) < 0.05, `eps=0, helicity=${p}: rho ≈ 0`);
  }
});

test("wasm mode block: a smaller field after a larger one is not read at the stale stride", () => {
  // Regression: the kernel strides mode arrays by the live N. Uploading at the reserved
  // capacity made every batch after a bigger field read garbage (silently wrong velocities).
  const big = create({ modes: 48, seed: 13, churn: 1.2, decay: 0.05 });
  big.sampleMany(new Float64Array(3 * 200).map((_, i) => Math.sin(i * 3.1) * 5), undefined, 0.4);
  const small = create({ modes: 6, seed: 4 });
  const n = 128, pos = new Float64Array(3 * n).map((_, i) => Math.cos(i * 1.9) * 2);
  const batch = small.sampleMany(pos, undefined, 0.3);
  const o = [0, 0, 0, 0, 0, 0];
  let worst = 0;
  for (let i = 0; i < n; i++) {
    small.sampleUW(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], o, 0.3);
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(batch[3 * i + c] - o[c]));
  }
  assert.ok(worst < 1e-12, `small-after-big batch mismatch ${worst}`);
});

// ---------------------------------------------------------------------------
// Scale-dependent dials + preset factories
// ---------------------------------------------------------------------------

test("scale dials: a constant callable reproduces the scalar config bit-identically", () => {
  const a = create({ modes: 12, seed: 42, helicity: 0.8, coherence: 0.5 }) as unknown as HelixField;
  const b = create({ modes: 12, seed: 42, helicity: () => 0.8, coherence: () => 0.5 }) as unknown as HelixField;
  const keys = ["kx", "ky", "kz", "km", "e1x", "e1y", "e1z", "e2x", "e2y", "e2z", "s", "chi", "a", "ph", "om"] as const;
  for (const k of keys) {
    for (let j = 0; j < a.N; j++) assert.equal(a[k][j], b[k][j], `${k}[${j}] must be bit-identical`);
  }
  assert.equal(a._scale, b._scale);
});

test("scale dials consume no RNG draws (the layout is untouched by the callables)", () => {
  const scalar = create({ modes: 8, seed: 5, centers: 2 }) as unknown as HelixField;
  const fn = create({
    modes: 8, seed: 5, centers: 2,
    coherence: rolloff(4),
    helicity: condensate(3, 1, -1),
  }) as unknown as HelixField;
  for (const k of ["kx", "ky", "kz", "km", "a"] as const) {
    for (let j = 0; j < 8; j++) assert.equal(scalar[k][j], fn[k][j], `${k}[${j}]: draw sequence must not shift`);
  }
  // condensate(3, +1, −1) is a known answer: p = +1 ⇒ every draw is < 1 ⇒ s = +1, and vice versa.
  for (let j = 0; j < fn.N; j++) assert.equal(fn.s[j], fn.km[j] <= 3 ? 1 : -1, `mode ${j} sign follows p(k)`);
});

test("rolloff: large scales lock onto the coherent phase, small scales stay random", () => {
  const kc = 4;
  const f = create({ modes: 40, seed: 8, kmin: 1, kmax: 8, centers: 1, coherence: rolloff(kc) }) as unknown as HelixField;
  // At λ = 1 the phase is exactly the center reference −k·c; at λ = 0 it carries the full
  // random part. Modes above kc must therefore differ from the pure reference, and the
  // lowest-k modes must sit much closer to it.
  const dev = (j: number): number => {
    const lam = Math.min(1, Math.max(0, 1 - f.km[j] / kc));
    return 1 - lam; // the surviving fraction of the random phase
  };
  let lowMax = 0, highMin = 1;
  for (let j = 0; j < f.N; j++) {
    if (f.km[j] < 2) lowMax = Math.max(lowMax, dev(j));
    if (f.km[j] > kc) highMin = Math.min(highMin, dev(j));
  }
  assert.ok(lowMax < 0.5, "large scales are mostly coherent");
  assert.equal(highMin, 1, "above the cutoff the phase is fully random");
});

test("shellPeak: the amplitude law peaks at kPeak and falls off like a Gaussian", () => {
  const s = shellPeak(3, 1);
  assert.ok(Math.abs(s(3) - 1) < 1e-15, "unit at the peak");
  assert.ok(Math.abs(s(4) - Math.exp(-0.5)) < 1e-15, "one width out");
  const f = create({ modes: 40, seed: 3, spectrum: shellPeak(3), kmin: 1, kmax: 6 }) as unknown as HelixField;
  let bestK = 0, bestA = -1;
  for (let j = 0; j < f.N; j++) if (f.a[j] > bestA) { bestA = f.a[j]; bestK = f.km[j]; }
  assert.ok(Math.abs(bestK - 3) < 0.3, `the strongest mode sits at the peak (got k=${bestK})`);
});

test("abc(): three modes reproducing the closed-form ABC field, with no RNG", () => {
  for (const [A, B, C] of [[1, 1, 1], [3, 3, 3], [1, 0.7, 0.3], [2.5, -1.2, 0]] as const) {
    const f = abc(A, B, C);
    assert.equal((f as unknown as HelixField).N, 3, "exactly three modes");
    let uErr = 0, wErr = 0, pErr = 0;
    for (let i = 0; i < 50; i++) {
      const x = Math.sin(i * 1.3) * 7, y = Math.cos(i * 2.1) * 5, z = Math.sin(i * 0.7) * 9;
      const want = [
        A * Math.sin(z) + C * Math.cos(y),
        B * Math.sin(x) + A * Math.cos(z),
        C * Math.sin(y) + B * Math.cos(x),
      ];
      const u = f.sample(x, y, z), w = f.vorticity(x, y, z), p = f.potential(x, y, z);
      for (let c = 0; c < 3; c++) {
        uErr = Math.max(uErr, Math.abs(u[c] - want[c]));
        wErr = Math.max(wErr, Math.abs(w[c] - want[c])); // Beltrami: ∇×u = u
        pErr = Math.max(pErr, Math.abs(p[c] - want[c])); // and the potential is u itself
      }
    }
    assert.ok(uErr < 1e-13, `abc(${A},${B},${C}) velocity: ${uErr}`);
    assert.ok(wErr < 1e-13, `abc(${A},${B},${C}) is Beltrami: ${wErr}`);
    assert.ok(pErr < 1e-13, `abc(${A},${B},${C}) potential: ${pErr}`);
  }
});

test("abc(): amplitude normalizes through the closed form; decay is the exact viscous solution", () => {
  const f = abc(3, 3, 3, { amplitude: 2 }) as unknown as HelixField;
  assert.equal(f._scale, 2 / Math.sqrt(27), "scale must be amplitude/√(A²+B²+C²), not rms()");
  assert.throws(() => f.set({ modes: 5 }), /closed-form preset field/);

  const nu = 0.3, g = abc(1, 1, 1, { decay: nu });
  const u0 = g.sample(1, 2, 3, 0), ut = g.sample(1, 2, 3, 1.5);
  assert.ok(Math.abs(ut[0] / u0[0] - Math.exp(-nu * 1.5)) < 1e-12, "u(t) = e^(−νt)·u(0)");
});

test("twoScale: exact sum, still divergence-free, potential still exact", () => {
  const kD = 8;
  const detail = create({ spectrum: shellPeak(kD), kmin: kD - 3, kmax: kD + 3, amplitude: C_TWO_SCALE / kD, seed: 2 });
  const base = abc(3, 3, 3);
  const storm = twoScale(base, detail);

  let sumErr = 0;
  for (let i = 0; i < 20; i++) {
    const x = i * 0.6, y = i * 1.1, z = i * 0.3;
    const s = storm.sample(x, y, z), b = base.sample(x, y, z), d = detail.sample(x, y, z);
    for (let c = 0; c < 3; c++) sumErr = Math.max(sumErr, Math.abs(s[c] - (b[c] + d[c])));
  }
  assert.equal(sumErr, 0, "the composite is exactly base + detail");

  const h = 1e-3;
  let divMax = 0, potErr = 0;
  for (const [x, y, z] of [[0.9, 1.7, 0.4], [3.1, 2.2, 5.0]] as const) {
    const dx = (storm.sample(x + h, y, z)[0] - storm.sample(x - h, y, z)[0]) / (2 * h);
    const dy = (storm.sample(x, y + h, z)[1] - storm.sample(x, y - h, z)[1]) / (2 * h);
    const dz = (storm.sample(x, y, z + h)[2] - storm.sample(x, y, z - h)[2]) / (2 * h);
    divMax = Math.max(divMax, Math.abs(dx + dy + dz));
    const pf = (a: number, b: number, c: number): Vec3 => storm.potential(a, b, c);
    const curl = [
      (pf(x, y + h, z)[2] - pf(x, y - h, z)[2]) / (2 * h) - (pf(x, y, z + h)[1] - pf(x, y, z - h)[1]) / (2 * h),
      (pf(x, y, z + h)[0] - pf(x, y, z - h)[0]) / (2 * h) - (pf(x + h, y, z)[2] - pf(x - h, y, z)[2]) / (2 * h),
      (pf(x + h, y, z)[1] - pf(x - h, y, z)[1]) / (2 * h) - (pf(x, y + h, z)[0] - pf(x, y - h, z)[0]) / (2 * h),
    ];
    const u = storm.sample(x, y, z);
    for (let c = 0; c < 3; c++) potErr = Math.max(potErr, Math.abs(curl[c] - u[c]));
  }
  assert.ok(divMax < 1e-4, `FD divergence of the composite: ${divMax}`);
  assert.ok(potErr < 1e-4, `curl of the composite potential vs its velocity: ${potErr}`);

  // the shared surface still gives boundaries and bakes
  const bnd = storm.withBoundary((x, y, z) => Math.hypot(x - 3, y - 3, z - 3) - 1.2, { thickness: 0.9 });
  const inside = bnd.sample(3, 3, 3);
  assert.deepEqual(inside, [0, 0, 0], "flow is zero inside the obstacle");
  assert.equal(storm.bake3D(4).data.length, 4 * 4 * 4 * 4);
});

// ---------------------------------------------------------------------------
// Grain axis — world-anchored linear polarization
// ---------------------------------------------------------------------------

/** Exact space-average of ⟨|u·n|²⟩/⟨|u|²⟩ straight from the mode data (no grid sampling error). */
function axisEnergyFraction(f: HelixField, n: [number, number, number]): number {
  let num = 0, den = 0;
  for (let j = 0; j < f.N; j++) {
    const a2 = f.a[j] * f.a[j];
    const p1 = f.e1x[j] * n[0] + f.e1y[j] * n[1] + f.e1z[j] * n[2];
    const p2 = f.e2x[j] * n[0] + f.e2y[j] * n[1] + f.e2z[j] * n[2];
    num += a2 * (p1 * p1 + p2 * p2);
    den += a2 * (f.e1x[j] ** 2 + f.e1y[j] ** 2 + f.e1z[j] ** 2 +
                 f.e2x[j] ** 2 + f.e2y[j] ** 2 + f.e2z[j] ** 2);
  }
  return num / den;
}

test("grain axis: off by default, and polarizationBias alone changes nothing", () => {
  const a = create({ modes: 12, seed: 7, helicity: 0.4 }) as unknown as HelixField;
  const b = create({ modes: 12, seed: 7, helicity: 0.4, polarizationBias: 0.8 }) as unknown as HelixField;
  assert.equal(b._general, false, "the channel is gated on the axis, never on the bias");
  for (const k of ["kx", "e1x", "e1y", "e1z", "e2x", "e2y", "e2z", "s", "chi", "ph", "om", "a"] as const) {
    for (let j = 0; j < 12; j++) assert.equal(a[k][j], b[k][j], `${k}[${j}] must be untouched`);
  }
  assert.equal(a._scale, b._scale);
});

test("grain axis: energy along the axis follows (1 + d)/3", () => {
  for (const d of [0, 0.4, 0.85]) {
    let acc = 0;
    const S = 24;
    for (let s = 0; s < S; s++) {
      const f = create({
        modes: 400, seed: 1000 + s, layout: "random", slope: 0, ellipticity: 0,
        polarizationAxis: [0, 1, 0], polarizationBias: d,
      }) as unknown as HelixField;
      acc += axisEnergyFraction(f, [0, 1, 0]);
    }
    const got = acc / S, want = (1 + d) / 3;
    assert.ok(Math.abs(got - want) < 0.02, `d=${d}: axis energy fraction ${got}, expected ≈ ${want}`);
  }
});

test("grain axis: the linear channel alone carries no helicity", () => {
  // Statistical smoke test: a single realization of a finite mode sum has O(1/√N) residual
  // helicity, so average over seeds. (Deliberately not `tileable` — snapping wavevectors to
  // the integer lattice makes modes collide, and colliding modes' cross terms do not average
  // away on the grid.)
  let acc = 0;
  const S = 6;
  for (let s = 0; s < S; s++) {
    const f = create({
      modes: 600, seed: 21 + s, layout: "random", ellipticity: 0,
      polarizationAxis: [0, 1, 0], polarizationBias: 0.85,
    });
    acc += f.relativeHelicity(10);
  }
  assert.ok(Math.abs(acc / S) < 0.03, `pure linear polarization is achiral (mean ρ = ${acc / S})`);
});

test("grain axis: handedness survives with the channel on", () => {
  const f = create({
    modes: 500, seed: 5, layout: "random", helicity: 1, ellipticity: 1,
    polarizationAxis: [0, 0, 1], polarizationBias: 0.3,
  });
  assert.ok(f.relativeHelicity(10) > 0.5, "a right-handed field stays right-handed");
});

test("grain axis: still divergence-free, with an exact curl and potential", () => {
  const f = create({ modes: 24, seed: 3, ellipticity: 0.4, polarizationAxis: [1, 0, 0], polarizationBias: 0.6 });
  const h = 1e-3;
  const curlOf = (fn: (x: number, y: number, z: number) => Vec3, x: number, y: number, z: number): number[] => {
    const ap = fn(x, y + h, z), am = fn(x, y - h, z);
    const bp = fn(x, y, z + h), bm = fn(x, y, z - h);
    const cp = fn(x + h, y, z), cm = fn(x - h, y, z);
    return [
      (ap[2] - am[2]) / (2 * h) - (bp[1] - bm[1]) / (2 * h),
      (bp[0] - bm[0]) / (2 * h) - (cp[2] - cm[2]) / (2 * h),
      (cp[1] - cm[1]) / (2 * h) - (ap[0] - am[0]) / (2 * h),
    ];
  };
  let div = 0, wErr = 0, uErr = 0;
  for (const [x, y, z] of [[0.9, 1.7, 0.4], [3.1, 2.2, 5.0]] as const) {
    const dx = (f.sample(x + h, y, z)[0] - f.sample(x - h, y, z)[0]) / (2 * h);
    const dy = (f.sample(x, y + h, z)[1] - f.sample(x, y - h, z)[1]) / (2 * h);
    const dz = (f.sample(x, y, z + h)[2] - f.sample(x, y, z - h)[2]) / (2 * h);
    div = Math.max(div, Math.abs(dx + dy + dz));
    const w = f.vorticity(x, y, z), wf = curlOf((a, b, c) => f.sample(a, b, c), x, y, z);
    const u = f.sample(x, y, z), uf = curlOf((a, b, c) => f.potential(a, b, c), x, y, z);
    for (let i = 0; i < 3; i++) {
      wErr = Math.max(wErr, Math.abs(w[i] - wf[i]));
      uErr = Math.max(uErr, Math.abs(u[i] - uf[i]));
    }
  }
  assert.ok(div < 1e-3, `FD divergence: ${div}`);
  assert.ok(wErr < 1e-3, `analytic vorticity vs FD curl: ${wErr}`);
  assert.ok(uErr < 1e-3, `curl(A) vs u: ${uErr}`);
});

test("grain axis: batch kernels and the emitted GLSL agree with the sampler", () => {
  const f = create({ modes: 20, seed: 4, ellipticity: 0.5, polarizationAxis: [0, 1, 0], polarizationBias: 0.5 });
  const n = 200, pos = new Float64Array(3 * n).map((_, i) => Math.sin(i * 1.7) * 3);
  const t = 0.3;
  const uw = f.sampleManyUW(pos, undefined, t), u3 = f.sampleMany(pos, undefined, t);
  const o = [0, 0, 0, 0, 0, 0];
  let e6 = 0, e3 = 0;
  for (let i = 0; i < n; i++) {
    f.sampleUW(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], o, t);
    for (let c = 0; c < 6; c++) e6 = Math.max(e6, Math.abs(uw[6 * i + c] - o[c]));
    for (let c = 0; c < 3; c++) e3 = Math.max(e3, Math.abs(u3[3 * i + c] - o[c]));
  }
  assert.ok(e6 < 1e-12, `sampleManyUW: ${e6}`);
  assert.ok(e3 < 1e-9, `sampleMany: ${e3}`);

  const g = f as unknown as HelixField;
  const src = g.glsl({ name: "grain", potential: true });
  assert.ok(src.includes("cross(grain_K[j], tv2)"), "curl uses the cross-product body");
  assert.ok(src.includes("dot(grain_K[j], grain_K[j])"), "potential divides by |k|²");
  for (const [x, y, z] of [[1, 2, 3], [0.3, 5.1, 2.2]] as const) {
    const u = [0, 0, 0], w = [0, 0, 0], A = [0, 0, 0];
    for (let j = 0; j < g.N; j++) {
      const phi = g.kx[j] * x + g.ky[j] * y + g.kz[j] * z + g.ph[j];
      const c = Math.cos(phi), s = Math.sin(phi), a = g.a[j];
      const e1 = [g.e1x[j], g.e1y[j], g.e1z[j]], e2 = [g.e2x[j], g.e2y[j], g.e2z[j]];
      const k = [g.kx[j], g.ky[j], g.kz[j]];
      const tv2 = [0, 1, 2].map((i) => a * (-s * e1[i] - c * e2[i]));
      const cr = [
        k[1] * tv2[2] - k[2] * tv2[1],
        k[2] * tv2[0] - k[0] * tv2[2],
        k[0] * tv2[1] - k[1] * tv2[0],
      ];
      const k2 = k[0] ** 2 + k[1] ** 2 + k[2] ** 2;
      for (let i = 0; i < 3; i++) { u[i] += a * (c * e1[i] - s * e2[i]); w[i] += cr[i]; A[i] += cr[i] / k2; }
    }
    const U = g.sample(x, y, z), W = g.vorticity(x, y, z), P = g.potential(x, y, z);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(u[i] * g._scale - U[i]) < 1e-12, "shader velocity");
      assert.ok(Math.abs(w[i] * g._scale - W[i]) < 1e-12, "shader curl");
      assert.ok(Math.abs(A[i] * g._scale - P[i]) < 1e-12, "shader potential");
    }
  }
});

// ---------------------------------------------------------------------------
// exactNS + measured-polarization bundles
// ---------------------------------------------------------------------------

test("exactNS: a genuine Navier–Stokes solution — single shell, Beltrami, Stokes decay", () => {
  const nu = 0.05, k0 = 2;
  const f = create(exactNS({ k0, nu, seed: 7, modes: 24 })) as unknown as HelixField;

  for (let j = 0; j < f.N; j++) {
    assert.ok(Math.abs(f.km[j] - k0) < 1e-12, `mode ${j} sits on the single shell`);
    assert.equal(f.s[j], 1, `mode ${j} takes the requested chirality`);
    assert.equal(f.om[j], 0, "no churn: viscous decay is the only time dependence");
  }
  assert.equal(f.nu, nu);
  // Beltrami by construction: ∇×u = s·k₀·u exactly, at every point and every time.
  for (const t of [0, 1.7]) {
    for (const [x, y, z] of [[1, 2, 3], [0.4, 5.2, 2.1]] as const) {
      const u = f.sample(x, y, z, t), w = f.vorticity(x, y, z, t);
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(w[c] - k0 * u[c]) < 1e-12, "curl u = k₀·u");
    }
  }
  // The exact viscous law: every amplitude decays at the same rate, so the shape is frozen.
  const t = 2.5, decay = Math.exp(-nu * k0 * k0 * t);
  const u0 = f.sample(1, 2, 3, 0), ut = f.sample(1, 2, 3, t);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(ut[c] - decay * u0[c]) < 1e-12, "u(t) = e^(−νk₀²t)·u(0)");

  assert.ok(Math.abs(f.relativeHelicitySpectral(0) - 1) < 1e-12, "maximal helicity: ρ = +1");
  assert.ok(Math.abs(f.relativeHelicitySpectral(t) - 1) < 1e-12, "and it is conserved under decay");
  assert.ok(Math.abs(create(exactNS({ sign: -1, modes: 12 })).relativeHelicitySpectral() + 1) < 1e-12, "sign: −1 flips it");
});

test("relativeHelicitySpectral is the exact value the grid estimate approximates", () => {
  // One mode: the closed form 2χ/(1+χ²), for every ellipticity.
  for (const eps of [0, 0.3, 0.5, 1]) {
    const f = create({ modes: 1, seed: 3, tileable: true, kmin: 2, kmax: 2, helicity: 1, ellipticity: eps }) as unknown as HelixField;
    const chi = f.chi[0];
    assert.ok(
      Math.abs(f.relativeHelicitySpectral() - (2 * chi) / (1 + chi * chi)) < 1e-12,
      `eps=${eps}: single-mode spectral helicity`
    );
  }
  // With few, distinct, integer wavevectors the grid quadrature is exact, so the two agree.
  for (const [modes, eps] of [[4, 1], [4, 0.6], [8, 0.6]] as const) {
    const f = create({ modes, seed: 2, tileable: true, kmin: 1, kmax: 3, helicity: 0.5, ellipticity: eps }) as unknown as HelixField;
    const seen = new Set(Array.from({ length: f.N }, (_, j) => `${f.kx[j]},${f.ky[j]},${f.kz[j]}`));
    assert.equal(seen.size, f.N, "this config must have distinct wavevectors for the identity to hold");
    assert.ok(
      Math.abs(f.relativeHelicitySpectral() - f.relativeHelicity(16)) < 1e-9,
      `${modes} modes at eps=${eps}: grid ${f.relativeHelicity(16)} vs exact ${f.relativeHelicitySpectral()}`
    );
  }
  // Colliding wavevectors (what `tileable` rounding produces in a crowded band) are exactly the
  // case where the grid estimate departs — cross terms between duplicated k do not cancel.
  const crowded = create({ modes: 200, seed: 11, helicity: 0.7, tileable: true, kmin: 1, kmax: 4 });
  assert.ok(crowded.relativeHelicitySpectral() > crowded.relativeHelicity(16), "documented, not a bug");
});

test("nsDeveloped / nsForced: polarization matches the measured targets", () => {
  for (const [name, bundle, target] of [
    ["dev", nsDeveloped(), NS_TARGETS.dev],
    ["forced", nsForced(), NS_TARGETS.forced],
  ] as const) {
    const eps = bundle.ellipticity as number;
    // ellipticity is the exact inverse of the per-mode helical fraction 2ε/(1+ε²) = |p|
    const pMode = (2 * eps) / (1 + eps * eps);
    assert.ok(Math.abs(pMode - target.absP) < 1e-12, `${name}: per-mode |p| = ${pMode}, want ${target.absP}`);
    // and the helicity slider carries the signed mean
    assert.ok(
      Math.abs((bundle.helicity as number) * target.absP - target.signedP) < 1e-12,
      `${name}: signed mean should come out at ${target.signedP}`
    );
    const f = create(bundle);
    assert.ok(Number.isFinite(f.relativeHelicity(8)), `${name}: builds a usable field`);
    assert.equal(create(nsForced({ seed: 7 })).params.seed, 7, "overrides win");
  }
  assert.ok((nsForced().ellipticity as number) > (nsDeveloped().ellipticity as number),
    "the forced state is the more polarized of the two");
});

// ---------------------------------------------------------------------------
// Structure primitives — closed-form localized flows
// ---------------------------------------------------------------------------

const fdCurl = (fn: (x: number, y: number, z: number) => Vec3, x: number, y: number, z: number, h: number): number[] => {
  const ap = fn(x, y + h, z), am = fn(x, y - h, z);
  const bp = fn(x, y, z + h), bm = fn(x, y, z - h);
  const cp = fn(x + h, y, z), cm = fn(x - h, y, z);
  return [
    (ap[2] - am[2]) / (2 * h) - (bp[1] - bm[1]) / (2 * h),
    (bp[0] - bm[0]) / (2 * h) - (cp[2] - cm[2]) / (2 * h),
    (cp[1] - cm[1]) / (2 * h) - (ap[0] - am[0]) / (2 * h),
  ];
};

/** Points where the ring's flow is actually non-negligible (it is exactly zero elsewhere). */
function ringPoints(f: FlowField, want = 12): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < 4000 && out.length < want; i++) {
    const p: [number, number, number] = [Math.sin(i * 1.7) * 2.2, Math.cos(i * 2.3) * 2.2, Math.sin(i * 0.9) * 1.2];
    if (Math.hypot(...f.sample(...p)) > 0.1) out.push(p);
  }
  return out;
}

test("vortex ring: compactly supported, and exactly zero outside its core", () => {
  const f = createRing({ radius: 1.5, core: 0.4, circulation: 2 });
  assert.deepEqual(f.sample(9, 9, 9), [0, 0, 0], "far field");
  assert.deepEqual(f.sample(0, 0, 0.2), [0, 0, 0], "on the axis, inside the ring");
  assert.deepEqual(f.potential(9, 9, 9), [0, 0, 0], "the potential is compact too");
  assert.ok(ringPoints(f).length === 12, "but the core carries real flow");
});

test("vortex ring: divergence-free with an exact analytic vorticity and potential", () => {
  const f = createRing({ radius: 1.5, core: 0.4, circulation: 2 });
  const pts = ringPoints(f);
  const err = (h: number): { div: number; w: number; u: number } => {
    let div = 0, w = 0, u = 0;
    for (const [x, y, z] of pts) {
      const dx = (f.sample(x + h, y, z)[0] - f.sample(x - h, y, z)[0]) / (2 * h);
      const dy = (f.sample(x, y + h, z)[1] - f.sample(x, y - h, z)[1]) / (2 * h);
      const dz = (f.sample(x, y, z + h)[2] - f.sample(x, y, z - h)[2]) / (2 * h);
      div = Math.max(div, Math.abs(dx + dy + dz));
      const aw = f.vorticity(x, y, z), fw = fdCurl((a, b, c) => f.sample(a, b, c), x, y, z, h);
      const au = f.sample(x, y, z), fu = fdCurl((a, b, c) => f.potential(a, b, c), x, y, z, h);
      for (let c = 0; c < 3; c++) {
        w = Math.max(w, Math.abs(aw[c] - fw[c]));
        u = Math.max(u, Math.abs(au[c] - fu[c]));
      }
    }
    return { div, w, u };
  };
  const coarse = err(4e-4), fine = err(2e-4);
  assert.ok(fine.div < 1e-4, `FD divergence ${fine.div}`);
  assert.ok(fine.u < 1e-4, `curl(A) vs u: ${fine.u}`);
  // Second-order convergence is what proves the analytic vorticity is the real curl, not
  // merely close to it: halving the step must quarter the error.
  const ratio = coarse.w / fine.w;
  assert.ok(ratio > 3.5 && ratio < 4.5, `vorticity error should converge as O(h²) (ratio ${ratio})`);
});

test("vortex ring: advect moves it at Kelvin's self-induced speed", () => {
  const G = 2, R = 1.5, c = 0.4;
  const want = (G / (4 * Math.PI * R)) * (Math.log((8 * R) / c) - 0.25);
  assert.ok(Math.abs(ringSpeed(G, R, c) - want) < 1e-12, "the closed-form speed");

  const still = createRing({ radius: R, core: c, circulation: G });
  const flying = createRing({ radius: R, core: c, circulation: G, advect: true });
  const t = 0.7, shift = ringSpeed(G, R, c) * t;
  const a = still.sample(R + 0.1, 0, 0);
  const b = flying.sample(R + 0.1, 0, shift, t);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-12, "the flying ring is the still one, translated");
});

test("compose: rings and a spectral field sum into one divergence-free flow", () => {
  const rings = collidingRings({ radius: 1.2, core: 0.35, circulation: 1.5, separation: 1.6 });
  const mixed = compose(rings, create({ modes: 12, seed: 3, amplitude: 0.2 }));
  const h = 1e-4;
  let div = 0, uErr = 0;
  for (let i = 0; i < 40; i++) {
    const x = i * 0.31, y = i * 0.57, z = i * 0.13;
    const dx = (mixed.sample(x + h, y, z)[0] - mixed.sample(x - h, y, z)[0]) / (2 * h);
    const dy = (mixed.sample(x, y + h, z)[1] - mixed.sample(x, y - h, z)[1]) / (2 * h);
    const dz = (mixed.sample(x, y, z + h)[2] - mixed.sample(x, y, z - h)[2]) / (2 * h);
    div = Math.max(div, Math.abs(dx + dy + dz));
    const u = mixed.sample(x, y, z), fu = fdCurl((a, b, c) => mixed.potential(a, b, c), x, y, z, 1e-3);
    for (let c = 0; c < 3; c++) uErr = Math.max(uErr, Math.abs(u[c] - fu[c]));
  }
  assert.ok(div < 1e-6, `composite divergence ${div}`);
  assert.ok(uErr < 1e-3, `composite potential is still exact: ${uErr}`);

  // and the shared surface still gives obstacles and bakes
  const bnd = mixed.withBoundary((x, y, z) => Math.hypot(x, y, z) - 0.5, { thickness: 0.4 });
  assert.deepEqual(bnd.sample(0, 0, 0), [0, 0, 0]);
  assert.equal(mixed.bake3D(4).data.length, 4 * 4 * 4 * 4);

  // colliding rings really are mirror images with opposite circulation
  const p = rings.sample(1.2, 0, 0.8), m = rings.sample(1.2, 0, -0.8);
  assert.ok(Math.abs(p[2] + m[2]) < 1e-12, "axial flow is antisymmetric about the collision plane");
});

// ---------------------------------------------------------------------------
// Velocity gradient and the structure diagnostics built on it
// ---------------------------------------------------------------------------

test("sampleGrad is the analytic velocity gradient, for every mode type", () => {
  for (const cfg of [
    { modes: 16, seed: 3 },
    { modes: 16, seed: 3, ellipticity: 0.5, helicity: 0.4 },
    { modes: 16, seed: 3, ellipticity: 0.4, polarizationAxis: [0, 1, 0] as Vec3, polarizationBias: 0.6 },
  ]) {
    const f = create(cfg) as unknown as HelixField;
    const h = 1e-4, g = new Float64Array(9);
    let gErr = 0, trace = 0, wErr = 0;
    for (let i = 0; i < 12; i++) {
      const x = i * 0.61, y = i * 1.13, z = i * 0.37;
      f.sampleGrad(x, y, z, g);
      for (let m = 0; m < 3; m++) {
        const p = [x, y, z], q = [x, y, z];
        p[m] += h; q[m] -= h;
        const up = f.sample(p[0], p[1], p[2]), um = f.sample(q[0], q[1], q[2]);
        for (let n = 0; n < 3; n++) gErr = Math.max(gErr, Math.abs(g[3 * m + n] - (up[n] - um[n]) / (2 * h)));
      }
      trace = Math.max(trace, Math.abs(g[0] + g[4] + g[8]));
      // the antisymmetric part must reproduce the analytic vorticity exactly
      const w = [g[5] - g[7], g[6] - g[2], g[1] - g[3]];
      const wa = f.vorticity(x, y, z);
      for (let c = 0; c < 3; c++) wErr = Math.max(wErr, Math.abs(w[c] - wa[c]));
    }
    const label = JSON.stringify(cfg);
    assert.ok(gErr < 1e-6, `${label}: gradient vs finite differences ${gErr}`);
    assert.ok(trace < 1e-12, `${label}: trace (= divergence) must be machine zero, got ${trace}`);
    assert.ok(wErr < 1e-12, `${label}: curl of the gradient must equal the analytic vorticity, off by ${wErr}`);
  }
  assert.throws(() => create({ modes: 2 }).sampleGrad(0, 0, 0, [0, 0, 0]), /needs 9 floats/);
});

test("Q, λ₂ and stretching: known answers and sane behaviour", () => {
  // A single Beltrami wave balances rotation against strain exactly, and stretches nothing.
  const one = create({ modes: 1, seed: 3, tileable: true, kmin: 2, kmax: 2, helicity: 1 });
  assert.ok(Math.abs(one.qCriterion(1, 2, 3)) < 1e-12, "single Beltrami mode has Q = 0");
  assert.ok(Math.abs(one.stretching(1, 2, 3)) < 1e-12, "and no vortex stretching");

  const f = create({ modes: 40, seed: 7, coherence: 0.6 });
  let qPos = 0, l2Neg = 0, agree = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const x = i * 0.13, y = i * 0.29, z = i * 0.07;
    const q = f.qCriterion(x, y, z), l = f.lambda2(x, y, z);
    assert.ok(Number.isFinite(q) && Number.isFinite(l), "both are finite everywhere");
    if (q > 0) qPos++;
    if (l < 0) l2Neg++;
    if (q > 0 === l < 0) agree++;
  }
  // The two criteria are different measures, but they are measuring the same thing: they should
  // pick out a substantial fraction of space and mostly agree with each other.
  assert.ok(qPos / n > 0.2 && qPos / n < 0.8, `Q > 0 fraction ${qPos / n}`);
  assert.ok(l2Neg / n > 0.2 && l2Neg / n < 0.8, `λ₂ < 0 fraction ${l2Neg / n}`);
  assert.ok(agree / n > 0.75, `the two criteria should mostly agree (${agree / n})`);
});

test("glsl({ gradient: true }) emits a gradient matrix matching sampleGrad", () => {
  const f = create({ modes: 6, seed: 5, ellipticity: 0.5 }) as unknown as HelixField;
  const src = f.glsl({ name: "gf", gradient: true });
  assert.ok(src.includes("mat3 gfGrad(vec3 p, float t)"), "emits the gradient");
  assert.ok(src.includes("float gfQ(vec3 p)"), "and the Q-criterion helper");

  // Evaluate the emitted body the way the shader would.
  const g = new Float64Array(9);
  for (const [x, y, z] of [[1, 2, 3], [0.3, 5.1, 2.2]] as const) {
    f.sampleGrad(x, y, z, g);
    const G = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let j = 0; j < f.N; j++) {
      const phi = f.kx[j] * x + f.ky[j] * y + f.kz[j] * z + f.ph[j];
      const a = f.a[j], sn = Math.sin(phi), c = Math.cos(phi), chi = f.chi[j];
      const b = [
        -a * (sn * f.e1x[j] + c * chi * f.e2x[j]),
        -a * (sn * f.e1y[j] + c * chi * f.e2y[j]),
        -a * (sn * f.e1z[j] + c * chi * f.e2z[j]),
      ];
      const k = [f.kx[j], f.ky[j], f.kz[j]];
      for (let m = 0; m < 3; m++) for (let n = 0; n < 3; n++) G[3 * m + n] += k[m] * b[n];
    }
    for (let i = 0; i < 9; i++) assert.ok(Math.abs(G[i] * f._scale - g[i]) < 1e-12, `shader gradient entry ${i}`);
  }
});
