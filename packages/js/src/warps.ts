import { BoundedFieldImpl } from "./boundary";
import { lambda2FromGrad, qFromGrad, stretchFromGrad } from "./diagnostics";
import type {
  Bake2DResult,
  Bake3DResult,
  BoundaryOptions,
  BoundedField,
  FlowField,
  Out6,
  Sdf,
  Vec3,
} from "./types";

/**
 * Time warps: transforms that change how a field behaves in `t` rather than what it contains.
 *
 * `churn` and `flutter` are local in time — they drift and jitter phases. These are global: they
 * make the whole pattern **focus**, shrinking toward a point while speeding up, with the two locked
 * together. Any positive length scale and any amplitude keep the field exactly divergence-free
 * (the chain rule gives `∇·u = (A/L)·(∇·U) = 0`), so a warp can never break the library's one
 * guarantee, whatever you set.
 */

const TAU = 2 * Math.PI;

/** Options for {@link collapse}. */
export interface CollapseOptions {
  /** The instant the collapse completes. Sampling is only defined for `t < T`. Default 1. */
  T?: number;
  /**
   * Space exponent. `0 < q < 1` completes in finite time; as `q → 1` it becomes a gentle drift
   * that never quite arrives. Default 0.6.
   */
  q?: number;
  /** The point everything focuses on. Default `[0, 0, 0]`. */
  center?: Vec3;
  /**
   * Tie the amplitude to the scale (`A = |L′|`), so the flow speeds up exactly as fast as it
   * shrinks and the norms follow `‖u‖∞ = q(T−t)^(q−1)`. Set false to zoom without accelerating.
   * Divergence-freedom holds either way. Default true.
   */
  tieAmplitude?: boolean;
  /**
   * Floor on `T − t`, so an animation that runs past `T` degrades instead of returning `Infinity`.
   * Default `1e-4`.
   */
  minTau?: number;
  /**
   * Freeze the wrapped field's own clock, so the warp supplies *all* the motion. Default true,
   * and for {@link dssCollapse} it is what makes the loop exact: self-similarity says the profile
   * repeats, which it cannot do if the profile is itself churning. Set false to let the wrapped
   * field evolve as well — the collapse still works, but the picture no longer closes on itself.
   */
  freezeProfile?: boolean;
}

/** Options for {@link dssCollapse}. */
export interface DssOptions extends CollapseOptions {
  /** Discrete zoom ratio: the picture repeats every `log λ` of renormalization time. Default 2. */
  lambda?: number;
  /** Space exponent `b`. Default 0.6. */
  b?: number;
  /** Amplitude exponent `a`. Default 0.8. */
  a?: number;
  /** 1-periodic, strictly positive scale modulation. Default `1 + 0.25·cos(2πφ)`. */
  scaleProfile?: (phase01: number) => number;
  /** 1-periodic, strictly positive amplitude modulation. Default `1`. */
  ampProfile?: (phase01: number) => number;
}

/**
 * Wrap a field in a **focusing** time warp: the whole pattern shrinks toward `center` like
 * `(T − t)^q` while the flow speeds up like `(T − t)^(q−1)`.
 *
 * ```js
 * const imploding = collapse(create({ modes: 48, tileable: true }), { T: 6, q: 0.55 });
 * ```
 *
 * `q` is the drama knob: near 1 a slow gathering, small a violent snap. The collapse *completes*
 * (rather than asymptoting) exactly when `q < 1`.
 *
 * Two practical notes. Sampling past `T` is clamped by `minTau`, not allowed to diverge. And
 * because the warp samples the wrapped field at `(x − c)/L` with `L → 0`, it walks ever further
 * into that field's far reaches — wrap a `tileable` field or a closed-form primitive if you want
 * the structure to survive deep zooms instead of dissolving into hash.
 */
