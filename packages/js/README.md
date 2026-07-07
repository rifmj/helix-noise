<p align="center">
  <img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/hero.gif" alt="Helix Noise — a divergence-free helical flow field, flowing" width="100%">
</p>

<h1 align="center">Helix Noise</h1>

<p align="center">
  <b>Give anything flowing, liquid-like motion — smoke, water, particles, wind.</b><br>
  One function tells you which way things drift at any point in space, and it always moves like a real fluid. No FFT, no grid, no simulation.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="0 dependencies">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript">
  <img src="https://img.shields.io/badge/module-ESM%20%2B%20CJS%20%2B%20IIFE-informational" alt="ESM + CJS + IIFE">
  <img src="https://img.shields.io/badge/size-~11kB-informational" alt="~11 kB">
</p>

<p align="center">
  <a href="https://rifmj.github.io/helix-noise/examples/index.html"><b>▶ Live demos</b></a> ·
  <a href="https://rifmj.github.io/helix-noise/sandbox.html">3-D sandbox</a> ·
  <a href="https://rifmj.github.io/helix-noise/docs/">Docs</a> ·
  <a href="#api">API</a> ·
  <a href="#the-same-field-in-python-rust-and-shaders">Python / Rust / shader ports</a>
</p>

---

## In 30 seconds

```bash
npm install helix-noise
```

```js
import { create } from "helix-noise";

const field = create({ helicity: 0.8, coherence: 0.5 });

const [u, v, w] = field.sample(x, y, z);       // which way things drift at (x, y, z)
const [u2, v2, w2] = field.sample(x, y, z, t); // …the same field, churning in time
```

Move anything along those velocities — particles, smoke, water, hair, a crowd — and it looks alive.
**[See it running →](https://rifmj.github.io/helix-noise/)** (that page's background *is* this library).

## Why not just curl noise?

The field is **divergence-free**: nothing piles up, nothing vanishes — exactly like a real,
incompressible fluid. That's why tracers swirl and fold instead of clumping into blobs the way plain
noise makes them. On top you get two dials ordinary procedural flow doesn't have: **helicity** (which
way the swirls corkscrew) and **coherence** (calm noise → organized eddies). And time is built in:
pass `t` and small eddies flicker fast while big structures drift — the signature look of real flow.

<sub>Precise terms, for the curious: the field is a grid-free sum of divergence-free *helical
(Beltrami) modes*; the three dials are spectral **slope** (scale), **helicity** (chirality), and
phase **coherence** (noise → structure). The rest of this README uses them.</sub>

## Install

```bash
npm install helix-noise    # zero runtime dependencies, TypeScript types included
```

Or straight from a CDN — no build step at all:

```html
<script src="https://cdn.jsdelivr.net/npm/helix-noise/dist/helix-noise.global.js"></script>
<script>
  const field = HelixNoise.create({ helicity: 0.8 });
</script>
```

Ships as **ES module**, **CommonJS**, and a **`<script>` global** — the right build is picked
automatically.

## Quick start — a particle system

The whole loop:

```js
import { create } from "helix-noise";

const field = create({ modes: 48, slope: 1.6, helicity: 0.8, coherence: 0.5, seed: 1 });
const uw = [0, 0, 0, 0, 0, 0];   // reusable output buffer → zero allocation in the loop
let t = 0;

function update(particles, dt) {
  t += dt;                                       // advance field time → the flow itself evolves
  for (const p of particles) {
    field.sampleUW(p.x, p.y, p.z, uw, t);        // velocity in [0..2], vorticity in [3..5]
    p.x += uw[0] * dt; p.y += uw[1] * dt; p.z += uw[2] * dt;
    p.hue = uw[0] * uw[3] + uw[1] * uw[4] + uw[2] * uw[5];   // helicity → colour, if you like
  }
}
```

That's it. `sampleUW` allocates nothing, so tens of thousands of particles per frame are fine. For
big flat-array clouds, `field.sampleMany(positions, velocities, t)` does the whole batch in one call
and automatically uses an embedded **WASM SIMD kernel** where available (~5.5× the loop in Node 20,
silent JS fallback elsewhere).

