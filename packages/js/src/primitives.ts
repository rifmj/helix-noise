import { BoundedFieldImpl } from "./boundary";
import { axisymGrad, lambda2FromGrad, qFromGrad, stretchFromGrad } from "./diagnostics";
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
 * Localized coherent structures — the third field genre next to the spectral sum and the sparse
 * atoms. These are closed-form flows with no randomness at all: a smoke ring is a smoke ring, at
 * whatever point you sample it.
 *
 * Every primitive is built as an explicit curl `u = ∇×A`, so it is exactly divergence-free and
 * comes with an exact vector potential — which means obstacles (`withBoundary`) and the
 * divergence-free potential bakes work on it exactly as they do on a spectral field.
 */

const TAU = 2 * Math.PI;

/** Options for {@link createRing}. */
export interface RingOptions {
  /** Center of the ring. Default `[0, 0, 0]`. */
  center?: Vec3;
  /** Ring axis — the direction it travels along. Normalized internally. Default `[0, 0, 1]`. */
  axis?: Vec3;
  /** Radius of the ring's core circle. Default 1. */
  radius?: number;
  /**
   * Core thickness: the flow lives within this distance of the core circle and is exactly zero
   * outside. Must stay below `radius` (otherwise the support would touch the axis, where the
   * closed form is not smooth). Default `0.3`.
   */
  core?: number;
  /** Circulation Γ — strength and, by its sign, travel direction. Default 1. */
  circulation?: number;
  /**
   * Let the ring travel: the center advances at Kelvin's self-induced speed for a thin-core ring,
   * `U = Γ/(4πR)·(ln(8R/c) − ¼)`, so `sample(x, y, z, t)` shows it in flight. Default false.
   */
  advect?: boolean;
}

/** Kelvin's self-induced translation speed of a thin-core vortex ring. */
export function ringSpeed(circulation: number, radius: number, core: number): number {
  const r = Math.max(radius, 1e-12), c = Math.max(core, 1e-12);
  return (circulation / (2 * TAU * r)) * (Math.log((8 * r) / c) - 0.25);
}

/**
 * A **vortex ring** — a smoke ring: a compact torus of swirling flow that pushes a jet through
 * its own middle. Closed form, exactly divergence-free, exactly zero outside the core, and with a
 * compactly supported potential, so it drops straight into `withBoundary` and the potential bakes.
 *
 * ```js
 * const ring = createRing({ radius: 1.5, core: 0.4, circulation: 2, advect: true });
 * ```
 *
 * The construction is the azimuthal potential `A = Γ·h(q/c)·ê_φ` with `q` the distance to the core
 * circle and `h(u) = (1−u²)³` a C² window; `u = ∇×A` is then dipolar flow threading the ring.
 */
export function createRing(opts: RingOptions = {}): FlowField {
  return new RingField(opts);
}

/**
 * Two rings fired at each other head-on — the classic colliding-rings setup, and the reason
 * `compose` exists. Equal and opposite circulation, mirrored about the origin along `axis`.
 */
export function collidingRings(opts: RingOptions & { separation?: number } = {}): FlowField {
  const sep = opts.separation ?? 2;
  const ax = norm3(opts.axis ?? [0, 0, 1]);
  const c = opts.center ?? [0, 0, 0];
  const off = (s: number): Vec3 => [c[0] + s * ax[0], c[1] + s * ax[1], c[2] + s * ax[2]];
  const G = opts.circulation ?? 1;
  return compose(
    createRing({ ...opts, center: off(-sep / 2), circulation: G }),
    createRing({ ...opts, center: off(sep / 2), circulation: -G })
  );
}

/**
 * Sum any number of flow fields. The sum of divergence-free fields is divergence-free and its
 * potential is the sum of theirs, so obstacles and potential bakes keep working — mix primitives
 * with each other or with a spectral field.
 */
export function compose(...fields: FlowField[]): FlowField {
  return new ComposedField(fields);
}

