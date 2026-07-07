# helix-noise-shaders

**Engine-agnostic shader package for Helix Noise** — a smooth, animated,
**divergence-free** (incompressible) 3D vector field, baked into ready-to-paste
shader constants for GLSL, HLSL, WGSL, and Godot.

The field is an analytic sum of helical (Beltrami) modes. Sampling it gives a
velocity that is divergence-free by construction, so it reads as *fluid* flow
rather than generic value noise — ideal for flow maps, dye/smoke advection,
particle steering, warping, and vector-field visualizations. It is grid-free
(evaluate at any point), tileable on request, and smoothly time-animatable.

This package does **not** run an RNG in the shader. Instead a small Python
generator computes the mode arrays on the CPU once and emits them as a
`const` block plus a hand-written function body. Regenerating with different
options re-tunes the field.

> This is a **port of the JavaScript [`helix-noise`](../helix-noise) library**,
> reproducing its shader-emitter output with numerical parity (the GLSL target
> is byte-for-byte identical to the JS `field.glsl()` output up to the trailing
> newline; every target is validated against a shared parity fixture).

## Install

No dependencies — just Python 3 (standard library only).

```bash
git clone <this-repo>
cd helix-noise-shaders
python3 generate.py --help
```

## Quickstart

Print a ready-to-paste shader to stdout:

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

Each call prints a constant block followed by `helixNoise`, `helixNoiseCurl`,
and (with `--potential`) `helixNoisePot`. Paste it into your shader and call
`helixNoise(p)` or `helixNoise(p, t)`.

Pre-generated, readable (24-mode) examples live in [`examples/`](examples):
`shadertoy.glsl` (with a runnable `mainImage` demo), `unity.hlsl`, `webgpu.wgsl`,
`godot.gdshader`.

## API (generated functions)

`p` is a position in the field's natural `[0, 2π)` domain — scale your world
coordinates into that range. `t` is an optional time (your animation clock).

| Function | Returns | Description |
|----------|---------|-------------|
| `helixNoise(p)` / `helixNoise(p, t)` | vec3 | Divergence-free velocity. |
| `helixNoiseCurl(p[, t])` | vec3 | Curl of the velocity (vorticity / swirl). |
| `helixNoisePot(p[, t])` | vec3 | Vector potential `A` with `curl(A) == helixNoise`. Emitted only with `--potential`; ramp it by an SDF and take an in-shader curl for obstacle-aware, still-divergence-free flow. |

(WGSL has no overloading, so the zero-time entry points are `helixNoise0(p)`,
`helixNoiseCurl0(p)`, `helixNoisePot0(p)`.)

## Generator options

| Flag | Default | Meaning |
|------|---------|---------|
| `--target {glsl,hlsl,wgsl,godot}` | `glsl` | Output shading language. |
| `--modes N` | `48` | Number of helical modes. Cost of one sample is `O(modes)`; also the size of the constant arrays. |
| `--seed N` | `1` | RNG seed (integer). |
| `--slope S` | `1.6` | Spectral slope; amplitude `~ |k|^-S`. Steeper = bigger swirls. |
| `--helicity H` | `0.0` | In `[-1, 1]`: bias toward one handedness of swirl. |
| `--coherence C` | `0.0` | In `[0, 1]`: random phases → organized structure. |
| `--kmin` / `--kmax` | `1.0` / `6.2` | Smallest / largest wavenumber (largest / finest features). |
| `--centers N` | `3` | Focus points the coherent phases organize toward. |
| `--amplitude A` | `1.0` | Output scale (field is normalized to unit RMS speed, then scaled). |
| `--tileable` | off | Snap wavevectors to the integer lattice → exactly `2π`-periodic. |
| `--layout {fibonacci,random}` | `fibonacci` | Low-discrepancy vs i.i.d. mode directions. |
| `--churn X` | `1.0` | Time-evolution rate for `helixNoise(p, t)`. |
| `--decay NU` | `0.0` | Viscous decay `≥ 0`: amplitudes fade as `e^(-NU·k²·t)`. |
| `--anisotropy G` / `--axis X Y Z` | `0.0` / `0 0 1` | Stretch directions along an axis (`<0` streaks along it, `>0` layers across). |
| `--name NAME` | `helixNoise` | Emitted function/const prefix. |
| `--precision P` | `7` | Significant figures for float literals. |
| `--no-curl` | (curl on) | Omit the `Curl` function. |
| `--potential` | off | Also emit the vector-potential function. |