export function collapse(field: FlowField, opts: CollapseOptions = {}): FlowField {
  const T = opts.T ?? 1;
  const q = opts.q ?? 0.6;
  const tie = opts.tieAmplitude !== false;
  const minTau = opts.minTau ?? 1e-4;
  return new WarpField(
    field,
    opts.center ?? [0, 0, 0],
    (t) => Math.pow(Math.max(T - t, minTau), q),
    (t) => (tie ? q * Math.pow(Math.max(T - t, minTau), q - 1) : 1),
    opts.freezeProfile !== false
  );
}

/**
 * The **log-periodic** version: the same focusing, dressed with a modulation that makes it an
 * *exact loop*.
 *
 * Driving by the renormalization time `s = −log(T − t)`, the scale is `(T−t)^b·Θ(s/log λ)` and the
 * amplitude `(T−t)^(−a)·𝒜(s/log λ)` with `Θ` and `𝒜` 1-periodic. So every time `s` advances by
 * `log λ`, the field is **identical to what it was, up to a rescale** by `λ^(−b)` in space and
 * `λ^a` in amplitude — one rendered period tiles the whole collapse, with no cross-fade and no
 * drift. That is the difference between a Droste zoom that is faked and one that closes.
 *
 * The exponents are free parameters here. A hypothetical Navier–Stokes singularity would have to
 * satisfy `1/2 < b < 1` and `b < a < (1+b)/2`, but that is a *necessary* budget constraint on an
 * object nobody has exhibited — it is offered as a sane starting range, not enforced, and this
 * warp is a kinematic animation law rather than a claim about turbulence.
 */
export function dssCollapse(field: FlowField, opts: DssOptions = {}): FlowField {
  const T = opts.T ?? 1;
  const lambda = Math.max(opts.lambda ?? 2, 1.0000001);
  const b = opts.b ?? 0.6;
  const a = opts.a ?? 0.8;
  const minTau = opts.minTau ?? 1e-4;
  const logL = Math.log(lambda);
  const theta = opts.scaleProfile ?? ((p: number): number => 1 + 0.25 * Math.cos(TAU * p));
  const alpha = opts.ampProfile ?? ((): number => 1);
  const phase = (t: number): number => {
    const s = -Math.log(Math.max(T - t, minTau));
    const p = (s / logL) % 1;
    return p < 0 ? p + 1 : p;
  };
  return new WarpField(
    field,
    opts.center ?? [0, 0, 0],
    (t) => Math.pow(Math.max(T - t, minTau), b) * theta(phase(t)),
    (t) => Math.pow(Math.max(T - t, minTau), -a) * alpha(phase(t)),
    opts.freezeProfile !== false
  );
}

const _w6: number[] = [0, 0, 0, 0, 0, 0];
const _w9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const _g9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * `u(x,t) = A(t)·U((x−c)/L(t), t)`. Velocity scales by `A`; vorticity picks up an extra `1/L` from
 * the chain rule, and the vector potential an extra `L`. Getting those two wrong is the only real
 * way to break this, so both are tested.
 * @internal
 */