function norm3(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

const _t6: number[] = [0, 0, 0, 0, 0, 0];
const _s6: number[] = [0, 0, 0, 0, 0, 0];
const _g9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const _e9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const _d6: number[] = [0, 0, 0, 0, 0, 0];

/** Shared bake/boundary plumbing for the closed-form primitives. @internal */
abstract class BaseFlow implements FlowField {
  abstract sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
  abstract sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
  /**
   * Abstract on purpose. Every primitive here has a closed-form gradient, and the alternative — a
   * silently-inherited approximation — is exactly the gap that let the structure primitives ship
   * without any way to colour them.
   */
  abstract sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, t?: number): T;

  qCriterion(x: number, y: number, z: number, t = 0): number {
    return qFromGrad(this.sampleGrad(x, y, z, _g9, t));
  }

  lambda2(x: number, y: number, z: number, t = 0): number {
    return lambda2FromGrad(this.sampleGrad(x, y, z, _g9, t));
  }

  stretching(x: number, y: number, z: number, t = 0): number {
    this.sampleUW(x, y, z, _s6, t);
    const wx = _s6[3], wy = _s6[4], wz = _s6[5];
    return stretchFromGrad(this.sampleGrad(x, y, z, _g9, t), wx, wy, wz);
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

/** @internal */
class RingField extends BaseFlow {
  private cx: number; private cy: number; private cz: number;
  private nx: number; private ny: number; private nz: number;
  private R: number; private c: number; private G: number;
  private speed: number;

  constructor(o: RingOptions) {
    super();
    const c0 = o.center ?? [0, 0, 0];
    const ax = norm3(o.axis ?? [0, 0, 1]);
    this.cx = c0[0]; this.cy = c0[1]; this.cz = c0[2];
    this.nx = ax[0]; this.ny = ax[1]; this.nz = ax[2];
    this.R = Math.max(o.radius ?? 1, 1e-9);
    // Keep the support strictly off the axis: the closed form is smooth only where rho > 0.
    this.c = Math.min(Math.max(o.core ?? 0.3, 1e-9), 0.95 * this.R);
    this.G = o.circulation ?? 1;
    this.speed = o.advect ? ringSpeed(this.G, this.R, this.c) : 0;
  }

  /**
   * One evaluation in the ring's local cylindrical frame. Writes velocity into 0..2 and either
   * the vorticity or the potential into 3..5.
   */
  private _eval<T extends Out6>(x: number, y: number, z: number, out6: T, t: number, wantW: boolean): T {
    const sh = this.speed * t; // the ring travels along its own axis
    const dx = x - (this.cx + sh * this.nx);
    const dy = y - (this.cy + sh * this.ny);
    const dz = z - (this.cz + sh * this.nz);
    const nx = this.nx, ny = this.ny, nz = this.nz;
    const zc = dx * nx + dy * ny + dz * nz;            // axial coordinate
    let rx = dx - zc * nx, ry = dy - zc * ny, rz = dz - zc * nz;
    const rho = Math.hypot(rx, ry, rz);                 // radial coordinate

    out6[0] = 0; out6[1] = 0; out6[2] = 0; out6[3] = 0; out6[4] = 0; out6[5] = 0;
    if (rho < 1e-12) return out6; // on the axis: outside the support, so the field is zero there

    rx /= rho; ry /= rho; rz /= rho;                    // ê_ρ
    const dr = rho - this.R;
    const q2 = dr * dr + zc * zc;
    const c = this.c, c2 = c * c;
    if (q2 >= c2) return out6;                          // strictly zero outside the core

    // Window h(u) = (1−u²)³ at u = q/c, and the smooth combination h'(u)/(c·q) = −(6/c²)(1−u²)².
    const s = 1 - q2 / c2;
    const h = this.G * s * s * s;
    const H1 = (-6 * this.G * s * s) / c2;              // = Γ·h'(q/c)/(c·q), finite at q = 0

    // A = h·ê_φ ; u = ∇×A = −∂_z A ê_ρ + (1/ρ)∂_ρ(ρA) ê_z
    const uRho = -H1 * zc;
    const uAx = h / rho + H1 * dr;
    out6[0] = uRho * rx + uAx * nx;
    out6[1] = uRho * ry + uAx * ny;
    out6[2] = uRho * rz + uAx * nz;

    // ê_φ = n̂ × ê_ρ
    const px = ny * rz - nz * ry, py = nz * rx - nx * rz, pz = nx * ry - ny * rx;
    if (!wantW) {
      out6[3] = h * px; out6[4] = h * py; out6[5] = h * pz; // A = h·ê_φ
      return out6;
    }
    // ω = ∇×u is azimuthal too: ω_φ = −(∂²_ρ + ∂²_z)A − (1/ρ)∂_ρA + A/ρ².
    // With A = Γ(1−q²/c²)³: ∂_ρA = H1·dr, ∂_zA = H1·z, and the Laplacian terms below.
    const H2 = (24 * this.G * s) / (c2 * c2); // = Γ·d/dq[h'(q/c)/(c q)] / q
    const lap = 2 * H1 + H2 * q2;             // ∂²_ρA + ∂²_zA
    const wPhi = -(lap + (H1 * dr) / rho - h / (rho * rho));
    out6[3] = wPhi * px; out6[4] = wPhi * py; out6[5] = wPhi * pz;
    return out6;
  }

  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    return this._eval(x, y, z, out6, t, true);
  }

  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    return this._eval(x, y, z, out6, t, false);
  }

  /**
   * Closed form. The ring has no swirl, so in its own cylindrical frame only four partials are
   * non-zero, and every one of them is a polynomial in the same window derivatives the velocity
   * already uses — `h`, `H1` and `H2`. Outside the core all three vanish, so the gradient goes to
   * exactly zero at the support boundary rather than stepping.
   */
  sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, t = 0): T {
    if (out9.length < 9) throw new Error("helix-noise: sampleGrad needs 9 floats");
    for (let i = 0; i < 9; i++) out9[i] = 0;
    const sh = this.speed * t;
    const dx = x - (this.cx + sh * this.nx);
    const dy = y - (this.cy + sh * this.ny);
    const dz = z - (this.cz + sh * this.nz);
    const nx = this.nx, ny = this.ny, nz = this.nz;
    const zc = dx * nx + dy * ny + dz * nz;
    let rx = dx - zc * nx, ry = dy - zc * ny, rz = dz - zc * nz;
    const rho = Math.hypot(rx, ry, rz);
    if (rho < 1e-12) return out9;
    rx /= rho; ry /= rho; rz /= rho;
    const dr = rho - this.R, q2 = dr * dr + zc * zc, c2 = this.c * this.c;
    if (q2 >= c2) return out9;
    const s = 1 - q2 / c2;
    const h = this.G * s * s * s;
    const H1 = (-6 * this.G * s * s) / c2;
    const H2 = (24 * this.G * s) / (c2 * c2);   // = ∂H1/∂q² · 1, so ∂_ρH1 = H2·dr, ∂_zH1 = H2·zc
    const ur = -H1 * zc;
    _e9[0] = rx; _e9[1] = ry; _e9[2] = rz;
    _e9[3] = ny * rz - nz * ry; _e9[4] = nz * rx - nx * rz; _e9[5] = nx * ry - ny * rx;
    _e9[6] = nx; _e9[7] = ny; _e9[8] = nz;
    return axisymGrad(
      ur, 0, rho,
      -H2 * dr * zc, 0, H1 * dr / rho - h / (rho * rho) + H2 * dr * dr + H1,
      -H1 - H2 * zc * zc, 0, H1 * zc / rho + H2 * zc * dr,
      _e9, out9
    );
  }
}