## Paste-in instructions

### Shadertoy (WebGL2 / GLSL ES 3.00)

1. `python3 generate.py --target glsl --modes 32 --seed 1`
2. Paste the whole block at the top of a new Shadertoy shader.
3. In `mainImage`, map pixels into the field and sample:
   ```glsl
   vec3 p = vec3((fragCoord/iResolution.xy) * 6.2831853, 0.0);
   vec3 v = helixNoise(p, iTime * 0.35);
   ```
   See [`examples/shadertoy.glsl`](examples/shadertoy.glsl) for a full runnable demo.

### Unity (custom function / shader)

- Generate HLSL: `python3 generate.py --target hlsl --modes 24 --seed 1`.
- Put the constant block + functions in an `.hlsl` file and `#include` it, **or**
  paste into a **Custom Function** node (Shader Graph) set to *File* or *String*
  mode, exposing a `float3 p` (and optional `float t`) input and a `float3` output
  that returns `helixNoise(p, t)`.
- Works in URP/HDRP/Built-in — it is plain HLSL with no engine dependencies.

### Unreal (Custom HLSL node)

- Generate HLSL as above.
- Add a **Custom** material expression node. Paste the constant block + functions
  into its **Code** field, add a `float3 P` input, and end with
  `return helixNoise(P, Time);`. Set output type to `CMOT Float 3`.
- For large `modes`, keep the `[loop]` attribute (already emitted) so the shader
  compiler does not unroll the loop.

### Godot 4 (`.gdshader`)

- Generate: `python3 generate.py --target godot --modes 24 --seed 2`.
- Save as a `.gdshaderinc` and `#include` it, or paste directly into a
  `shader_type spatial;` / `canvas_item` shader. Call `helixNoise(p, TIME)` from
  `fragment()` / `vertex()`.

### WebGPU (WGSL)

- Generate: `python3 generate.py --target wgsl --modes 24 --seed 3`.
- Paste at module scope in your WGSL shader. Call `helixNoise(p, t)` (or
  `helixNoise0(p)` for `t = 0`). The constant arrays are module-scope `const` and
  are indexed dynamically inside the functions.

## Notes & limits

- **Constant-array size limits.** The mode data lives in `const` arrays of length
  `modes`. Very large `modes` can hit per-stage uniform/const limits or long
  compile times on some drivers (especially WebGL2/Shadertoy). Keep `modes` in the
  16–64 range for interactive use; increase only if your target allows it.
- **Regenerating re-tunes.** The constants are seed-derived. Changing `--seed` or
  any field option produces a different (but statistically similar) field — there
  is no in-shader RNG to keep two builds in sync. Pin your seed/options to keep a
  look stable.
- **Domain.** Feed positions in `[0, 2π)`; multiply your coordinates by a spatial
  frequency to zoom. With `--tileable` the field is exactly `2π`-periodic.
- **Parity.** The generator embeds the same RNG and field builder as the JS
  library; the GLSL target matches the JS `field.glsl()` output and all targets
  are checked against `tests/parity_fixture.json`. Run `python3 tests/test_shaders.py`.

## Scope

v0.1 covers the **spectral engine** shader emitters (GLSL / HLSL / WGSL / Godot).
The particle/atom advection engine from the JS library is a documented follow-up
and is **not** included here.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT © Rifat Jumagulov. See [LICENSE](LICENSE).
