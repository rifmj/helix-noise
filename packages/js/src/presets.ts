import { HelixField } from "./field";
import type {
  HelixNoiseOptions,
  Bake2DResult,
  Bake3DResult,
  BoundaryOptions,
  BoundedField,
  Field,
  FlowField,
  Out6,
  ScaleFn,
  Sdf,
  Vec3,
} from "./types";
import { BoundedFieldImpl } from "./boundary";
import { lambda2FromGrad, qFromGrad, stretchFromGrad } from "./diagnostics";

/**
 * Ready-made shapes for the per-wavenumber dials (`spectrum`, `coherence`, `helicity`) plus two
 * field factories. Everything here is a pure function of `|k|` or a closed form — no RNG, so
 * mixing presets in never disturbs a field's mode layout.
 */

/**
 * Spectrum preset: a Gaussian shell bump `a(k) = exp(−(k−kPeak)²/(2·width²))` — an
 * energy-containing band instead of a power law. Pair it with `kmin ≈ kPeak − 3·width` and
 * `kmax ≈ kPeak + 3·width` so the discarded tails stay near 1%.
 *
 * ```js
 * create({ spectrum: shellPeak(3), kmin: 1, kmax: 6 });
 * ```
 */
export function shellPeak(kPeak: number, width = 1): ScaleFn {
  const w = Math.abs(width) || 1;
  return (k: number): number => Math.exp((-(k - kPeak) * (k - kPeak)) / (2 * w * w));
}

/**
 * Coherence preset: `λ(k) = clamp(1 − k/kc, 0, 1)` — organized structure at large scales,
 * fading to uncorrelated noise above the cutoff `kc`. The "rollers carrying fine grain" look.
 */
export function rolloff(kc: number): ScaleFn {
  return (k: number): number => Math.min(1, Math.max(0, 1 - k / kc));
}

/**
 * Helicity preset: `p(k) = k <= kSplit ? pLarge : pSmall` — a handed large-scale condensate
 * over a (near-)mirror-symmetric fine-scale background, the polarization profile measured on
 * forced turbulence.
 */
export function condensate(kSplit: number, pLarge: number, pSmall = 0): ScaleFn {
  return (k: number): number => (k <= kSplit ? pLarge : pSmall);
}

/**
 * The classical ABC (Arnold–Beltrami–Childress) cell field
 * `u = (A sin z + C cos y, B sin x + A cos z, C sin y + B cos x)`,
 * built as exactly three modes of the same engine — so `glsl()`, the bakes, `withBoundary`
 * and every sampler work on it unchanged. Consumes no RNG, is exactly 2π-tileable, and is a
 * pure Beltrami field (`∇×u = u`, potential `A = u`).
 *
 * By default this is the *literal* field (its amplitudes mean what they say). Pass
 * `amplitude` to opt into the usual RMS normalization, or `decay: ν` for the exact viscous
 * solution `u(t) = e^(−νt)·u(0)`.
 */
export function abc(A = 1, B = 1, C = 1, opts?: { amplitude?: number; decay?: number }): Field {
  // frame() maps these three directions to the (e1, e2) pairs that make the mode formula
  // a(cos φ·e1 − s·sin φ·e2) reproduce each ABC term; the phases below place sin/cos.
  const HALF_PI = Math.PI / 2;
  // Closed-form RMS: the 5³ grid mean of |u|² is exactly (A²+B²+C²) in exact arithmetic, so
  // never route this through rms() — float summation order would move it by ~1 ulp.
  const rms = Math.sqrt(A * A + B * B + C * C);
  const amp = opts?.amplitude;
  return new HelixField(
    { modes: 3, tileable: true, churn: 0, decay: opts?.decay ?? 0 },
    {
      k: [
        [0, 0, 1],
        [1, 0, 0],
        [0, 1, 0],
      ],
      s: [1, 1, 1],
      a: [A, B, C],
      ph: [-HALF_PI, -HALF_PI, Math.PI],
      scale: amp === undefined ? 1 : amp / (rms || 1),
    }
  );
}

/** Detail-amplitude constant for {@link twoScale}: `amplitude = C_TWO_SCALE / kDetail` holds the
 *  detail layer's vorticity budget fixed as you move its wavenumber. */
export const C_TWO_SCALE = 1.6;

/**
 * The sum of two divergence-free fields — still divergence-free, and its potential is the sum
 * of theirs, so `withBoundary` and the potential bakes keep working.
 *
 * The recipe it exists for: a coherent large-scale backbone plus incoherent broadband detail.
 * Sizing the detail as `amplitude: C_TWO_SCALE / kDetail` keeps its vorticity budget constant
 * while you slide the detail scale.
 *
 * ```js
 * const kD = 8;
 * const detail = create({ spectrum: shellPeak(kD), kmin: kD - 3, kmax: kD + 3,
 *                         amplitude: C_TWO_SCALE / kD, seed: 2 });
 * const storm = twoScale(abc(3, 3, 3), detail);
 * ```
 */