<details>
<summary>Performance details</summary>

`sampleMany` runs a tiled JS kernel (~1.8× the per-point loop); on runtimes with WebAssembly SIMD an
embedded 1.4 kB wasm f64x2 kernel takes over automatically — measured ~5.5× the loop / ~3× the JS
kernel in Node 20, ~2× the JS kernel in Chrome, equal to the scalar path to < 1e-12 (it mirrors the
same fdlibm sincos op-for-op). One `sample()` costs O(`modes`); the default 48 modes is a few
microseconds. `npm run bench` reproduces the numbers on your machine.

</details>

## What you can make

It's just velocities, so the *renderer is your choice*. One field drawn four ways — streamlines, a
flow texture, a helicity map, speed contours:

<p align="center">
  <img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/looks.png" alt="One field, four renderers: streamlines, LIC, helicity map, contours" width="100%">
</p>

…and the same field drives motion and 3-D just as easily:

<table>
<tr>
<td width="50%" valign="top">
<img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/smoke.gif" alt="Volumetric smoke raymarched through the helical field" width="100%"><br>
<sub><b>Volumetric smoke</b> — a dye volume advected through <code>field.bake3D()</code>, raymarched in
WebGL2. → <a href="https://rifmj.github.io/helix-noise/examples/smoke.html">run it</a></sub>
</td>
<td width="50%" valign="top">
<img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/water.gif" alt="Flowing water surface with caustics and sun-glints" width="100%"><br>
<sub><b>Flowing water</b> — ripple crests bent along the streamlines, with caustics and
sun-glints. → <a href="https://rifmj.github.io/helix-noise/examples/water.html">run it</a></sub>
</td>
</tr>
</table>

