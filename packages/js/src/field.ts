import { DEFAULTS, TAU } from "./constants";
import { mulberry32 } from "./rng";
import { toGLSL } from "./glsl";
import { BoundedFieldImpl } from "./boundary";
import { runWasm } from "./wasm";
import type {
  Bake2DResult,
  Bake3DResult,
  BoundaryOptions,
  BoundedField,
  Field,
  GlslOptions,
  HelixNoiseOptions,
  ModeData,
  Out6,
  Sdf,
  Vec3,
} from "./types";

const _tmp6: number[] = [0, 0, 0, 0, 0, 0];

/** Golden angle (radians) — the Fibonacci-sphere azimuth increment. */
const GA = Math.PI * (3 - Math.sqrt(5));

/** Points per tile in the batch samplers; tile scratch = TILE·6 doubles ≈ 12 kB (L1-resident). */
const TILE = 256;

// Inline sincos for the batch kernel: one shared Cody–Waite argument reduction (3-term π/2
// split — each q·PIO2_i product is exact for |q| < 2^20) + the fdlibm double-precision
// kernels. Agrees with Math.sin/Math.cos to < 2 ulp for |φ| ≤ PHI_MAX; larger phases take the
// (rare, correctly-rounded) Math.* path in the kernel below.
const TWO_OVER_PI = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00; // first 33 bits of π/2
const PIO2_2 = 6.07710050630396597660e-11; // next 33 bits
const PIO2_3 = 2.02226624879595063154e-21; // remainder
const PHI_MAX = 1e6;
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

/** Orthonormal transverse frame (e1, e2) perpendicular to the unit vector (dx, dy, dz). @internal */
export function frame(dx: number, dy: number, dz: number, out: number[]): void {
  let rx: number, ry: number, rz: number;
  if (Math.abs(dz) < 0.9) { rx = 0; ry = 0; rz = 1; } else { rx = 0; ry = 1; rz = 0; }
  let e1x = ry * dz - rz * dy, e1y = rz * dx - rx * dz, e1z = rx * dy - ry * dx;
  const n = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= n; e1y /= n; e1z /= n;
  const e2x = dy * e1z - dz * e1y, e2y = dz * e1x - dx * e1z, e2z = dx * e1y - dy * e1x;
  out[0] = e1x; out[1] = e1y; out[2] = e1z; out[3] = e2x; out[4] = e2y; out[5] = e2z;
}

/** Uniform random rotation (row-major 3×3) from three uniforms — Shoemake's quaternion method. */
function rotFromUniforms(u1: number, u2: number, u3: number): Float64Array {
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  const qx = s1 * Math.sin(TAU * u2), qy = s1 * Math.cos(TAU * u2);
  const qz = s2 * Math.sin(TAU * u3), qw = s2 * Math.cos(TAU * u3);
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return new Float64Array([
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]);
}

/**
 * A divergence-free helical flow field, evaluatable at any point (grid-free) as an analytic sum
 * of Beltrami modes. Construct via {@link create}.
 */
export class HelixField implements Field, ModeData {
  params: Field["params"];
  N!: number;
  kx!: Float64Array; ky!: Float64Array; kz!: Float64Array;
  km!: Float64Array; a!: Float64Array; s!: Float64Array; ph!: Float64Array;
  /** Per-mode phase rate (rad per unit time): eddy churn + coherent sweep. */
  om!: Float64Array;
  e1x!: Float64Array; e1y!: Float64Array; e1z!: Float64Array;
  e2x!: Float64Array; e2y!: Float64Array; e2z!: Float64Array;
  /** Per-center sweep velocities (coherent structures translate with these). @internal */
  cvx!: Float64Array; cvy!: Float64Array; cvz!: Float64Array;
  /** Viscous decay rate ν (amplitudes ∝ e^(−νk²t)); 0 = none. */
  nu = 0;
  _scale = 1;
  /** Bumped on every rebuild — the wasm backend uses it to re-upload mode data. @internal */
  _buildStamp = 0;
  /** Test/bench escape hatch: set true to force the JS batch kernel. @internal */
  _noWasm = false;
  private _aT: Float64Array | null = null; // decayed-amplitude cache, valid at time _tAmp
  private _tAmp = NaN;
  private _tile: Float64Array | null = null; // batch-sampler accumulator scratch

