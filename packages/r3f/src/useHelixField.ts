import { useMemo } from "react";
import type { Field, HelixNoiseOptions } from "helix-noise";
import { buildField, fieldKey } from "./core";

/**
 * Create (and memoise) a Helix Noise field inside a React component.
 *
 * The field is rebuilt only when the options actually change (keyed by a stable
 * stringify), so it is safe to pass an inline object literal. The returned value is the
 * live core `Field` — the full escape hatch: call `sample`/`vorticity`/`helicityDensity`/
 * `withBoundary`/`bake3D` directly, or hand it to `<HelixParticles field={...} />` /
 * `helixFlowMaterial`.
 *
 * ```tsx
 * const field = useHelixField({ helicity: 0.8, coherence: 0.5, seed: 7 });
 * const [u, v, w] = field.sample(x, y, z);
 * ```
 */
export function useHelixField(options?: HelixNoiseOptions): Field {
  const key = fieldKey(options);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable digest of options
  return useMemo(() => buildField(options), [key]);
}
