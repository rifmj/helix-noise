# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-07

Initial release of the Python port of Helix Noise.

- Spectral, grid-free, divergence-free 3-D velocity field as an analytic sum of Beltrami (helical)
  modes, evaluatable at any point in space and time.
- Three artist controls: spectral slope (size of the swirls), helicity (energy split between +/-
  helical states), and phase coherence (random phases → structured eddies).
- Time evolution via `churn` (advective time-evolution rate) and `decay` (viscous amplitude decay
  `e^(-ν k² t)`).
- Free-slip SDF boundary (`with_boundary` → `BoundedField`): `curl(ramp(d/thickness) · A)` — stays
  divergence-free, tangent to the wall, zero inside the obstacle, and identical to the base field
  beyond the influence band.
- GLSL emitter (`glsl`): self-contained WebGL2 / GLSL ES 3.00 shader with the mode arrays baked in
  as constants; emits the velocity functions, optional `Curl` and `Pot` variants, and compiles the
  decay term in when set.
- numpy vectorized batch sampling: `sample_many` and `sample_many_uw` evaluate many points at once
  and return numpy arrays.
- Numerical parity with the JavaScript reference: the `mulberry32` RNG stream is bit-identical, and
  a fixture-checked parity suite matches mode arrays, samples, relative helicity, bake sums,
  boundary samples, and the GLSL emitter to `1e-9`.
- The atom engine from the JavaScript library is out of scope for this release and is a documented
  follow-up.