/** @internal */
class ComposedField extends BaseFlow {
  constructor(private readonly parts: FlowField[]) {
    super();
  }

  private _sum<T extends Out6>(pick: "uw" | "ua", x: number, y: number, z: number, out6: T, t: number): T {
    for (let i = 0; i < 6; i++) out6[i] = 0;
    for (const f of this.parts) {
      if (pick === "uw") f.sampleUW(x, y, z, _s6, t);
      else f.sampleUA(x, y, z, _s6, t);
      for (let i = 0; i < 6; i++) out6[i] += _s6[i];
    }
    return out6;
  }

  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    return this._sum("uw", x, y, z, out6, t);
  }

  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    return this._sum("ua", x, y, z, out6, t);
  }

  /** The gradient of a sum is the sum of the gradients — so a composed field stays analytic. */
  sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, t = 0): T {
    if (out9.length < 9) throw new Error("helix-noise: sampleGrad needs 9 floats");
    for (let i = 0; i < 9; i++) out9[i] = 0;
    for (const f of this.parts) {
      f.sampleGrad(x, y, z, _c9, t);
      for (let i = 0; i < 9; i++) out9[i] += _c9[i];
    }
    return out9;
  }
}

const _c9: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

// ---------------------------------------------------------------------------
// Axisymmetric chassis and the columns it unlocks (design doc 14)
// ---------------------------------------------------------------------------

/**
 * A profile in the chassis coordinates `(q, z)` with `q = r²`. Taking `r²` rather than `r` as the
 * argument is what makes the axis behave: it forces the parity every smooth axisymmetric field
 * must have, so no implementation ever has to special-case `r = 0`.
 *
 * Supply `dq` and `dz` to get an exactly divergence-free field. Without them the partials are
 * estimated by central differences, and the divergence is then O(h²) rather than machine zero.
 */