  constructor(opts?: HelixNoiseOptions) {
    this.params = { ...DEFAULTS };
    if (opts) {
      for (const k of Object.keys(opts) as (keyof HelixNoiseOptions)[]) {
        if ((k in DEFAULTS || k === "spectrum") && opts[k] !== undefined) {
          (this.params as unknown as Record<string, unknown>)[k] = opts[k];
        }
      }
    }
    this._alloc(this.params.modes);
    this._build();
  }

  private _alloc(N: number): void {
    this.N = N;
    this.kx = new Float64Array(N); this.ky = new Float64Array(N); this.kz = new Float64Array(N);
    this.km = new Float64Array(N); this.a = new Float64Array(N); this.s = new Float64Array(N);
    this.ph = new Float64Array(N); this.om = new Float64Array(N);
    this.e1x = new Float64Array(N); this.e1y = new Float64Array(N); this.e1z = new Float64Array(N);
    this.e2x = new Float64Array(N); this.e2y = new Float64Array(N); this.e2z = new Float64Array(N);
  }

  private _build(): void {
    const p = this.params;
    const rng = mulberry32((p.seed >>> 0) || 1);
    const N = this.N;
    const nc = Math.max(1, p.centers | 0);
    const cx = new Float64Array(nc), cy = new Float64Array(nc), cz = new Float64Array(nc);
    for (let m = 0; m < nc; m++) { cx[m] = rng() * TAU; cy[m] = rng() * TAU; cz[m] = rng() * TAU; }
    const fr = [0, 0, 0, 0, 0, 0];
    const lam = Math.min(1, Math.max(0, p.coherence));
    const fib = p.layout !== "random";
    const ci = new Int32Array(N);
    const gam = Math.min(9, Math.max(-0.99, p.anisotropy));
    const an = Math.hypot(p.axis[0], p.axis[1], p.axis[2]) || 1;
    const anx = p.axis[0] / an, any = p.axis[1] / an, anz = p.axis[2] / an;

    // Low-discrepancy layout: a seeded random rotation of the Fibonacci sphere for directions,
    // one jittered wavenumber per stratum, and a random direction ↔ wavenumber pairing (so the
    // spiral's latitude order never correlates with scale).
    let rot: Float64Array | null = null;
    let kms: Float64Array | null = null;
    let perm: Int32Array | null = null;
    if (fib) {
      rot = rotFromUniforms(rng(), rng(), rng());
      kms = new Float64Array(N);
      for (let i = 0; i < N; i++) kms[i] = p.kmin + (p.kmax - p.kmin) * ((i + rng()) / N);
      perm = new Int32Array(N);
      for (let i = 0; i < N; i++) perm[i] = i;
      for (let i = N - 1; i > 0; i--) {
        const j = (rng() * (i + 1)) | 0;
        const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
      }
    }

    for (let j = 0; j < N; j++) {
      let dx: number, dy: number, dz: number, km: number;
      if (fib) {
        const zf = 1 - (2 * j + 1) / N, rf = Math.sqrt(Math.max(0, 1 - zf * zf)), th = j * GA;
        const fx = rf * Math.cos(th), fy = rf * Math.sin(th), fz = zf;
        const R = rot!;
        dx = R[0] * fx + R[1] * fy + R[2] * fz;
        dy = R[3] * fx + R[4] * fy + R[5] * fz;
        dz = R[6] * fx + R[7] * fy + R[8] * fz;
        km = kms![perm![j]];
      } else {
        // layout: "random" — i.i.d. ensemble: independent direction + wavenumber per mode.
        // Not a legacy fallback; the statistically-independent choice (Monte-Carlo / ensemble avg).
        const z = 2 * rng() - 1, th = TAU * rng(), r = Math.sqrt(1 - z * z);
        dx = r * Math.cos(th); dy = r * Math.sin(th); dz = z; // uniform on sphere
        km = p.kmin + (p.kmax - p.kmin) * rng();
      }
      if (gam !== 0) { // stretch the direction along the anisotropy axis, renormalize
        const dn = dx * anx + dy * any + dz * anz;
        dx += gam * dn * anx; dy += gam * dn * any; dz += gam * dn * anz;
        const dm = Math.hypot(dx, dy, dz) || 1;
        dx /= dm; dy /= dm; dz /= dm;
      }
      let kxc = km * dx, kyc = km * dy, kzc = km * dz;
      if (p.tileable) { // snap to integer lattice → exactly periodic
        kxc = Math.round(kxc); kyc = Math.round(kyc); kzc = Math.round(kzc);
        if (kxc === 0 && kyc === 0 && kzc === 0) kxc = 1;
        km = Math.hypot(kxc, kyc, kzc); dx = kxc / km; dy = kyc / km; dz = kzc / km;
      }
      this.kx[j] = kxc; this.ky[j] = kyc; this.kz[j] = kzc; this.km[j] = km;
      frame(dx, dy, dz, fr);
      this.e1x[j] = fr[0]; this.e1y[j] = fr[1]; this.e1z[j] = fr[2];
      this.e2x[j] = fr[3]; this.e2y[j] = fr[4]; this.e2z[j] = fr[5];
      this.s[j] = rng() < (1 + p.helicity) / 2 ? 1 : -1;
      this.a[j] = p.spectrum ? Math.max(0, p.spectrum(km)) : Math.pow(km, -p.slope);
      const phr = TAU * rng();
      const c = (rng() * nc) | 0;
      ci[j] = c;
      const phc = -(kxc * cx[c] + kyc * cy[c] + kzc * cz[c]);
      const bx = (1 - lam) * Math.cos(phr) + lam * Math.cos(phc);
      const by = (1 - lam) * Math.sin(phr) + lam * Math.sin(phc);
      this.ph[j] = Math.atan2(by, bx);
    }

    // Time evolution (all draws AFTER the spatial ones, so the t = 0 field is unchanged by the
    // time knobs). Incoherent part: Kolmogorov eddy-turnover churn ω(k) = ±χ·kmin^⅓·k^⅔ (small
    // scales flicker faster). Coherent part: each mode sweeps with its center's velocity, so at
    // high λ organized structures translate rigidly instead of dissolving.
    const chi = Math.max(0, p.churn);
    this.cvx = new Float64Array(nc); this.cvy = new Float64Array(nc); this.cvz = new Float64Array(nc);
    const sg = chi / Math.sqrt(3); // per-component σ, so E|V|² = χ²
    for (let m = 0; m < nc; m++) { // isotropic Gaussian center velocity (Box–Muller)
      const r1 = Math.sqrt(-2 * Math.log(1 - rng())), a1 = TAU * rng();
      const r2 = Math.sqrt(-2 * Math.log(1 - rng())), a2 = TAU * rng();
      this.cvx[m] = sg * r1 * Math.cos(a1);
      this.cvy[m] = sg * r1 * Math.sin(a1);
      this.cvz[m] = sg * r2 * Math.cos(a2);
    }
    const rate0 = chi * Math.cbrt(Math.max(p.kmin, 1e-9));
    for (let j = 0; j < N; j++) {
      const sgn = rng() < 0.5 ? -1 : 1;
      const c = ci[j];
      this.om[j] =
        (1 - lam) * sgn * rate0 * Math.pow(this.km[j], 2 / 3) -
        lam * (this.kx[j] * this.cvx[c] + this.ky[j] * this.cvy[c] + this.kz[j] * this.cvz[c]);
    }

    this.nu = Math.max(0, p.decay);
    this._tAmp = NaN; // invalidate the decayed-amplitude cache
    this._buildStamp++;
    this._scale = 1;
    this._scale = (p.amplitude || 1) / (this._rms() || 1);
  }

