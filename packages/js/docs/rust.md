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
helix-noise = "0.7"
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
| `ellipticity` | `f64`            | `1.0`          | Polarization ellipticity `eps` in `[0, 1]` (clamped): per-mode chirality `chi = eps*s`. `1` = circular/Beltrami modes (tubes & corkscrews), `0` = linearly polarized modes (sheets & jets, zero helicity). Consumes no RNG draws. |
| `spectrum`   | `Option<Box<dyn Fn(f64) -> f64>>` | `None` | Custom amplitude law; overrides `\|k\|^-slope`.       |
| `coherence_fn` | `Option<Box<dyn Fn(f64) -> f64>>` | `None` | Optional per-wavenumber coherence `(k) -> lambda`; overrides `coherence` when set. |
| `helicity_fn` | `Option<Box<dyn Fn(f64) -> f64>>` | `None` | Optional per-wavenumber helicity `(k) -> p`; overrides `helicity` when set.     |
| `polarization_axis` | `Option<[f64; 3]>` | `None`   | World-space grain axis for linear polarization. `None` = channel off.          |
| `polarization_bias` | `f64`        | `0.0`          | Linear-polarization strength `d` in `[0, 0.95]` along `polarization_axis`.      |
| `flutter`    | `f64`             | `0.0`          | Temporal flutter `>= 0`: a fast, deterministic phase wobble on top of the churn drift. Vanishes exactly at `t = 0` and consumes no RNG draws. |

The `spectrum` field type is aliased as `SpectrumFn` (`Box<dyn Fn(f64) -> f64>`); `coherence_fn`
and `helicity_fn` share that same alias as `ScaleFn` (`Box<dyn Fn(f64) -> f64>`), evaluated once
per mode at its final `|k|` — pure and RNG-free, so setting the scalar or the callable never
changes the draw sequence.

## Presets

The `presets` module has three per-wavenumber dial shapes (`ScaleFn` factories, no RNG), a
closed-form ABC cell field, a two-field compositor, and two option bundles for exact/measured
Navier–Stokes states.

```rust
use helix_noise::{
    abc, exact_ns, ns_developed, rolloff, shell_peak, AbcOptions, ExactNsOptions, HelixField,
    HelixOptions,
};

// Energy-containing shell instead of a power law; pair with a matching kmin/kmax.
let field = HelixField::new(HelixOptions {
    spectrum: Some(shell_peak(4.0, 0.8)),
    coherence_fn: Some(rolloff(3.0)),
    ..Default::default()
});

// The classical ABC cell, as exactly three engine modes — every sampler works on it unchanged.
let cell = abc(1.0, 1.0, 1.0, AbcOptions::default());

// An exact Navier–Stokes solution: single shell, one handedness, pure viscous decay.
let ns = HelixField::create(HelixOptions {
    seed: 7,
    ..exact_ns(ExactNsOptions { k0: 2.0, nu: 0.02, sign: 1.0 })
});

// Polarization calibrated to measured developed turbulence (spectrum left at the default power law).
let dev = HelixField::create(HelixOptions { seed: 3, ..ns_developed() });
```

| Item | Kind | Meaning |
|------|------|---------|
| `shell_peak(k_peak, width)` | `fn -> ScaleFn` | Gaussian shell bump `a(k) = exp(-(k-k_peak)²/(2·width²))`, an energy-containing band instead of a power law. |
| `rolloff(kc)` | `fn -> ScaleFn` | Coherence preset `lambda(k) = clamp(1 - k/kc, 0, 1)`: organized structure below `kc`, uncorrelated noise above it. |
| `condensate(k_split, p_large, p_small)` | `fn -> ScaleFn` | Helicity preset: `p_large` for `k <= k_split`, `p_small` above — a handed large-scale condensate over a near-mirror-symmetric fine background. |
| `abc(a, b, c, AbcOptions)` | `fn -> HelixField` | The classical ABC (Arnold–Beltrami–Childress) cell, built as exactly three modes. Consumes no RNG, is exactly `2π`-tileable, and is a pure Beltrami field (`curl u = u`). |
| `AbcOptions { amplitude, decay }` | struct | `amplitude: Option<f64>` RMS-normalizes when set (default `None` returns the literal field); `decay: f64` gives the exact viscous solution `u(t) = e^(-nu·t) u(0)`. |
| `TwoScale { base, detail, detail_gain }` | struct | Componentwise sum of two fields (still divergence-free); `TwoScale::new(base, detail, detail_gain)`, with `sample`/`sample_uw`/`sample_ua`/`vorticity`/`helicity_density`/`potential`. |
| `C_TWO_SCALE` | `f64` const | `1.6` — detail-layer amplitude constant: `amplitude = C_TWO_SCALE / k_detail` holds its vorticity budget fixed as you move the detail wavenumber. |
| `exact_ns(ExactNsOptions)` | `fn -> HelixOptions` | Option bundle for a field that is an **exact solution of the Navier–Stokes equations**: one shell `|k| = k0`, one handedness, decaying as `e^(-nu·k0²·t)`. |
| `ExactNsOptions { k0, nu, sign }` | struct | `k0: f64` (default `2.0`) shell wavenumber; `nu: f64` (default `0.02`) viscosity; `sign: f64` (default `1.0`) chirality `+1`/`-1`. |
| `ns_developed()` / `ns_forced()` | `fn -> HelixOptions` | Option bundles whose **polarization** matches measured developed / forced turbulence (`NS_TARGETS_DEV` / `NS_TARGETS_FORCED`); the spectrum stays the default power law — supply your own `spectrum` if you have a measured one. |
| `NsTargets { d, abs_p, signed_p }` | struct | Energy-weighted polarization of a measured turbulence state: linear-polarization degree, per-shell helical fraction `\|p\|`, and its signed mean. |

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

