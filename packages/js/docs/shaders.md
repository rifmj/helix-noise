---
title: Shaders Reference
description: Engine-agnostic shader generator for the divergence-free helical flow field — bakes GLSL/HLSL/WGSL/Godot constants.
---

# Shaders Reference

`helix-noise-shaders` is a port of the reference [JavaScript library](/API) that emits
ready-to-paste shader code for a smooth, animated, **divergence-free** (incompressible) 3D
vector field. The field is an analytic sum of helical (Beltrami) modes, so a sample gives a
velocity that is divergence-free by construction — it reads as *fluid* flow rather than
generic value noise.

Unlike the runtime ports, this is a **code generator**: a small Python script (`generate.py`)
computes the mode arrays on the CPU once and emits them as a `const` block plus a hand-written
function body. There is no in-shader RNG — regenerating with different options re-tunes the
field. Targets are **GLSL** (GLSL ES 3.00 / WebGL2), **HLSL**, **WGSL**, and **Godot**.

- Other ports: [JavaScript](/API) · [Python](/python) · [Rust](/rust) · [React](/r3f) · [project home](/)
- Source: [`packages/shaders` on GitHub](https://github.com/rifmj/helix-noise/tree/main/packages/shaders)

## Install

No package registry and no dependencies — `generate.py` is a Python 3 script using only the
standard library. Clone the monorepo and run it directly:

```bash
git clone https://github.com/rifmj/helix-noise
cd helix-noise/packages/shaders
python3 generate.py --help
```

## Quickstart

`generate.py` prints a ready-to-paste shader to stdout. Redirect it to a file, or paste the
output straight into your shader.

```bash
# GLSL ES 3.00 (WebGL2 / Shadertoy), 48 modes, seed 1
python3 generate.py --target glsl --modes 48 --seed 1

# Unity/Unreal HLSL, coherent + helical look, with the vector potential
python3 generate.py --target hlsl --modes 32 --seed 7 \
    --helicity 0.6 --coherence 0.4 --potential

# WebGPU WGSL with a slow viscous decay
python3 generate.py --target wgsl --modes 24 --seed 3 --decay 0.02

# Godot .gdshader, tileable (integer-lattice wavevectors)
python3 generate.py --target godot --modes 24 --seed 2 --tileable > flow.gdshaderinc
```

Each call prints a constant block followed by `helixNoise`, `helixNoiseCurl`, and (with
`--potential`) `helixNoisePot`. Paste it into your shader and call `helixNoise(p)` or
`helixNoise(p, t)`.

Pre-generated, readable 24-mode examples live in
[`examples/`](https://github.com/rifmj/helix-noise/tree/main/packages/shaders/examples):
`shadertoy.glsl` (with a runnable `mainImage` demo), `unity.hlsl`, `webgpu.wgsl`,
`godot.gdshader`.

## Generated functions

`p` is a position in the field's natural `[0, 2π)` domain — scale your world coordinates into
that range. `t` is an optional time (your animation clock). GLSL/HLSL/Godot return `vec3` /
`float3`; the WGSL entry points return `vec3f`.

| Function | Returns | Description |
|----------|---------|-------------|
| `helixNoise(p)` / `helixNoise(p, t)` | vec3 | Divergence-free velocity. |
| `helixNoiseCurl(p[, t])` | vec3 | Curl of the velocity (vorticity / swirl). Omit with `--no-curl`. |
| `helixNoisePot(p[, t])` | vec3 | Vector potential `A` with `curl(A) == helixNoise`. Emitted only with `--potential`; ramp it by an SDF and take an in-shader curl for obstacle-aware, still-divergence-free flow. |

WGSL has no function overloading, so the zero-time entry points are emitted as separate
functions `helixNoise0(p)`, `helixNoiseCurl0(p)`, `helixNoisePot0(p)`.

All emitted names take the `--name` prefix; with the default name they are exactly the names
above. The constant arrays and helper names are prefixed with `helixNoise_` (or
`<name>_`).

## Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--target {glsl,hlsl,wgsl,godot}` | `glsl` | Output shading language. |
| `--modes N` | `48` | Number of helical modes. Cost of one sample is `O(modes)`; also the size of the constant arrays. |
| `--seed N` | `1` | RNG seed (integer). |
| `--slope S` | `1.6` | Spectral slope; amplitude `~ \|k\|^-S`. Steeper = bigger swirls. |
| `--helicity H` | `0.0` | In `[-1, 1]`: bias toward one handedness of swirl. |
| `--coherence C` | `0.0` | In `[0, 1]`: random phases → organized structure. |
| `--kmin K` | `1.0` | Smallest wavenumber (largest features). |
| `--kmax K` | `6.2` | Largest wavenumber (finest features). |
| `--centers N` | `3` | Focus points the coherent phases organize toward. |
| `--amplitude A` | `1.0` | Output scale (field is normalized to unit RMS speed, then scaled). |
| `--tileable` | off | Snap wavevectors to the integer lattice → exactly `2π`-periodic. |
| `--layout {fibonacci,random}` | `fibonacci` | Low-discrepancy vs i.i.d. mode directions. |
| `--churn X` | `1.0` | Time-evolution rate for `helixNoise(p, t)`. |
| `--decay NU` | `0.0` | Viscous decay `≥ 0`: amplitudes fade as `e^(-NU·k²·t)`. |
| `--anisotropy G` | `0.0` | Stretch directions along the axis (`<0` streaks along it, `>0` layers across). |
| `--axis X Y Z` | `0 0 1` | The anisotropy axis (three floats). |
| `--name NAME` | `helixNoise` | Emitted function/const prefix. |
| `--precision P` | `7` | Significant figures for float literals. |
| `--no-curl` | (curl on) | Omit the `Curl` function. |
| `--potential` | off | Also emit the vector-potential function. |

The three main artist controls are `--slope` (size of the swirls), `--helicity` (which way
they spin), and `--coherence` (calm noise → organized eddies). `--churn` and `--decay` govern
the time evolution reached by passing `t`.

## Boundaries (free-slip via SDF)

The generator has no built-in obstacle geometry, but the vector potential enables a free-slip
boundary entirely in-shader. Emit the potential with `--potential`, then in your own shader:

1. Multiply the potential `helixNoisePot(p, t)` by a smooth ramp of your obstacle's signed
   distance function (0 inside the solid, 1 in open flow).
2. Take the curl of that ramped potential with finite differences.

Because velocity is reconstructed as `∇×A`, the result stays divergence-free while the flow
slides tangent to the obstacle instead of penetrating it. This mirrors the SDF vector-potential
boundary in the JS reference; here you write the ramp and the finite-difference curl in the
target shading language.

## GLSL / GPU notes

- **Constant-array size limits.** The mode data lives in `const` arrays of length `modes`.
  Very large `modes` can hit per-stage uniform/const limits or long compile times on some
  drivers (especially WebGL2 / Shadertoy). Keep `modes` in the 16–64 range for interactive
  use; increase only if your target allows it.
- **Dynamic loop.** The HLSL emitter tags the sampling loop with `[loop]` so the compiler does
  not unroll it for large `modes`. Keep that attribute on Unreal Custom nodes.
- **Domain.** Feed positions in `[0, 2π)`; multiply your coordinates by a spatial frequency to
  zoom. With `--tileable` the field is exactly `2π`-periodic.
- **Regenerating re-tunes.** The constants are seed-derived. Changing `--seed` or any field
  option produces a different (but statistically similar) field — there is no in-shader RNG to
  keep two builds in sync. Pin your seed and options to keep a look stable.

## Paste-in instructions

### Shadertoy (WebGL2 / GLSL ES 3.00)

1. `python3 generate.py --target glsl --modes 32 --seed 1`
2. Paste the whole block at the top of a new Shadertoy shader.
3. In `mainImage`, map pixels into the field and sample:
   ```glsl
   vec3 p = vec3((fragCoord/iResolution.xy) * 6.2831853, 0.0);
   vec3 v = helixNoise(p, iTime * 0.35);
   ```
   See
   [`examples/shadertoy.glsl`](https://github.com/rifmj/helix-noise/tree/main/packages/shaders/examples/shadertoy.glsl)
   for a full runnable demo.

### Unity (custom function / shader)

- Generate HLSL: `python3 generate.py --target hlsl --modes 24 --seed 1`.
- Put the constant block + functions in an `.hlsl` file and `#include` it, **or** paste into a
  **Custom Function** node (Shader Graph) set to *File* or *String* mode, exposing a `float3 p`
  (and optional `float t`) input and a `float3` output that returns `helixNoise(p, t)`.
- Works in URP / HDRP / Built-in — it is plain HLSL with no engine dependencies.

### Unreal (Custom HLSL node)

- Generate HLSL as above.
- Add a **Custom** material expression node. Paste the constant block + functions into its
  **Code** field, add a `float3 P` input, and end with `return helixNoise(P, Time);`. Set output
  type to `CMOT Float 3`.
- For large `modes`, keep the `[loop]` attribute (already emitted) so the shader compiler does
  not unroll the loop.

### Godot 4 (`.gdshader`)

- Generate: `python3 generate.py --target godot --modes 24 --seed 2`.
- Save as a `.gdshaderinc` and `#include` it, or paste directly into a `shader_type spatial;` /
  `canvas_item` shader. Call `helixNoise(p, TIME)` from `fragment()` / `vertex()`.

### WebGPU (WGSL)

- Generate: `python3 generate.py --target wgsl --modes 24 --seed 3`.
- Paste at module scope in your WGSL shader. Call `helixNoise(p, t)` (or `helixNoise0(p)` for
  `t = 0`). The constant arrays are module-scope `const` and are indexed dynamically inside the
  functions.

## Parity

The generator embeds the same RNG (mulberry32) and field builder as the JS library. The GLSL
target reproduces the JS `field.glsl()` output, and every target is validated against a shared
parity fixture. The test suite
([`tests/test_shaders.py`](https://github.com/rifmj/helix-noise/tree/main/packages/shaders/tests))
checks:

- **GLSL parity** — `generate.py` for the reference configs equals the reference GLSL by parsed
  floats (tolerance `1e-6`) and identical non-numeric structure.
- **Structural checks** — signatures present and brace/paren balance for the HLSL, WGSL, and
  Godot targets, with constant-array counts matching `modes`.
- **Numeric self-check** — the emitted constants are parsed, the field formula is evaluated in
  pure Python at the fixture sample points, and the result matches `parity_fixture.json` within
  `1e-6` (proving the shader math is correct without a GPU).

Run it with `python3 tests/test_shaders.py`.

## Scope

v0.1 covers the **spectral engine** shader emitters (GLSL / HLSL / WGSL / Godot):

- the analytic Beltrami-mode velocity field and its curl (vorticity);
- the optional vector potential for SDF free-slip boundaries;
- time evolution (`--churn`, `--decay`);
- the artist controls `--slope`, `--helicity`, `--coherence`.

The particle/atom advection engine from the JS library (`createAtoms`) is a documented
follow-up and is **not** included in this port.

## License

MIT © Rifat Jumagulov.
