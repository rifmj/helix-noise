# spec/ — the shared parity contract

This directory is the **single source of truth** that keeps every port producing the same field.

| File | What it is |
|---|---|
| `PORTING_SPEC.md` | The language-agnostic algorithm: RNG (`mulberry32`, bit-exact across languages), mode construction and the exact `rng()` draw order, sampling formulas, the `FlowField` contract, boundaries (Bridson quintic ramp), the GLSL emitter, presets, structure primitives, time warps, and the gradient diagnostics. Opens with a per-feature table of which port has what and which blocks the fixture pins. **Port from this.** |
| `parity_fixture.json` | Canonical fixture — **18 configs in three shapes**: 13 spectral (mode arrays + u/vorticity/potential samples + `relativeHelicity` + bake checksum), 2 boundary (`base_config` + thickness/fdStep + samples), 3 atom (`scale`/`kBase` + samples; no mode arrays — atoms regenerate from the hash). **Generated from `packages/js`.** |
| `ref_glsl_A.glsl`, `ref_glsl_D_decay.glsl`, `ref_glsl_K_elliptic.glsl`, `ref_glsl_Q_grain.glsl` | Exact expected output of the GLSL emitter, for shader-generator parity. |

## The JS package is the oracle

`parity_fixture.json` is derived from the reference implementation. When the algorithm changes:

```bash
# from the repo root
node packages/js/scripts/dump-fixture.mjs > spec/parity_fixture.json
# then refresh each port's self-contained copy — all four, wasm included:
for p in python rust shaders wasm; do cp spec/parity_fixture.json packages/$p/tests/parity_fixture.json; done
```

The loop above omitted `wasm` while the CI check covered it, so following the documented procedure
left one copy stale and failed the build.

The fixture's first key is `$spec_version` — the reference version that generated it. Each port
asserts its own `SPEC_VERSION` against that key, so regenerating from a newer reference turns every
unverified port red instead of letting it drift (see `PORTING_SPEC.md` §1).

Each package keeps its **own copy** of the fixture inside `tests/` so it stays self-contained and
publishable to its registry. The `parity-fixture` CI job regenerates the oracle and fails the build if
`spec/` or any package copy has drifted — so the copies can never silently diverge.

## Parity target

Fields match the JS reference to ~1e-15 (machine epsilon); the RNG stream is bit-exact, only
transcendental functions differ by ~1 ULP. Tests assert `1e-9` (and `1e-7` for the float32 bake sums).