## Atom engine

`HelixAtoms` is the sparse-atom counterpart to the spectral `HelixField`: a divergence-free sum
of compactly-supported helical wavelets ("atoms") drawn deterministically from a spatial hash,
rather than a finite mode sum evaluated everywhere. Each atom is
`u_atom = curl(W * A) = (grad W) x A + W * u_wave`, with `u_wave` a helical plane wave, `A` its
exact Beltrami potential, and `W = (1 - q²)³` a `C²` window that vanishes at the support radius.
Atoms live on a hash lattice (one PRNG per cell), so the field is infinite, grid-free, amortized
`O(1)` per sample, and any region can carry its own helicity/gain via `helicity_field` /
`gain_field`. It is divergence-free exactly — every atom is a curl. This is a numerical-parity
port of the JS reference `HelixAtoms`: the integer spatial hash and the per-atom `mulberry32`
draw order are bit-identical.

```rust
use helix_noise::{AtomOptions, HelixAtoms};

let atoms = HelixAtoms::new(AtomOptions { octaves: 4, helicity: 0.7, seed: 42, ..Default::default() });

let u = atoms.sample(1.0, 2.0, 3.0);
let (u, w) = atoms.sample_uw(1.0, 2.0, 3.0, 0.0);
let h = atoms.relative_helicity(12);
```

### `AtomOptions`

| Field              | Type                      | Default        | Meaning                                                        |
|---------------------|--------------------------|----------------|------------------------------------------------------------------|
| `octaves`           | `usize`                  | `3`            | Octave layers; each halves the atom radius and doubles the wavenumber. |
| `atoms_per_cell`     | `usize`                  | `8`            | Atoms per hash cell (a cell is one atom diameter wide). Density/quality knob. |
| `radius`             | `f64`                    | `1.6`          | Support radius of the largest atoms (octave 0); octave `o` uses `radius / 2^o`. |
| `cycles_per_atom`    | `f64`                    | `2.0`          | Wavelengths across an atom's diameter — sets `\|k\| * radius` per octave. |
| `slope`              | `f64`                    | `1.6`          | Amplitude `~ \|k\|^-slope` across octaves.                      |
| `helicity`           | `f64`                    | `0.0`          | `p` in `[-1, 1]`, as in the spectral engine.                    |
| `amplitude`          | `f64`                    | `1.0`          | Output scale. The field is normalized to unit RMS at `t = 0`, then multiplied by this. |
| `seed`               | `u32`                    | `1`            | PRNG seed (`0` is treated as `1`).                              |
| `churn`              | `f64`                    | `1.0`          | Time-evolution rate: per-atom phase churn at `omega(k) ~ k^(2/3)`. `0` freezes. |
| `anisotropy`         | `f64`                    | `0.0`          | Direction anisotropy `gamma` (clamped to `[-0.99, 9]`): streaks (`< 0`) or layers (`> 0`) along `axis`. |
| `axis`               | `[f64; 3]`                | `[0, 0, 1]`    | Anisotropy axis (normalized internally).                        |
| `helicity_field`     | `Option<ScalarField3>`    | `None`         | Spatially-varying helicity, sampled at each atom's center. Overrides `helicity` locally. |
| `gain_field`         | `Option<ScalarField3>`    | `None`         | Spatially-varying amplitude gain, sampled at each atom's center. |
| `spectrum`           | `Option<SpectrumFn>`      | `None`         | Custom amplitude law `a(\|k\|) >= 0`, replacing the octave power law (shape only). |

`ScalarField3` is `Box<dyn Fn(f64, f64, f64) -> f64>` — a spatially-varying scalar field sampled
once at each atom's center.