export interface AxiProfile {
  (q: number, z: number): number;
  /** ∂/∂q. Optional; central differences are used when absent. */
  dq?: (q: number, z: number) => number;
  /** ∂/∂z. Optional; central differences are used when absent. */
  dz?: (q: number, z: number) => number;
  /** ∂²/∂q². Optional; used by `sampleGrad`, differenced from `dq` when absent. */
  dqq?: (q: number, z: number) => number;
  /** ∂²/∂q∂z. Optional; used by `sampleGrad`, differenced from `dq` when absent. */
  dqz?: (q: number, z: number) => number;
  /** ∂²/∂z². Optional; used by `sampleGrad`, differenced from `dz` when absent. */
  dzz?: (q: number, z: number) => number;
}

/** Options for {@link axisymmetric}. */
export interface AxisymOptions {
  /** Stream profile `P` in `ψ = r²·P(r², z)`. Default: none (no poloidal flow). */
  stream?: AxiProfile;
  /** Swirl profile `h` in `Γ = r²·h(r², z)`. Default: none (no rotation). */
  swirl?: AxiProfile;
  /**
   * Antiderivative `H(q, z) = ∫₀^q h dt` of the swirl profile, used only by `potential()`.
   * Supply it for an exact vector potential; without it a fixed Simpson rule is used.
   */
  swirlIntegral?: (q: number, z: number) => number;
  center?: Vec3;
  /** Symmetry axis; normalized internally. Default `[0, 0, 1]`. */
  axis?: Vec3;
}

const FD = 1e-5;

/**
 * The **axisymmetric chassis**: any pair of smooth profiles becomes a swirling, exactly
 * incompressible field that is smooth on its own axis.
 *
 * ```js
 * const funnel = axisymmetric({
 *   stream: (q, z) => Math.exp(-q) * z,      // ψ = r²·P
 *   swirl: (q) => Math.exp(-2 * q),          // Γ = r²·h
 * });
 * ```
 *
 * With `ψ = r²P(r², z)` and `Γ = r²h(r², z)` the cylindrical formulas lose their division by `r`
 * entirely — `u^r = −r·∂_z P`, `u^z = 2P + 2q·∂_q P`, `u^θ = r·h` — so the axis is an ordinary
 * point rather than a removable singularity, and there is no seam down the middle.
 *
 * **This is not a Navier–Stokes solution.** An arbitrary pair of profiles gives a field that is
 * exactly incompressible and smooth, nothing more. For one that does solve the equations, see
 * {@link strainedColumn}.
 */
export function axisymmetric(opts: AxisymOptions = {}): FlowField {
  return new AxisymField(opts);
}

/** Options for {@link strainedColumn}. */
export interface StrainedColumnOptions {
  /** Inward strain rate `a` — how hard the flow squeezes toward the axis. Default 0.7. */
  strain?: number;
  /** Viscosity `ν`. With `strain` it fixes the core radius `√(2ν/a)`. Default 0.05. */
  viscosity?: number;
  /** Circulation `ε` — how fast the column spins. Default 1. */
  circulation?: number;
  center?: Vec3;
  axis?: Vec3;
}

/**
 * A **strained vortex column** — a tornado, and an *exact stationary solution* of the
 * Navier–Stokes equations:
 *
 * ```
 * u^r = −a·r,   u^z = 2a·z,   u^θ = ε(1 − e^(−a r²/2ν)) / r
 * ```
 *
 * An inward strain holds the filament open against viscosity, and the balance is exact: the
 * vorticity is purely axial and Gaussian, `ω_z = (εa/ν)·e^(−a r²/2ν)`, with core radius
 * `√(2ν/a)`. Raise the strain and the filament gets **thinner and brighter at once**, because the
 * peak `εa/ν` climbs as the width falls — which is how a real intensifying vortex reads.
 *
 * Note that the strain field grows with distance (`u ~ a·r`), so this is a **local-domain** object:
 * bound the region you render, or the far field will dominate. Its vector potential is exact but
 * grows logarithmically and is *not* compactly supported — a swirling column cannot have a compact
 * one — so an obstacle far from the column is affected slightly, unlike with {@link createRing}.
 */
export function strainedColumn(opts: StrainedColumnOptions = {}): FlowField {
  return new StrainedColumnField(opts);
}

/** Core radius `√(2ν/a)` of a {@link strainedColumn} — where its Gaussian vorticity falls to 1/e. */
export function columnCore(strain: number, viscosity: number): number {
  return Math.sqrt((2 * Math.max(viscosity, 0)) / Math.max(strain, 1e-12));
}

