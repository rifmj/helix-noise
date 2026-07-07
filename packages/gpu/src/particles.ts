import { PARTICLE_STRIDE_FLOATS, TAU } from "./constants";

/**
 * Build the initial interleaved particle buffer: `count` particles, 5 floats each
 * (`x, y, z, hue, speed`), positions uniform in `[0, box)³`. The PRNG is a deterministic LCG
 * seeded from `seed`, so the same seed reproduces the same cloud bit-for-bit (identical to the
 * `million.html` reference layout).
 *
 * @param count  particle count
 * @param box    domain size L; positions fill `[0, L)` per axis. Default `2π`.
 * @param seed   integer seed. Default `1`.
 */
export function initParticles(count: number, box: number = TAU, seed: number = 1): Float32Array {
  const n = Math.max(0, count | 0);
  const data = new Float32Array(n * PARTICLE_STRIDE_FLOATS);
  let s = (seed * 2654435761) >>> 0;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const o = i * PARTICLE_STRIDE_FLOATS;
    data[o] = rand() * box;
    data[o + 1] = rand() * box;
    data[o + 2] = rand() * box;
    data[o + 3] = 0; // hue — neutral until the first advection step colours it
    data[o + 4] = 1; // speed — placeholder until the first step measures it
  }
  return data;
}
