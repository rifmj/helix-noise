import { DEFAULTS, PHI, POLAR_DEG_MAX, POLAR_SALT, TAU } from "./constants";
import { mulberry32 } from "./rng";
import { toGLSL } from "./glsl";
import { BoundedFieldImpl } from "./boundary";
import { runWasm } from "./wasm";
import { lambda2FromGrad, qFromGrad, stretchFromGrad } from "./diagnostics";
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
const _tmp9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * An explicit, RNG-free mode table for closed-form preset fields (e.g. `abc()`).
 * `e1`/`e2` are always recomputed with the engine's own `frame()`. @internal
 */
export interface DirectModes {
  k: [number, number, number][];
  s: number[];
  a: number[];
  ph: number[];
  scale: number;
}

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
  /** Per-mode chirality χ = ellipticity·s ∈ [−1,1]: ±1 circular (Beltrami), 0 linear. */
  chi!: Float64Array;
  /** Per-mode phase rate (rad per unit time): eddy churn + coherent sweep. */
  om!: Float64Array;
  e1x!: Float64Array; e1y!: Float64Array; e1z!: Float64Array;
  e2x!: Float64Array; e2y!: Float64Array; e2z!: Float64Array;
  /** Per-center sweep velocities (coherent structures translate with these). @internal */
  cvx!: Float64Array; cvy!: Float64Array; cvz!: Float64Array;
  /** Viscous decay rate ν (amplitudes ∝ e^(−νk²t)); 0 = none. */
  nu = 0;
  _scale = 1;
  /**
   * True when every mode is fully circular (ellipticity === 1). Gates the legacy Beltrami
   * shortcut `w = (s·κ)·u_j`, which is algebraically equal to the general two-term curl but
   * rounds differently — the parity fixture pins the shortcut's bits. @internal
   */
  _beltrami = true;
  /** True when the grain-axis channel folded a general transverse amplitude into the frame. */
  _general = false;
  /** Curl frame for general modes: w = A·(cos φ·w1 − sin φ·w2). Allocated only when needed. */
  w1x?: Float64Array; w1y?: Float64Array; w1z?: Float64Array;
  w2x?: Float64Array; w2y?: Float64Array; w2z?: Float64Array;
  /** Flutter amplitude (radians of phase wobble); 0 = off. @internal */
  _flutter = 0;
  /** Per-mode flutter rate — an irrational multiple of the churn rate. @internal */
  _omf?: Float64Array;
  private _phT: Float64Array | null = null; // flutter-shifted phase cache, valid at time _tPh
  private _tPh = NaN;
  /** Bumped on every rebuild — the wasm backend uses it to re-upload mode data. @internal */
  _buildStamp = 0;
  /** Test/bench escape hatch: set true to force the JS batch kernel. @internal */
  _noWasm = false;
  private _aT: Float64Array | null = null; // decayed-amplitude cache, valid at time _tAmp
  private _tAmp = NaN;
  private _tile: Float64Array | null = null; // batch-sampler accumulator scratch

  /**
   * Set when the modes come from a closed-form preset instead of the RNG (see
   * {@link DirectModes}); `set()` refuses to regenerate such a field. @internal
   */
  _fixed = false;

  constructor(opts?: HelixNoiseOptions, direct?: DirectModes) {
    this.params = { ...DEFAULTS };
    if (opts) {
      for (const k of Object.keys(opts) as (keyof HelixNoiseOptions)[]) {
        if ((k in DEFAULTS || k === "spectrum") && opts[k] !== undefined) {
          (this.params as unknown as Record<string, unknown>)[k] = opts[k];
        }
      }
    }
    if (direct) {
      this._installDirect(direct);
      return;
    }
    this._alloc(this.params.modes);
    this._build();
  }

  /** Install an explicit, closed-form mode table (no RNG draws at all). @internal */
  private _installDirect(d: DirectModes): void {
    const N = d.k.length;
    this.params.modes = N;
    this._alloc(N);
    const fr = [0, 0, 0, 0, 0, 0];
    for (let j = 0; j < N; j++) {
      const [kx, ky, kz] = d.k[j];
      const km = Math.hypot(kx, ky, kz);
      this.kx[j] = kx; this.ky[j] = ky; this.kz[j] = kz; this.km[j] = km;
      frame(kx / km, ky / km, kz / km, fr); // the engine's own frame — never a hand-written one
      this.e1x[j] = fr[0]; this.e1y[j] = fr[1]; this.e1z[j] = fr[2];
      this.e2x[j] = fr[3]; this.e2y[j] = fr[4]; this.e2z[j] = fr[5];
      this.s[j] = d.s[j];
      this.chi[j] = d.s[j];
      this.a[j] = d.a[j];
      this.ph[j] = d.ph[j];
      this.om[j] = 0; // steady preset fields
    }
    const nc = Math.max(1, this.params.centers | 0);
    this.cvx = new Float64Array(nc); this.cvy = new Float64Array(nc); this.cvz = new Float64Array(nc);
    this.nu = Math.max(0, this.params.decay);
    this._beltrami = true;
    this._tAmp = NaN;
    this._buildStamp++;
    this._scale = d.scale;
    this._fixed = true;
  }

  private _alloc(N: number): void {
    this.N = N;
    this.kx = new Float64Array(N); this.ky = new Float64Array(N); this.kz = new Float64Array(N);
    this.km = new Float64Array(N); this.a = new Float64Array(N); this.s = new Float64Array(N);
    this.chi = new Float64Array(N);
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
    // coherence / helicity accept either a scalar or a pure per-wavenumber callable. Neither
    // ever gates an rng() call — they only feed arithmetic and a comparison threshold — so the
    // draw sequence is identical either way, and the scalar path keeps its exact expression tree.
    const cohFn = typeof p.coherence === "function" ? p.coherence : null;
    const helFn = typeof p.helicity === "function" ? p.helicity : null;
    const helVal = helFn ? 0 : (p.helicity as number);
    const lam = cohFn ? 0 : Math.min(1, Math.max(0, p.coherence as number));
    // Per-mode λ has to survive into the (later) time-evolution loop.
    const lamArr = cohFn ? new Float64Array(N) : null;
    const fib = p.layout !== "random";
    const ci = new Int32Array(N);
    const gam = Math.min(9, Math.max(-0.99, p.anisotropy));
    // Polarization ellipticity: chi_j = eps*s_j. Draw-free (a post-transform of the sign), so the
    // whole RNG sequence is identical for every eps; eps = 1 keeps the legacy Beltrami code path.
    const eps = Math.min(1, Math.max(0, p.ellipticity));
    this._beltrami = eps === 1;
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
      this.s[j] = rng() < (1 + (helFn ? helFn(km) : helVal)) / 2 ? 1 : -1;
      this.chi[j] = eps * this.s[j];
      this.a[j] = p.spectrum ? Math.max(0, p.spectrum(km)) : Math.pow(km, -p.slope);
      const phr = TAU * rng();
      const c = (rng() * nc) | 0;
      ci[j] = c;
      const phc = -(kxc * cx[c] + kyc * cy[c] + kzc * cz[c]);
      // Additive phase interpolation (helical-fields Eq. 9): the structured center
      // reference stays at full weight while the random part fades as λ→1.
      // ph = φc + (1−λ)·φr — uniform-random at λ=0, locked to the reference at λ=1,
      // and well-defined for every λ (no λ=½ antipodal singularity of the earlier
      // complex-plane "chord" blend). |a_j| is untouched, so the energy spectrum and
      // helicity bias are frozen at every λ; only the phase moves.
      const lamJ = cohFn ? Math.min(1, Math.max(0, cohFn(km))) : lam;
      if (lamArr) lamArr[j] = lamJ;
      this.ph[j] = phc + (1 - lamJ) * phr;
    }

    // Time evolution (all draws AFTER the spatial ones, so the t = 0 field is unchanged by the
    // time knobs). Incoherent part: Kolmogorov eddy-turnover churn ω(k) = ±χ·kmin^⅓·k^⅔ (small
    // scales flicker faster). Coherent part: each mode sweeps with its center's velocity, so at
    // high λ organized structures translate rigidly instead of dissolving.
    const churnRate = Math.max(0, p.churn);
    this.cvx = new Float64Array(nc); this.cvy = new Float64Array(nc); this.cvz = new Float64Array(nc);
    const sg = churnRate / Math.sqrt(3); // per-component σ, so E|V|² = churnRate²
    for (let m = 0; m < nc; m++) { // isotropic Gaussian center velocity (Box–Muller)
      const r1 = Math.sqrt(-2 * Math.log(1 - rng())), a1 = TAU * rng();
      const r2 = Math.sqrt(-2 * Math.log(1 - rng())), a2 = TAU * rng();
      this.cvx[m] = sg * r1 * Math.cos(a1);
      this.cvy[m] = sg * r1 * Math.sin(a1);
      this.cvz[m] = sg * r2 * Math.cos(a2);
    }
    const rate0 = churnRate * Math.cbrt(Math.max(p.kmin, 1e-9));
    for (let j = 0; j < N; j++) {
      const sgn = rng() < 0.5 ? -1 : 1;
      const c = ci[j];
      const lamJ = lamArr ? lamArr[j] : lam;
      this.om[j] =
        (1 - lamJ) * sgn * rate0 * Math.pow(this.km[j], 2 / 3) -
        lamJ * (this.kx[j] * this.cvx[c] + this.ky[j] * this.cvy[c] + this.kz[j] * this.cvz[c]);
    }

    // Flutter: a fast second harmonic on each phase. Its rate is the finest scale's eddy rate
    // times the golden ratio, so it is both faster than any mode's own drift and incommensurate
    // with it — the wobble never collapses into a global pulse.
    this._flutter = Math.max(0, p.flutter);
    if (this._flutter > 0) {
      if (!this._omf || this._omf.length !== N) this._omf = new Float64Array(N);
      const base = PHI * rate0 * Math.pow(Math.max(p.kmax, p.kmin), 2 / 3);
      for (let j = 0; j < N; j++) this._omf[j] = base * (1 + 0.25 * Math.cos(this.ph[j]));
    }
    this._tPh = NaN;

    this.nu = Math.max(0, p.decay);
    this._polarize(); // grain-axis channel (no-op unless polarizationAxis is set)
    this._tAmp = NaN; // invalidate the decayed-amplitude cache
    this._buildStamp++;
    this._scale = 1;
    this._scale = (p.amplitude || 1) / (this._rms() || 1);
  }

  /**
   * Linear-polarization ("grain axis") post-pass. Each mode's circular amplitude is replaced by a
   * Gaussian sample with the requested 2×2 transverse covariance `J = I + d·R(2ψ) + χ·N`, drawn
   * from a **second, independent** RNG stream — so every draw of the main build above happens in
   * the same order with the same use, and a field with the channel off is bit-identical to one
   * built before the channel existed.
   *
   * The sampled amplitude is folded straight into the stored frame (`e1`, `e2` stop being
   * orthonormal, `s` becomes 1), which leaves the velocity formula untouched; only the curl and
   * potential need the general cross-product form, precomputed here as `w1`/`w2`.
   */
  private _polarize(): void {
    const p = this.params;
    const ax = p.polarizationAxis;
    this._general = false;
    if (!ax) return;

    const an = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const nx = ax[0] / an, ny = ax[1] / an, nz = ax[2] / an;
    const d0 = Math.min(0.95, Math.max(0, p.polarizationBias));
    // Second stream: an additive salt puts it ~6·10⁸ draws down the same mulberry32 orbit, far
    // beyond any build's consumption, so the two streams never overlap.
    const seedEff = (p.seed >>> 0) || 1;
    const rng2 = mulberry32(((seedEff + POLAR_SALT) >>> 0) || 1);
    const N = this.N;
    this._allocGeneral(N);

    for (let j = 0; j < N; j++) {
      // Two complex standard normals (E|z|² = 1) — note there is no factor 2 under the sqrt,
      // unlike the real Box–Muller above: each real component must be N(0, ½).
      const r1 = Math.sqrt(-Math.log(1 - rng2())), t1 = TAU * rng2();
      const z1r = r1 * Math.cos(t1), z1i = r1 * Math.sin(t1);
      const r2 = Math.sqrt(-Math.log(1 - rng2())), t2 = TAU * rng2();
      const z2r = r2 * Math.cos(t2), z2i = r2 * Math.sin(t2);

      const km = this.km[j];
      const dx = this.kx[j] / km, dy = this.ky[j] / km, dz = this.kz[j] / km;
      const e1x = this.e1x[j], e1y = this.e1y[j], e1z = this.e1z[j];
      const e2x = this.e2x[j], e2y = this.e2y[j], e2z = this.e2z[j];

      // Project the world grain axis into this mode's transverse plane; ψ is its frame angle.
      const ndk = nx * dx + ny * dy + nz * dz;
      let tx = nx - ndk * dx, ty = ny - ndk * dy, tz = nz - ndk * dz;
      const tl = Math.hypot(tx, ty, tz);
      let c2 = 1, s2 = 0;
      if (tl > 1e-6) {
        tx /= tl; ty /= tl; tz /= tl;
        const ct = tx * e1x + ty * e1y + tz * e1z;
        const st = tx * e2x + ty * e2y + tz * e2z;
        const psi = Math.atan2(st, ct);
        c2 = Math.cos(2 * psi); s2 = Math.sin(2 * psi);
      } // else k ∥ axis: the grain direction is undefined there, fall back to the mode's own e1

      // Covariance + its Cholesky factor. The degree ball is the PSD condition, not a fudge:
      // circular and linear polarization genuinely compete for the same budget.
      let dd = d0, pp = this.chi[j];
      const deg = Math.hypot(dd, pp);
      if (deg > POLAR_DEG_MAX) { const f = POLAR_DEG_MAX / deg; dd *= f; pp *= f; }
      const J11 = 1 + dd * c2, J22 = 1 - dd * c2;
      const J21r = dd * s2, J21i = pp;
      const L11 = Math.sqrt(Math.max(J11, 1e-12));
      const L21r = J21r / L11, L21i = J21i / L11;
      const L22 = Math.sqrt(Math.max(J22 - (J21r * J21r + J21i * J21i) / J11, 0));

      // α = L·z, then fold the complex amplitude into the frame: u = Re[(α₁e1 + α₂e2)·e^{iφ}]
      const a1r = L11 * z1r, a1i = L11 * z1i;
      const a2r = L21r * z1r - L21i * z1i + L22 * z2r;
      const a2i = L21r * z1i + L21i * z1r + L22 * z2i;
      const f1x = a1r * e1x + a2r * e2x, f1y = a1r * e1y + a2r * e2y, f1z = a1r * e1z + a2r * e2z;
      const f2x = a1i * e1x + a2i * e2x, f2y = a1i * e1y + a2i * e2y, f2z = a1i * e1z + a2i * e2z;
      this.e1x[j] = f1x; this.e1y[j] = f1y; this.e1z[j] = f1z;
      this.e2x[j] = f2x; this.e2y[j] = f2y; this.e2z[j] = f2z;
      this.s[j] = 1; this.chi[j] = 1;

      // Curl frame: w = A(c·w1 − sn·w2) with w1 = −k×e2′, w2 = k×e1′.
      const kx = this.kx[j], ky = this.ky[j], kz = this.kz[j];
      this.w1x![j] = -(ky * f2z - kz * f2y);
      this.w1y![j] = -(kz * f2x - kx * f2z);
      this.w1z![j] = -(kx * f2y - ky * f2x);
      this.w2x![j] = ky * f1z - kz * f1y;
      this.w2y![j] = kz * f1x - kx * f1z;
      this.w2z![j] = kx * f1y - ky * f1x;
    }
    this._beltrami = false;
    this._general = true;
  }

  private _allocGeneral(N: number): void {
    if (this.w1x && this.w1x.length === N) return;
    this.w1x = new Float64Array(N); this.w1y = new Float64Array(N); this.w1z = new Float64Array(N);
    this.w2x = new Float64Array(N); this.w2y = new Float64Array(N); this.w2z = new Float64Array(N);
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

  /**
   * Per-mode phases at time t: `ph` plus the flutter harmonic, which is written as
   * `sin(ω_f t + ph) − sin(ph)` so it is exactly zero at `t = 0`. Cached per t, like the
   * decayed amplitudes — recomputed once a frame, not once a sample.
   */
  private _phases(t: number): Float64Array {
    if (!(this._flutter > 0) || t === 0) return this.ph;
    if (t !== this._tPh || !this._phT || this._phT.length !== this.N) {
      if (!this._phT || this._phT.length !== this.N) this._phT = new Float64Array(this.N);
      const f = this._flutter, omf = this._omf!;
      for (let j = 0; j < this.N; j++) {
        const p0 = this.ph[j];
        this._phT[j] = p0 + f * (Math.sin(omf[j] * t + p0) - Math.sin(p0));
      }
      this._tPh = t;
    }
    return this._phT;
  }

  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    const N = this.N, sc = this._scale, A = this._amps(t), PH = this._phases(t);
    let ux = 0, uy = 0, uz = 0, wx = 0, wy = 0, wz = 0;
    if (this._beltrami) {
      for (let j = 0; j < N; j++) {
        const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + PH[j] + this.om[j] * t;
        const c = Math.cos(phi), sn = Math.sin(phi), s = this.s[j], a = A[j];
        const tx = a * (c * this.e1x[j] - s * sn * this.e2x[j]);
        const ty = a * (c * this.e1y[j] - s * sn * this.e2y[j]);
        const tz = a * (c * this.e1z[j] - s * sn * this.e2z[j]);
        ux += tx; uy += ty; uz += tz;
        const g = s * this.km[j];
        wx += g * tx; wy += g * ty; wz += g * tz;
      }
    } else if (this._general) {
      // Grain-axis modes: the frame is folded and no longer orthonormal, so the curl comes from
      // the precomputed cross-product frame w1 = −k×e2, w2 = k×e1.
      const w1x = this.w1x!, w1y = this.w1y!, w1z = this.w1z!;
      const w2x = this.w2x!, w2y = this.w2y!, w2z = this.w2z!;
      for (let j = 0; j < N; j++) {
        const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + PH[j] + this.om[j] * t;
        const c = Math.cos(phi), sn = Math.sin(phi), a = A[j];
        ux += a * (c * this.e1x[j] - sn * this.e2x[j]);
        uy += a * (c * this.e1y[j] - sn * this.e2y[j]);
        uz += a * (c * this.e1z[j] - sn * this.e2z[j]);
        wx += a * (c * w1x[j] - sn * w2x[j]);
        wy += a * (c * w1y[j] - sn * w2y[j]);
        wz += a * (c * w1z[j] - sn * w2z[j]);
      }
    } else {
      // Elliptic modes: u_j = a(c·e1 − χ·sn·e2), w_j = aκ(χ·c·e1 − sn·e2) — the general two-term
      // curl (the Beltrami shortcut w = sκ·u is only valid at |χ| = 1). Same cos/sin, one extra combine.
      for (let j = 0; j < N; j++) {
        const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + PH[j] + this.om[j] * t;
        const c = Math.cos(phi), sn = Math.sin(phi), xi = this.chi[j], a = A[j];
        const e1x = this.e1x[j], e1y = this.e1y[j], e1z = this.e1z[j];
        const e2x = this.e2x[j], e2y = this.e2y[j], e2z = this.e2z[j];
        const cx = xi * c, sx = xi * sn;
        ux += a * (c * e1x - sx * e2x); uy += a * (c * e1y - sx * e2y); uz += a * (c * e1z - sx * e2z);
        const gk = a * this.km[j];
        wx += gk * (cx * e1x - sn * e2x); wy += gk * (cx * e1y - sn * e2y); wz += gk * (cx * e1z - sn * e2z);
      }
    }
    out6[0] = ux * sc; out6[1] = uy * sc; out6[2] = uz * sc;
    out6[3] = wx * sc; out6[4] = wy * sc; out6[5] = wz * sc;
    return out6;
  }

  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    const N = this.N, sc = this._scale, A = this._amps(t), PH = this._phases(t);
    let ux = 0, uy = 0, uz = 0, ax = 0, ay = 0, az = 0;
    if (this._beltrami) {
      for (let j = 0; j < N; j++) {
        const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + PH[j] + this.om[j] * t;
        const c = Math.cos(phi), sn = Math.sin(phi), s = this.s[j], a = A[j];
        const tx = a * (c * this.e1x[j] - s * sn * this.e2x[j]);
        const ty = a * (c * this.e1y[j] - s * sn * this.e2y[j]);
        const tz = a * (c * this.e1z[j] - s * sn * this.e2z[j]);
        ux += tx; uy += ty; uz += tz;
        const g = s / this.km[j]; // A_j = u_j / (s·k) = (s/k)·u_j — exact vector potential per mode
        ax += g * tx; ay += g * ty; az += g * tz;
      }
    } else if (this._general) {
      // A_j = w_j/κ² with the same cross-product curl frame.
      const w1x = this.w1x!, w1y = this.w1y!, w1z = this.w1z!;
      const w2x = this.w2x!, w2y = this.w2y!, w2z = this.w2z!;
      for (let j = 0; j < N; j++) {
        const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + PH[j] + this.om[j] * t;
        const c = Math.cos(phi), sn = Math.sin(phi), a = A[j];
        ux += a * (c * this.e1x[j] - sn * this.e2x[j]);
        uy += a * (c * this.e1y[j] - sn * this.e2y[j]);
        uz += a * (c * this.e1z[j] - sn * this.e2z[j]);
        const ga = a / (this.km[j] * this.km[j]);
        ax += ga * (c * w1x[j] - sn * w2x[j]);
        ay += ga * (c * w1y[j] - sn * w2y[j]);
        az += ga * (c * w1z[j] - sn * w2z[j]);
      }
    } else {
      // A_j = w_j/κ² = (a/κ)(χ·c·e1 − sn·e2) — same Coulomb gauge, ∇×A_j = u_j for every χ.
      for (let j = 0; j < N; j++) {
        const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + PH[j] + this.om[j] * t;
        const c = Math.cos(phi), sn = Math.sin(phi), xi = this.chi[j], a = A[j];
        const e1x = this.e1x[j], e1y = this.e1y[j], e1z = this.e1z[j];
        const e2x = this.e2x[j], e2y = this.e2y[j], e2z = this.e2z[j];
        const cx = xi * c, sx = xi * sn;
        ux += a * (c * e1x - sx * e2x); uy += a * (c * e1y - sx * e2y); uz += a * (c * e1z - sx * e2z);
        const ga = a / this.km[j];
        ax += ga * (cx * e1x - sn * e2x); ay += ga * (cx * e1y - sn * e2y); az += ga * (cx * e1z - sn * e2z);
      }
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
    const N = this.N, sc = this._scale, A = this._amps(t), PHA = this._phases(t);
    if (!this._noWasm && n >= 64 && runWasm(this, A, PHA, pos, out, t, uw, sc)) return;
    if (!this._tile) this._tile = new Float64Array(TILE * 6);
    const acc = this._tile;
    const bel = this._beltrami;
    for (let i0 = 0; i0 < n; i0 += TILE) {
      const m = Math.min(TILE, n - i0);
      acc.fill(0, 0, st * m);
      for (let j = 0; j < N; j++) {
        const kx = this.kx[j], ky = this.ky[j], kz = this.kz[j];
        // Keep the exact + association of the scalar path (… + ph, then + om·t), so batch
        // phases are bit-identical to sampleUW even when |k·x| is large.
        const ph = PHA[j], omt = this.om[j] * t, s = this.s[j], a = A[j];
        // Fold amplitude and chirality into the mode's frame once per (mode, tile). At ε = 1
        // (χ = s) this reproduces the legacy fold exactly.
        const b1x = a * this.e1x[j], b1y = a * this.e1y[j], b1z = a * this.e1z[j];
        const as = bel ? a * s : a * this.chi[j];
        const b2x = as * this.e2x[j], b2y = as * this.e2y[j], b2z = as * this.e2z[j];
        const g = s * this.km[j];
        // Vorticity fold for the non-Beltrami paths. Grain-axis modes use the precomputed
        // cross-product frame; elliptic modes the two-term χ form w_j = aκ(χ·c·e1 − sn·e2).
        const gen = this._general;
        const ak = a * this.km[j], akx = ak * this.chi[j];
        const c1x = gen ? a * this.w1x![j] : akx * this.e1x[j];
        const c1y = gen ? a * this.w1y![j] : akx * this.e1y[j];
        const c1z = gen ? a * this.w1z![j] : akx * this.e1z[j];
        const c2x = gen ? a * this.w2x![j] : ak * this.e2x[j];
        const c2y = gen ? a * this.w2y![j] : ak * this.e2y[j];
        const c2z = gen ? a * this.w2z![j] : ak * this.e2z[j];
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
          if (uw) {
            if (bel) { acc[w + 3] += g * tx; acc[w + 4] += g * ty; acc[w + 5] += g * tz; }
            else {
              acc[w + 3] += c * c1x - sn * c2x;
              acc[w + 4] += c * c1y - sn * c2y;
              acc[w + 5] += c * c1z - sn * c2z;
            }
          }
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
    if (this._fixed) throw new Error("helix-noise: this is a closed-form preset field — build a new one instead of set()");
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

  /**
   * Relative helicity computed straight from the mode arrays, with no grid at all.
   *
   * Writing each mode as `u_j = Re[v_j e^(iφ)]` with `v_j = a_j(e1 + i·e2)` (the same complex
   * amplitude the samplers use), the space averages are exact sums:
   * `⟨|u|²⟩ = ½Σ|v|²`, `⟨|ω|²⟩ = ½Σ|k×v|²`, `⟨u·ω⟩ = ½ΣRe[v̄·(i k×v)]`.
   *
   * This is the infinite-volume value — {@link relativeHelicity} differs from it only by the
   * cross-mode terms a finite grid fails to cancel. For a single mode it is exactly `2χ/(1+χ²)`,
   * and under viscous decay it is constant in time when all modes share one `|k|`.
   */
  /**
   * Velocity gradient `∂u_n/∂x_m`, analytically — no finite differences. Written row-major into
   * `out9` as `[∂u/∂x, ∂v/∂x, ∂w/∂x, ∂u/∂y, …]`, i.e. `out9[3m + n] = ∂u_n/∂x_m`.
   *
   * This is what the rendering diagnostics are built from: {@link qCriterion} finds vortex cores,
   * {@link lambda2} finds them the other standard way, and {@link stretching} says whether a
   * vortex is being spun up or torn apart. Colour particles by any of them.
   */
  sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, t = 0): T {
    if (out9.length < 9) throw new Error("helix-noise: sampleGrad needs 9 floats");
    const N = this.N, sc = this._scale, A = this._amps(t), PH = this._phases(t);
    for (let i = 0; i < 9; i++) out9[i] = 0;
    const gen = this._general;
    for (let j = 0; j < N; j++) {
      const kx = this.kx[j], ky = this.ky[j], kz = this.kz[j];
      const phi = kx * x + ky * y + kz * z + PH[j] + this.om[j] * t;
      const c = Math.cos(phi), sn = Math.sin(phi), a = A[j];
      // ∂_m u_n = a·k_m·(−sin φ·e1'_n − cos φ·e2'_n), with e2' = χ·e2 for circular/elliptic modes.
      const chi = gen ? 1 : this.chi[j];
      const bx = -a * (sn * this.e1x[j] + c * chi * this.e2x[j]);
      const by = -a * (sn * this.e1y[j] + c * chi * this.e2y[j]);
      const bz = -a * (sn * this.e1z[j] + c * chi * this.e2z[j]);
      out9[0] += kx * bx; out9[1] += kx * by; out9[2] += kx * bz;
      out9[3] += ky * bx; out9[4] += ky * by; out9[5] += ky * bz;
      out9[6] += kz * bx; out9[7] += kz * by; out9[8] += kz * bz;
    }
    for (let i = 0; i < 9; i++) out9[i] *= sc;
    return out9;
  }

  /**
   * The **Q-criterion**: `Q = ½(|Ω|² − |S|²)`, rotation minus strain. Positive inside vortex
   * cores, negative in shear layers — the standard way to pick filaments out of a flow, and the
   * cheapest good thing to colour particles by.
   */
  qCriterion(x: number, y: number, z: number, t = 0): number {
    return qFromGrad(this.sampleGrad(x, y, z, _tmp9, t));
  }

  /**
   * The **λ₂ criterion**: the middle eigenvalue of `S² + Ω²`. Negative inside a vortex core.
   * Stricter than {@link qCriterion} — it ignores swirl that is really just shear.
   */
  lambda2(x: number, y: number, z: number, t = 0): number {
    return lambda2FromGrad(this.sampleGrad(x, y, z, _tmp9, t));
  }

  /**
   * Vortex **stretching** `ξ̂·S·ξ̂`: the strain felt along the local vorticity direction.
   * Positive means the vortex is being spun up (stretched), negative means it is being squashed.
   * Zero where there is no vorticity to speak of.
   */
  stretching(x: number, y: number, z: number, t = 0): number {
    this.sampleUW(x, y, z, _tmp6, t);
    return stretchFromGrad(this.sampleGrad(x, y, z, _tmp9, t), _tmp6[3], _tmp6[4], _tmp6[5]);
  }


  relativeHelicitySpectral(t = 0): number {
    let H = 0, E = 0, Z = 0;
    const gen = this._general;
    for (let j = 0; j < this.N; j++) {
      const km = this.km[j], k2 = km * km;
      const a = this.a[j];
      const m = a * a * (this.nu > 0 && t !== 0 ? Math.exp(-2 * this.nu * k2 * t) : 1);
      // The velocity amplitude vector is v = a(e1' + i·e2'). For elliptic modes e2' = χ·e2,
      // for grain-axis modes the folded frame already *is* (e1', e2').
      let e1x = this.e1x[j], e1y = this.e1y[j], e1z = this.e1z[j];
      let e2x = this.e2x[j], e2y = this.e2y[j], e2z = this.e2z[j];
      // Curl frame: w1 = −k×e2', w2 = k×e1'. For circular/elliptic modes that is (χκ·e1, κ·e2).
      let w1x: number, w1y: number, w1z: number, w2x: number, w2y: number, w2z: number;
      if (gen) {
        w1x = this.w1x![j]; w1y = this.w1y![j]; w1z = this.w1z![j];
        w2x = this.w2x![j]; w2y = this.w2y![j]; w2z = this.w2z![j];
      } else {
        const chi = this.chi[j], ck = chi * km;
        w1x = ck * e1x; w1y = ck * e1y; w1z = ck * e1z;
        w2x = km * e2x; w2y = km * e2y; w2z = km * e2z;
        e2x *= chi; e2y *= chi; e2z *= chi;
      }
      E += 0.5 * m * (e1x * e1x + e1y * e1y + e1z * e1z + e2x * e2x + e2y * e2y + e2z * e2z);
      Z += 0.5 * m * (w1x * w1x + w1y * w1y + w1z * w1z + w2x * w2x + w2y * w2y + w2z * w2z);
      H += 0.5 * m * (e1x * w1x + e1y * w1y + e1z * w1z + e2x * w2x + e2y * w2y + e2z * w2z);
    }
    return H / (Math.sqrt(E * Z) || 1);
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