More in [See it live ↓](#see-it-live).

## Two engines — which one do I want?

| | `create()` — spectral | `createAtoms()` — sparse atoms |
|---|---|---|
| Best for | coherent structures, GPU (`glsl()`), seamless tiles | broadband detail, infinite worlds, regional art direction |
| Detail | a band of scales (`kmin…kmax`) | octaves — fine grain global modes can't afford |
| Domain | all of R³, optionally `tileable` | all of R³, no period, amortized O(1) per sample |
| Art direction | one parameter set for all space | `helicityField(x,y,z)` / `gainField(x,y,z)` vary per region |
| `coherence` dial | ✅ | — (atom phases are independent by design) |

Start with `create()`. Reach for [the atom engine](#the-atom-engine--broadband-infinite-locally-art-directed)
when you need detail across many scales or different flow character in different places.

## The three dials

Everything is driven by three artist-facing controls (plus a `seed`).

### Spectral slope — the size of things

<img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/knob-spectrum.gif" alt="Spectral slope sweeping from steep to shallow" width="100%">

`slope` sets how energy spreads across scales — the sweep runs from steep (`slope: 2.6`, a few big
silky swirls) to shallow (`slope: 1.0`, fine multi-scale grain) and back.

### Helicity — which way it swirls

<img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/knob-helicity.gif" alt="Helicity sweeping from left-handed to right-handed" width="100%">

`helicity` (`p ∈ [-1, 1]`) is the handedness of the swirl — a genuinely 3-D property. The sweep runs
from left-handed (`-1`, amber) through mirror-symmetric (`0`) to right-handed (`+1`, teal); at the
extremes every vortex tube corkscrews the same way (a Beltrami flow). Watch the swirls reverse.

### Phase coherence — noise vs structure

<img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/knob-coherence.gif" alt="Phase coherence sweeping from random to structured at a fixed spectrum" width="100%">

`coherence` (`λ ∈ [0, 1]`) slides the field from formless to organized **at a fixed spectrum** — the
sweep runs from `0` (even, random) to `1` (energy concentrates into coherent structures) and back.
The overall busyness never changes, only how arranged it is — the one axis plain curl-noise doesn't have.

## Time — the field flows by itself

Every sampler takes an optional trailing `t`. The evolution is not a generic 4-D noise scroll — it
is scaled like turbulence:

- **Eddy churn.** Incoherent modes advance their phases at the eddy-turnover rate `ω(k) ∝ k^⅔` —
  small scales flicker faster than large ones, the signature look of real flow. `churn` scales the
  rate; `churn: 0` freezes the field exactly.
- **Coherent sweep.** Modes organized by `coherence` share their focus point's random velocity, so
  at high `λ` structures *translate* like eddies instead of dissolving.
- **Viscous decay** (optional). With `decay: ν`, amplitudes fall as `e^(−νk²t)` — the exact viscous
  factor (a single helical mode evolving this way is an exact Navier–Stokes solution).

```js
const field = create({ churn: 1, decay: 0.02 });
field.sample(x, y, z, t);            // same field, later
```

Bulk wind is just frozen turbulence — sample at `x − U·t`. Time costs one multiply-add per mode, and
`t = 0` reproduces the static field bit-for-bit, so existing code is unaffected.

## Boundaries — flow around obstacles

Describe an obstacle by a signed distance function and the flow slides along it — still exactly
divergence-free ([live demo](https://rifmj.github.io/helix-noise/examples/obstacle.html)):

```js
const sphere = (x, y, z) => Math.hypot(x - 3, y - 3, z - 3) - 1.2;   // SDF: > 0 outside
const bounded = field.withBoundary(sphere, { thickness: 0.9 });

bounded.sample(x, y, z, t);   // tangent at the wall, zero inside, base field far away
```

Pass an analytic `gradient` for exactness and speed when you have one (for a sphere:
`(x−c)/r`); otherwise it's estimated from the SDF automatically.

<details>
<summary>Why this works (the vector-potential trick)</summary>

Every Beltrami mode has a closed-form vector potential `A_j = s_j·u_j/|k_j|` (exposed as
`field.potential()` / `sampleUA()`). The boundary is Bridson's curl-noise trick applied to it:
`u = ∇×(ramp(d)·A) = ramp′·∇d×A + ramp·u` — free-slip at the wall (the ramp kills the normal flux,
the slip term is tangent identically), exactly divergence-free because it is still a curl, and it
composes with time (`t` passes straight through).

The same potential fixes GPU bakes: `bakePotential3D()` stores `A` instead of `u`, and a
central-difference curl of the trilinear samples in your shader is **discretely divergence-free to
machine precision** — a directly-baked velocity leaks O(voxel²) divergence through interpolation.
`BoundedField.bakePotential3D()` bakes the *ramped* potential (alpha = SDF), so the obstacle rides
into the texture for free. For in-shader boundaries with your own SDF, emit the analytic potential
with `field.glsl({ potential: true })` (adds `<name>Pot(p, t)`).

</details>

## The atom engine — broadband, infinite, locally art-directed

The second engine trades global waves for a sum of **compactly-supported helical atoms** placed by a
spatial hash. Use it when you need broadband detail, an unbounded domain, or flow that behaves
differently in different places:

```js
const field = HelixNoise.createAtoms({
  octaves: 3,                                   // broadband: each octave halves the atom size
  radius: 1.6, slope: 1.2, seed: 11,
  helicityField: (x, y, z) => Math.tanh(3 - x), // handedness varies across space
  gainField:     (x, y, z) => (y > 2 ? 1 : 0.3),
});
field.sample(x, y, z, t);                       // same sampling surface, any point in R³
```

- **Exactly divergence-free**, like everything here: each atom is a curl (`∇×(W·A)`), with analytic
  vorticity — helicity colouring stays cheap and exact.
- **Broadband**: octave layers with a per-octave `slope` law — fine detail global modes would need
  many times the mode count for.
- **Infinite & amortized O(1)**: cost per sample is independent of domain size. No period, no tile.
- **Spatially-varying parameters**: `helicityField` / `gainField` are frozen into each atom at its
  center — regional art direction at zero divergence cost
  ([demo](https://rifmj.github.io/helix-noise/examples/atoms.html): left half right-handed, right
  half left-handed, clean seam).
- **Boundaries and div-free bakes compose**: `withBoundary()` and `bakePotential3D()` work exactly
  as in the spectral engine.

<details>
<summary>Atom engine on the GPU, and honest trade-offs</summary>

`glsl()` works here too: the emitted shader **regenerates the atoms in-shader** from the spatial
hash — the integer PRNG ports bit-exactly, so the GPU field matches the CPU one to float32 precision
(verified on a live WebGL2 context: worst |cpu − gpu| ≈ 1.3e-6). It regenerates
octaves × 8 × `atomsPerCell` atoms per fragment, so it's for moderate resolutions or offline passes —
for cheap real-time GPU use prefer the bake textures. Constant parameters only
(`helicityField`/`gainField`/`spectrum` are JS callbacks and can't be ported — it throws).

Trade-offs vs the spectral engine: no `coherence` axis (atom phases are independent by
construction — organized structures live in the spectral engine), no `tileable`, and one sample
costs ~1.4–1.9× the 48-mode sum (measured in `npm run bench`; still microseconds).
`sampleMany`/`sampleManyUW` exist for allocation-free batches.

</details>

## See it live

Every demo runs in the browser — **[open the hub](https://rifmj.github.io/helix-noise/examples/index.html)**,
or jump straight in (they're plain HTML files in [`examples/`](examples/), no build needed):

| Demo | What it shows |
|---|---|
| [Gallery](https://rifmj.github.io/helix-noise/gallery.html) | one field, nine renderers, three shared sliders re-tuning all at once |
| [3-D sandbox](https://rifmj.github.io/helix-noise/sandbox.html) | orbit camera, comet-trail streamlines, every control |
| [Volumetric smoke](https://rifmj.github.io/helix-noise/examples/smoke.html) | a dye volume advected through `bake3D()`, raymarched with self-shadowing — draw with the pointer |
| [Flowing water](https://rifmj.github.io/helix-noise/examples/water.html) | ripples bent along streamlines, caustics, sun-glints |
| [Living nebula](https://rifmj.github.io/helix-noise/examples/nebula.html) | no bake, no sim — the shader raymarches the field analytically; colour = local handedness |
| [A million particles](https://rifmj.github.io/helix-noise/examples/million.html) | 1–4 M particles advected entirely on the GPU via `field.glsl()` |
| [Vortex tubes](https://rifmj.github.io/helix-noise/examples/tubes.html) | three.js streamtubes — at `helicity ±1` every tube corkscrews the same way |
| [Kelp forest](https://rifmj.github.io/helix-noise/examples/kelp.html) | sway driven by the field's own `churn` — set it to 0 and the forest freezes |
| [Ebru marbling](https://rifmj.github.io/helix-noise/examples/ebru.html) | ink stretches and folds but never tears — incompressibility made visible |
| [Q-criterion isosurfaces](https://rifmj.github.io/helix-noise/examples/qcriterion.html) | marching cubes over the vortex skeleton; raise `coherence` and the tangle condenses |
| [Flow around an obstacle](https://rifmj.github.io/helix-noise/examples/obstacle.html) | a cylinder described only by its SDF — free-slip via `withBoundary()` |
| [Atom engine](https://rifmj.github.io/helix-noise/examples/atoms.html) | regional handedness via `helicityField`, one seamless field |
| [Jetstream cirrus](https://rifmj.github.io/helix-noise/examples/cirrus.html) | one `anisotropy` dial: wisps combed along the jet, or billow bands across it |
| [Audio-reactive](https://rifmj.github.io/helix-noise/examples/audio.html) | bass → `amplitude`, treble → `churn`, stereo → `helicity` |
| [three.js](https://rifmj.github.io/helix-noise/examples/three.html) · [p5.js](https://rifmj.github.io/helix-noise/examples/p5.html) · [raw WebGL2](https://rifmj.github.io/helix-noise/examples/shader.html) · [minimal](https://rifmj.github.io/helix-noise/examples/basic.html) | integration starting points |

## Use it in your stack

Helix Noise only produces velocities, so it drops into anything. Three ways in:

**1. Sample in JS** — works with three.js, p5.js, PixiJS, canvas, any particle system:

```js
// three.js — advect a THREE.Points cloud
const uw = [0, 0, 0, 0, 0, 0];
const p = geometry.attributes.position.array;
for (let i = 0; i < p.length; i += 3) {
  field.sampleUW(p[i], p[i + 1], p[i + 2], uw);
  p[i] += uw[0] * dt; p[i + 1] += uw[1] * dt; p[i + 2] += uw[2] * dt;
}
geometry.attributes.position.needsUpdate = true;
```

**2. Bake to a texture** — for GPU particle systems and raymarchers:

```js
const vol = field.bake3D(64);      // { data: Float32Array (rgb = velocity, a = helicity), size, channels }
const tex = new THREE.Data3DTexture(vol.data, vol.size, vol.size, vol.size);
tex.format = THREE.RGBAFormat; tex.type = THREE.FloatType; tex.needsUpdate = true;
```

**3. Run the field on the GPU** — `glsl()` emits the *exact same field* as a shader function
(verified equal to `sample()` to machine precision):

```js
const src = field.glsl({ name: "helixNoise" });   // defines vec3 helixNoise(vec3 p) (+ Curl)
// paste `src` into a three.js ShaderMaterial / TSL, regl, raw WebGL2, or Shadertoy
```

## Recipes & tips

- **Scale.** The field's structures live at wavelengths `2π/kmax … 2π/kmin` (defaults: ~1–6 world
  units). Working in pixels or meters? Sample at `p * s` and pick `s` so those wavelengths match the
  swirl size you want — e.g. `field.sample(x * 0.01, y * 0.01, 0)` for pixel coordinates.
- **2-D flow.** Just sample a slice: `field.sample(x, y, 0, t)` and use `[u, v]`. Divergence-free in
  3-D isn't exactly divergence-free in the slice, but visually it behaves (see the marbling demo).
- **Wind.** Add a constant drift by sampling upstream: `field.sample(x - U*t, y, z, t)`.
- **Seamless textures.** `create({ tileable: true })` snaps the field to an exact 2π period in all
  three axes — bake any slice or volume and it wraps with zero seam.
- **Determinism.** Same `seed` (and options) ⇒ the same field, bit-for-bit, everywhere — fields are
  safe to regenerate instead of serialize.
- **Live re-tuning.** `field.set({ helicity: -0.5 })` rebuilds in well under a millisecond — wire it
  straight to sliders (that's how all the demos do it).
- **Performance checklist.** Reuse one `out6` buffer with `sampleUW` → zero GC; whole clouds →
  `sampleMany` (auto-WASM); GPU → `bake3D`/`bakePotential3D` textures or `glsl()`; fewer `modes` is
  linearly cheaper.

## API

> 📖 **Full reference:** [live docs](https://rifmj.github.io/helix-noise/docs/) ·
> [`docs/API.md`](docs/API.md) — every function, option, and method in plain language.
> The tables below are the quick version.

### `create(options?) → Field`

| option | default | meaning |
|---|---|---|
| `modes` | `48` | number of helical modes; one `sample()` is O(modes) |
| `slope` | `1.6` | spectral slope — steep = big swirls, shallow = fine grain |
| `helicity` | `0` | `p ∈ [-1, 1]` — handedness (`±1` = fully helical, `0` = mirror-symmetric) |
| `coherence` | `0` | `λ ∈ [0, 1]` — phases random → structured, at fixed spectrum |
| `kmin`, `kmax` | `1`, `6.2` | wavenumber band (largest → finest structures) |
| `centers` | `3` | focus points the coherent phases organize toward |
| `amplitude` | `1` | output scale (field is first normalized to unit RMS speed) |
| `tileable` | `false` | snap wavevectors to the integer lattice → **exactly 2π-periodic** |
| `seed` | `1` | integer seed (deterministic) |
| `layout` | `"fibonacci"` | mode layout: low-discrepancy directions + stratified spectrum (fewer beat artifacts). `"random"` = statistically independent (i.i.d.) modes — higher variance, for Monte-Carlo / ensemble-average matching |
| `churn` | `1` | time-evolution rate χ for the `t` argument; `0` freezes the field |
| `decay` | `0` | viscosity ν — amplitudes decay as `e^(−νk²t)` |
| `spectrum` | — | custom amplitude law `a(\|k\|)` replacing the power law (shape only — RMS-normalized) |
| `anisotropy`, `axis` | `0`, `[0,0,1]` | stretch wavevectors along `axis`: γ<0 → streaks/jets along it, γ>0 → layers across it |

### `Field` methods

All samplers and bakes take an optional trailing `t` (default `0`).

| method | returns | notes |
|---|---|---|
| `sample(x, y, z, t?)` | `[u, v, w]` | divergence-free velocity |
| `vorticity(x, y, z, t?)` | `[wx, wy, wz]` | curl u |
| `helicityDensity(x, y, z, t?)` | `number` | `u·ω`; sign = local handedness |
| `sampleUW(x, y, z, out6, t?)` | `out6` | velocity (0..2) + vorticity (3..5), zero allocation |
| `sampleMany(pos, out?, t?)` | `out` | batch velocities for interleaved `[x,y,z,…]`; tiled kernel + auto WASM SIMD |
| `sampleManyUW(pos, out?, t?)` | `out` | batch velocity + vorticity, 6 floats per point |
| `sampleUA(x, y, z, out6, t?)` | `out6` | velocity (0..2) + vector potential A (3..5); `∇×A = u` exactly |
| `potential(x, y, z, t?)` | `[Ax, Ay, Az]` | the analytic vector potential — boundaries & div-free bakes |
| `withBoundary(sdf, opts?)` | `BoundedField` | obstacle-aware field: free-slip at the wall, zero inside, still div-free |
| `set(options)` | `this` | re-tune any params and rebuild (sub-millisecond) |
| `relativeHelicity(ng?)` | `number` | `⟨u·ω⟩/(‖u‖‖ω‖)`; a live check that helicity tracks `p` |
| `bake3D(n, t?)` / `bake2D(nx, ny, z?, t?)` | `{ data, … }` | RGBA `Float32Array` for a GPU texture |
| `bakePotential3D(n, t?)` | `{ data, … }` | rgb = A; FD-curl it in the shader → discretely div-free velocity |
| `glsl(opts?)` | `string` | self-contained GLSL — the exact field, GPU-side, `(vec3 p)` + `(vec3 p, float t)`; `{ potential: true }` adds `<name>Pot` |

### `createAtoms(options?)` → `AtomField`

The sparse-atom engine (see above). Same sampling surface as `Field` minus `tileable`/`coherence`
(batches and `glsl()` included — the atom shader regenerates atoms in-GPU); plus its own options:

| option | default | meaning |
|---|---|---|
| `octaves` | `3` | broadband layers; each halves the atom radius, doubles `\|k\|` |
| `atomsPerCell` | `8` | density/quality knob (a hash cell is one atom diameter) |
| `radius` | `1.6` | support radius of the largest atoms |
| `cyclesPerAtom` | `2` | wavelengths across an atom's diameter |
| `slope`, `helicity`, `amplitude`, `seed`, `churn` | as spectral | same meanings |
| `spectrum`, `anisotropy`, `axis` | as spectral | same meanings (spectrum sampled at each atom's `\|k\|`) |
| `helicityField(x,y,z)` | — | local handedness, sampled at atom centers |
| `gainField(x,y,z)` | — | local amplitude, sampled at atom centers |

## Guarantees

The claims above aren't vibes — `npm test` measures every one of them:

| property | value | meaning |
|---|---|---|
| transversality `max\|k·e\|` | `4.4e-16` | each mode ⟂ its own `k` ⇒ **div u = 0 pointwise**, at any `t` |
| finite-difference divergence | `~3.5e-6` | pure O(h²) truncation of an analytically div-free field |
| `ρ(p)` for `p = −1…+1` | `−0.88, −0.44, −0.10, +0.36, +0.88` | relative helicity **tracks the knob**, ~0 at the mirror point |
| mode separation (48 modes) | `0.45 rad` vs `0.073 rad` iid | Fibonacci layout keeps directions ~6× farther apart → fewer beat artifacts |
| batch = scalar | `< 1e-12` | `sampleMany` matches `sampleUW` point-for-point (incl. its fast sincos path) |
| coherent sweep | `< 1e-10` | at `coherence: 1`, `centers: 1`: `u(x, t) = u(x − Vt, 0)` — structures translate rigidly |
| viscous decay | `< 1e-12` | a single mode decays exactly by `e^(−νk²t)` — the Navier–Stokes factor |
| vector potential | O(h²) FD check | `∇×A = u`: `A_j = s_j·u_j/\|k_j\|` is exact per mode |
| wall-normal flux | `ramp(d)·(u·n)` exactly | boundary slip term is tangent identically; normal flux dies with the ramp |
| baked-potential divergence | `< 1e-6`, ≥ 100× below baked velocity | trilinear + FD-curl of `bakePotential3D` stays discretely div-free |
| atom engine divergence | `< 1e-5` (FD) | every atom is `∇×(W·A)` — a curl, at any `t`, with any parameter fields |
| atom vorticity | `< 1e-4` vs FD curl | the closed-form window-Hessian formula matches numerics |
| regional helicity | `ρ > +0.4` / `< −0.4` per half | `helicityField` split domain: each half carries its own handedness |
| wasm kernel = JS kernel | `< 1e-12` | the f64x2 SIMD batch mirrors the JS ops (decay/churn active, odd counts) |
| atom GLSL = CPU atoms | `≈ 1.3e-6` on GPU | in-shader hash+PRNG regeneration, executed and read back on WebGL2 |

With `tileable: true`, the field is periodic to machine precision: `|u(x) − u(x + 2π)| ≈ 1e-15`.
`t = 0` with any `churn`/`decay` reproduces the static field **bit-for-bit**, and
`layout: "random"` selects the i.i.d. ensemble instead (same seeds ⇒ same fields, bit-for-bit).

## Limits

- Grid-free and **not periodic** by default — sample any point in R³; use `tileable: true` for a
  seamless loop or a repeating tile (spectral engine only).
- The spectral engine's spectrum is **sparse** (a few dozen modes) — that's what keeps it real-time;
  reach for the atom engine when you need broadband detail or regional parameters.
- It's an authoring / effect tool for plausible, directable flow — **not** a fluid solver. Obstacles
  are respected kinematically (`withBoundary`: free-slip, div-free) but there are no wakes, no vortex
  shedding, no pressure feedback. The time evolution is exact per mode (viscous decay, sweep) and
  physically *scaled* across modes (eddy churn) — it is not a nonlinear cascade.

## The same field in Python, Rust, and shaders

This package is the reference implementation of a small family — all ports produce the **same field
for the same seed and options**, verified against a shared fixture to ~1e-15:

| | | |
|---|---|---|
| **Python** (numpy) | `pip install helix-noise` | [`packages/python`](https://github.com/rifmj/helix-noise/tree/main/packages/python) |
| **Rust** (zero-dep crate) | `cargo add helix-noise` | [`packages/rust`](https://github.com/rifmj/helix-noise/tree/main/packages/rust) |
| **Shaders** (GLSL · HLSL · WGSL · Godot) | `generate.py --target glsl` | [`packages/shaders`](https://github.com/rifmj/helix-noise/tree/main/packages/shaders) |

## Develop

TypeScript source in `src/`, built with [tsup](https://tsup.egoist.dev/) to `dist/` (ESM + CJS +
IIFE + `.d.ts`). Zero runtime dependencies.

```bash
npm install
npm run build       # tsup → dist/
npm run typecheck   # tsc --noEmit (strict)
npm test            # runs the .ts test suite via tsx
npm run bench       # batch-sampler benchmark (sampleMany vs per-point loop)
npm run assets      # regenerate the README images (pure Node, no deps)
```

```
src/            TypeScript source (index · field · atoms · boundary · glsl · rng · types)
dist/           built output (committed so demos work without a build)
test/           node:test suite (.ts)
examples/       all the live demos (plain HTML, no build)
scripts/        reproducible asset renderers · bench · fixture dump
docs/           the VitePress documentation site
sandbox.html · gallery.html       browser demos
```

## License

MIT © Rifat Jumagulov. See [LICENSE](LICENSE).
