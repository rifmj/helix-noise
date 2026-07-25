import { BoundedFieldImpl } from "./boundary";
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

/** Shared bake/boundary plumbing for the closed-form primitives. @internal */
abstract class BaseFlow implements FlowField {
  abstract sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
  abstract sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;

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
}
