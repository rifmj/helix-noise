import { WASM_B64 } from "./wasm-kernel";
import type { ModeData, Out6 } from "./types";

/**
 * Optional WASM f64x2-SIMD backend for the spectral batch samplers. The 1.4 kB module is
 * embedded (zero runtime deps), instantiated synchronously on first use, and silently falls
 * back to the JS kernel when WebAssembly/SIMD is unavailable. It mirrors the JS kernel
 * op-for-op, so results agree to the usual < 1e-12 (verified in tests).
 */

type ManyFn = (
  nT: number, N: number, t: number, uw: number, md: number,
  px: number, py: number, pz: number,
  ux: number, uy: number, uz: number,
  wx: number, wy: number, wz: number
) => void;

// Minimal structural types so this file compiles against bare ES2020 libs; the real
// WebAssembly/atob come from the host at runtime (browser, node, deno, bun).
interface WaMemory { buffer: ArrayBuffer; grow(pages: number): number }
interface WaApi {
  Module: new (bytes: Uint8Array) => object;
  Instance: new (mod: object, imports: object) => { exports: Record<string, unknown> };
}

interface Kernel { mem: WaMemory; many: ManyFn }

let kernelState: Kernel | null | undefined; // undefined = not tried yet

function b64bytes(s: string): Uint8Array {
  const g = globalThis as { Buffer?: { from(s: string, e: string): Uint8Array }; atob?: (s: string) => string };
  if (g.Buffer) return new Uint8Array(g.Buffer.from(s, "base64"));
  const bin = g.atob!(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function kernel(): Kernel | null {
  if (kernelState === undefined) {
    try {
      const WA = (globalThis as { WebAssembly?: WaApi }).WebAssembly;
      if (!WA) throw new Error("no wasm");
      const inst = new WA.Instance(new WA.Module(b64bytes(WASM_B64)), {});
      kernelState = { mem: inst.exports.mem as WaMemory, many: inst.exports.many as ManyFn };
    } catch {
      kernelState = null; // no wasm / no SIMD / sync-compile limit — JS path takes over
    }
  }
  return kernelState;
}

const ARRS = ["kx", "ky", "kz", "ph", "om", "s", "a", "km", "e1x", "e1y", "e1z", "e2x", "e2y", "e2z"] as const;
const PHI_MAX = 1e6; // beyond this the JS kernel's exact-reduction guard applies — stay on JS

// Layout state for the single shared instance (mode block re-uploaded when the owner changes).
let owner: unknown = null;
let ownerStamp = -1;
let capN = 0, capPts = 0;
let f64: Float64Array | null = null;
let mdO = 0, pxO = 0, pyO = 0, pzO = 0, uxO = 0, uyO = 0, uzO = 0, wxO = 0, wyO = 0, wzO = 0;

function ensure(k: Kernel, N: number, nPts: number): void {
  if (N <= capN && nPts <= capPts && f64 && f64.buffer === k.mem.buffer) return;
  capN = Math.max(N, capN);
  capPts = Math.max(nPts, capPts, 4096);
  const al = (x: number): number => (x + 15) & ~15;
  mdO = 16;
  pxO = al(mdO + 14 * capN * 8);
  pyO = al(pxO + capPts * 8);
  pzO = al(pyO + capPts * 8);
  uxO = al(pzO + capPts * 8);
  uyO = al(uxO + capPts * 8);
  uzO = al(uyO + capPts * 8);
  wxO = al(uzO + capPts * 8);
  wyO = al(wxO + capPts * 8);
  wzO = al(wyO + capPts * 8);
  const need = al(wzO + capPts * 8);
  const have = k.mem.buffer.byteLength;
  if (need > have) k.mem.grow(Math.ceil((need - have) / 65536));
  f64 = new Float64Array(k.mem.buffer);
  owner = null; // offsets moved — force mode re-upload
}

/**
 * Run the batch through the wasm kernel. Returns false (nothing written) when wasm is
 * unavailable or the phase magnitude could exceed the exact-reduction range — the caller's
 * JS kernel handles those.
 */
export function runWasm(
  field: ModeData & { _buildStamp: number },
  amps: Float64Array,
  pos: ArrayLike<number>,
  out: Out6,
  t: number,
  uw: boolean,
  sc: number
): boolean {
  const k = kernel();
  if (!k) return false;
  const N = field.N;
  const n = (pos.length / 3) | 0;
  const n2 = n + (n & 1); // wasm processes pairs; pad odd counts
  ensure(k, N, n2);
  const m = f64!;

  // mode block (14 arrays); `a` slot gets the (possibly decayed) amplitudes for this t
  if (owner !== field || ownerStamp !== field._buildStamp) {
    for (let ai = 0; ai < ARRS.length; ai++) {
      const src = ARRS[ai] === "a" ? amps : (field[ARRS[ai]] as Float64Array);
      m.set(src, (mdO >> 3) + ai * capN);
    }
    owner = field; ownerStamp = field._buildStamp;
  } else if (amps !== field.a) {
    m.set(amps, (mdO >> 3) + 6 * capN); // decay active: refresh amplitudes only
  }

  // transpose positions to SoA, tracking the phase bound
  const xb = pxO >> 3, yb = pyO >> 3, zb = pzO >> 3;
  let mx = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    m[xb + i] = x; m[yb + i] = y; m[zb + i] = z;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax > mx) mx = ax; if (ay > mx) mx = ay; if (az > mx) mx = az;
  }
  if (n2 > n) { m[xb + n] = m[xb + n - 1]; m[yb + n] = m[yb + n - 1]; m[zb + n] = m[zb + n - 1]; }
  let kmax = 0, omax = 0;
  for (let j = 0; j < N; j++) {
    const ks = Math.abs(field.kx[j]) + Math.abs(field.ky[j]) + Math.abs(field.kz[j]);
    if (ks > kmax) kmax = ks;
    const ao = Math.abs(field.om[j]);
    if (ao > omax) omax = ao;
  }
  if (mx * kmax + Math.PI + omax * Math.abs(t) >= PHI_MAX) return false;

  const st = uw ? 6 : 3;
  m.fill(0, uxO >> 3, (uxO >> 3) + n2);
  m.fill(0, uyO >> 3, (uyO >> 3) + n2);
  m.fill(0, uzO >> 3, (uzO >> 3) + n2);
  if (uw) {
    m.fill(0, wxO >> 3, (wxO >> 3) + n2);
    m.fill(0, wyO >> 3, (wyO >> 3) + n2);
    m.fill(0, wzO >> 3, (wzO >> 3) + n2);
  }
  k.many(n2, N, t, uw ? 1 : 0, mdO, pxO, pyO, pzO, uxO, uyO, uzO, wxO, wyO, wzO);

  const ub = uxO >> 3, vb = uyO >> 3, wb = uzO >> 3;
  const qb = wxO >> 3, rb = wyO >> 3, sb = wzO >> 3;
  for (let i = 0; i < n; i++) {
    const o = st * i;
    out[o] = m[ub + i] * sc; out[o + 1] = m[vb + i] * sc; out[o + 2] = m[wb + i] * sc;
    if (uw) { out[o + 3] = m[qb + i] * sc; out[o + 4] = m[rb + i] * sc; out[o + 5] = m[sb + i] * sc; }
  }
  return true;
}
