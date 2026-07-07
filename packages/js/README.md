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

---

Helix Noise describes an invisible **current** filling all of 3-D space. Ask it about any point and
it tells you which way things drift there — so you can carry particles, smoke, water, hair, or a
whole crowd along that flow and it looks alive. No fluid solver, no bake.

The current is **divergence-free** — a physics term that just means **nothing piles up and nothing
vanishes**, exactly like a real, incompressible fluid. That's what makes the motion swirl and fold
naturally instead of collapsing into blobs the way plain noise does (tracers never clump). On top of
that you get two things ordinary procedural flow can't do: a **handedness** — which way the swirls
spin — and a dial from **calm noise to organized eddies**. And the field itself is alive: pass a
time `t` and it churns — small eddies flicker fast, big structures drift instead of dissolving.

<sub>Precise terms, for the curious: the field is a grid-free sum of divergence-free *helical
(Beltrami) modes*; the three dials are spectral **slope** (scale of the swirls), **helicity**
(chirality), and phase **coherence** (noise → structure). The rest of this README uses them.</sub>

```js
import { create } from "helix-noise";

const field = create({ helicity: 0.8, coherence: 0.5 });
const [u, v, w] = field.sample(x, y, z);      // divergence-free velocity, anywhere
const [u2, v2, w2] = field.sample(x, y, z, t); // …the same field, churning in time
```

## Install

```bash
npm install helix-noise
```

No build step for you, zero runtime dependencies. Or load it straight from a CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/helix-noise/dist/helix-noise.global.js"></script>
<script>
  const field = HelixNoise.create({ helicity: 0.8 });
</script>
```

Works as **ES module**, **CommonJS**, or a **`<script>` global** — the right build is picked
automatically, and TypeScript types come along for the ride.

## Quick start

Advect a particle system — the whole loop:

```js
import { create } from "helix-noise";

const field = create({ modes: 48, slope: 1.6, helicity: 0.8, coherence: 0.5, seed: 1 });
const uw = [0, 0, 0, 0, 0, 0];
let t = 0;

