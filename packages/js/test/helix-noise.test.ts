import test from "node:test";
import assert from "node:assert";
import HelixNoise, { create, createAtoms, HelixField } from "../src/index";
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
