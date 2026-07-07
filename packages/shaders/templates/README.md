# Per-target function bodies

Each file here is a **small (3-mode) reference block** showing the exact shape
`generate.py` emits for that target. They are documentation, not something you
paste directly — run `generate.py` with your own `--modes/--seed/...` to get a
real block. The *structure* is identical to what you see here.

Every target defines the same three functions over a baked constant block:

| Function | Returns | Meaning |
|----------|---------|---------|
| `helixNoise(p)` / `helixNoise(p, t)` | `vec3` | divergence-free velocity |
| `helixNoiseCurl(p[, t])` | `vec3` | curl of the velocity (vorticity) |
| `helixNoisePot(p[, t])` | `vec3` | vector potential `A` with `curl(A) == helixNoise` (only emitted with `--potential`) |

`p` is a position in the field's natural `[0, 2π)` domain (scale your coordinates
in). `t` is an optional time; pass your animation clock. When the field was
generated with `--decay > 0`, an extra `helixNoise_NU` constant appears and the
amplitude picks up an `exp(-NU * dot(k,k) * t)` viscous factor.

## Per-language syntax notes

The math is identical; only the constant-array and function syntax differ.

| Target | Vector type | Const array declaration | Zero-arg overload |
|--------|-------------|-------------------------|-------------------|
| **GLSL ES 3.00** (`glsl`) | `vec3` | `const vec3 K[N] = vec3[N](vec3(...), ...);` | `helixNoise(vec3 p)` (overload) |
| **HLSL** (`hlsl`, Unity/Unreal) | `float3` | `static const float3 K[N] = { float3(...), ... };` | `helixNoise(float3 p)` (overload) |
| **WGSL** (`wgsl`, WebGPU) | `vec3f` | `const K = array<vec3f, N>(vec3f(...), ...);` | `helixNoise0(p)` (no overloads in WGSL) |
| **Godot** (`godot`, `.gdshader`) | `vec3` | `const vec3[N] K = {vec3(...), ...};` | `helixNoise(vec3 p)` (overload) |

Notes:

- **WGSL** has no function overloading, so the zero-time entry points are suffixed
  with `0`: `helixNoise0(p)`, `helixNoiseCurl0(p)`, `helixNoisePot0(p)`.
- **HLSL** loops carry a `[loop]` attribute so the compiler does not fully unroll
  large `N`. Remove it if you prefer unrolling.
- All float literals are emitted with a decimal point or exponent so they are
  valid in every target.