export function twoScale(base: FlowField, detail: FlowField, opts?: { detailGain?: number }): FlowField {
  return new TwoScaleField(base, detail, opts?.detailGain ?? 1);
}

/** Componentwise sum of two flow fields. @internal */
class TwoScaleField implements FlowField {
  /**
   * Per-instance, every one of them. `twoScale` is a sum node exactly as `compose` is, so a part
   * that is itself a `TwoScaleField` would otherwise be handed the same arrays its caller is
   * mid-sum on. Nesting in the `detail` slot is the visible case — the inner call overwrites `_a6`
   * with its own base, so the outer field's base is dropped and the inner one counted twice — while
   * nesting in `base` survives only because that slot happens to be scaled in place. A sum whose
   * correctness depends on which side you nested is not one to leave standing.
   */
  private readonly _a6: number[] = [0, 0, 0, 0, 0, 0];
  private readonly _b6: number[] = [0, 0, 0, 0, 0, 0];
  private readonly _t6: number[] = [0, 0, 0, 0, 0, 0];
  private readonly _a9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  private readonly _b9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  private readonly _g9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  constructor(
    readonly base: FlowField,
    readonly detail: FlowField,
    readonly detailGain: number
  ) {}

  private _sum<T extends Out6>(
    pick: "uw" | "ua",
    x: number,
    y: number,
    z: number,
    out6: T,
    t: number
  ): T {
    const g = this.detailGain;
    if (pick === "uw") {
      this.base.sampleUW(x, y, z, this._a6, t);
      this.detail.sampleUW(x, y, z, this._b6, t);
    } else {
      this.base.sampleUA(x, y, z, this._a6, t);
      this.detail.sampleUA(x, y, z, this._b6, t);
    }
    for (let i = 0; i < 6; i++) out6[i] = this._a6[i] + g * this._b6[i];
    return out6;
  }

  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    return this._sum("uw", x, y, z, out6, t);
  }

  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    return this._sum("ua", x, y, z, out6, t);
  }

  /** Both scales are analytic, so their weighted sum is too. */
  sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, t = 0): T {
    if (out9.length < 9) throw new Error("helix-noise: sampleGrad needs 9 floats");
    this.base.sampleGrad(x, y, z, this._a9, t);
    this.detail.sampleGrad(x, y, z, this._b9, t);
    const g = this.detailGain;
    for (let i = 0; i < 9; i++) out9[i] = this._a9[i] + g * this._b9[i];
    return out9;
  }

  qCriterion(x: number, y: number, z: number, t = 0): number {
    return qFromGrad(this.sampleGrad(x, y, z, this._g9, t));
  }

  lambda2(x: number, y: number, z: number, t = 0): number {
    return lambda2FromGrad(this.sampleGrad(x, y, z, this._g9, t));
  }

  stretching(x: number, y: number, z: number, t = 0): number {
    this.sampleUW(x, y, z, this._t6, t);
    return stretchFromGrad(this.sampleGrad(x, y, z, this._g9, t), this._t6[3], this._t6[4], this._t6[5]);
  }

  sample(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUW(x, y, z, this._t6, t);
    return [this._t6[0], this._t6[1], this._t6[2]];
  }

  vorticity(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUW(x, y, z, this._t6, t);
    return [this._t6[3], this._t6[4], this._t6[5]];
  }

  helicityDensity(x: number, y: number, z: number, t = 0): number {
    this.sampleUW(x, y, z, this._t6, t);
    return this._t6[0] * this._t6[3] + this._t6[1] * this._t6[4] + this._t6[2] * this._t6[5];
  }

  potential(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUA(x, y, z, this._t6, t);
    return [this._t6[3], this._t6[4], this._t6[5]];
  }

  withBoundary(sdf: Sdf, opts?: BoundaryOptions): BoundedField {
    return new BoundedFieldImpl(this, sdf, opts);
  }

  bake3D(n: number, t = 0): Bake3DResult {
    const data = new Float32Array(n * n * n * 4);
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      this.sampleUW((x / n) * TAU_, (y / n) * TAU_, (z / n) * TAU_, this._t6, t);
      data[p] = this._t6[0]; data[p + 1] = this._t6[1]; data[p + 2] = this._t6[2];
      data[p + 3] = this._t6[0] * this._t6[3] + this._t6[1] * this._t6[4] + this._t6[2] * this._t6[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }

  bakePotential3D(n: number, t = 0): Bake3DResult {
    const data = new Float32Array(n * n * n * 4);
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = (x / n) * TAU_, py = (y / n) * TAU_, pz = (z / n) * TAU_;
      this.sampleUA(px, py, pz, this._t6, t);
      data[p] = this._t6[3]; data[p + 1] = this._t6[4]; data[p + 2] = this._t6[5];
      this.sampleUW(px, py, pz, this._t6, t);
      data[p + 3] = this._t6[0] * this._t6[3] + this._t6[1] * this._t6[4] + this._t6[2] * this._t6[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }

  bake2D(nx: number, ny: number, z = 0, t = 0): Bake2DResult {
    const data = new Float32Array(nx * ny * 4);
    let p = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      this.sampleUW((i / nx) * TAU_, (j / ny) * TAU_, z, this._t6, t);
      data[p] = this._t6[0]; data[p + 1] = this._t6[1]; data[p + 2] = this._t6[2];
      data[p + 3] = this._t6[0] * this._t6[3] + this._t6[1] * this._t6[4] + this._t6[2] * this._t6[5];
      p += 4;
    }
    return { data, width: nx, height: ny, channels: 4 };
  }
}