/** Peak axial vorticity `εa/ν` at the axis of a {@link strainedColumn}. */
export function columnPeakVorticity(strain: number, viscosity: number, circulation: number): number {
  return (circulation * strain) / Math.max(viscosity, 1e-12);
}

/**
 * Exponential integral E₁(x), x > 0 — series below 1, continued fraction above. Needed only for
 * the column's vector potential.
 * @internal
 */
function expInt1(x: number): number {
  if (x <= 0) return Infinity;
  if (x <= 1) {
    let s = -0.5772156649015329 - Math.log(x), term = 1;
    for (let k = 1; k < 30; k++) { term *= -x / k; s -= term / k; }
    return s;
  }
  let cf = 0;
  for (let k = 20; k >= 1; k--) cf = (k * k) / (x + 2 * k + 1 - cf);
  return Math.exp(-x) / (x + 1 - cf);
}

/**
 * `G(u) = γ + ln u + E₁(u)`, the antiderivative behind the swirl potential. The logarithms cancel
 * at the origin — `G(0) = 0`, `G(u) ≈ u` for small `u` — so the potential is regular on the axis;
 * outside, `G` grows like `ln u`, which is the solenoid obstruction and is unavoidable.
 * @internal
 */
function gLog(u: number): number {
  if (u < 1e-8) return u - (u * u) / 4;              // series: G(u) = u − u²/4 + …
  return 0.5772156649015329 + Math.log(u) + expInt1(u);
}

/** Shared cylindrical frame + sampling for the axisymmetric family. @internal */
abstract class AxisBase extends BaseFlow {
  protected cx: number; protected cy: number; protected cz: number;
  protected nx: number; protected ny: number; protected nz: number;

  constructor(center: Vec3 | undefined, axis: Vec3 | undefined) {
    super();
    const c = center ?? [0, 0, 0];
    const a = norm3(axis ?? [0, 0, 1]);
    this.cx = c[0]; this.cy = c[1]; this.cz = c[2];
    this.nx = a[0]; this.ny = a[1]; this.nz = a[2];
  }

  /** Cylindrical components at a point; subclasses fill (u^r, u^θ, u^z) and optionally ω. */
  protected abstract cyl(r: number, z: number, out: number[]): void;

  /** Whether {@link cyl} also wrote a vorticity triple into out[3..5]. */
  protected analyticVorticity = false;

  private _frame(x: number, y: number, z: number, fr: number[]): void {
    const dx = x - this.cx, dy = y - this.cy, dz = z - this.cz;
    const zc = dx * this.nx + dy * this.ny + dz * this.nz;
    let rx = dx - zc * this.nx, ry = dy - zc * this.ny, rz = dz - zc * this.nz;
    const r = Math.hypot(rx, ry, rz);
    if (r > 1e-12) { rx /= r; ry /= r; rz /= r; }
    else { // on the axis any transverse direction will do; the field vanishes there anyway
      rx = Math.abs(this.nz) < 0.9 ? -this.ny : 0;
      ry = Math.abs(this.nz) < 0.9 ? this.nx : 1;
      rz = 0;
      const n = Math.hypot(rx, ry, rz) || 1;
      rx /= n; ry /= n; rz /= n;
    }
    fr[0] = r; fr[1] = zc; fr[2] = rx; fr[3] = ry; fr[4] = rz;
  }

  /** Assemble a cylindrical triple (radial, azimuthal, axial) into world coordinates. */
  private _world(vr: number, vt: number, vz: number, fr: number[], out: number[], o: number): void {
    const rx = fr[2], ry = fr[3], rz = fr[4];
    const px = this.ny * rz - this.nz * ry;      // ê_φ = n̂ × ê_ρ
    const py = this.nz * rx - this.nx * rz;
    const pz = this.nx * ry - this.ny * rx;
    out[o] = vr * rx + vt * px + vz * this.nx;
    out[o + 1] = vr * ry + vt * py + vz * this.ny;
    out[o + 2] = vr * rz + vt * pz + vz * this.nz;
  }

  private _c = [0, 0, 0, 0, 0, 0];
  private _fr = [0, 0, 0, 0, 0];