function update(particles, dt) {
  t += dt;                                       // advance field time → the flow itself evolves
  for (const p of particles) {
    field.sampleUW(p.x, p.y, p.z, uw, t);       // velocity in [0..2], vorticity in [3..5]
    p.x += uw[0] * dt; p.y += uw[1] * dt; p.z += uw[2] * dt;
    p.hue = uw[0] * uw[3] + uw[1] * uw[4] + uw[2] * uw[5];   // helicity → colour, if you like
  }
}
```

That's it. `sampleUW` allocates nothing, so it's fine to call for tens of thousands of particles per
frame. For big flat-array systems, `field.sampleMany(positions, velocities, t)` does the whole cloud
in one call: a tiled JS kernel (~1.8× the loop above), and on runtimes with WebAssembly SIMD an
embedded **1.4 kB wasm f64x2 kernel** takes over automatically — measured **~5.5× the loop / ~3× the
JS kernel** in Node 20, ~2× the JS kernel in Chrome, equal to the scalar path to < 1e-12 (it
mirrors the same fdlibm sincos op-for-op; silent JS fallback when wasm is unavailable).

## What you can make

It's just velocities, so the *renderer is your choice*. Here is one field drawn four ways — streamlines,
a flow texture (LIC), a helicity map, and speed contours:

<p align="center">
  <img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/looks.png" alt="One field, four renderers: streamlines, LIC, helicity map, contours" width="100%">
</p>

…and the same field drives motion and 3-D just as easily — smoke you can raymarch, water you can flow:

<table>
<tr>
<td width="50%" valign="top">
<img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/smoke.gif" alt="Volumetric smoke raymarched through the helical field" width="100%"><br>
<sub><b>Volumetric smoke</b> — a dye volume advected through <code>field.bake3D()</code> and raymarched in
WebGL2, with self-shadowing. → <a href="examples/smoke.html"><code>examples/smoke.html</code></a></sub>
</td>
<td width="50%" valign="top">
<img src="https://raw.githubusercontent.com/rifmj/helix-noise/main/packages/js/assets/water.gif" alt="Flowing water surface with caustics and sun-glints" width="100%"><br>
<sub><b>Flowing water</b> — ripple crests bent along the streamlines, with caustic highlights and
sun-glints. → <a href="examples/water.html"><code>examples/water.html</code></a></sub>
</td>
</tr>
</table>

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

- **Eddy churn.** Incoherent modes advance their phases at the Kolmogorov eddy-turnover rate
  `ω(k) ∝ k^⅔` — small scales flicker faster than large ones, the signature look of real flow.
  `churn` scales the rate; `churn: 0` freezes the field exactly.
- **Coherent sweep.** Modes organized by `coherence` share their focus point's random velocity, so
  at high `λ` structures *translate* like eddies instead of dissolving (with one center the whole
  field moves rigidly — an exact identity, see Guarantees).
- **Viscous decay** (optional). With `decay: ν`, amplitudes fall as `e^(−νk²t)` — the exact viscous
  factor: a single helical mode evolving this way is an exact Navier–Stokes solution (its
  self-advection vanishes identically), and any same-`|k|`, same-handedness superposition stays one.
  The multi-scale sum is the exact Stokes flow with modeled churn — honest physics, not a solver.

```js
const field = create({ churn: 1, decay: 0.02 });
field.sample(x, y, z, t);            // same field, later
```

Bulk wind is just frozen turbulence — sample at `x − U·t`. Time costs one multiply-add per mode;
`t = 0` reproduces the static field bit-for-bit, so existing code is unaffected.

## Boundaries — flow around obstacles

Describe an obstacle by a signed distance function and the flow slides along it:

```js
const sphere = (x, y, z) => Math.hypot(x - 3, y - 3, z - 3) - 1.2;        // SDF: > 0 outside
const bounded = field.withBoundary(sphere, {
  thickness: 0.9,                                                          // influence band
  gradient: (x, y, z) => { const r = Math.hypot(x-3, y-3, z-3) || 1;      // ∇d (optional but
    return [(x-3)/r, (y-3)/r, (z-3)/r]; },                                 //  exact & faster)
});
bounded.sample(x, y, z, t);   // tangent at the wall, zero inside, base field far away
```

This works because every Beltrami mode has a **closed-form vector potential** `A_j = s_j·u_j/|k_j|`
(exposed as `field.potential()` / `sampleUA()`). The boundary is Bridson's curl-noise trick applied
to it: `u = ∇×(ramp(d)·A) = ramp′·∇d×A + ramp·u` — free-slip at the wall (the ramp kills the
normal flux, the slip term is tangent identically), exactly divergence-free because it is still a
curl, and it composes with time (`t` passes straight through). See it live:
[`examples/obstacle.html`](examples/obstacle.html).

The same potential fixes GPU bakes: `bakePotential3D()` stores `A` instead of `u`, and a
central-difference curl of the trilinear samples in your shader is **discretely divergence-free to
machine precision** — a directly-baked velocity leaks O(voxel²) divergence through interpolation.
`BoundedField.bakePotential3D()` bakes the *ramped* potential (alpha = SDF), so the obstacle rides
into the texture for free. For in-shader boundaries with your own SDF, emit the analytic potential
with `field.glsl({ potential: true })` (adds `<name>Pot(p, t)`).

## The atom engine — broadband, infinite, locally art-directed

The spectral field above is a sum of *global* waves: perfect for coherent structures, `glsl()`, and
tileability, but its spectrum is a band and its parameters are one set for all of space. The second
engine trades those for the three things global modes can't do:

```js
const field = HelixNoise.createAtoms({
  octaves: 3,                                   // broadband: each octave halves the atom size
  radius: 1.6, slope: 1.2, seed: 11,
  helicityField: (x, y, z) => Math.tanh(3 - x), // handedness varies across space
  gainField:     (x, y, z) => (y > 2 ? 1 : 0.3),
});
field.sample(x, y, z, t);                       // same sampling surface, any point in R³
```

It is a sum of **compactly-supported helical atoms** — each one `∇×(W·A)`, a C² window times the
Beltrami-wave potential — placed by a spatial hash (one deterministic PRNG per cell, generated on
demand and cached). Consequences:

- **Exactly divergence-free**, like everything here: each atom is a curl. Vorticity is analytic
  (closed-form window Hessian), so helicity colouring stays cheap and exact.
- **Broadband**: octave layers with a per-octave `slope` amplitude law — fine detail global modes
  would need many times the mode count for.
- **Infinite & amortized O(1)**: cost per sample is 8 cells × `atomsPerCell` × octaves, independent
  of domain size. No period, no tile.
- **Spatially-varying parameters**: `helicityField` / `gainField` are frozen into each atom at its
  center, so regional art direction costs no divergence (see the demo — left half right-handed,
  right half left-handed, clean seam).
- **Boundaries and div-free bakes compose**: the exact potential `ΣW·A` means `withBoundary()` and
  `bakePotential3D()` work identically to the spectral engine.

`glsl()` works here too: the emitted shader **regenerates the atoms in-shader** from the spatial
hash — the integer PRNG ports bit-exactly, so the GPU field matches the CPU one to float32
precision (verified on a live WebGL2 context: worst |cpu − gpu| ≈ 1.3e-6). It regenerates
octaves × 8 × `atomsPerCell` atoms per fragment, so it's for moderate resolutions or offline
passes — for cheap real-time GPU use prefer the bake textures. Constant parameters only
(`helicityField`/`gainField`/`spectrum` are JS callbacks and can't be ported — it throws).

Honest trade-offs: no `coherence` axis (atom phases are independent by construction — organized
structures live in the spectral engine), no `tileable`, and one sample costs ~1.4–1.9× the
48-mode sum (measured in `npm run bench` — a direct-mapped cell memo keeps repeated lookups
cheap; still microseconds). `sampleMany`/`sampleManyUW` exist for allocation-free batches.

## Live demos

Open these in a browser (they're plain HTML — no build needed):

- **[`gallery.html`](gallery.html)** — one field, nine renderers, three shared sliders re-tuning all at once.
- **[`sandbox.html`](sandbox.html)** — the full 3-D view: orbit camera, comet-trail streamlines, every control.
- **[`examples/smoke.html`](examples/smoke.html)** — **volumetric smoke**: a 48³ dye volume advected through
  `field.bake3D()` and raymarched in WebGL2, with self-shadowing. Orbit, zoom, draw smoke with the pointer.
- **[`examples/water.html`](examples/water.html)** — **flowing water surface**: ripple layers bent along the
  streamlines, with caustics and sun-glints. Three dials reshape the current; move the pointer to steer the sun.
- **[`examples/nebula.html`](examples/nebula.html)** — **living nebula**: no bake, no sim — the shader
  raymarches `hx(p, t)` analytically; density = |vorticity| (self-calibrated), colour = local handedness,
  churn = the library's Kolmogorov-scaled time evolution.
- **[`examples/tubes.html`](examples/tubes.html)** — **vortex streamtubes** (three.js): at `helicity ±1`
  every tube corkscrews the same way; at `0` both handednesses coexist — the axis curl-noise doesn't have.
- **[`examples/million.html`](examples/million.html)** — **1–4 M particles** advected entirely on the GPU:
  `field.glsl()` inside a transform-feedback shader, zero CPU field calls per frame.
- **[`examples/kelp.html`](examples/kelp.html)** — **kelp forest**: each frond bent by the field at its
  own height *and at field time*; the sway is the library's own `churn` — set it to 0 and the forest freezes.
- **[`examples/ebru.html`](examples/ebru.html)** — **ebru marbling**: ink advected through the flow;
  because it's divergence-free the bands stretch and fold but never tear — incompressibility made visible.
- **[`examples/qcriterion.html`](examples/qcriterion.html)** — **Q-criterion vortex isosurfaces**:
  marching cubes over `Q = ½(‖Ω‖²−‖S‖²)`, tinted by helicity; raise `coherence` and the tangle condenses
  into distinct tubes.
- **[`examples/obstacle.html`](examples/obstacle.html)** — **flow around an obstacle**: a cylinder described
  only by its SDF; the flow slides along the wall via `field.withBoundary()`, still divergence-free.
- **[`examples/atoms.html`](examples/atoms.html)** — **the atom engine**: regional handedness via
  `helicityField` — right-handed on the left, left-handed on the right, one seamless field.
- **[`examples/cirrus.html`](examples/cirrus.html)** — **jetstream cirrus**: one `anisotropy` dial shears
  an advected dye sky (GPU `field.glsl()`) — wisps combed *along* the jet at γ&lt;0, billow bands *across* it at γ&gt;0.
- **[`examples/audio.html`](examples/audio.html)** — **audio-reactive**: bass → `amplitude`, treble → `churn`,
  stereo balance → `helicity`. A self-contained WebAudio demo beat drives all three (or feed it your mic / a track).
- **[`examples/index.html`](examples/index.html)** — the hub with all of the above on one page.
- **[`examples/three.html`](examples/three.html)** · **[`examples/p5.html`](examples/p5.html)** ·
  **[`examples/shader.html`](examples/shader.html)** · **[`examples/basic.html`](examples/basic.html)** — integrations.

## Use it in your stack

Helix Noise only produces velocities, so it drops into anything. Three ways in — see
[`examples/`](examples/) for runnable versions of each.

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

## API

> 📖 **Full developer reference:** [`docs/API.md`](docs/API.md) — every function, option, and method
> in plain language. The tables below are the quick version.

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
| `sampleMany(pos, out?, t?)` | `out` | batch velocities for interleaved `[x,y,z,…]`; tiled kernel, ~1.8× the loop |
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

`npm test` reproduces:

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
  physically *scaled* across modes (Kolmogorov churn) — it is not a nonlinear cascade.

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
src/            TypeScript source (index · field · glsl · rng · types · constants)
dist/           built output (committed so demos work without a build)
test/           node:test suite (.ts)
examples/       three.js · p5.js · raw-WebGL2 · volumetric smoke · flowing water · minimal
scripts/        render-assets.mjs — reproducible PNG generator
sandbox.html · gallery.html       browser demos
```

## License

MIT © Rifat Jumagulov. See [LICENSE](LICENSE).
