# spec/ — the shared parity contract

This directory is the **single source of truth** that keeps every port producing the same field.

| File | What it is |
|---|---|
| `PORTING_SPEC.md` | The language-agnostic algorithm: RNG (`mulberry32`, bit-exact across languages), mode construction and the exact `rng()` draw order, sampling formulas, boundaries (Bridson quintic ramp), the GLSL emitter. **Port from this.** |
| `parity_fixture.json` | Canonical fixture — mode arrays + sample outputs (u / vorticity / potential) for 6 configs (incl. a boundary case), plus `relativeHelicity` and bake checksums. **Generated from `packages/js`.** |
| `ref_glsl_A.glsl`, `ref_glsl_D_decay.glsl` | Exact expected output of the GLSL emitter, for shader-generator parity. |

## The JS package is the oracle

`parity_fixture.json` is derived from the reference implementation. When the algorithm changes:

```bash
# from the repo root
node packages/js/scripts/dump-fixture.mjs > spec/parity_fixture.json
# then refresh each port's self-contained copy:
for p in python rust shaders; do cp spec/parity_fixture.json packages/$p/tests/parity_fixture.json; done
```

Each package keeps its **own copy** of the fixture inside `tests/` so it stays self-contained and
publishable to its registry. The `parity-fixture` CI job regenerates the oracle and fails the build if
`spec/` or any package copy has drifted — so the copies can never silently diverge.

## Parity target

Fields match the JS reference to ~1e-15 (machine epsilon); the RNG stream is bit-exact, only
transcendental functions differ by ~1 ULP. Tests assert `1e-9` (and `1e-7` for the float32 bake sums).
