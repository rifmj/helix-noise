import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "helix-noise";
import { buildField, fieldKey, helixFieldChunk } from "../src/core.ts";

// This suite deliberately imports only the react-free plumbing (`../src/core`), so it runs as
// a plain node:test. The component layer (useHelixField / HelixParticles) is exercised with
// @react-three/test-renderer separately (arrives with M1).

const OPTS = { modes: 40, slope: 1.6, helicity: 0.8, coherence: 0.5, seed: 7 } as const;
const PTS: [number, number, number][] = [
  [0.1, 0.2, 0.3],
  [1.0, 2.0, 3.0],
  [4.2, 5.5, 0.7],
  [6.0, 6.1, 6.2],
];

test("transport: buildField reproduces the core field bit-for-bit", () => {
  const a = buildField(OPTS);
  const b = create(OPTS);
  for (const [x, y, z] of PTS) {
    const ua = a.sample(x, y, z);
    const ub = b.sample(x, y, z);
    for (let i = 0; i < 3; i++) {
      // Same construction, same RNG → must be exactly equal, not merely within tolerance.
      assert.equal(ua[i], ub[i], `component ${i} at (${x},${y},${z})`);
    }
  }
});

test("emission: helixFieldChunk emits the expected GLSL surface", () => {
  const chunk = helixFieldChunk(buildField(OPTS));
  assert.match(chunk, /vec3 helixNoise\(vec3 p, float t\)/, "time-parameterised sampler");
  assert.match(chunk, /vec3 helixNoise\(vec3 p\)/, "t=0 convenience overload");
  assert.match(chunk, /vec3 helixNoiseCurl\(/, "curl (vorticity) sampler");
  assert.ok(chunk.length > 200, "non-empty baked mode arrays");
});

test("fieldKey: stable for equal options, busts on change", () => {
  assert.equal(fieldKey(OPTS), fieldKey({ ...OPTS }), "same options → same key");
  assert.notEqual(fieldKey(OPTS), fieldKey({ ...OPTS, seed: 8 }), "changed seed → new key");
  // A spectrum closure is keyed by its source, so a stable function memoises and a fresh
  // closure (different source or identity) busts as intended.
  const s = (k: number) => 1 / k;
  assert.equal(fieldKey({ ...OPTS, spectrum: s }), fieldKey({ ...OPTS, spectrum: s }));
});

// The full numeric contract (evaluate the emitted GLSL, assert ≤1e-9 vs field.sample()) lives
// in ./glsl-parity.test.ts, on the transpile evaluation harness in ./glsl-eval.ts.
