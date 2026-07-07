# helix-noise (Python)

Spectral, **divergence-free** helical flow fields for procedural graphics — smoke,
fluids, curl-noise motion, vector-field art. The field is an analytic sum of Beltrami
(helical) modes, so you can evaluate it **grid-free** at any point in space and time, bake
it to a texture, constrain it around an obstacle, or emit an equivalent GLSL shader.

This is a Python + numpy port of the JavaScript
[`helix-noise`](../helix-noise) library. It is at **numerical parity** with the JS
reference: the `mulberry32` RNG stream is bit-identical across languages, and field values
match to ~1e-12 (transcendental ULP differences only). A parity test suite reproduces the
reference fixture (mode arrays, samples, relative helicity, bake sums, boundary samples,
and the GLSL emitter).

## Install

```bash
pip install helix-noise
```

Requires Python >= 3.9 and numpy >= 1.20. From a source checkout:

```bash
pip install -e .
```

## Quickstart

```python
import helix_noise as hn

field = hn.create(modes=48, seed=1, helicity=0.6, coherence=0.4)

# Sample velocity at a point (grid-free).
u = field.sample(1.0, 2.0, 0.5)            # (ux, uy, uz)
w = field.vorticity(1.0, 2.0, 0.5)         # (wx, wy, wz)

# Animate over time.
u_t = field.sample(1.0, 2.0, 0.5, t=0.3)

# Vectorized: evaluate many points at once (numpy).
import numpy as np
pts = np.random.rand(10000, 3) * (2 * np.pi)
vel = field.sample_many(pts)               # (10000, 3)

# Bake a tileable 3D velocity texture (n, n, n, 4) float32; rgba = (u, v, w, u·w).
tex = field.bake3d(32)

# Emit an equivalent WebGL2 / GLSL ES 3.00 shader.
print(field.glsl(name="myFlow", curl=True))
```

### Free-slip obstacles

Wrap the field with a signed-distance function to make the flow slide tangentially
around an obstacle while staying divergence-free:

```python
import math

def sphere(x, y, z):
    return math.hypot(x - 3, y - 3, z - 3) - 1.2

bounded = field.with_boundary(sphere, thickness=0.9)
u = bounded.sample(3.0, 3.0, 4.5)          # zero inside, slip on the surface
```

## API

### `create(**opts) -> HelixField`

| Option        | Default        | Meaning |
|---------------|----------------|---------|
| `modes`       | `48`           | Number of helical modes (per-sample cost is O(modes)). |
| `slope`       | `1.6`          | Spectral slope `s`: amplitude ~ `\|k\|^-s` (steep = big swirls). |
| `helicity`    | `0.0`          | In `[-1, 1]`: energy split between +/- helical states. |
| `coherence`   | `0.0`          | In `[0, 1]`: random phases -> structured (fixed spectrum). |
| `kmin`        | `1.0`          | Smallest wavenumber (largest structures). |
| `kmax`        | `6.2`          | Largest wavenumber (finest detail). |
| `centers`     | `3`            | Focus points the coherent phases organize toward. |
| `amplitude`   | `1.0`          | Output scale; field is normalized to unit RMS speed, then scaled. |
| `tileable`    | `False`        | Snap wavevectors to the integer lattice => exactly 2π-periodic. |
| `seed`        | `1`            | RNG seed (uint32). |
| `layout`      | `"fibonacci"`  | Mode layout: `"fibonacci"` (low-discrepancy) or `"random"` (i.i.d.). |
| `churn`       | `1.0`          | Time-evolution rate for `sample(x, y, z, t)`. |
| `decay`       | `0.0`          | Viscosity ν >= 0: amplitudes decay as `e^(-ν k² t)`. |
| `anisotropy`  | `0.0`          | Direction stretch along `axis` (< 0 streaks, > 0 layers). |
| `axis`        | `[0, 0, 1]`    | Anisotropy axis. |
| `spectrum`    | `None`         | Optional callable `(k: float) -> float` overriding the `\|k\|^-slope` law. |

### `HelixField` methods

| Method | Returns | Notes |
|--------|---------|-------|
| `sample(x, y, z, t=0.0)` | `(u, v, w)` | Velocity at a point. |
| `sample_uw(x, y, z, t=0.0)` | `((u...), (w...))` | Velocity + vorticity. |
| `sample_ua(x, y, z, t=0.0)` | `((u...), (A...))` | Velocity + vector potential. |
| `vorticity(x, y, z, t=0.0)` | `(wx, wy, wz)` | Curl of velocity. |
| `helicity_density(x, y, z, t=0.0)` | `float` | `u · w`. |
| `potential(x, y, z, t=0.0)` | `(Ax, Ay, Az)` | Analytic vector potential. |
| `sample_many(pos, t=0.0)` | `(n, 3)` array | Vectorized velocity; `pos` is `(n, 3)` or flat. |
| `sample_many_uw(pos, t=0.0)` | `(u, w)` arrays | Vectorized velocity + vorticity. |
| `bake3d(n, t=0.0)` | `(n, n, n, 4)` float32 | rgba = `(u, v, w, u·w)`. |
| `bake2d(nx, ny, z=0.0, t=0.0)` | `(ny, nx, 4)` float32 | Slice at height `z`. |
| `bake_potential3d(n, t=0.0)` | `(n, n, n, 4)` float32 | rgb = potential, a = `u·w`. |
| `relative_helicity(ng=12)` | `float` | Normalized mean helicity over an `ng³` grid. |
| `with_boundary(sdf, thickness=1.0, gradient=None, fd_step=1e-3)` | `BoundedField` | Free-slip SDF obstacle. |
| `glsl(name="helixNoise", precision=7, curl=True, potential=False)` | `str` | Self-contained WebGL2 shader. |
| `set(**opts)` | `self` | Update options and rebuild in place. |
| `params` | `dict` | The resolved option set. |

Mode arrays (`kx`, `ky`, `kz`, `km`, `a`, `s`, `ph`, `om`, `e1*`, `e2*`, `N`, `nu`,
`_scale`) are exposed as numpy float64 arrays for inspection.

### `BoundedField`

Returned by `with_boundary`. Provides `sample`, `sample_uw`, `vorticity`,
`helicity_density`, `potential`, `bake3d`, and `bake_potential3d`. Velocity is
`curl(ramp(d/thickness) · A)` — divergence-free, tangent to the wall (free-slip), zero
inside the obstacle, and identical to the base field beyond the influence band.

## Parity / testing

```bash
python3 tests/test_parity.py       # stdlib + numpy only
python3 -m pytest -q                # if pytest is installed
```

The suite rebuilds every fixture config and asserts mode arrays, sample `u`/`w`/`A`,
relative helicity, the bake sum, the free-slip boundary samples, and the GLSL emitter all
match the JS reference within abs+rel `1e-9` (`1e-7` for the float32 bake sum).

## Scope / follow-ups

v0.1 ships the spectral engine, the free-slip SDF boundary, and the GLSL emitter. The
**atom engine** from the JS library is out of scope for this release and is a documented
follow-up.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT © Rifat Jumagulov
