import type { Field } from "helix-noise";
import { TAU } from "./constants";

/** A triple of speed percentiles `[p62, p97, p99.5]` — the renderer's glow thresholds. */
export type SpeedPercentiles = [number, number, number];

/**
 * Measure the field's speed distribution over the domain and return the `[p62, p97, p99.5]`
 * percentiles. The renderer maps these to "filament glows" / "core whitens" thresholds, so the
 * look stays stable whatever the helicity/slope/coherence — a fast field and a slow field glow
 * the same amount. Uses the core's batched `sampleMany` (CPU, one-off at build time, no per-frame
 * cost) with its own deterministic sampling grid.
 *
 * @param field    the Helix Noise field
 * @param box      domain size to sample within. Default `2π`.
 * @param samples  number of probe points. Default `1200`.
 */
export function calibrateSpeed(field: Field, box: number = TAU, samples: number = 1200): SpeedPercentiles {
  const n = Math.max(16, samples | 0);
  const pos = new Float64Array(3 * n);
  let s = 987654321 >>> 0;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 3 * n; i++) pos[i] = rand() * box;

  const out = field.sampleMany(pos);
  const sp = new Float64Array(n);
  for (let j = 0; j < n; j++) sp[j] = Math.hypot(out[3 * j], out[3 * j + 1], out[3 * j + 2]);
  sp.sort();

  const at = (q: number): number => sp[Math.min(n - 1, (n * q) | 0)];
  return [at(0.62), at(0.97), at(0.995)];
}