  // These fields are stationary, so `t` is accepted for interface compatibility and unused.
  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, _t = 0): T {
    this._frame(x, y, z, this._fr);
    const r = this._fr[0];
    this._c.fill(0);
    this.cyl(r, this._fr[1], this._c);
    this._world(this._c[0], this._c[1], this._c[2], this._fr, out6 as unknown as number[], 0);
    if (this.analyticVorticity) {
      this._world(this._c[3], this._c[4], this._c[5], this._fr, out6 as unknown as number[], 3);
    } else {
      // no closed form for this chassis instance — central differences of the analytic velocity
      const h = FD, a = [0, 0, 0, 0, 0, 0], b = [0, 0, 0, 0, 0, 0];
      const d = (i: number, ax: 0 | 1 | 2): number => {
        const p: [number, number, number] = [x, y, z], m: [number, number, number] = [x, y, z];
        p[ax] += h; m[ax] -= h;
        this._vel(p[0], p[1], p[2], a); this._vel(m[0], m[1], m[2], b);
        return (a[i] - b[i]) / (2 * h);
      };
      out6[3] = d(2, 1) - d(1, 2);
      out6[4] = d(0, 2) - d(2, 0);
      out6[5] = d(1, 0) - d(0, 1);
    }
    return out6;
  }

  /** Velocity only, into out[0..2]. @internal */
  private _vel(x: number, y: number, z: number, out: number[]): void {
    const fr = [0, 0, 0, 0, 0], c = [0, 0, 0, 0, 0, 0];
    this._frame(x, y, z, fr);
    this.cyl(fr[0], fr[1], c);
    this._world(c[0], c[1], c[2], fr, out, 0);
  }

  /**
   * Cylindrical partials at a point, written as
   * `[∂_r u^r, ∂_r u^θ, ∂_r u^z, ∂_z u^r, ∂_z u^θ, ∂_z u^z]`.
   *
   * The default differences {@link cyl} in the `(r, z)` half-plane — two dimensions rather than
   * three, and on the profile rather than the assembled field. Subclasses with a closed form
   * override it.
   */
  protected dcyl(r: number, z: number, out6: number[]): void {
    const h = FD, a = [0, 0, 0, 0, 0, 0], b = [0, 0, 0, 0, 0, 0];
    this.cyl(r + h, z, a); this.cyl(r - h, z, b);
    out6[0] = (a[0] - b[0]) / (2 * h); out6[1] = (a[1] - b[1]) / (2 * h); out6[2] = (a[2] - b[2]) / (2 * h);
    this.cyl(r, z + h, a); this.cyl(r, z - h, b);
    out6[3] = (a[0] - b[0]) / (2 * h); out6[4] = (a[1] - b[1]) / (2 * h); out6[5] = (a[2] - b[2]) / (2 * h);
  }

  /**
   * The gradient of an axisymmetric field, assembled from its cylindrical partials — see
   * {@link axisymGrad} for why the middle row is not a derivative of anything.
   */
  sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, _t = 0): T {
    if (out9.length < 9) throw new Error("helix-noise: sampleGrad needs 9 floats");
    this._frame(x, y, z, this._fr);
    const r = this._fr[0], zc = this._fr[1];
    const rx = this._fr[2], ry = this._fr[3], rz = this._fr[4];
    this._c.fill(0);
    this.cyl(r, zc, this._c);
    this.dcyl(r, zc, _d6);
    _e9[0] = rx; _e9[1] = ry; _e9[2] = rz;
    _e9[3] = this.ny * rz - this.nz * ry;
    _e9[4] = this.nz * rx - this.nx * rz;
    _e9[5] = this.nx * ry - this.ny * rx;
    _e9[6] = this.nx; _e9[7] = this.ny; _e9[8] = this.nz;
    return axisymGrad(this._c[0], this._c[1], r, _d6[0], _d6[1], _d6[2], _d6[3], _d6[4], _d6[5], _e9, out9);
  }

  /** (A_θ, A_z) of the vector potential in cylindrical components. */
  protected abstract pot(r: number, z: number, out: number[]): void;

  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, _t = 0): T {
    this._frame(x, y, z, this._fr);
    const c = [0, 0];
    this.pot(this._fr[0], this._fr[1], c);
    this._vel(x, y, z, out6 as unknown as number[]);
    this._world(0, c[0], c[1], this._fr, out6 as unknown as number[], 3);
    return out6;
  }
}

/** @internal */
class AxisymField extends AxisBase {
  private P?: AxiProfile;
  private h?: AxiProfile;
  private H?: (q: number, z: number) => number;

  constructor(o: AxisymOptions) {
    super(o.center, o.axis);
    this.P = o.stream; this.h = o.swirl; this.H = o.swirlIntegral;
  }

