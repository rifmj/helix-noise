import { TAU } from "./constants";
import type { Bake3DResult, BoundaryOptions, BoundedField, FlowField, Out6, Sdf, Vec3 } from "./types";

// Bridson's free-slip ramp (the curl-noise boundary quintic): r(0) = 0 but r'(0) = 15/8 > 0, so
// the wall value is a pure tangential slip flow rather than a no-slip dead zone; r(1) = 1 with
// r'(1) = r''(1) = 0, so the field blends C²-smoothly into the unconstrained one.
function ramp(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const x2 = x * x;
  return (x * (15 - 10 * x2 + 3 * x2 * x2)) / 8;
}
function dramp(x: number): number {
  if (x < 0 || x >= 1) return 0;
  const w = 1 - x * x;
  return (15 / 8) * w * w;
}

/**
 * A field constrained by an SDF obstacle. Velocity is `∇×(ramp(d/th)·A)` with `A` the base
 * field's analytic vector potential, expanded exactly as
 * `u_b = ramp'·∇d×A + ramp·u`
 * — divergence-free by construction (it is a curl), tangent to the wall (the normal component
 * carries a factor ramp(0) = 0), zero inside, and bit-identical to the base field beyond the
 * influence band.
 */
export class BoundedFieldImpl implements BoundedField {
  readonly base: FlowField;
  readonly sdf: Sdf;
  private th: number;
  private h: number;
  private grad?: (x: number, y: number, z: number) => ArrayLike<number>;
  private _ua: number[] = [0, 0, 0, 0, 0, 0];
  private _fa: number[] = [0, 0, 0];
  private _fb: number[] = [0, 0, 0];

  constructor(base: FlowField, sdf: Sdf, opts?: BoundaryOptions) {
    this.base = base;
    this.sdf = sdf;
    this.th = Math.max(opts?.thickness ?? 1, 1e-9);
    this.h = opts?.fdStep ?? 1e-3;
    this.grad = opts?.gradient;
  }

  /** Core: bounded velocity into out[0..2]. */
  private _u(x: number, y: number, z: number, t: number, out: number[] | Out6, o = 0): void {
    const d = this.sdf(x, y, z);
    if (d <= 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; return; }
    const ua = this._ua;
    this.base.sampleUA(x, y, z, ua, t);
    const q = d / this.th;
    if (q >= 1) { out[o] = ua[0]; out[o + 1] = ua[1]; out[o + 2] = ua[2]; return; }
    let gx: number, gy: number, gz: number;
    if (this.grad) {
      const g = this.grad(x, y, z);
      gx = g[0]; gy = g[1]; gz = g[2];
    } else {
      const h = this.h, s = this.sdf;
      gx = (s(x + h, y, z) - s(x - h, y, z)) / (2 * h);
      gy = (s(x, y + h, z) - s(x, y - h, z)) / (2 * h);
      gz = (s(x, y, z + h) - s(x, y, z - h)) / (2 * h);
    }
    const r = ramp(q), rp = dramp(q) / this.th;
    const cx = gy * ua[5] - gz * ua[4]; // ∇d × A
    const cy = gz * ua[3] - gx * ua[5];
    const cz = gx * ua[4] - gy * ua[3];
    out[o] = rp * cx + r * ua[0];
    out[o + 1] = rp * cy + r * ua[1];
    out[o + 2] = rp * cz + r * ua[2];
  }

  sample(x: number, y: number, z: number, t = 0): Vec3 {
    const f = this._fa;
    this._u(x, y, z, t, f);
    return [f[0], f[1], f[2]];
  }

  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    this._u(x, y, z, t, out6, 0);
    const h = this.h, a = this._fa, b = this._fb;
    this._u(x, y + h, z, t, a); this._u(x, y - h, z, t, b);
    const uzy = (a[2] - b[2]) / (2 * h), uxy = (a[0] - b[0]) / (2 * h);
    this._u(x, y, z + h, t, a); this._u(x, y, z - h, t, b);
    const uyz = (a[1] - b[1]) / (2 * h), uxz = (a[0] - b[0]) / (2 * h);
    this._u(x + h, y, z, t, a); this._u(x - h, y, z, t, b);
    const uyx = (a[1] - b[1]) / (2 * h), uzx = (a[2] - b[2]) / (2 * h);
    out6[3] = uzy - uyz;
    out6[4] = uxz - uzx;
    out6[5] = uyx - uxy;
    return out6;
  }

  vorticity(x: number, y: number, z: number, t = 0): Vec3 {
    const o = this._ua;
    this.sampleUW(x, y, z, o, t);
    return [o[3], o[4], o[5]];
  }

  helicityDensity(x: number, y: number, z: number, t = 0): number {
    const o = this._ua;
    this.sampleUW(x, y, z, o, t);
    return o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
  }

  potential(x: number, y: number, z: number, t = 0): Vec3 {
    const d = this.sdf(x, y, z);
    if (d <= 0) return [0, 0, 0];
    const ua = this._ua;
    this.base.sampleUA(x, y, z, ua, t);
    const r = ramp(d / this.th);
    return [r * ua[3], r * ua[4], r * ua[5]];
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
    const data = new Float32Array(n * n * n * 4), ua = this._ua;
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = (x / n) * TAU, py = (y / n) * TAU, pz = (z / n) * TAU;
      const d = this.sdf(px, py, pz);
      if (d <= 0) {
        data[p] = 0; data[p + 1] = 0; data[p + 2] = 0;
      } else {
        this.base.sampleUA(px, py, pz, ua, t);
        const r = ramp(d / this.th);
        data[p] = r * ua[3]; data[p + 1] = r * ua[4]; data[p + 2] = r * ua[5];
      }
      data[p + 3] = d;
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }
}
