# helix-noise

[![crates.io](https://img.shields.io/crates/v/helix-noise.svg)](https://crates.io/crates/helix-noise)
[![docs.rs](https://img.shields.io/docsrs/helix-noise)](https://docs.rs/helix-noise)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A **divergence-free helical (Beltrami) spectral flow-field** noise for Rust.

> 📖 **API docs:** [docs.rs/helix-noise](https://docs.rs/helix-noise) — every type, option, and
> method, generated from the source. Rendered guide: [rifmj.github.io/helix-noise/docs/rust](https://rifmj.github.io/helix-noise/docs/rust).

The field is an analytic sum of divergence-free helical modes, so you can evaluate it
grid-free at any point in space and time, and its **vorticity** (curl) and **vector
potential** come out in closed form. It is useful for:

- curl-noise particle advection (smoke, dust, fluid-looking motion),
- procedural vector textures and displacement,
- animated, seamlessly-tileable flow fields,
- GPU flow shaders (emit ready-to-paste GLSL).

This crate is a **port of the JavaScript [`helix-noise`] library with numerical parity**:
the deterministic `mulberry32` mode-construction stream is bit-identical across languages,
so a field built with the same options and seed reproduces the reference values to
floating-point tolerance (~1e-12; transcendental functions differ by ~1 ULP).

The library has **zero runtime dependencies** and no threads or I/O in the hot path.

## Install

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

### Obstacles (free-slip boundary)

Wrap a field with a signed-distance obstacle. The bounded velocity is the curl of a ramped
vector potential — divergence-free, tangent to the wall, and zero inside.

```rust
use helix_noise::{HelixField, HelixOptions, BoundaryOptions};

let field = HelixField::new(HelixOptions::default());
let sphere = |x: f64, y: f64, z: f64|
    ((x - 3.0).powi(2) + (y - 3.0).powi(2) + (z - 3.0).powi(2)).sqrt() - 1.2;

let bounded = field.with_boundary(sphere, BoundaryOptions { thickness: 0.9, ..Default::default() });
let u = bounded.sample(2.0, 2.0, 2.0, 0.0);
```

### Atom engine (sparse wavelets)

An alternative engine built from compactly-supported helical wavelets ("atoms") drawn from a
spatial hash — infinite, grid-free, amortized `O(1)` per sample, and locally art-directable. It
shares the sampling surface (`sample`, `sample_uw`, `sample_ua`, `vorticity`, `bake3d`, …) and can
be wrapped by the same `with_boundary`.

```rust
use helix_noise::{HelixAtoms, AtomOptions};
let atoms = HelixAtoms::new(AtomOptions { octaves: 4, helicity: 0.7, seed: 42, ..Default::default() });
let u = atoms.sample(1.0, 2.0, 3.0);            // velocity at a point
let (u, w) = atoms.sample_uw(1.0, 2.0, 3.0, 0.5); // velocity + analytic vorticity, animated
# let _ = (u, w);
```

### Emit a GPU shader

```rust
use helix_noise::{HelixField, HelixOptions, GlslOptions};
let field = HelixField::new(HelixOptions::default());
let src = field.glsl(&GlslOptions { name: "myFlow".into(), ..Default::default() });
// `src` defines vec3 myFlow(vec3 p) / (vec3 p, float t) and myFlowCurl, ready to paste
// into a GLSL ES 3.00 / WebGL2 shader.
```

## Options

| Field        | Type              | Default        | Meaning                                                        |
|--------------|-------------------|----------------|----------------------------------------------------------------|
| `modes`      | `usize`           | `48`           | Number of helical modes. Sample cost is `O(modes)`.            |
| `slope`      | `f64`             | `1.6`          | Spectral slope `s`: amplitude ~ `\|k\|^-s` (steeper = bigger swirls). |
| `helicity`   | `f64`             | `0.0`          | `p` in `[-1, 1]`: energy split between `+`/`-` helical states. |
| `coherence`  | `f64`             | `0.0`          | `lambda` in `[0, 1]`: phases random -> structured.             |
| `kmin`       | `f64`             | `1.0`          | Smallest wavenumber (largest structures).                     |
| `kmax`       | `f64`             | `6.2`          | Largest wavenumber (finest detail).                           |
| `centers`    | `i64`             | `3`            | Focus points the coherent phases organize toward.             |
| `amplitude`  | `f64`             | `1.0`          | Output scale (field is normalized to unit RMS speed first).   |
| `tileable`   | `bool`            | `false`        | Snap wavevectors to the integer lattice -> exactly `2π`-periodic. |
| `seed`       | `u32`             | `1`            | PRNG seed (`0` is treated as `1`).                            |
| `layout`     | `Layout`          | `Fibonacci`    | `Fibonacci` (low-discrepancy) or `Random` (i.i.d. ensemble).  |
| `churn`      | `f64`             | `1.0`          | Time-evolution rate: eddy-turnover churn + structure sweep.   |
| `decay`      | `f64`             | `0.0`          | Viscosity `nu >= 0`: amplitudes decay as `e^(-nu k² t)`.       |
| `anisotropy` | `f64`             | `0.0`          | Direction stretch along `axis` (`<0` streaks, `>0` layers).   |
| `axis`       | `[f64; 3]`        | `[0, 0, 1]`    | Anisotropy axis.                                              |
| `spectrum`   | `Option<Box<dyn Fn(f64)->f64>>` | `None` | Custom amplitude law; overrides `\|k\|^-slope`.             |

## API

| Method                                   | Returns          | Description                                             |
|------------------------------------------|------------------|--------------------------------------------------------|
| `HelixField::new(opts)` / `create(opts)` | `HelixField`     | Build a field.                                         |
| `sample(x, y, z)`                        | `[f64; 3]`       | Velocity at time 0.                                    |
| `sample_t(x, y, z, t)`                   | `[f64; 3]`       | Velocity at time `t`.                                  |
| `sample_uw(x, y, z, t)`                  | `([f64;3],[f64;3])` | Velocity and vorticity.                             |
| `sample_ua(x, y, z, t)`                  | `([f64;3],[f64;3])` | Velocity and vector potential.                      |
| `vorticity(x, y, z, t)`                  | `[f64; 3]`       | Curl of the velocity.                                  |
| `helicity_density(x, y, z, t)`           | `f64`            | `u · w`.                                               |
| `potential(x, y, z, t)`                  | `[f64; 3]`       | Vector potential `A` with `curl(A) = u`.               |
| `relative_helicity(ng)`                  | `f64`            | Mean relative helicity over an `ng³` grid, in `[-1,1]`.|
| `bake3d(n, t)`                           | `Vec<f32>`       | `n³` RGBA volume: `(u.x, u.y, u.z, u·w)`.              |
| `bake2d(nx, ny, z, t)`                   | `Vec<f32>`       | `nx·ny` RGBA slice at constant `z`.                    |
| `bake_potential3d(n, t)`                 | `Vec<f32>`       | `n³` RGBA volume: `(A, u·w)`.                          |
| `with_boundary(sdf, opts)`               | `BoundedField`   | Constrain the field with a free-slip SDF obstacle.     |
| `glsl(&opts)`                            | `String`         | Emit a self-contained GLSL ES 3.00 / WebGL2 shader.    |
| `mode_snapshot()`                        | `ModeSnapshot`   | Read-only snapshot of the built spectral arrays.       |

`BoundedField` mirrors the sampling surface (`sample`, `sample_uw`, `vorticity`,
`helicity_density`, `potential`) with the obstacle applied.

## WebAssembly

The core has no threads and no I/O in the hot path, so it compiles cleanly to
`wasm32-unknown-unknown`. To expose it to JavaScript, add
[`wasm-bindgen`](https://rustwasm.github.io/wasm-bindgen/) in your own binding crate (it is
deliberately **not** a dependency here) and wrap the API, e.g.:

```rust,ignore
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

The `tests/` directory rebuilds a shared fixture (`parity_fixture.json`) — six configurations
covering defaults, helical/coherent, random/anisotropic, viscous decay in time, tileable, and
a boundary case — and asserts the full mode arrays, `u`/`w`/`A` samples, relative helicity,
and bake sums all match the JS reference within `abs+rel 1e-9` (`1e-7` for float32 bake sums).
A further test checks the emitted GLSL for the default config against the reference shader.

Run them with:

```sh
cargo test
```

## Scope

Covers both engines — the spectral [`HelixField`] and the sparse-atom [`HelixAtoms`] — plus the
free-slip SDF boundary (`with_boundary` wraps either engine via the [`VectorPotential`] trait) and
the GLSL emitter. The atom-engine GLSL emitter of the JS reference is a documented follow-up and
is not yet ported.

[`HelixField`]: https://docs.rs/helix-noise/latest/helix_noise/struct.HelixField.html
[`HelixAtoms`]: https://docs.rs/helix-noise/latest/helix_noise/struct.HelixAtoms.html
[`VectorPotential`]: https://docs.rs/helix-noise/latest/helix_noise/trait.VectorPotential.html

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT © Rifat Jumagulov. Port of the JavaScript `helix-noise` library.

[`helix-noise`]: https://www.npmjs.com/package/helix-noise
