import { TAU } from "./constants";
import { mulberry32 } from "./rng";
import { frame } from "./field";
import { BoundedFieldImpl } from "./boundary";
import { atomsToGLSL } from "./atoms-glsl";
import type {
  AtomField,
  Bake2DResult,
  Bake3DResult,
  BoundaryOptions,
  BoundedField,
  GlslOptions,
  HelixAtomsOptions,
  Out6,
  Sdf,
  Vec3,
} from "./types";

const ATOM_DEFAULTS: Omit<AtomField["params"], "helicityField" | "gainField" | "spectrum"> = {
  octaves: 3,
  atomsPerCell: 8,
  radius: 1.6,
  cyclesPerAtom: 2,
  slope: 1.6,
  helicity: 0,
  amplitude: 1,
  seed: 1,
  churn: 1,
  anisotropy: 0,
  axis: [0, 0, 1],
};

const ATOM_CALLBACK_KEYS = ["helicityField", "gainField", "spectrum"] as const;

// Per-atom record layout inside a cell's Float64Array.
const STRIDE = 18;
// 0..2 center | 3..5 k | 6 |k| | 7 s | 8 a | 9 phase | 10 phase rate | 11 s/|k|
// 12..14 e1 | 15..17 e2

/** Avalanche hash of a cell address (i, j, k wrapped to 16 bits) + octave + seed. */
function hcell(i: number, j: number, k: number, seed: number): number {
  let h = seed ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The sparse-atom engine. The field is a sum of compactly-supported helical wavelets ("atoms"):
 *
 *   u_atom = ∇×(W·A) = ∇W×A + W·u_wave
 *
 * where u_wave is a helical plane wave, A = (s/|k|)·u_wave its exact Beltrami potential, and
 * W = (1−q²)³ a C² window vanishing at the support radius. Atoms are drawn deterministically
 * from a spatial hash (one PRNG per cell), so the field is infinite, grid-free, amortized O(1)
 * per sample, and any region can carry its own helicity/gain. Divergence-free exactly — every
 * atom is a curl.
 */
export class HelixAtoms implements AtomField {
  params: AtomField["params"];
  private _scale = 1;
  private _cells = new Map<number, Float64Array>();
  private _kBase = 1;
  // Direct-mapped memo in front of the Map — consecutive samples reuse the same 8 cells.
  // Slots come from cheap int ops (the full key is still compared, so collisions only miss).
  private _mk = new Float64Array(64).fill(NaN);
  private _mv: (Float64Array | undefined)[] = new Array(64);

  constructor(opts?: HelixAtomsOptions) {
    this.params = { ...ATOM_DEFAULTS };
    if (opts) this._merge(opts);
    this._init();
  }

  private _merge(opts: HelixAtomsOptions): void {
    for (const k of Object.keys(opts) as (keyof HelixAtomsOptions)[]) {
      if (opts[k] !== undefined && (k in ATOM_DEFAULTS || (ATOM_CALLBACK_KEYS as readonly string[]).includes(k))) {
        (this.params as unknown as Record<string, unknown>)[k] = opts[k];
      }
    }
  }

  private _init(): void {
    this._cells.clear();
    this._mk.fill(NaN);
    this._mv.fill(undefined);
    this._kBase = (this.params.cyclesPerAtom * Math.PI) / this.params.radius;
    this._scale = 1;
    this._scale = (this.params.amplitude || 1) / (this._rms() || 1);
  }

  set(opts: HelixAtomsOptions): AtomField {
    this._merge(opts);
    this._init();
    return this;
  }

  /** Atoms of one hash cell (cell size = atom diameter), generated on first use and cached. */
  private _cell(o: number, ci: number, cj: number, ck: number): Float64Array {
    const key = ((o * 65536 + (ci & 0xffff)) * 65536 + (cj & 0xffff)) * 65536 + (ck & 0xffff);
    const slot = (o + ci * 2 + cj * 4 + ck * 8) & 63; // the 8-cell neighbourhood → 8 distinct slots
    if (this._mk[slot] === key) return this._mv[slot]!;
    let atoms = this._cells.get(key);
    if (atoms) {
      this._mk[slot] = key; this._mv[slot] = atoms;
      return atoms;
    }
    if (this._cells.size >= 16384) this._cells.clear(); // crude, cheap eviction

    const p = this.params;
    const rho = p.radius / (1 << o);
    const L = 2 * rho; // cell size = atom diameter → only 2×2×2 cells cover any point
    const kc = this._kBase * (1 << o);
    const npc = Math.max(1, p.atomsPerCell | 0);
    const rng = mulberry32(hcell(ci, cj, ck, ((p.seed >>> 0) || 1) + Math.imul(o, 0x9e3779b9)));
    const chi = Math.max(0, p.churn);
    const rate0 = chi * Math.cbrt(this._kBase);
    const gam = Math.min(9, Math.max(-0.99, p.anisotropy));
    const an = Math.hypot(p.axis[0], p.axis[1], p.axis[2]) || 1;
    const anx = p.axis[0] / an, any = p.axis[1] / an, anz = p.axis[2] / an;
    const fr = [0, 0, 0, 0, 0, 0];
    atoms = new Float64Array(npc * STRIDE);
    for (let m = 0; m < npc; m++) {
      const b = m * STRIDE;
      const cx = (ci + rng()) * L, cy = (cj + rng()) * L, cz = (ck + rng()) * L;
      const zd = 2 * rng() - 1, th = TAU * rng(), rd = Math.sqrt(Math.max(0, 1 - zd * zd));
      let dx = rd * Math.cos(th), dy = rd * Math.sin(th), dz = zd;
      if (gam !== 0) { // stretch the wavevector direction along the anisotropy axis
        const dn = dx * anx + dy * any + dz * anz;
        dx += gam * dn * anx; dy += gam * dn * any; dz += gam * dn * anz;
        const dm = Math.hypot(dx, dy, dz) || 1;
        dx /= dm; dy /= dm; dz /= dm;
      }
      const km = kc * (0.85 + 0.3 * rng());
      // Local parameters are frozen into the atom at its center — each atom is still an exact
      // curl, so spatial variation costs no divergence.
      const pl = p.helicityField ? Math.max(-1, Math.min(1, p.helicityField(cx, cy, cz))) : p.helicity;
      const s = rng() < (1 + pl) / 2 ? 1 : -1;
      const gain = p.gainField ? p.gainField(cx, cy, cz) : 1;
      const ph = TAU * rng();
      const sgn = rng() < 0.5 ? -1 : 1;
      atoms[b] = cx; atoms[b + 1] = cy; atoms[b + 2] = cz;
      atoms[b + 3] = km * dx; atoms[b + 4] = km * dy; atoms[b + 5] = km * dz;
      atoms[b + 6] = km;
      atoms[b + 7] = s;
      atoms[b + 8] = gain * (p.spectrum ? Math.max(0, p.spectrum(km)) : Math.pow(km / this._kBase, -p.slope));
      atoms[b + 9] = ph;
      atoms[b + 10] = sgn * rate0 * Math.pow(km, 2 / 3);
      atoms[b + 11] = s / km;
      frame(dx, dy, dz, fr);
      atoms[b + 12] = fr[0]; atoms[b + 13] = fr[1]; atoms[b + 14] = fr[2];
      atoms[b + 15] = fr[3]; atoms[b + 16] = fr[4]; atoms[b + 17] = fr[5];
    }
    this._cells.set(key, atoms);
    return atoms;
  }

  /**
   * Core evaluation. mode 0: u only → out[0..2]. mode 1: u + analytic vorticity → out[0..5].
   * mode 2: u + potential ΣW·A → out[0..5].
   */
  private _eval(x: number, y: number, z: number, t: number, out: Out6, mode: 0 | 1 | 2): void {
    const p = this.params, sc = this._scale;
    let ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0;
    for (let o = 0; o < p.octaves; o++) {
      const rho = p.radius / (1 << o), L = 2 * rho, rho2 = rho * rho;
      const bi = Math.floor(x / L - 0.5), bj = Math.floor(y / L - 0.5), bk = Math.floor(z / L - 0.5);
      for (let dc = 0; dc < 8; dc++) {
        const at = this._cell(o, bi + (dc & 1), bj + ((dc >> 1) & 1), bk + (dc >> 2));
        for (let b = 0; b < at.length; b += STRIDE) {
          const dxx = x - at[b], dyy = y - at[b + 1], dzz = z - at[b + 2];
          const r2 = dxx * dxx + dyy * dyy + dzz * dzz;
          if (r2 >= rho2) continue;
          const beta = 1 - r2 / rho2, b2 = beta * beta, w = b2 * beta;
          const kx = at[b + 3], ky = at[b + 4], kz = at[b + 5];
          const phi = kx * dxx + ky * dyy + kz * dzz + at[b + 9] + at[b + 10] * t;
          const c = Math.cos(phi), sn = Math.sin(phi);
          const s = at[b + 7], a = at[b + 8], gsk = at[b + 11];
          const twx = a * (c * at[b + 12] - s * sn * at[b + 15]); // u_wave
          const twy = a * (c * at[b + 13] - s * sn * at[b + 16]);
          const twz = a * (c * at[b + 14] - s * sn * at[b + 17]);
          const Ax = gsk * twx, Ay = gsk * twy, Az = gsk * twz; // wave potential
          const gw = (-6 * b2) / rho2; // ∇W = gw·d
          const gwx = gw * dxx, gwy = gw * dyy, gwz = gw * dzz;
          // u_atom = ∇W×A + W·u_wave
          ux += gwy * Az - gwz * Ay + w * twx;
          uy += gwz * Ax - gwx * Az + w * twy;
          uz += gwx * Ay - gwy * Ax + w * twz;
          if (mode === 2) { // potential of the atom: W·A
            vx += w * Ax; vy += w * Ay; vz += w * Az;
          } else if (mode === 1) {
            // ω = ∇×u_atom, from ∇×∇×(WA) = ∇(∇·(WA)) − ∇²(WA), all closed-form:
            //   H_W·A − (∇²W)·A + (∇W·A′)·k − 2(k·∇W)·A′ + |k|²·W·A
            // where A′ = (s/|k|)·∂φ(u_wave) and H_W the window Hessian.
            const apx = gsk * a * (-sn * at[b + 12] - s * c * at[b + 15]); // A′
            const apy = gsk * a * (-sn * at[b + 13] - s * c * at[b + 16]);
            const apz = gsk * a * (-sn * at[b + 14] - s * c * at[b + 17]);
            const dA = dxx * Ax + dyy * Ay + dzz * Az;
            const c1 = (12 * b2) / rho2, c2 = (24 * beta) / (rho2 * rho2);
            const kgw = kx * gwx + ky * gwy + kz * gwz;
            const gap = gwx * apx + gwy * apy + gwz * apz;
            const skw = s * at[b + 6] * w;
            vx += c1 * Ax + c2 * (dA * dxx - r2 * Ax) + gap * kx - 2 * kgw * apx + skw * twx;
            vy += c1 * Ay + c2 * (dA * dyy - r2 * Ay) + gap * ky - 2 * kgw * apy + skw * twy;
            vz += c1 * Az + c2 * (dA * dzz - r2 * Az) + gap * kz - 2 * kgw * apz + skw * twz;
          }
        }
      }
    }
    out[0] = ux * sc; out[1] = uy * sc; out[2] = uz * sc;
    if (mode !== 0) { out[3] = vx * sc; out[4] = vy * sc; out[5] = vz * sc; }
  }

  sample(x: number, y: number, z: number, t = 0): Vec3 {
    const o = this._t6;
    this._eval(x, y, z, t, o, 0);
    return [o[0], o[1], o[2]];
  }
  private _t6: number[] = [0, 0, 0, 0, 0, 0];

  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    this._eval(x, y, z, t, out6, 1);
    return out6;
  }

  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t = 0): T {
    this._eval(x, y, z, t, out6, 2);
    return out6;
  }

  vorticity(x: number, y: number, z: number, t = 0): Vec3 {
    const o = this._t6;
    this._eval(x, y, z, t, o, 1);
    return [o[3], o[4], o[5]];
  }

  helicityDensity(x: number, y: number, z: number, t = 0): number {
    const o = this._t6;
    this._eval(x, y, z, t, o, 1);
    return o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
  }

  potential(x: number, y: number, z: number, t = 0): Vec3 {
    const o = this._t6;
    this._eval(x, y, z, t, o, 2);
    return [o[3], o[4], o[5]];
  }

  withBoundary(sdf: Sdf, opts?: BoundaryOptions): BoundedField {
    return new BoundedFieldImpl(this, sdf, opts);
  }

  glsl(opts?: GlslOptions): string {
    return atomsToGLSL(this, this._kBase, this._scale, opts);
  }

  sampleMany<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t = 0): T {
    const o = (out ?? new Float64Array(pos.length)) as T;
    const n = (pos.length / 3) | 0;
    if (o.length < 3 * n) throw new Error(`helix-noise: out needs ${3 * n} floats, got ${o.length}`);
    const s6 = this._t6;
    for (let i = 0; i < n; i++) {
      this._eval(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], t, s6, 0);
      o[3 * i] = s6[0]; o[3 * i + 1] = s6[1]; o[3 * i + 2] = s6[2];
    }
    return o;
  }

  sampleManyUW<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t = 0): T {
    const o = (out ?? new Float64Array(2 * pos.length)) as T;
    const n = (pos.length / 3) | 0;
    if (o.length < 6 * n) throw new Error(`helix-noise: out needs ${6 * n} floats, got ${o.length}`);
    const s6 = this._t6;
    for (let i = 0; i < n; i++) {
      this._eval(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], t, s6, 1);
      for (let m = 0; m < 6; m++) o[6 * i + m] = s6[m];
    }
    return o;
  }

  relativeHelicity(ng = 12): number {
    const span = 4 * this.params.radius, o = [0, 0, 0, 0, 0, 0];
    let H = 0, un = 0, wn = 0;
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      this._eval(0.13 + (i / ng) * span, 0.29 + (j / ng) * span, 0.41 + (k / ng) * span, 0, o, 1);
      H += o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      un += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      wn += o[3] * o[3] + o[4] * o[4] + o[5] * o[5];
    }
    return H / (Math.sqrt(un * wn) || 1);
  }

  private _rms(): number {
    const ng = 6, span = 4 * this.params.radius, o = [0, 0, 0];
    let s = 0, n = 0;
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      this._eval(0.13 + (i / ng) * span, 0.29 + (j / ng) * span, 0.41 + (k / ng) * span, 0, o, 0);
      s += o[0] * o[0] + o[1] * o[1] + o[2] * o[2]; n++;
    }
    return Math.sqrt(s / n);
  }

  bake3D(n: number, t = 0): Bake3DResult {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      this._eval((x / n) * TAU, (y / n) * TAU, (z / n) * TAU, t, o, 1);
      data[p] = o[0]; data[p + 1] = o[1]; data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }

  bake2D(nx: number, ny: number, z = 0, t = 0): Bake2DResult {
    const data = new Float32Array(nx * ny * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      this._eval((i / nx) * TAU, (j / ny) * TAU, z, t, o, 1);
      data[p] = o[0]; data[p + 1] = o[1]; data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, width: nx, height: ny, channels: 4 };
  }

  bakePotential3D(n: number, t = 0): Bake3DResult {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = (x / n) * TAU, py = (y / n) * TAU, pz = (z / n) * TAU;
      this._eval(px, py, pz, t, o, 2);
      data[p] = o[3]; data[p + 1] = o[4]; data[p + 2] = o[5];
      this._eval(px, py, pz, t, o, 1);
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }
}