  private dq(f: AxiProfile, q: number, z: number): number {
    if (f.dq) return f.dq(q, z);
    const h = FD * (1 + Math.abs(q));
    return (f(q + h, z) - f(Math.max(0, q - h), z)) / (q - h < 0 ? q + h : 2 * h);
  }
  private dz(f: AxiProfile, q: number, z: number): number {
    if (f.dz) return f.dz(q, z);
    return (f(q, z + FD) - f(q, z - FD)) / (2 * FD);
  }

  protected cyl(r: number, z: number, out: number[]): void {
    const q = r * r;
    if (this.P) {
      out[0] = -r * this.dz(this.P, q, z);                       // u^r = −r ∂_z P
      out[2] = 2 * this.P(q, z) + 2 * q * this.dq(this.P, q, z); // u^z = 2P + 2q ∂_q P
    }
    if (this.h) out[1] = r * this.h(q, z);                       // u^θ = r h
  }

  /** Second derivatives: exact when the profile supplies them, differenced from the first otherwise. */
  private dqq(f: AxiProfile, q: number, z: number): number {
    if (f.dqq) return f.dqq(q, z);
    const h = FD * (1 + Math.abs(q));
    if (q - h < 0) return (this.dq(f, q + h, z) - this.dq(f, q, z)) / h;
    return (this.dq(f, q + h, z) - this.dq(f, q - h, z)) / (2 * h);
  }
  private dqz(f: AxiProfile, q: number, z: number): number {
    if (f.dqz) return f.dqz(q, z);
    return (this.dq(f, q, z + FD) - this.dq(f, q, z - FD)) / (2 * FD);
  }
  private dzz(f: AxiProfile, q: number, z: number): number {
    if (f.dzz) return f.dzz(q, z);
    return (this.dz(f, q, z + FD) - this.dz(f, q, z - FD)) / (2 * FD);
  }

  /**
   * Closed form in `r`. With `q = r²`,
   *
   * ```
   * ∂_r u^r = −P_z − 2q·P_qz      ∂_z u^r = −r·P_zz
   * ∂_r u^θ = h + 2q·h_q          ∂_z u^θ = r·h_z
   * ∂_r u^z = 2r(4P_q + 2q·P_qq)  ∂_z u^z = 2P_z + 2q·P_qz
   * ```
   *
   * — note `∂_r u^r + u^r/r + ∂_z u^z = 0` identically, whatever the profiles are. The `r`
   * dependence and the frame are always exact; only the profile's own second derivatives fall back
   * to differences, and only when it does not supply `dqq`/`dqz`/`dzz`.
   */
  protected override dcyl(r: number, z: number, out6: number[]): void {
    const q = r * r;
    out6[0] = out6[1] = out6[2] = out6[3] = out6[4] = out6[5] = 0;
    if (this.P) {
      const Pz = this.dz(this.P, q, z), Pq = this.dq(this.P, q, z);
      const Pqz = this.dqz(this.P, q, z), Pqq = this.dqq(this.P, q, z), Pzz = this.dzz(this.P, q, z);
      out6[0] = -Pz - 2 * q * Pqz;
      out6[3] = -r * Pzz;
      out6[2] = 2 * r * (4 * Pq + 2 * q * Pqq);
      out6[5] = 2 * Pz + 2 * q * Pqz;
    }
    if (this.h) {
      out6[1] = this.h(q, z) + 2 * q * this.dq(this.h, q, z);
      out6[4] = r * this.dz(this.h, q, z);
    }
  }

  protected pot(r: number, z: number, out: number[]): void {
    const q = r * r;
    out[0] = this.P ? r * this.P(q, z) : 0;                      // A_θ = ψ/r = r P
    if (!this.h) { out[1] = 0; return; }
    // A_z = −½ ∫₀^q h dt — exact when the caller supplies it, Simpson otherwise
    if (this.H) { out[1] = -0.5 * this.H(q, z); return; }
    const N = 24, dt = q / N;
    let s = 0;
    for (let i = 0; i <= N; i++) {
      const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
      s += w * this.h(i * dt, z);
    }
    out[1] = -0.5 * ((s * dt) / 3);
  }
}

/** @internal */
class StrainedColumnField extends AxisBase {
  private a: number; private nu: number; private eps: number; private b: number;

  constructor(o: StrainedColumnOptions) {
    super(o.center, o.axis);
    this.a = o.strain ?? 0.7;
    this.nu = Math.max(o.viscosity ?? 0.05, 1e-9);
    this.eps = o.circulation ?? 1;
    this.b = this.a / (2 * this.nu);
    this.analyticVorticity = true;   // everything below is closed form
  }

