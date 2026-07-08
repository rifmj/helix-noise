---
title: Helix Noise — Rust Reference
description: Reference for the helix-noise Rust crate — a divergence-free helical (Beltrami) spectral flow field, at numerical parity with the JavaScript reference.
---

# Helix Noise — Rust Reference

The `helix-noise` crate is a Rust port of the [JavaScript reference library](/API): a
**divergence-free helical (Beltrami) spectral flow field** you can evaluate grid-free at any
point in space and time. Its **vorticity** (curl) and **vector potential** come out in closed
form, which makes it useful for curl-noise particle advection, procedural vector textures,
animated tileable flow fields, and GPU flow shaders.

The crate has **zero runtime dependencies** and no threads or I/O in the hot path, so it
compiles cleanly to WebAssembly.

**Ports:** [JavaScript](/API) · [Python](/python) · Rust (this page) · [Shaders](/shaders) ·
[React](/r3f) · [Project home](/)

**Registry & source:** [crates.io](https://crates.io/crates/helix-noise) ·
[API docs on docs.rs](https://docs.rs/helix-noise) ·
[GitHub source](https://github.com/rifmj/helix-noise/tree/main/packages/rust)

## Install

```sh
cargo add helix-noise
```

Or add it to `Cargo.toml`:

```toml
[dependencies]
helix-noise = "0.1"
```

## Quickstart

```rust
use helix_noise::{HelixField, HelixOptions};

// Build a field. Override any option; leave the rest at their defaults.
let field = HelixField::new(HelixOptions { seed: 42, modes: 48, ..Default::default() });

// Velocity at a point.
let u = field.sample(1.0, 2.0, 3.0);

// Velocity animated in time.
let u_t = field.sample_t(1.0, 2.0, 3.0, 0.5);

// Velocity + vorticity together (one pass).
let (u, w) = field.sample_uw(1.0, 2.0, 3.0, 0.0);

// Velocity + analytic vector potential together.
let (u, a) = field.sample_ua(1.0, 2.0, 3.0, 0.0);
```

`HelixField::create(opts)` is a convenience alias for `HelixField::new(opts)`.

### Custom spectrum

Override the default `|k|^-slope` power law with any callable:

```rust
use helix_noise::{HelixField, HelixOptions};
let field = HelixField::new(HelixOptions {
    spectrum: Some(Box::new(|k: f64| (-k).exp())),
    ..Default::default()
});
```

## Options

Every field has a sensible default; build one with `HelixOptions::default()` and override
individual fields with struct-update syntax.

| Field        | Type              | Default        | Meaning                                                        |
|--------------|-------------------|----------------|----------------------------------------------------------------|
| `modes`      | `usize`           | `48`           | Number of helical modes. Sample cost is `O(modes)`.            |
| `slope`      | `f64`             | `1.6`          | Spectral slope `s`: amplitude ~ `\|k\|^-s` (steeper = bigger swirls). |
| `helicity`   | `f64`             | `0.0`          | `p` in `[-1, 1]`: energy split between `+`/`-` helical states. |
| `coherence`  | `f64`             | `0.0`          | `lambda` in `[0, 1]`: phases random → structured.             |
| `kmin`       | `f64`             | `1.0`          | Smallest wavenumber (largest structures).                     |
| `kmax`       | `f64`             | `6.2`          | Largest wavenumber (finest detail).                           |
| `centers`    | `i64`             | `3`            | Focus points the coherent phases organize toward.             |
| `amplitude`  | `f64`             | `1.0`          | Output scale (field is normalized to unit RMS speed first).   |
| `tileable`   | `bool`            | `false`        | Snap wavevectors to the integer lattice → exactly `2π`-periodic. |
| `seed`       | `u32`             | `1`            | PRNG seed (`0` is treated as `1`).                            |
| `layout`     | `Layout`          | `Layout::Fibonacci` | `Fibonacci` (low-discrepancy) or `Random` (i.i.d. ensemble). |
| `churn`      | `f64`             | `1.0`          | Time-evolution rate: eddy-turnover churn + structure sweep.   |
| `decay`      | `f64`             | `0.0`          | Viscosity `nu >= 0`: amplitudes decay as `e^(-nu k² t)`.       |
| `anisotropy` | `f64`             | `0.0`          | Direction stretch along `axis` (`<0` streaks, `>0` layers).   |
| `axis`       | `[f64; 3]`        | `[0, 0, 1]`    | Anisotropy axis.                                              |
| `spectrum`   | `Option<Box<dyn Fn(f64) -> f64>>` | `None` | Custom amplitude law; overrides `\|k\|^-slope`.       |

The `spectrum` field type is aliased as `SpectrumFn` (`Box<dyn Fn(f64) -> f64>`).

## API

| Method                                   | Returns          | Description                                             |
|------------------------------------------|------------------|--------------------------------------------------------|
| `HelixField::new(opts)` / `create(opts)` | `HelixField`     | Build a field.                                         |
| `sample(x, y, z)`                        | `[f64; 3]`       | Velocity at time 0.                                    |
| `sample_t(x, y, z, t)`                   | `[f64; 3]`       | Velocity at time `t`.                                  |
| `sample_uw(x, y, z, t)`                  | `([f64; 3], [f64; 3])` | Velocity and vorticity.                          |
| `sample_ua(x, y, z, t)`                  | `([f64; 3], [f64; 3])` | Velocity and vector potential.                   |
| `vorticity(x, y, z, t)`                  | `[f64; 3]`       | Curl of the velocity.                                  |
| `helicity_density(x, y, z, t)`           | `f64`            | `u · w`.                                               |
| `potential(x, y, z, t)`                  | `[f64; 3]`       | Vector potential `A` with `curl(A) = u`.               |
| `relative_helicity(ng)`                  | `f64`            | Mean relative helicity over an `ng³` grid, in `[-1, 1]`. |
| `bake3d(n, t)`                           | `Vec<f32>`       | `n³` RGBA volume: `(u.x, u.y, u.z, u·w)`.               |
| `bake2d(nx, ny, z, t)`                   | `Vec<f32>`       | `nx·ny` RGBA slice at constant `z`.                     |
| `bake_potential3d(n, t)`                 | `Vec<f32>`       | `n³` RGBA volume: `(A, u·w)`.                           |
| `with_boundary(sdf, opts)`               | `BoundedField`   | Constrain the field with a free-slip SDF obstacle.     |
| `glsl(&opts)`                            | `String`         | Emit a self-contained GLSL ES 3.00 / WebGL2 shader.    |
| `mode_snapshot()`                        | `ModeSnapshot`   | Read-only snapshot of the built spectral arrays.       |
| `modes()`                                | `usize`          | Number of modes.                                       |
| `options()`                              | `&HelixOptions`  | The resolved options this field was built from.        |

`mode_snapshot()` returns a `ModeSnapshot` — a `Clone`/`Debug` struct exposing the per-mode
arrays (`kx`, `ky`, `kz`, `km`, `a`, `s`, `ph`, `om`, the transverse frame `e1*`/`e2*`, plus
`nu`, `scale`, and the mode count `n`) for diagnostics, serialization, and cross-port parity
checks.

## Boundaries (free-slip SDF)

Wrap a field with a signed-distance obstacle. The bounded velocity is the curl of a ramped
vector potential — divergence-free by construction, tangent to the wall, zero inside the
obstacle, and identical to the base field beyond the influence band.

```rust
use helix_noise::{HelixField, HelixOptions, BoundaryOptions};

let field = HelixField::new(HelixOptions::default());
let sphere = |x: f64, y: f64, z: f64|
    ((x - 3.0).powi(2) + (y - 3.0).powi(2) + (z - 3.0).powi(2)).sqrt() - 1.2;

let bounded = field.with_boundary(sphere, BoundaryOptions { thickness: 0.9, ..Default::default() });
let u = bounded.sample(2.0, 2.0, 2.0, 0.0);
```

`BoundedField` mirrors the sampling surface of the base field, with the obstacle applied:
`sample`, `sample_uw`, `vorticity`, `helicity_density`, and `potential` (each taking
`(x, y, z, t)`). Bounded vorticity is taken by central differences of the bounded velocity
itself.

### `BoundaryOptions`

| Field       | Type              | Default | Meaning                                                          |
|-------------|-------------------|---------|------------------------------------------------------------------|
| `thickness` | `f64`             | `1.0`   | Width of the influence band, in world units. Clamped to `>= 1e-9`. |
| `fd_step`   | `f64`             | `1e-3`  | Finite-difference step for numerical gradients (SDF gradient and bounded vorticity). |
| `gradient`  | `Option<Box<dyn Fn(f64, f64, f64) -> [f64; 3]>>` | `None` | Optional analytic SDF gradient `grad(d)`; when absent, central differences are used. |

## GLSL / GPU

Emit a self-contained GLSL ES 3.00 / WebGL2 shader that evaluates this exact field on the GPU.
The mode arrays are baked as GLSL constants; the shader does not regenerate the RNG.

```rust
use helix_noise::{HelixField, HelixOptions, GlslOptions};
let field = HelixField::new(HelixOptions::default());
let src = field.glsl(&GlslOptions { name: "myFlow".into(), ..Default::default() });
// `src` defines vec3 myFlow(vec3 p) / (vec3 p, float t) and myFlowCurl, ready to paste
// into a GLSL ES 3.00 / WebGL2 shader.
```

### `GlslOptions`

| Field       | Type     | Default        | Meaning                                                        |
|-------------|----------|----------------|----------------------------------------------------------------|
| `name`      | `String` | `"helixNoise"` | Base function name. Sanitized to `[A-Za-z0-9_]`.               |
| `precision` | `usize`  | `7`            | Significant digits for baked float literals.                  |
| `curl`      | `bool`   | `true`         | Also emit the `<name>Curl` (vorticity) pair.                  |
| `potential` | `bool`   | `false`        | Also emit the `<name>Pot` (vector potential) pair.            |

## WebAssembly

The core has no threads and no I/O in the hot path, so it compiles cleanly to
`wasm32-unknown-unknown`. To expose it to JavaScript, add
[`wasm-bindgen`](https://rustwasm.github.io/wasm-bindgen/) in your own binding crate (it is
deliberately **not** a dependency here) and wrap the API, e.g.:

```rust
use wasm_bindgen::prelude::*;
use helix_noise::{HelixField, HelixOptions};

#[wasm_bindgen]
pub struct Field(HelixField);

#[wasm_bindgen]
impl Field {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, modes: usize) -> Field {
        Field(HelixField::new(HelixOptions { seed, modes, ..Default::default() }))
    }
    pub fn sample(&self, x: f64, y: f64, z: f64) -> Vec<f64> {
        self.0.sample(x, y, z).to_vec()
    }
}
```

Then build with `wasm-pack build`.

## Parity

This crate is a port of the JavaScript reference with numerical parity: the deterministic
`mulberry32` mode-construction stream is bit-identical across languages, so a field built with
the same options and seed reproduces the reference values to floating-point tolerance
(transcendental functions differ by ~1 ULP).

The crate's `tests/` directory rebuilds a shared fixture (`parity_fixture.json`) — six
configurations covering defaults, helical/coherent, random/anisotropic, viscous decay in time,
tileable, and a boundary case — and asserts the full mode arrays, `u`/`w`/`A` samples, relative
helicity, and bake sums all match the JS reference within `abs+rel 1e-9` (`1e-7` for float32
bake sums). A further test checks the emitted GLSL for the default config against the reference
shader.

```sh
cargo test
```

The library version is exposed as the `VERSION` constant. Two further public items are the
`TAU` constant (`2π`) and `ga()` (the golden angle, `π · (3 − √5)`), used by the Fibonacci
layout. The deterministic PRNG itself is public as `Mulberry32` (`Mulberry32::new(seed)` /
`Mulberry32::seeded(seed)` / `next_f64()`), so you can reproduce the exact `mulberry32` draw
stream the mode construction consumes.

## Scope

v0.1 covers the spectral engine, the free-slip SDF boundary, and the GLSL emitter. The particle
"atom" engine of the JS reference (`createAtoms`) is a documented follow-up and is not yet
ported — it is out of scope for this release.

Relative to the JavaScript reference and the Python port, this crate also omits the batched
samplers (`sampleMany` / `sampleManyUW`), in-place `set()` re-tuning, and `selfTest()`: sample in
your own loop, rebuild with `HelixField::new`, and rely on `cargo test` for validation. The
single-point sampling surface, boundaries, bakes, and GLSL emit are at full parity.

## License

MIT © Rifat Jumagulov. Port of the JavaScript `helix-noise` library.

---

**See also:** [JavaScript reference](/API) · [Python port](/python) ·
[Shaders](/shaders) · [Project home](/) ·
[crates.io](https://crates.io/crates/helix-noise) ·
[docs.rs](https://docs.rs/helix-noise) ·
[GitHub](https://github.com/rifmj/helix-noise/tree/main/packages/rust)
