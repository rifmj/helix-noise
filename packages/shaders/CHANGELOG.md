# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-07

Initial release of the Helix Noise shader generator — an engine-agnostic port of the
JavaScript reference library that bakes the field into ready-to-paste shader constants.

- Spectral Beltrami-mode engine: an analytic sum of helical modes producing a divergence-free
  3D velocity field, evaluatable at any point.
- Three artist controls: spectral `--slope` (size of the swirls), `--helicity` (handedness of
  the swirl), and phase `--coherence` (calm noise → organized structure).
- Time evolution: `--churn` (evolution rate) and `--decay` (viscous amplitude falloff
  `e^(-NU·k²·t)`) for the `helixNoise(p, t)` entry point.
- Emitted functions: `helixNoise` (velocity), `helixNoiseCurl` (vorticity, on by default,
  omit with `--no-curl`), and `helixNoisePot` (vector potential, with `--potential`). The
  vector potential enables a free-slip SDF boundary — ramp it by a signed distance function
  and take an in-shader curl to keep flow divergence-free while it slides tangent to obstacles.
- Targets: GLSL (GLSL ES 3.00 / WebGL2), HLSL, WGSL, and Godot `.gdshader`, with per-engine
  paste-in instructions for Shadertoy, Unity, Unreal, Godot 4, and WebGPU. WGSL emits separate
  zero-time entry points (`helixNoise0`, `helixNoiseCurl0`, `helixNoisePot0`) since it has no
  overloading.
- Additional generator options: `--modes`, `--seed`, `--kmin` / `--kmax`, `--centers`,
  `--amplitude`, `--tileable` (integer-lattice, exactly 2π-periodic), `--layout`,
  `--anisotropy` / `--axis`, `--name`, and `--precision`.
- Self-contained: Python 3 standard library only. The generator embeds the mulberry32 RNG and
  the field builder, so there is no in-shader RNG — the mode arrays are baked as `const` blocks.
- Numerical parity with the JS reference: the GLSL target reproduces the JS `field.glsl()`
  output, and all targets are fixture-checked (parsed floats and the numeric self-check match
  to `1e-6`).
- Scope: the spectral engine only. The particle/atom advection engine (`createAtoms`) from the
  JS library is out of scope for this release and is a documented follow-up.