  protected cyl(r: number, z: number, out: number[]): void {
    const q = r * r, e = Math.exp(-this.b * q);
    out[0] = -this.a * r;                                        // u^r
    // u^θ = ε(1 − e^(−b r²))/r, regular at the axis where it tends to ε b r
    out[1] = q < 1e-12 ? this.eps * this.b * r : (this.eps * (1 - e)) / r;
    out[2] = 2 * this.a * z;                                     // u^z
    out[3] = 0; out[4] = 0;
    out[5] = (this.eps * this.a) / this.nu * e;                  // ω purely axial and Gaussian
  }

  protected override dcyl(r: number, _z: number, out6: number[]): void {
    const x = this.b * r * r, e = Math.exp(-x);
    // (1 − e^(−x))/x, written with expm1 so the axis stays accurate instead of cancelling.
    const E = x > 1e-300 ? -Math.expm1(-x) / x : 1;
    out6[0] = -this.a;                                           // ∂_r u^r
    out6[1] = this.eps * this.b * (2 * e - E);                   // ∂_r u^θ → εb on the axis
    out6[2] = 0;                                                 // ∂_r u^z
    out6[3] = 0;                                                 // ∂_z u^r
    out6[4] = 0;                                                 // ∂_z u^θ
    out6[5] = 2 * this.a;                                        // ∂_z u^z
  }

  protected pot(r: number, z: number, out: number[]): void {
    out[0] = this.a * r * z;                                     // A_θ = a r z, exact
    out[1] = -0.5 * this.eps * gLog(this.b * r * r);             // A_z = −(ε/2) G(b r²)
  }
}

/**
 * A **counter-rotating pair** — two parallel strained columns, side by side, spinning opposite ways.
 *
 * They are offset *across* the axis, not stacked along it. Stacking is the tempting arrangement and
 * it is degenerate: a column's vorticity `ω_z = (εa/ν)·e^(−a r²/2ν)` depends on `r` alone and never
 * decays along `z`, so two on a shared axis with opposite circulation cancel each other **globally**
 * — every trace of rotation, everywhere, leaving nothing but a doubled strain.
 *
 * Offset laterally, they instead do what a real vortex pair does. On the mid-plane the two cores sit
 * at equal distance, so the swirl contributions are mirror images: the component *through* the plane
 * cancels identically while the in-plane component doubles. Two exact consequences, both worth
 * checking rather than believing —
 *
 * - the mid-plane is **impermeable**: `u·n̂ = 0` on it exactly, an invisible wall the flow never
 *   crosses, with the strain's own inflow cancelling there too;
 * - the vorticity vanishes on that plane and *only* there, so the two filaments stay individually
 *   bright — and between them the doubled swirl drives a **jet** along the plane.
 *
 * `separation` is the distance between the two axes; `offsetAxis` is the direction they are
 * separated along (any vector not parallel to `axis` — its perpendicular part is used).
 */
export function counterSwirlColumns(
  opts: StrainedColumnOptions & { separation?: number; offsetAxis?: Vec3 } = {}
): FlowField {
  const sep = opts.separation ?? 2;
  const ax = norm3(opts.axis ?? [0, 0, 1]);
  const n = norm3(perp(ax, opts.offsetAxis));
  const c = opts.center ?? [0, 0, 0];
  const at = (s: number): Vec3 => [c[0] + s * n[0], c[1] + s * n[1], c[2] + s * n[2]];
  const G = opts.circulation ?? 1;
  return compose(
    strainedColumn({ ...opts, center: at(sep / 2), circulation: G }),
    strainedColumn({ ...opts, center: at(-sep / 2), circulation: -G })
  );
}

/**
 * The component of `hint` perpendicular to the unit vector `ax`, falling back to whichever
 * coordinate axis is least aligned with `ax` when no usable hint is given.
 * @internal
 */
function perp(ax: Vec3, hint?: Vec3): Vec3 {
  const cand: Vec3[] = hint ? [hint] : [];
  const m = Math.abs(ax[0]) < Math.abs(ax[1])
    ? (Math.abs(ax[0]) < Math.abs(ax[2]) ? 0 : 2)
    : (Math.abs(ax[1]) < Math.abs(ax[2]) ? 1 : 2);
  cand.push([m === 0 ? 1 : 0, m === 1 ? 1 : 0, m === 2 ? 1 : 0]);
  for (const v of cand) {
    const d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2];
    const p: Vec3 = [v[0] - d * ax[0], v[1] - d * ax[1], v[2] - d * ax[2]];
    if (Math.hypot(p[0], p[1], p[2]) > 1e-9) return p;
  }
  return [1, 0, 0];
}