const TAU_ = 2 * Math.PI;

/** Options for {@link exactNS}. */
export interface ExactNSOptions {
  /** Shell wavenumber k₀ (used for both `kmin` and `kmax`). Default 2. */
  k0?: number;
  /** Kinematic viscosity ν (becomes `decay`). Default 0.02; `0` gives the steady Euler member. */
  nu?: number;
  /** Chirality s = ±1 (becomes `helicity`, so every mode takes that sign). Default 1. */
  sign?: 1 | -1;
  /** Passed through untouched — none of these break exactness. */
  modes?: number;
  seed?: number;
  amplitude?: number;
  coherence?: number;
  centers?: number;
  layout?: "fibonacci" | "random";
}

/**
 * Options for a field that is an **exact solution of the Navier–Stokes equations**, not merely a
 * plausible-looking one: a single-wavenumber Beltrami field decaying at the exact Stokes rate.
 *
 * All modes share one `|k| = k₀` and one handedness, which makes the field Beltrami
 * (`∇×u = ±k₀·u`); the nonlinear term is then a pure gradient and is absorbed by the pressure, so
 * the flow just decays as `e^(−νk₀²t)` — which is precisely what `decay` does to every amplitude.
 *
 * ```js
 * const field = create(exactNS({ k0: 2, nu: 0.05, seed: 7 }));
 * ```
 *
 * Keep `tileable` off and `ellipticity` at 1 — integer rounding would break the single shell, and
 * elliptic modes are not Beltrami.
 */
export function exactNS(opts: ExactNSOptions = {}): HelixNoiseOptions {
  const { k0 = 2, nu = 0.02, sign = 1, ...rest } = opts;
  return {
    kmin: k0,
    kmax: k0, // one shell: |k| is the same for every mode
    helicity: sign, // p = ±1 makes every drawn sign that sign
    churn: 0, // om = 0; the only time dependence is the viscous decay
    decay: nu,
    tileable: false,
    ellipticity: 1, // Beltrami — the whole point
    ...rest,
  };
}

/**
 * Energy-weighted polarization of the two measured turbulence states these presets aim at:
 * `d` = linear polarization degree, `absP` = per-shell helical fraction, `signedP` = its signed
 * mean. Quoted so tests and docs can check what a field actually reproduces.
 */
export const NS_TARGETS = {
  dev: { d: 1.155, absP: 0.462, signedP: 0.057 },
  forced: { d: 1.062, absP: 0.516, signedP: 0.229, condensateK1: 0.55 },
} as const;

/** Invert the per-mode relative helicity 2ε/(1+ε²) = p for ε — the ellipticity matching a target. */
function epsForP(p: number): number {
  return (1 - Math.sqrt(1 - p * p)) / p;
}

/**
 * Option bundle whose **polarization** matches measured developed turbulence: per-mode helical
 * fraction |p| ≈ 0.46 with a weakly positive signed mean, i.e. strongly polarized waves whose
 * handedness nearly cancels. Both numbers are inverted exactly — `ellipticity` from
 * 2ε/(1+ε²) = |p|, and the `helicity` slider from signedP/|p|.
 *
 * Scope, honestly: the polarization is calibrated, the **spectrum is not** — this keeps the
 * default power law. Matching the measured shell spectrum needs a table this package does not
 * ship; pass your own `spectrum` if you have one.
 */
export function nsDeveloped(overrides?: Partial<HelixNoiseOptions>): HelixNoiseOptions {
  const { absP, signedP } = NS_TARGETS.dev;
  return {
    modes: 96,
    layout: "random", // a genuine ensemble, matching how the target was measured
    kmin: 1,
    kmax: 15, // the band holding ~99% of the measured energy
    ellipticity: epsForP(absP),
    helicity: signedP / absP,
    ...overrides,
  };
}

/**
 * Same as {@link nsDeveloped} for the *forced* state: more strongly polarized waves (|p| ≈ 0.52)
 * and a markedly net-handed field (signed mean +0.23), which reads as a visible overall swirl
 * direction. The measured state also carries a helical condensate at the largest scale; expressing
 * that needs a per-wavenumber `helicity` — see the `condensate` preset if you want to add one.
 *
 * Same scope caveat as {@link nsDeveloped}: polarization calibrated, spectrum not.
 */
export function nsForced(overrides?: Partial<HelixNoiseOptions>): HelixNoiseOptions {
  const { absP, signedP } = NS_TARGETS.forced;
  return {
    modes: 96,
    layout: "random",
    kmin: 1,
    kmax: 15,
    ellipticity: epsForP(absP),
    helicity: signedP / absP,
    ...overrides,
  };
}
