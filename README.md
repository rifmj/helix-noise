<h1 align="center">Helix Noise — monorepo</h1>

<p align="center">
  <b>Divergence-free helical flow fields you can art-direct — in four ecosystems, one algorithm.</b><br>
  Sample a smooth, incompressible 3-D velocity field at any point: spectral slope, helicity, phase coherence, polarization.
  No FFT, no grid, no simulation.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/parity-~1e--12%20across%20ports-brightgreen" alt="numerical parity">
</p>

---

This repository holds the reference implementation and its ports. **All ports produce the *same field***
for the same seed and parameters — verified numerically against the JS reference, not just visually. The
RNG stream is bit-exact across languages; the field values themselves agree to **~1e-12 relative**, and
the parity suites assert `abs+rel ~1e-9`. They are *not* bit-for-bit, and cannot be: `sin`/`cos`/`pow`/
`cbrt`/`atan2`/`exp` differ by about 1 ULP between language runtimes. The normative statement lives in
[`spec/PORTING_SPEC.md`](spec/PORTING_SPEC.md). That parity is a hard, tested invariant: the whole point
of the monorepo is to change the algorithm once and re-verify every language in one CI run.

## Packages

| Package | Language | Registry | In repo | Published | Status |
|---|---|---|---|---|---|
| [`packages/js`](packages/js) | TypeScript / JS | npm `helix-noise` | `1.11.3` | `1.0.2` | reference implementation (spectral + atom engines, boundaries, GLSL, WASM batch kernel, structure primitives, time warps, gradient diagnostics) |
| [`packages/python`](packages/python) | Python 3 + numpy | PyPI `helix-noise` | `0.6.0` | `0.1.0` | spectral engine + boundary + GLSL; vectorized `sample_many` |
| [`packages/rust`](packages/rust) | Rust | crates.io `helix-noise` | `0.7.0` | `0.2.0` | spectral **+ atom** engines + boundary (wraps either) + GLSL; zero runtime deps, WASM-friendly |
| [`packages/wasm`](packages/wasm) | Rust → WebAssembly | npm `helix-noise-wasm` | `0.6.0` | `0.1.0` | `wasm-bindgen` build of the Rust core; both engines, native-speed sampling in the browser |
| [`packages/shaders`](packages/shaders) | GLSL · HLSL · WGSL · Godot | — | `0.5.0` | — | code generator + ready-to-paste shaders for Shadertoy / Unity / Unreal / Godot / WebGPU |
| [`packages/r3f`](packages/r3f) | TypeScript / React | npm `helix-noise-r3f` | `0.1.0` | `0.1.0` | react-three-fiber components (declarative particles + material); CPU + GPU engines, SDF obstacles |
| [`packages/gpu`](packages/gpu) | TypeScript / WebGL2 | npm `helix-noise-gpu` | `0.1.0` | `0.1.0` | framework-agnostic GPU particle engine (transform-feedback advection via injected `field.glsl()`, ~10⁶ particles); no three.js/React |

> **Read the two version columns before you `npm i`.** *In repo* is what this tree builds; *Published*
> is what the registry currently serves. They have drifted: the automated release job has been failing
> since it was added, so the 1.1–1.11 line of `helix-noise` (and everything in the ports past their
> first release) exists only here. Installing from a registry today gets you the older API — no
> structure primitives, no time warps, no gradient diagnostics. Build from source if you need those.

The project's front-door site lives in [`site/`](site) (the landing) plus `packages/js/docs` (the VitePress
reference); the `Deploy Site` workflow assembles them into one GitHub Pages site — landing at `/`, docs at `/docs`.
Rendered reference docs cover **every** platform:
[JavaScript](https://rifmj.github.io/helix-noise/docs/API) ·
[Python](https://rifmj.github.io/helix-noise/docs/python) ·
[Rust](https://rifmj.github.io/helix-noise/docs/rust) ·
[Shaders](https://rifmj.github.io/helix-noise/docs/shaders) ·
[React (r3f)](https://rifmj.github.io/helix-noise/docs/r3f) ·
[WebGL2 (gpu)](https://rifmj.github.io/helix-noise/docs/gpu). Each package also keeps its own `CHANGELOG.md`.

Both engines — the **spectral** field and the sparse **atom** field — now ship in JS and Rust (and,
via `packages/wasm`, in the browser as WebAssembly); Python and the shader generator scope v0.1 to
the spectral engine and document the atom engine as a follow-up.

## Parity — the shared contract

Everything under [`spec/`](spec) is the single source of truth:

- [`spec/PORTING_SPEC.md`](spec/PORTING_SPEC.md) — the language-agnostic algorithm (RNG, mode
  construction, sampling, the `FlowField` contract, boundaries, GLSL emitter, presets, structure
  primitives, time warps, gradient diagnostics). Opens with a per-feature table of which port has
  what, and which blocks the fixture actually pins. Port from this.
- [`spec/parity_fixture.json`](spec/parity_fixture.json) — the canonical fixture: **18 configs** —
  13 spectral (mode arrays + samples), 2 boundary, 3 atom-engine — **generated from `packages/js`**.
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

# WASM artifact (Rust → wasm-bindgen)
cd packages/wasm && wasm-pack build --target web --out-dir pkg && node tests/parity.test.mjs

# Shader generator
cd packages/shaders && python3 tests/test_shaders.py

# WebGL2 particle engine (framework-agnostic)
cd packages/gpu && npm install && npm test && npm run build
```

## License

MIT © Rifat Jumagulov. See [LICENSE](LICENSE).
