# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-07-07

Adds the second engine and generalizes the boundary.

- **Atom engine** (`HelixAtoms` / `AtomOptions`): the sparse-wavelet field of the JS reference,
  ported at full numerical parity (bit-identical spatial hash and per-atom PRNG draw order). A
  divergence-free sum of compactly-supported helical wavelets on a spatial hash — infinite,
  grid-free, amortized `O(1)` per sample, with per-region helicity/gain. Shares the sampling
  surface (`sample`, `sample_uw`, `sample_ua`, `vorticity`, `helicity_density`, `potential`,
  `sample_many`, `bake3d`/`bake2d`/`bake_potential3d`, `relative_helicity`) and closed-form
  vorticity/potential. The atom-engine GLSL emitter remains a follow-up.
- **`VectorPotential` trait**: `with_boundary` now wraps *either* engine. Any field exposing its
  exact vector potential gets the free-slip SDF obstacle for free.
- Parity fixtures extended with three atom configs; the `atom_configs_match_fixture` test asserts
  the port reproduces the JS reference within `1e-9`.

### Breaking

- `BoundedField<'f, S>` is now `BoundedField<'f, B, S>` (generic over the wrapped engine `B`).
  `HelixField::with_boundary` returns `BoundedField<'_, HelixField, S>`. Code that named the type
  parameters explicitly needs the extra argument; typical `let bounded = field.with_boundary(...)`
  usage is unaffected.

## [0.1.0] - 2026-07-07

Initial release of the Rust port of Helix Noise.

- Spectral engine: a grid-free, divergence-free 3-D velocity field built as an analytic sum
  of Beltrami (helical) modes, with closed-form vorticity (curl) and vector potential.
- Three artist controls: `slope` (spectral slope / swirl size), `helicity` (energy split
  between `+`/`-` helical states), and `coherence` (phases random → structured).
- Time evolution: `churn` (eddy-turnover phase churn + structure sweep) and `decay`
  (viscous amplitude decay `e^(-nu k² t)`).
- Free-slip SDF boundary: `with_boundary` wraps a field with a signed-distance obstacle;
  the bounded velocity is the curl of a ramped vector potential — divergence-free, tangent
  to the wall, and zero inside.
- GLSL emitter: `glsl` produces a self-contained GLSL ES 3.00 / WebGL2 shader that evaluates
  the exact same field on the GPU, with optional curl and vector-potential pairs.
- Zero runtime dependencies; no threads or I/O in the hot path, so the crate compiles cleanly
  to WebAssembly (`wasm32-unknown-unknown`).
- Numerical parity with the JavaScript reference: the deterministic `mulberry32`
  mode-construction stream is bit-identical, and a shared fixture is checked to `abs+rel 1e-9`
  (`1e-7` for float32 bake sums).
- Out of scope for this release: the particle "atom" engine (`createAtoms`) of the JS
  reference is a documented follow-up and is not yet ported.
