<h1 align="center">Helix Noise — monorepo</h1>

<p align="center">
  <b>Divergence-free helical flow fields you can art-direct — in four ecosystems, one algorithm.</b><br>
  Sample a smooth, incompressible 3-D velocity field at any point: spectral slope, helicity, phase coherence.
  No FFT, no grid, no simulation.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/parity-~1e--15%20across%20ports-brightgreen" alt="numerical parity">
</p>

---

This repository holds the reference implementation and its ports. **All ports produce the *same field***
for the same seed and parameters — verified to ~1e-15 (machine epsilon) against the JS reference, not
just visually. That parity is a hard, tested invariant: the whole point of the monorepo is to change the
algorithm once and re-verify every language in one CI run.

## Packages

| Package | Language | Registry | Status |
|---|---|---|---|
| [`packages/js`](packages/js) | TypeScript / JS | npm `helix-noise` | reference implementation (spectral + atom engines, boundaries, GLSL, WASM batch kernel) |
| [`packages/python`](packages/python) | Python 3 + numpy | PyPI `helix-noise` | spectral engine + boundary + GLSL; vectorized `sample_many` |
| [`packages/rust`](packages/rust) | Rust | crates.io `helix-noise` | spectral engine + boundary + GLSL; zero runtime deps, WASM-friendly |
| [`packages/shaders`](packages/shaders) | GLSL · HLSL · WGSL · Godot | — | code generator + ready-to-paste shaders for Shadertoy / Unity / Unreal / Godot / WebGPU |

The project's front-door site lives in [`site/`](site) (the landing) plus `packages/js/docs` (the VitePress
reference); the `Deploy Site` workflow assembles them into one GitHub Pages site — landing at `/`, docs at `/docs`.

The **atom engine** currently lives only in `packages/js`; the native ports scope v0.1 to the spectral
engine and document it as a follow-up.

## Parity — the shared contract

Everything under [`spec/`](spec) is the single source of truth:

- [`spec/PORTING_SPEC.md`](spec/PORTING_SPEC.md) — the language-agnostic algorithm (RNG, mode construction,
  sampling, boundaries, GLSL emitter). Port from this.
- [`spec/parity_fixture.json`](spec/parity_fixture.json) — the canonical fixture (mode arrays + sample
  outputs for 6 configs incl. a boundary case), **generated from `packages/js`**.
- [`spec/ref_glsl_*.glsl`](spec) — exact GLSL emitter targets.

Each port's test suite asserts it reproduces the fixture within `1e-9`. Regenerate the fixture with:

```bash
node packages/js/scripts/dump-fixture.mjs > spec/parity_fixture.json
```

CI fails if any package's copy of the fixture drifts from `spec/`.

## Develop

```bash
# JS reference
cd packages/js && npm install && npm test && npm run build

# Python port
cd packages/python && python3 tests/test_parity.py

# Rust port
cd packages/rust && cargo test

# Shader generator
cd packages/shaders && python3 tests/test_shaders.py
```

## License

MIT © Rifat Jumagulov. See [LICENSE](LICENSE).
