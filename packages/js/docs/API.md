# Helix Noise — API Reference

A practical reference for developers. It covers every public function, option, and method.
For the concepts and the visual tour, see the
[README](https://github.com/rifmj/helix-noise#readme).

**Mental model in one line:** you create a *field*, then ask it for a velocity at any point in
space (and, optionally, at any time). The velocity is always divergence-free — it moves like a
real, incompressible fluid — so anything you carry along it (particles, smoke, water, hair) looks
alive and never clumps.

- [Getting started](#getting-started)
- [Entry points](#entry-points)
- [`create(options)` — the spectral field](#createoptions--the-spectral-field)
  - [Options](#options)
  - [Reading the field](#reading-the-field)
  - [Batch sampling](#batch-sampling)
  - [Baking to a texture](#baking-to-a-texture)
  - [Boundaries (flow around obstacles)](#boundaries-flow-around-obstacles)
  - [GLSL / GPU](#glsl--gpu)
  - [Re-tuning](#re-tuning)
- [`createAtoms(options)` — the atom field](#createatomsoptions--the-atom-field)
- [Helpers](#helpers)
- [Types](#types)

---

## Getting started

```bash
npm install helix-noise
```

```js
import { create } from "helix-noise";

const field = create({ helicity: 0.8, coherence: 0.5 });

const [u, v, w] = field.sample(x, y, z);       // velocity at a point
const [u2, v2, w2] = field.sample(x, y, z, t); // …the same field, later in time
```

Ships as **ES module**, **CommonJS**, and a **`<script>` global** (`HelixNoise.create(...)`).
TypeScript types are included. Zero runtime dependencies.

---

## Entry points

| Function | Returns | Use it for |
|---|---|---|
| [`create(options?)`](#createoptions--the-spectral-field) | [`Field`](#field) | The main engine. Coherent, tileable, GPU-friendly. Start here. |
| [`createAtoms(options?)`](#createatomsoptions--the-atom-field) | [`AtomField`](#atomfield) | Infinite, broadband, regionally art-directed flow. |
| [`version`](#helpers) | `string` | The library version. |
| [`selfTest()`](#helpers) | [`SelfTestReport`](#selftestreport) | A built-in sanity check (divergence, etc.). |

Both engines share the same sampling surface, so most of your code doesn't care which one you use.

---

## `create(options)` — the spectral field

```js
const field = create({ modes: 48, slope: 1.6, helicity: 0.8, coherence: 0.5, seed: 1 });
```

Returns a [`Field`](#field). All options are optional — sensible defaults are shown below.

### Options

**The three you'll actually reach for:**

| Option | Type | Default | What it does |
|---|---|---|---|
| `slope` | `number` | `1.6` | Size of the structures. Higher = a few big soft swirls; lower = fine multi-scale grain. |
| `helicity` | `number \| (k) => number` | `0` | Handedness of the swirls, from `-1` (one way) through `0` (mirror-symmetric) to `+1` (the other way). Pass a function of the wavenumber for a scale-dependent profile. |
| `coherence` | `number \| (k) => number` | `0` | `0` = formless noise, `1` = organized eddies — **at the same busyness**. The dial plain curl-noise doesn't have. Also accepts a function of the wavenumber. |
| `ellipticity` | `number` | `1` | Polarization: `1` = corkscrew **tubes** (the classic look), `0` = laminated **sheets/jets**, in between = braided. Changes the texture at a fixed spectrum and a fixed `helicity`. |

> **Three independent shape dials.** `anisotropy` = *where the waves point*, `ellipticity` =
> *how each wave polarizes*, `helicity` = *which way it winds*. They are genuinely independent —
> no other curl-noise exposes the middle one.
>
> Note the interaction: at `ellipticity = 0` every wave is achiral, so the `helicity` slider has
> no visible effect and `relativeHelicity()` reads ≈ 0. More generally a single wave's relative
> helicity is capped at `2ε/(1+ε²)`, so `relativeHelicity()` scales down with `ellipticity`.

**Structure & scale:**

| Option | Type | Default | What it does |
|---|---|---|---|
| `modes` | `number` | `48` | How many waves are summed. More = richer detail but each sample costs more (cost is linear in `modes`). |
| `kmin` | `number` | `1` | Smallest wavenumber = the **largest** structures. |
| `kmax` | `number` | `6.2` | Largest wavenumber = the **finest** detail. |
| `centers` | `number` | `3` | How many focus points the coherent structures organize around (only matters when `coherence > 0`). |
| `amplitude` | `number` | `1` | Output scale. The field is normalized to unit average speed, then multiplied by this. |
| `seed` | `number` | `1` | Integer seed. Same seed ⇒ exactly the same field. |

**Time (only active when you pass `t` to a sampler):**

| Option | Type | Default | What it does |
|---|---|---|---|
| `churn` | `number` | `1` | How fast the field evolves over time. `0` freezes it. Fine detail flickers faster than big structures. Has no effect at `t = 0`. |
| `decay` | `number` | `0` | Optional viscosity: the field gently fades over time as if it were a real, slowly-dissipating fluid. `0` = never fades. |

**Advanced shaping:**

| Option | Type | Default | What it does |
|---|---|---|---|
| `tileable` | `boolean` | `false` | Snaps waves to an integer grid so the field repeats seamlessly every `2π`. Great for textures. |
| `anisotropy` | `number` | `0` | Stretches the flow along `axis`. `< 0` → streaks *along* the axis (jets); `> 0` → layers *across* it (strata). |
| `axis` | `[number,number,number]` | `[0,0,1]` | The direction `anisotropy` works along. |
| `polarizationAxis` | `[number,number,number] \| null` | `null` | A world-space **grain axis**: the direction the texture combs along. `null` leaves the channel off. |
| `polarizationBias` | `number` | `0` | How strongly the flow polarizes along that axis, `0 … 0.95`. |
| `spectrum` | `(k: number) => number` | — | Custom amplitude curve, replacing the `slope` power law. Only the shape matters (the field is re-normalized). Must be pure. |
| `layout` | `"fibonacci" \| "random"` | `"fibonacci"` | How the waves are spread out. `"fibonacci"` (default) looks cleaner at the same `modes` — use it for rendering. `"random"` gives statistically independent waves (for Monte-Carlo / analysis work); it needs more `modes` to look as smooth. |

### Grain axis

`ellipticity` sets *how* each wave polarizes, but each wave's ellipse is oriented by its own
wavevector — so there is no overall grain. `polarizationAxis` adds one: a world direction the
texture combs along, with `polarizationBias` for how strongly.

```js
create({ ellipticity: 0.3, polarizationAxis: [0, 1, 0], polarizationBias: 0.7 });
```

Two things to know:

- **Turning it on re-rolls the texture.** The channel draws each wave's amplitude from a Gaussian
  with the covariance you asked for, using a second, independent random stream. The statistics are
  what you requested; the particular realization is new — even at `polarizationBias: 0`. (With the
  axis left `null`, nothing changes at all: the field is exactly what earlier versions produced.)
- **Grain and handedness compete.** A wave can be at most fully polarized, so `polarizationBias`
  and the chirality `ε·s` are jointly capped at `√(d² + χ²) ≤ 0.97`. At `ellipticity: 1` there is
  almost no room left for grain — lower `ellipticity` to open it up. That is physics (the
  covariance must stay positive), not a knob quirk.

The energy fraction along the axis lands at `(1 + d)/3` — `1/3` is the isotropic value, so
`polarizationBias: 0.85` puts about 62% of the flow's energy along the grain.

### Scale-dependent dials

`helicity` and `coherence` also take a **function of the wavenumber**, evaluated once per wave —
just like `spectrum`. That buys the looks a single slider can't reach: organized rollers carrying
fine random grain, or a strongly handed large scale over mirror-symmetric detail.

```js
import { create, rolloff, condensate, shellPeak } from "helix-noise";

create({ coherence: rolloff(4), kmax: 12 });                 // rollers + fine grain
create({ helicity: condensate(1.5, 0.55, 0.06) });           // handed large scale only
create({ spectrum: shellPeak(3), kmin: 1, kmax: 6 });        // one energetic band
```

The callables must be pure — they never draw randomness, so the mode layout is untouched: pass
a function that returns a constant and you get back exactly the scalar field, bit for bit.

| Preset | Shape | Use for |
|---|---|---|
| `shellPeak(kPeak, width = 1)` | `a(k) = exp(−(k−kPeak)²/(2·width²))` | one energetic band instead of a power law |
| `rolloff(kc)` | `λ(k) = clamp(1 − k/kc, 0, 1)` | organized big structures, incoherent detail |
| `condensate(kSplit, pLarge, pSmall = 0)` | `p(k) = k ≤ kSplit ? pLarge : pSmall` | handedness that lives only at large scale |

### Preset fields

| Factory | Returns | Notes |
|---|---|---|
| `abc(A, B, C, { amplitude?, decay? })` | `Field` | The classical ABC cell flow as exactly 3 waves. No randomness at all, seamlessly tileable, and a pure Beltrami field (`∇×u = u`). `decay: ν` makes it the exact viscous solution `e^(−νt)·u`. Being fixed, it refuses `set()`. |
| `twoScale(base, detail, { detailGain? })` | `FlowField` | The sum of two fields — still divergence-free, still has an exact potential, so boundaries and potential bakes keep working. |

The recipe those two exist for is **a coherent backbone carrying broadband detail**. Sizing the
detail as `amplitude: C_TWO_SCALE / kDetail` holds its vorticity budget fixed, so you can slide
the detail scale without the picture getting busier or calmer:

```js
import { create, abc, twoScale, shellPeak, C_TWO_SCALE } from "helix-noise";

const kD = 8;
const detail = create({ spectrum: shellPeak(kD), kmin: kD - 3, kmax: kD + 3,
                        amplitude: C_TWO_SCALE / kD, seed: 2 });
const storm = twoScale(abc(3, 3, 3), detail);
```

### Structure primitives

Besides the noise field there is a second genre: **localized closed-form structures**, with no
randomness in them at all. A smoke ring is a smoke ring, wherever you sample it.

| Factory | Returns | What it is |
|---|---|---|
| `createRing({ center, axis, radius, core, circulation, advect })` | `FlowField` | A **vortex ring** — a compact torus of swirl pushing a jet through its own middle. Exactly zero outside the core. `advect: true` sends it flying at the textbook self-induced speed. |
| `collidingRings({ …, separation })` | `FlowField` | Two rings fired head-on: equal and opposite circulation, mirrored. |
| `compose(...fields)` | `FlowField` | Sum any number of flows — primitives with each other, or with a noise field. |
| `ringSpeed(circulation, radius, core)` | `number` | Kelvin's self-induced ring speed, if you want to drive the motion yourself. |

```js
import { create, createRing, collidingRings, compose } from "helix-noise";

const smoke = compose(
  collidingRings({ radius: 1.2, core: 0.35, circulation: 1.5, separation: 1.6 }),
  create({ modes: 24, seed: 3, amplitude: 0.25 })   // broadband detail on top
);
```

These are built as an explicit curl, so they are exactly divergence-free *and* carry an exact
potential — obstacles and the potential bakes work on them, and on any `compose` of them, exactly
as they do on a noise field. The ring's potential is compactly supported too, so a `withBoundary`
obstacle outside the core sees literally nothing.

### Ready-made looks

| Factory | Returns | What it is |
|---|---|---|
| `exactNS({ k0, nu, sign })` | options | A field that genuinely **solves** the Navier–Stokes equations, not one that merely looks like it: a single-wavenumber Beltrami flow decaying at the exact viscous rate. Sample it at any `t` and you are looking at a real solution. |
| `nsDeveloped(overrides?)` | options | Polarization matched to measured developed turbulence — strongly polarized waves whose handedness nearly cancels. |
| `nsForced(overrides?)` | options | The same for forced turbulence: more polarized, and visibly net-handed. |

```js
import { create, exactNS, nsForced } from "helix-noise";

const solution = create(exactNS({ k0: 2, nu: 0.05, seed: 7 }));
const turbulent = create(nsForced({ seed: 3 }));
```

Why `exactNS` is exact: with one `|k|` and one handedness the flow is Beltrami (`∇×u = ±k₀u`),
which makes the nonlinear term a pure gradient that the pressure absorbs. What is left is plain
viscous decay — `e^(−νk₀²t)` on every amplitude, which is what `decay` already does.

**Scope of the two NS bundles, plainly:** they calibrate the **polarization** — `ellipticity` is
the exact inverse of the measured per-mode helical fraction, and `helicity` carries its signed
mean. They do **not** calibrate the spectrum; that keeps the default power law, because matching a
measured shell spectrum needs a table this package does not ship. Pass your own `spectrum` if you
have one. `NS_TARGETS` exports the numbers so you can check what a field reproduces.

### Reading the field

Every sampler takes an optional trailing `t` (field time). Omit it for the static field.

| Method | Returns | Notes |
|---|---|---|
| `sample(x, y, z, t?)` | `[u, v, w]` | The velocity. This is the one you'll use most. |
| `vorticity(x, y, z, t?)` | `[wx, wy, wz]` | Local spin (curl of the velocity). |
| `helicityDensity(x, y, z, t?)` | `number` | Local handedness (`u·ω`). Sign tells you which way it twists — handy for colouring. |
| `sampleUW(x, y, z, out6, t?)` | `out6` | Velocity in slots `0..2` **and** vorticity in `3..5`, in one pass. **Allocates nothing** — pass a reusable 6-length array. Best for particle loops. |
| `sampleUA(x, y, z, out6, t?)` | `out6` | Velocity in `0..2` and the vector potential in `3..5`. Allocation-free. |
| `potential(x, y, z, t?)` | `[ax, ay, az]` | The vector potential (the thing whose curl is the velocity). Used by boundaries and GPU bakes. |

```js
// Advect particles — zero allocation in the hot loop:
const uw = [0, 0, 0, 0, 0, 0];
for (const p of particles) {
  field.sampleUW(p.x, p.y, p.z, uw, t);
  p.x += uw[0] * dt; p.y += uw[1] * dt; p.z += uw[2] * dt;
}
```

### Batch sampling

For big flat-array systems, do the whole cloud in one call — faster than looping.

| Method | Writes | Notes |
|---|---|---|
| `sampleMany(pos, out?, t?)` | `[u,v,w, …]` per point | `pos` is interleaved `[x0,y0,z0, x1,y1,z1, …]`. `out` is the same length; if omitted, a `Float64Array` is allocated. Uses a WASM SIMD kernel automatically when available (with a silent JS fallback). |
| `sampleManyUW(pos, out?, t?)` | `[u,v,w,wx,wy,wz, …]` per point | Velocity + vorticity. `out` length = `2 × pos.length`. |

```js
const positions = new Float32Array([x0,y0,z0, x1,y1,z1, /* … */]);
const velocities = new Float32Array(positions.length);
field.sampleMany(positions, velocities, t);
```

### Baking to a texture

Precompute the field into a volume/slice — e.g. to sample it cheaply on the GPU.

| Method | Returns | Notes |
|---|---|---|
| `bake3D(n, t?)` | [`Bake3DResult`](#bake3dresult) | An `n³` RGBA float volume: `rgb` = velocity, `a` = helicity density. |
| `bake2D(nx, ny, z?, t?)` | [`Bake2DResult`](#bake2dresult) | An `nx × ny` RGBA slice at height `z`. |
| `bakePotential3D(n, t?)` | [`Bake3DResult`](#bake3dresult) | Bakes the **vector potential** instead. Take a finite-difference curl in your shader to get a velocity that stays divergence-free even after texture interpolation. Prefer this for GPU flow. |

### Boundaries (flow around obstacles)

Describe an obstacle with a signed distance function and the flow slides along it — still exactly
divergence-free.

```js
const sphere = (x, y, z) => Math.hypot(x - 3, y - 3, z - 3) - 1.2; // > 0 outside
const bounded = field.withBoundary(sphere, { thickness: 0.9 });
bounded.sample(x, y, z, t); // tangent at the wall, 0 inside, base field far away
```

`withBoundary(sdf, opts?)` returns a [`BoundedField`](#boundedfield) with the same
`sample` / `vorticity` / `helicityDensity` / `sampleUW` / `potential` / `bake3D` /
`bakePotential3D` methods as the base field.

[`BoundaryOptions`](#boundaryoptions):

| Option | Type | Default | What it does |
|---|---|---|---|
| `thickness` | `number` | `1` | Width of the band over which the flow yields to the wall. |
| `gradient` | `(x,y,z) => ArrayLike<number>` | — | The SDF's gradient (outward normal). Supplying it makes the result exact and faster; if omitted it's estimated numerically (6 extra SDF calls per sample). |
| `fdStep` | `number` | `1e-3` | Step size for the internal numerical derivatives. |

### GLSL / GPU

`glsl(opts?)` returns a **self-contained GLSL (WebGL2) string** that reproduces the field on the
GPU — it defines `vec3 <name>(vec3 p)` and `vec3 <name>(vec3 p, float t)`.

```js
const src = field.glsl({ name: "helixNoise" });
// paste `src` into your fragment shader, then call helixNoise(p) / helixNoise(p, t)
```

[`GlslOptions`](#glsloptions):

| Option | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | `"helixNoise"` | Function name (also namespaces the baked constants). |
| `precision` | `number` | `7` | Significant digits for baked float constants. |
| `curl` | `boolean` | `true` | Also emit `<name>Curl(vec3 p)` (the vorticity). |
| `potential` | `boolean` | `false` | Also emit `<name>Pot(vec3 p)` (the vector potential — for in-shader SDF boundaries). |

### Re-tuning

| Method | Returns | Notes |
|---|---|---|
| `set(options)` | `this` | Change any subset of options and rebuild. Chainable. |
| `params` | object (read-only) | The current, fully-resolved parameters. |
| `relativeHelicitySpectral(t?)` | `number` | The exact, grid-free relative helicity, straight from the wave data. `relativeHelicity` is a grid estimate of this. |
| `relativeHelicity(ng?)` | `number` | Measures the field's average handedness on an `ng³` grid (default `12`) — should track `helicity`. Mostly a diagnostic. |

```js
field.set({ coherence: 1, helicity: -0.5 }); // same field object, new look
```

---

## `createAtoms(options)` — the atom field

A second engine: instead of global waves, it sums many small, compactly-supported "atoms" placed
on a spatial hash. Use it when you want **infinite** flow (no repeat), **broadband** detail across
many scales, or **regionally different** parameters across space.

```js
const field = createAtoms({
  octaves: 3,
  radius: 1.6,
  helicityField: (x, y, z) => Math.tanh(3 - x), // handedness varies across space
  gainField:     (x, y, z) => (y > 2 ? 1 : 0.3),
});
field.sample(x, y, z, t);
```

Returns an [`AtomField`](#atomfield). It has the **same reading, batch, bake, boundary, and GLSL
methods** as the spectral `Field`, minus `sample`-time re-tuning specifics noted below.

[`HelixAtomsOptions`](#helixatomsoptions):

| Option | Type | Default | What it does |
|---|---|---|---|
| `octaves` | `number` | `3` | Detail layers. Each octave halves the atom size and doubles the frequency. |
| `atomsPerCell` | `number` | `8` | Density of atoms per hash cell — quality/cost knob. |
| `radius` | `number` | `1.6` | Size of the largest atoms (octave 0). |
| `cyclesPerAtom` | `number` | `2` | How many wavelengths fit across one atom. |
| `slope` | `number` | `1.6` | Amplitude falloff across octaves. |
| `helicity` | `number` | `0` | Handedness, as in the spectral engine. |
| `amplitude` | `number` | `1` | Output scale. |
| `seed` | `number` | `1` | Integer seed. |
| `churn` | `number` | `1` | Time-evolution rate (needs `t`). `0` freezes. |
| `anisotropy` | `number` | `0` | Streaks (`< 0`) or layers (`> 0`) along `axis`. |
| `axis` | `[number,number,number]` | `[0,0,1]` | Anisotropy direction. |
| `helicityField` | `(x,y,z) => number` | — | Per-region handedness, sampled once at each atom's center. Overrides `helicity` locally. |
| `gainField` | `(x,y,z) => number` | — | Per-region amplitude gain, sampled at atom centers. |
| `spectrum` | `(k) => number` | — | Custom amplitude curve replacing the octave power law (shape only). |

> **Caching note:** `helicityField`, `gainField`, and `spectrum` are read once per atom and cached.
> If you change what one of them returns, call `field.set({})` to flush the atom cache.

> **GLSL note:** `atomField.glsl()` regenerates the atoms in-shader and matches the CPU field to
> float32 precision, but it only supports **constant** parameters — it throws if
> `helicityField` / `gainField` / `spectrum` are set. For cheap real-time GPU use, prefer a bake.

---

## Helpers

```js
import { version, selfTest } from "helix-noise";

version;        // e.g. "1.0.0"
selfTest();     // → { transversality, fdDivergenceRms, rhoVsP }
```

- **`version`** — the library version string.
- **`selfTest()`** — runs the built-in validation and returns a [`SelfTestReport`](#selftestreport):
  `transversality` is analytic and machine-zero (≈ `1e-16`); `fdDivergenceRms` is a finite-difference
  residual — a small O(h²) truncation of the exactly divergence-free field (order `1e-6`, **not**
  machine-zero). Both staying small is a good CI smoke test.

You can also import the classes directly (`HelixField`, `HelixAtoms`) if you prefer `new` over the
factory functions — they're equivalent.

---

## Types

### `Field`
The spectral field returned by `create()`. Extends [`FlowField`](#flowfield) and adds
`sampleMany`, `sampleManyUW`, `set`, `relativeHelicity`, `glsl`, and `params`.

### `AtomField`
The atom field returned by `createAtoms()`. Same surface as `Field` (batch, bake, boundary, GLSL),
with the atom-specific options and caching rules above.

### `FlowField`
The shared surface both engines implement: `sample`, `vorticity`, `helicityDensity`, `sampleUW`,
`sampleUA`, `potential`, `bake3D`, `bake2D`, `bakePotential3D`, `withBoundary`.

### `BoundedField`
A field constrained by an obstacle (from `withBoundary`). Same reading/baking methods, plus
`base` (the field it wraps) and `sdf` (the obstacle).

### `Vec3`
`[number, number, number]` — a 3-component vector (velocity, vorticity, potential, …).

### `Out6`
`number[] | Float64Array | Float32Array` — a length-6 buffer you pass to `sampleUW` / `sampleUA` so
they can write without allocating.

### `Sdf`
`(x, y, z) => number` — a signed distance function: `> 0` outside the obstacle, `< 0` inside, `0`
on the wall.

### `Bake3DResult`
`{ data: Float32Array; size: number; channels: 4 }` — an `size³` RGBA volume.

### `Bake2DResult`
`{ data: Float32Array; width: number; height: number; channels: 4 }` — a 2-D RGBA slice.

### `BoundaryOptions`
Options for `withBoundary` — see [Boundaries](#boundaries-flow-around-obstacles).

### `GlslOptions`
Options for `glsl()` — see [GLSL / GPU](#glsl--gpu).

### `HelixNoiseOptions`
Options for `create()` — see [Options](#options).

### `HelixAtomsOptions`
Options for `createAtoms()` — see the [atom field](#createatomsoptions--the-atom-field).

### `SelfTestReport`
`{ transversality: number; fdDivergenceRms: number; rhoVsP: Record<string, number> }` — the result
of `selfTest()`. `transversality` is machine-zero (≈ `1e-16`, exact by construction); `fdDivergenceRms`
is a small O(h²) finite-difference residual (order `1e-6`), not machine-zero; `rhoVsP` maps a helicity
value to the measured handedness.