  /** Mode amplitudes at time t: a·e^(−νk²t), cached per t (recomputed once per frame, not per sample). */
  private _amps(t: number): Float64Array {
    if (!(this.nu > 0) || t === 0) return this.a;
    if (t !== this._tAmp || !this._aT || this._aT.length !== this.N) {
      if (!this._aT || this._aT.length !== this.N) this._aT = new Float64Array(this.N);
      const nu = this.nu;
      for (let j = 0; j < this.N; j++) this._aT[j] = this.a[j] * Math.exp(-nu * this.km[j] * this.km[j] * t);
      this._tAmp = t;
    }
    return this._aT;
  }

  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    const N = this.N, sc = this._scale, A = this._amps(t);
    let ux = 0, uy = 0, uz = 0, wx = 0, wy = 0, wz = 0;
    for (let j = 0; j < N; j++) {
      const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + this.ph[j] + this.om[j] * t;
      const c = Math.cos(phi), sn = Math.sin(phi), s = this.s[j], a = A[j];
      const tx = a * (c * this.e1x[j] - s * sn * this.e2x[j]);
      const ty = a * (c * this.e1y[j] - s * sn * this.e2y[j]);
      const tz = a * (c * this.e1z[j] - s * sn * this.e2z[j]);
      ux += tx; uy += ty; uz += tz;
      const g = s * this.km[j];
      wx += g * tx; wy += g * ty; wz += g * tz;
    }
    out6[0] = ux * sc; out6[1] = uy * sc; out6[2] = uz * sc;
    out6[3] = wx * sc; out6[4] = wy * sc; out6[5] = wz * sc;
    return out6;
  }

  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    const N = this.N, sc = this._scale, A = this._amps(t);
    let ux = 0, uy = 0, uz = 0, ax = 0, ay = 0, az = 0;
    for (let j = 0; j < N; j++) {
      const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + this.ph[j] + this.om[j] * t;
      const c = Math.cos(phi), sn = Math.sin(phi), s = this.s[j], a = A[j];
      const tx = a * (c * this.e1x[j] - s * sn * this.e2x[j]);
      const ty = a * (c * this.e1y[j] - s * sn * this.e2y[j]);
      const tz = a * (c * this.e1z[j] - s * sn * this.e2z[j]);
      ux += tx; uy += ty; uz += tz;
      const g = s / this.km[j]; // A_j = u_j / (s·k) = (s/k)·u_j — exact vector potential per mode
      ax += g * tx; ay += g * ty; az += g * tz;
    }
    out6[0] = ux * sc; out6[1] = uy * sc; out6[2] = uz * sc;
    out6[3] = ax * sc; out6[4] = ay * sc; out6[5] = az * sc;
    return out6;
  }

  sample(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUW(x, y, z, _tmp6, t);
    return [_tmp6[0], _tmp6[1], _tmp6[2]];
  }

  vorticity(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUW(x, y, z, _tmp6, t);
    return [_tmp6[3], _tmp6[4], _tmp6[5]];
  }

  helicityDensity(x: number, y: number, z: number, t = 0): number {
    this.sampleUW(x, y, z, _tmp6, t);
    return _tmp6[0] * _tmp6[3] + _tmp6[1] * _tmp6[4] + _tmp6[2] * _tmp6[5];
  }

  potential(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUA(x, y, z, _tmp6, t);
    return [_tmp6[3], _tmp6[4], _tmp6[5]];
  }

  withBoundary(sdf: Sdf, opts?: BoundaryOptions): BoundedField {
    return new BoundedFieldImpl(this, sdf, opts);
  }

  sampleMany<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t = 0): T {
    const o = (out ?? new Float64Array(pos.length)) as T;
    this._many(pos, o, t, false);
    return o;
  }

  sampleManyUW<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t = 0): T {
    const o = (out ?? new Float64Array(2 * pos.length)) as T;
    this._many(pos, o, t, true);
    return o;
  }

  /**
   * Batch kernel: mode-major and tiled. Each mode's constants stay in registers while a tile of
   * points streams through L1; accumulation is in f64 scratch regardless of `out`'s type.
   */
  private _many(pos: ArrayLike<number>, out: Out6, t: number, uw: boolean): void {
    const n = (pos.length / 3) | 0;
    const st = uw ? 6 : 3;
    if (out.length < st * n) throw new Error(`helix-noise: out needs ${st * n} floats, got ${out.length}`);
    const N = this.N, sc = this._scale, A = this._amps(t);
    if (!this._noWasm && n >= 64 && runWasm(this, A, pos, out, t, uw, sc)) return;
    if (!this._tile) this._tile = new Float64Array(TILE * 6);
    const acc = this._tile;
    for (let i0 = 0; i0 < n; i0 += TILE) {
      const m = Math.min(TILE, n - i0);
      acc.fill(0, 0, st * m);
      for (let j = 0; j < N; j++) {
        const kx = this.kx[j], ky = this.ky[j], kz = this.kz[j];
        // Keep the exact + association of the scalar path (… + ph, then + om·t), so batch
        // phases are bit-identical to sampleUW even when |k·x| is large.
        const ph = this.ph[j], omt = this.om[j] * t, s = this.s[j], a = A[j];
        // Fold amplitude and helicity sign into the mode's frame once per (mode, tile).
        const b1x = a * this.e1x[j], b1y = a * this.e1y[j], b1z = a * this.e1z[j];
        const as = a * s;
        const b2x = as * this.e2x[j], b2y = as * this.e2y[j], b2z = as * this.e2z[j];
        const g = s * this.km[j];
        for (let i = 0; i < m; i++) {
          const q = 3 * (i0 + i);
          const phi = kx * pos[q] + ky * pos[q + 1] + kz * pos[q + 2] + ph + omt;
          let c: number, sn: number;
          if (phi > -PHI_MAX && phi < PHI_MAX) {
            const qn = Math.round(phi * TWO_OVER_PI);
            const r = phi - qn * PIO2_1 - qn * PIO2_2 - qn * PIO2_3;
            const z = r * r;
            const ps = r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
            const pc = 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
            const k = qn & 3, swap = k & 1;
            sn = (1 - (k & 2)) * (ps + swap * (pc - ps));
            c = (1 - ((k + 1) & 2)) * (pc + swap * (ps - pc));
          } else {
            c = Math.cos(phi); sn = Math.sin(phi);
          }
          const tx = c * b1x - sn * b2x;
          const ty = c * b1y - sn * b2y;
          const tz = c * b1z - sn * b2z;
          const w = st * i;
          acc[w] += tx; acc[w + 1] += ty; acc[w + 2] += tz;
          if (uw) { acc[w + 3] += g * tx; acc[w + 4] += g * ty; acc[w + 5] += g * tz; }
        }
      }
      for (let i = 0; i < m; i++) {
        const w = st * i, o = st * (i0 + i);
        out[o] = acc[w] * sc; out[o + 1] = acc[w + 1] * sc; out[o + 2] = acc[w + 2] * sc;
        if (uw) { out[o + 3] = acc[w + 3] * sc; out[o + 4] = acc[w + 4] * sc; out[o + 5] = acc[w + 5] * sc; }
      }
    }
  }

  private _rms(): number {
    const ng = 5, o = [0, 0, 0, 0, 0, 0];
    let s = 0, n = 0;
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      this.sampleUW((i / ng) * TAU, (j / ng) * TAU, (k / ng) * TAU, o);
      s += o[0] * o[0] + o[1] * o[1] + o[2] * o[2]; n++;
    }
    return Math.sqrt(s / n);
  }

  set(opts: HelixNoiseOptions): Field {
    const reAlloc = !!opts && "modes" in opts && opts.modes !== this.params.modes;
    for (const k of Object.keys(opts) as (keyof HelixNoiseOptions)[]) {
      if ((k in DEFAULTS || k === "spectrum") && opts[k] !== undefined) {
        (this.params as unknown as Record<string, unknown>)[k] = opts[k];
      }
    }
    if (reAlloc) this._alloc(this.params.modes);
    this._build();
    return this;
  }

  relativeHelicity(ng = 12): number {
    let H = 0, un = 0, wn = 0;
    const o = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      this.sampleUW((i / ng) * TAU, (j / ng) * TAU, (k / ng) * TAU, o);
      H += o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      un += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      wn += o[3] * o[3] + o[4] * o[4] + o[5] * o[5];
    }
    return H / (Math.sqrt(un * wn) || 1);
  }

  bake3D(n: number, t = 0): Bake3DResult {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      this.sampleUW((x / n) * TAU, (y / n) * TAU, (z / n) * TAU, o, t);
      data[p] = o[0]; data[p + 1] = o[1]; data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }

  bakePotential3D(n: number, t = 0): Bake3DResult {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = (x / n) * TAU, py = (y / n) * TAU, pz = (z / n) * TAU;
      this.sampleUA(px, py, pz, o, t);
      data[p] = o[3]; data[p + 1] = o[4]; data[p + 2] = o[5];
      this.sampleUW(px, py, pz, o, t);
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }

  bake2D(nx: number, ny: number, z = 0, t = 0): Bake2DResult {
    const data = new Float32Array(nx * ny * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      this.sampleUW((i / nx) * TAU, (j / ny) * TAU, z, o, t);
      data[p] = o[0]; data[p + 1] = o[1]; data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, width: nx, height: ny, channels: 4 };
  }

  glsl(opts?: GlslOptions): string {
    return toGLSL(this, opts);
  }
}