### `HelixAtoms` API

| Method                          | Returns                | Description                                             |
|----------------------------------|------------------------|------------------------------------------------------------|
| `HelixAtoms::new(opts)` / `create(opts)` | `HelixAtoms`     | Build an atom field.                                     |
| `set(opts)`                      | `&mut Self`            | Replace the options and re-tune: recompute the base wavenumber, flush the atom cache, renormalize to unit RMS. |
| `options()`                      | `&AtomOptions`          | Current options.                                          |
| `k_base()`                       | `f64`                   | Base wavenumber `\|k\|` of octave 0 (`cycles_per_atom * pi / radius`). |
| `scale()`                        | `f64`                   | The RMS-normalization scale applied to every sample.       |
| `sample(x, y, z)`                | `[f64; 3]`              | Velocity at time 0.                                        |
| `sample_t(x, y, z, t)`           | `[f64; 3]`              | Velocity at time `t`.                                      |
| `sample_uw(x, y, z, t)`          | `([f64; 3], [f64; 3])`  | Velocity and its analytic vorticity, one pass.              |
| `sample_ua(x, y, z, t)`          | `([f64; 3], [f64; 3])`  | Velocity and its exact vector potential, one pass.           |
| `vorticity(x, y, z, t)`          | `[f64; 3]`              | Curl of the velocity.                                       |
| `helicity_density(x, y, z, t)`   | `f64`                   | `u · w`.                                                     |
| `potential(x, y, z, t)`          | `[f64; 3]`              | Exact vector potential.                                      |
| `sample_many(pos, t)`            | `Vec<f64>`              | Batch velocities for interleaved `[x, y, z, ...]` points, returning `[u, v, w, ...]`. |
| `sample_many_uw(pos, t)`         | `Vec<f64>`              | Batch velocity + analytic vorticity, 6 floats per point.     |
| `relative_helicity(ng)`          | `f64`                   | `<u . omega> / (‖u‖ ‖omega‖)` on an `ng³` grid spanning a few radii. |
| `bake3d(n, t)`                   | `Vec<f32>`              | `n³` RGBA volume: `rgb` = velocity, `a` = helicity density, over `[0, 2π)³`. |
| `bake2d(nx, ny, z, t)`           | `Vec<f32>`              | `nx*ny` RGBA slice at height `z`.                             |
| `bake_potential3d(n, t)`         | `Vec<f32>`              | `n³` RGBA volume: `rgb` = vector potential `A`, `a` = helicity density. |
| `with_boundary(sdf, opts)`       | `BoundedField`          | Wrap this field with a free-slip SDF obstacle.               |

Unlike `HelixField`, `HelixAtoms` has **no `glsl()`** — the atom-engine GLSL emitter of the JS
reference (`atomsToGLSL`) is not yet ported.

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

The crate covers both engines of the JS reference — the spectral `HelixField` and the sparse-atom
`HelixAtoms` — plus the free-slip SDF boundary (wraps either engine), the GLSL emitter for
`HelixField`, and the `presets` module (dial shapes, the ABC cell, `TwoScale`, and the
`exact_ns`/`ns_developed`/`ns_forced` option bundles).

What it still lacks relative to the JavaScript reference and the Python port:

- **On `HelixField`**: the batched samplers (`sampleMany` / `sampleManyUW`), in-place `set()`
  re-tuning, and `selfTest()` — sample in your own loop, rebuild with `HelixField::new`, and rely
  on `cargo test` for validation. (`HelixAtoms` *does* have its own `sample_many` /
  `sample_many_uw` and `set()` — see [Atom engine](#atom-engine) above.)
- **On `HelixAtoms`**: the GLSL emitter (`atomsToGLSL` in the JS reference) is not ported, so
  atom fields can't yet be baked into a shader the way spectral fields can with `glsl()`.
- The structure primitives (`createRing`, `axisymmetric`, `strainedColumn`, and friends) and the
  time warps (`collapse`, `dssCollapse`) that the JS reference exports from `primitives.ts` /
  `warps.ts` have no Rust equivalent at all — there is no `primitives` or `warps` module in this
  crate.

The single-point sampling surface, boundaries, bakes, and GLSL emit for `HelixField` are at full
parity; the atom engine's sampling surface, boundaries, and bakes are likewise at full parity.

## License

MIT © Rifat Jumagulov. Port of the JavaScript `helix-noise` library.

---

**See also:** [JavaScript reference](/API) · [Python port](/python) ·
[Shaders](/shaders) · [Project home](/) ·
[crates.io](https://crates.io/crates/helix-noise) ·
[docs.rs](https://docs.rs/helix-noise) ·
[GitHub](https://github.com/rifmj/helix-noise/tree/main/packages/rust)
