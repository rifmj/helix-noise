import { create } from "helix-noise";
import type { Field, HelixNoiseOptions, GlslOptions } from "helix-noise";

/**
 * Build a Helix Noise field. This is a thin, deliberate re-export of the core `create`:
 * the r3f adapter is a *transport*, never a re-implementation of the mode sum. Every
 * component and hook resolves to a `Field` from here, so parity with the core (and thus
 * every other port) is inherited, not re-established.
 *
 * @see useHelixField for the React-memoised wrapper around this.
 */
export function buildField(options?: HelixNoiseOptions): Field {
  return create(options);
}

/**
 * A stable string key for a set of options, for React memoisation. Functions
 * (`spectrum`) are keyed by their source so a stable closure memoises correctly; a
 * freshly-allocated closure each render intentionally busts the cache (rebuild the field).
 */
export function fieldKey(options?: HelixNoiseOptions): string {
  if (!options) return "{}";
  return JSON.stringify(options, (_k, v) =>
    typeof v === "function" ? `fn:${v.toString()}` : v,
  );
}

/**
 * The GLSL the GPU path injects: `vec3 helixNoise(vec3 p[, float t])` + `helixNoiseCurl`,
 * and (for bounded fields) the vector potential. This is the *same* emitter the standalone
 * shader port uses — the GPU render path never hand-writes the mode sum.
 */
export function helixFieldChunk(field: Field, opts?: GlslOptions): string {
  return field.glsl({ name: "helixNoise", curl: true, ...opts });
}