class WarpField implements FlowField {
  constructor(
    private readonly base: FlowField,
    private readonly c: Vec3,
    private readonly L: (t: number) => number,
    private readonly A: (t: number) => number,
    /** When true the wrapped field is always sampled at t = 0 — see `freezeProfile`. */
    private readonly freeze: boolean
  ) {}

  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    const l = this.L(t), amp = this.A(t);
    this.base.sampleUW((x - this.c[0]) / l, (y - this.c[1]) / l, (z - this.c[2]) / l, _w6, this.freeze ? 0 : t);
    out6[0] = amp * _w6[0]; out6[1] = amp * _w6[1]; out6[2] = amp * _w6[2];
    const wScale = amp / l;
    out6[3] = wScale * _w6[3]; out6[4] = wScale * _w6[4]; out6[5] = wScale * _w6[5];
    return out6;
  }

  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    const l = this.L(t), amp = this.A(t);
    this.base.sampleUA((x - this.c[0]) / l, (y - this.c[1]) / l, (z - this.c[2]) / l, _w6, this.freeze ? 0 : t);
    out6[0] = amp * _w6[0]; out6[1] = amp * _w6[1]; out6[2] = amp * _w6[2];
    const aScale = amp * l;
    out6[3] = aScale * _w6[3]; out6[4] = aScale * _w6[4]; out6[5] = aScale * _w6[5];
    return out6;
  }

  /**
   * `u = A·U(ξ)` with `ξ = (x−c)/L`, so the chain rule gives `∇u = (A/L)·∇U` — the same `A/L` the
   * vorticity carries, for the same reason. Exact whenever the wrapped field's gradient is.
   */
  sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, t = 0): T {
    if (out9.length < 9) throw new Error("helix-noise: sampleGrad needs 9 floats");
    const l = this.L(t), amp = this.A(t), k = amp / l;
    this.base.sampleGrad((x - this.c[0]) / l, (y - this.c[1]) / l, (z - this.c[2]) / l, _w9,
      this.freeze ? 0 : t);
    for (let i = 0; i < 9; i++) out9[i] = k * _w9[i];
    return out9;
  }

  qCriterion(x: number, y: number, z: number, t = 0): number {
    return qFromGrad(this.sampleGrad(x, y, z, _g9, t));
  }

  lambda2(x: number, y: number, z: number, t = 0): number {
    return lambda2FromGrad(this.sampleGrad(x, y, z, _g9, t));
  }

  stretching(x: number, y: number, z: number, t = 0): number {
    this.sampleUW(x, y, z, _t6, t);
    return stretchFromGrad(this.sampleGrad(x, y, z, _g9, t), _t6[3], _t6[4], _t6[5]);
  }

  sample(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUW(x, y, z, _t6, t);
    return [_t6[0], _t6[1], _t6[2]];
  }

  vorticity(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUW(x, y, z, _t6, t);
    return [_t6[3], _t6[4], _t6[5]];
  }

  helicityDensity(x: number, y: number, z: number, t = 0): number {
    this.sampleUW(x, y, z, _t6, t);
    return _t6[0] * _t6[3] + _t6[1] * _t6[4] + _t6[2] * _t6[5];
  }

  potential(x: number, y: number, z: number, t = 0): Vec3 {
    this.sampleUA(x, y, z, _t6, t);
    return [_t6[3], _t6[4], _t6[5]];
  }

  withBoundary(sdf: Sdf, opts?: BoundaryOptions): BoundedField {
    return new BoundedFieldImpl(this, sdf, opts);
  }

  bake3D(n: number, t = 0): Bake3DResult {
    const data = new Float32Array(n * n * n * 4);
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      this.sampleUW((x / n) * TAU, (y / n) * TAU, (z / n) * TAU, _t6, t);
      data[p] = _t6[0]; data[p + 1] = _t6[1]; data[p + 2] = _t6[2];
      data[p + 3] = _t6[0] * _t6[3] + _t6[1] * _t6[4] + _t6[2] * _t6[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }

  bakePotential3D(n: number, t = 0): Bake3DResult {
    const data = new Float32Array(n * n * n * 4);
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = (x / n) * TAU, py = (y / n) * TAU, pz = (z / n) * TAU;
      this.sampleUA(px, py, pz, _t6, t);
      data[p] = _t6[3]; data[p + 1] = _t6[4]; data[p + 2] = _t6[5];
      this.sampleUW(px, py, pz, _t6, t);
      data[p + 3] = _t6[0] * _t6[3] + _t6[1] * _t6[4] + _t6[2] * _t6[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }

  bake2D(nx: number, ny: number, z = 0, t = 0): Bake2DResult {
    const data = new Float32Array(nx * ny * 4);
    let p = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      this.sampleUW((i / nx) * TAU, (j / ny) * TAU, z, _t6, t);
      data[p] = _t6[0]; data[p + 1] = _t6[1]; data[p + 2] = _t6[2];
      data[p + 3] = _t6[0] * _t6[3] + _t6[1] * _t6[4] + _t6[2] * _t6[5];
      p += 4;
    }
    return { data, width: nx, height: ny, channels: 4 };
  }
}

const _t6: number[] = [0, 0, 0, 0, 0, 0];
