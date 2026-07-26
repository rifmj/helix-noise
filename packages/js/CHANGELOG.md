# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Stale time-dependent modes in the wasm batch path.** With `decay` or `flutter` active, a
  `sampleMany`/`sampleManyUW` call at `t = 0` that followed a call at `t > 0` on the same field
  returned the *previous* time's decayed amplitudes / flutter-shifted phases — the batch path
  disagreed with `sampleUW`, which was always correct. The kernel's per-slot refresh guard tested
  array identity (`amps !== field.a`), but `_amps`/`_phases` return the baked arrays at `t = 0`, so
  the step back down to 0 looked like "nothing to re-upload". The mode block now tracks *which
  time's* content is resident in each time-dependent slot. Alternating two fields per frame masked
  this (the owner switch forced a full re-upload); re-measuring one field at `t = 0` exposed it.

## [1.8.0]

### Added

- **`flutter`** — fast temporal decorrelation. `churn` drifts the field smoothly; real flow also
  shimmers, with a good part of the local strain fluctuating far faster than an eddy turns over.
  This adds that: a second phase harmonic per wave, at the finest scale's eddy rate times the
  golden ratio, so it is faster than any wave's own drift and never resynchronizes into a global
  pulse. In radians — `0.3` flickers, `1` is agitated.

### Notes

- Written as `sin(ω_f t + ph) − sin(ph)`, so it vanishes *exactly* at `t = 0`: the static field
  stays bit-identical, as it must (this is the same contract `churn` has). Consumes no RNG draws.
- `churn: 0` still freezes the field completely — flutter rides the churn rate, so it stops too.
- The phases are cached per frame like the decayed amplitudes, so the cost is per-frame, not
  per-sample, and the wasm batch path keeps working by uploading the shifted phases.
- Emitted GLSL bakes `<name>_FL` and `<name>_OMF[]` and carries the same phase, so the GPU path
  shimmers identically. Ported to Python, Rust and all four shader targets; new fixture config
  `R_flutter`, whose `t = 0.5` samples are what pin it.

## [1.7.0]

### Added

- **Structure diagnostics for colouring.** `qCriterion`, `lambda2` and `stretching` — the standard
  ways to say *this is a vortex core*, *this is a shear layer*, *this vortex is being spun up* —
  plus `sampleGrad(x, y, z, out9, t)`, the analytic velocity gradient they are built from. No
  finite differences and no grid: the gradient is one closed-form term per wave.
- `glsl({ gradient: true })` emits `mat3 <name>Grad(vec3 p)` and `float <name>Q(vec3 p)` so the
  same colouring works on the GPU.
- Sandbox demo: a colour toggle between helicity density and the Q-criterion.

### Notes

- The gradient is exact for every mode type — circular, elliptic and grain-axis — and the tests
  pin it three ways: against finite differences, by its trace being machine-zero (that *is* the
  divergence), and by its antisymmetric part reproducing the analytic vorticity to 1e-12.
- Two known answers worth knowing: a single Beltrami wave has `Q = 0` exactly (its rotation and
  strain balance) and zero stretching.

## [1.6.0]

### Added

- **Structure primitives** — a second field genre next to the noise sum: localized, closed-form
  flows with no randomness in them at all.
  - `createRing({ center, axis, radius, core, circulation, advect })` — a **vortex ring**: a compact
    torus of swirl pushing a jet through its own middle, exactly zero outside the core.
    `advect: true` sends it flying at Kelvin's self-induced speed `Γ/(4πR)·(ln(8R/c) − ¼)`.
  - `collidingRings({ …, separation })` — two rings fired head-on.
  - `compose(...fields)` — sum any number of flows, primitives or noise.
  - `ringSpeed(circulation, radius, core)` — the closed-form ring speed on its own.

### Notes

- Built as an explicit curl `u = ∇×A` with `A = Γ(1 − q²/c²)³·ê_φ`, so the ring is exactly
  divergence-free and its analytic vorticity is the real curl — the test pins that by Richardson
  extrapolation (halving the step quarters the error, ratio 4.0), not by a loose tolerance.
- The potential is compactly supported as well, so `withBoundary` and `bakePotential3D` work
  exactly, and an obstacle outside the core sees literally nothing.
- JS-first, like the atom engine: the primitives are outside the cross-port spectral spec.
- Not yet shipped: columnar (tornado) swirl. Its potential cannot be compactly supported — a
  solenoid never has one — and picking the decaying gauge is a real design decision rather than a
  transcription, so it waits rather than shipping half-right.

## [1.5.0]

### Added

- **`exactNS({ k0, nu, sign })`** — options for a field that genuinely *solves* the Navier–Stokes
  equations rather than merely resembling one. A single wavenumber and one handedness make the flow
  Beltrami (`∇×u = ±k₀u`), so the nonlinear term is a pure gradient the pressure absorbs and what
  remains is exact viscous decay. Verified as a shipped test: `∇×u = k₀u` pointwise, `u(t)` is
  `e^(−νk₀²t)·u(0)` to machine precision, and the relative helicity is `±1` and conserved.
- **`nsDeveloped()` / `nsForced()`** — option bundles whose polarization matches measured
  turbulence: `ellipticity` is the exact inverse of the per-mode helical fraction (2ε/(1+ε²) = |p|)
  and `helicity` carries its signed mean. `NS_TARGETS` exports the numbers.
- **`relativeHelicitySpectral(t)`** — the exact, grid-free relative helicity, computed straight
  from the wave data. `relativeHelicity(ng)` is a grid estimate of it; with few, distinct, integer
  wavevectors the two agree to 1e-9, and they part company exactly where you would expect —
  when `tileable` rounding makes wavevectors collide.

### Notes

- The NS bundles calibrate **polarization only**; the spectrum keeps the default power law, because
  matching a measured shell spectrum needs a table this package does not ship. The docs say so.

## [1.4.0]

### Added

- **`polarizationAxis` / `polarizationBias` — a world-space grain axis.** `ellipticity` sets how each
  wave polarizes, but each wave's ellipse is oriented by its own wavevector, so there is no overall
  grain. This adds one: a direction the texture combs along, and how strongly (`0 … 0.95`). It is the
  last of the three polarization channels (`Φ = g·P⊥ + D + i·p·N`) — the real, traceless transverse
  part `D`, which no amount of `anisotropy` can produce (that only moves wavevector *directions*).
- Sandbox demo: a **grain** slider.

### Notes

- **The channel is gated on the axis, never on the bias.** With `polarizationAxis: null` (the
  default) nothing changes at all — no second stream is created and the field is bit-identical to
  1.3. Setting the axis re-rolls the texture: each wave's amplitude is then drawn from a Gaussian
  with the requested covariance, so the statistics are what you asked for but the particular
  realization is new, even at `polarizationBias: 0`.
- The extra draws come from a **second, independent** mulberry32 stream (seed + a fixed salt), so
  every draw of the main build still happens in the same order with the same use.
- Grain and handedness compete for the same budget: `d` and the chirality `χ = ε·s` are jointly
  capped at `√(d² + χ²) ≤ 0.97`. That is the positivity of the covariance — physics, not a quirk.
  At `ellipticity: 1` there is almost no room for grain; lower it to open the ball.
- Energy along the axis lands at `(1 + d)/3` (`1/3` being isotropic) — a shipped self-test.
- Folded frames need the general cross-product curl, so `sampleManyUW` and the emitted `…Curl` /
  `…Pot` take that path; batch velocity keeps its wasm fast path.

## [1.3.0]

### Added

- **Scale-dependent dials.** `helicity` and `coherence` now also take a function of the wavenumber,
  evaluated once per wave exactly like `spectrum`. That reaches looks a single slider cannot:
  organized large-scale rollers carrying incoherent fine grain, or handedness that lives only at
  the largest scales. The callables never draw randomness, so the mode layout is untouched — a
  function returning a constant reproduces the scalar field bit for bit.
- **Dial presets** `shellPeak(kPeak, width)`, `rolloff(kc)`, `condensate(kSplit, pLarge, pSmall)`.
- **`abc(A, B, C, { amplitude, decay })`** — the classical ABC cell flow as exactly three waves of
  the same engine, so every sampler, bake, `glsl()` and `withBoundary` works on it. No RNG at all,
  seamlessly tileable, a pure Beltrami field (`∇×u = u`, potential `= u`); `decay: ν` makes it the
  exact viscous solution. It refuses `set()` — build a new one instead.
- **`twoScale(base, detail, { detailGain })`** plus the constant `C_TWO_SCALE` — a coherent backbone
  carrying broadband detail. The sum of two divergence-free fields is divergence-free and its
  potential is the sum of theirs, so boundaries and potential bakes keep working. Sizing the detail
  as `amplitude: C_TWO_SCALE / kDetail` holds its vorticity budget fixed as you slide its scale.
- Sandbox demo: `rollers` and `band` preset buttons driving the new dials.

### Notes

- Purely additive: with scalars everywhere the executed code path is unchanged, and every
  pre-existing parity-fixture config is bit-identical.

## [1.2.0]

### Added

- **`ellipticity` — the polarization dial** (`ε ∈ [0, 1]`, default `1`). Each mode's Beltrami sign
  `s = ±1` generalizes to a continuous chirality `χ = ε·s`, morphing the texture between corkscrew
  **tubes** (`ε = 1`, the classic engine, bit-identical) and laminated **sheets/jets** (`ε = 0`) at a
  fixed spectrum and a fixed `helicity`. It is the third axis of the one-point spectral tensor
  (`Φ = g·P⊥ + D + i·p·N`) — genuinely independent of both `anisotropy` (which only moves wavevector
  *directions*) and `helicity` (which only biases the *sign* of `χ`). The field stays exactly
  divergence-free and keeps an exact Coulomb-gauge vector potential for every `ε`, so `withBoundary`,
  `bakePotential3D` and the emitted GLSL potential work unchanged.
- Sandbox demo: an **ellipticity** slider plus `sheets` and `braid` presets.
- `selfTest()` reports `ellipticityRho` (one mode's relative helicity vs the exact `2χ/(1+χ²)`) and
  `fdDivergenceRmsElliptic`.
- `ModeData` exposes the per-mode `chi` array; the emitted GLSL bakes it into `P_S` (no ABI change)
  and switches `…Curl`/`…Pot` to the general two-term bodies when the modes are not Beltrami.

### Fixed

- **WASM batch kernel read stale mode data.** The kernel strides its mode arrays by the live mode
  count, but the uploader wrote them at the reserved capacity — so any field built with fewer modes
  than an earlier one got garbage velocities from `sampleMany`/`sampleManyUW` (silently: no error,
  just a wrong field). Both now use the same stride.

### Notes

- `ellipticity` consumes **no RNG draws** — it is a deterministic post-transform of the already-drawn
  sign, so every field's mode layout is bit-identical across `ε`, and all pre-existing parity-fixture
  configs are unchanged.
- Interaction to know: at `ε = 0` every mode is achiral, so the `helicity` slider has no visible
  effect and `relativeHelicity()` reads ≈ 0. In general one mode's relative helicity is capped at
  `2ε/(1+ε²)`.

## [1.1.0]

- `coherence` now blends phases additively (`ph = φ_center + (1−λ)·φ_random`, helical-fields Eq. 9)
  instead of the complex-plane "chord" blend, which had a singularity at λ = ½ for antipodal phases.
  The amplitude spectrum and helicity bias are frozen at every λ — only the phase moves.

## [1.0.2]

- Docs-only release: restructured README for faster onboarding — code in the first screen,
  live demo links (GitHub Pages), an engine-comparison table, a Recipes & tips section, links
  to the Python/Rust/shader ports, and a new hero animation (the landing's particle flow).
- No code changes.

## [1.0.1]

- Fix broken README images on npm: the package lives in `packages/js` of the monorepo, so
  relative `assets/*` paths didn't resolve on the npm page. Images now use absolute raw URLs,
  and `repository.directory` is set so npm resolves the remaining relative links correctly.
- No code changes.

## [1.0.0]

Initial release of Helix Noise.

- Grid-free, divergence-free 3-D velocity field as an analytic sum of Beltrami (helical) modes.
- Demos: `gallery.html` (nine renderers on one field), `sandbox.html` (full single view),
  `examples/smoke.html` (volumetric smoke — a 48³ dye volume advected through `bake3D()` and
  raymarched in WebGL2), `examples/smoke_obstacle.html` (GPU smoke around an SDF obstacle — the
  whole sim runs on the GPU: `BoundedField.bakePotential3D()` stores the vector potential (rgb) and
  signed distance (alpha) in one RGBA16F volume, the advection shader reconstructs velocity as the
  finite-difference `∇×A` of the trilinear samples so the interpolated field stays discretely
  divergence-free, and the alpha channel both carves the solid out of the smoke and shades it;
  sphere / torus / bar), `examples/nebula.html` (living nebula —
  no bake: rays march the emitted `hx(p, t)` analytically; density = |vorticity| with thresholds
  self-calibrated from measured percentiles, colour = local handedness, churn = the library's time
  axis), `examples/tubes.html` (vortex streamtubes in three.js coloured by u·ω — at helicity ±1
  every tube corkscrews the same way), `examples/million.html` (1–4 M particles advected by a
  transform-feedback shader built from `field.glsl()` — zero CPU field calls per frame, ~70 fps at
  1 M), `examples/kelp.html` (kelp forest — fronds bent by `sampleUW(x,y,z,out,t)` up their height,
  swaying by the library's own churn), `examples/ebru.html` (Turkish paper-marbling — ink advected
  semi-Lagrangian through a `bake2D` slice; divergence-free ⇒ bands fold but never tear), and
  `examples/qcriterion.html` (Q-criterion vortex isosurfaces — marching cubes over
  `Q = ½(‖Ω‖²−‖S‖²)` from central-difference ∇u, tinted by helicity, with a self-contained
  `examples/marching-cubes.js`), `examples/cirrus.html` (jetstream cirrus
  — a single `anisotropy` dial shears an advected-dye sky rendered from `field.glsl()`: γ<0 combs wisps
  along the jet, γ>0 stacks billow bands across it; IBFV ping-pong dye + sunset compositing in WebGL2),
  `examples/water.html` (flowing water surface — ripple layers bent along the streamlines, with caustics
  and sun-glints), `examples/audio.html` (audio-reactive — bass → `amplitude`, treble → `churn`, stereo
  balance → `helicity`, via a WebAudio analyser chain with a splitter for the L/R balance; a self-contained
  demo beat drives all three, or mic / file input; helicity is re-baked only past a threshold, exploiting
  that `set()` re-rolls no RNG so sign flips are monotone), `examples/basic.html` (minimal), and
  `examples/index.html` (the demo hub). Fixed an inherited
  camera-basis flip in the volumetric raymarchers (`R = F × up` was negated, rendering the volume
  rotated 180°), and a first-frame `dt = NaN` in the requestAnimationFrame loops (the immediate
  `loop()` invocation received an undefined timestamp).
- Three artist-facing controls: `slope` (spectral slope), `helicity` (`p ∈ [-1, 1]`),
  `coherence` (`λ ∈ [0, 1]`, noise → structure at fixed spectrum).
- **Low-discrepancy mode layout** (default): directions on a seeded random rotation of the
  Fibonacci sphere, wavenumbers stratified across the band with a shuffled pairing — measured ~6×
  larger minimum angular separation at 48 modes than iid sampling, so visibly fewer interference
  beats. `layout: "random"` keeps the plain iid construction (bit-for-bit, same seeds ⇒ same fields).
- **Time evolution**: every sampler/bake takes an optional trailing `t`, and `glsl()` emits
  `(vec3 p)` + `(vec3 p, float t)` overloads. Incoherent modes churn at the Kolmogorov
  eddy-turnover rate `ω(k) ∝ k^⅔` (knob: `churn`); coherent modes sweep with their center's
  velocity, so structures translate rigidly at `coherence: 1` (exact identity, tested); optional
  `decay: ν` applies the exact per-mode viscous factor `e^(−νk²t)`. `t = 0` is bit-identical to
  the static field.
- **Batch samplers** `sampleMany` / `sampleManyUW`: tiled, mode-major kernel with an inlined
  double-precision sincos (3-term Cody–Waite reduction + fdlibm kernels; `Math.*` fallback for
  huge phases) — measured ~1.8× a zero-alloc `sampleUW` loop (Node 20), equal to the scalar path
  to < 1e-12 (tested). `npm run bench` reproduces the numbers.
- **Vector potential & SDF boundaries**: every Beltrami mode has the closed-form potential
  `A_j = s_j·u_j/|k_j|` (`potential()`, `sampleUA()`; `glsl({ potential: true })` emits
  `<name>Pot`). `withBoundary(sdf, { thickness, gradient })` applies Bridson's curl-noise
  boundary ramp to it: free-slip flow along obstacles (wall-normal flux = `ramp(d)·(u·n)`
  exactly — the slip term is tangent identically), zero inside, bit-identical to the base field
  beyond the band, exactly divergence-free, composes with `t`. Demo: `examples/obstacle.html`.
- **Divergence-free bakes**: `bakePotential3D()` (rgb = A; alpha = helicity) — a central-difference
  curl of the trilinear samples in the shader reconstructs velocity that is discretely
  divergence-free to machine precision (tested ≥ 100× below a directly-baked velocity);
  `BoundedField.bakePotential3D()` bakes the ramped potential with alpha = SDF, so obstacle-aware
  flow runs entirely on the GPU.
- **Spectrum designer & anisotropy** (both engines): `spectrum: (k) => a` replaces the power law
  with any amplitude shape (RMS normalization keeps only the shape meaningful);
  `anisotropy`/`axis` stretch wavevector directions — γ < 0 streaks the flow along the axis
  (jets), γ > 0 layers it across (strata). Defaults reproduce the isotropic power-law fields
  bit-for-bit.
- **Sparse-atom engine** (`createAtoms`): the field as a sum of compactly-supported helical
  atoms `∇×(W·A)` (C² window × Beltrami-wave potential) placed by a spatial hash — broadband
  (octaves), infinite and grid-free, amortized O(1) per sample, exactly divergence-free with
  closed-form analytic vorticity (tested against FD). **Spatially-varying parameters**:
  `helicityField` / `gainField` are frozen into atoms at their centers, so regional handedness /
  gain costs no divergence (tested: split-domain ρ = ±0.4+). Shares the `FlowField` surface —
  `withBoundary()`, `potential()`, and all bakes compose — plus `sampleMany`/`sampleManyUW` and a
  direct-mapped cell memo (measured ~1.4–1.9× the 48-mode sum per sample). Demo:
  `examples/atoms.html`. Trade-offs vs the spectral engine: no coherence axis, no `tileable`.
- **Atom-engine GLSL** (`AtomField.glsl()`): the emitted shader regenerates atoms in-GPU from the
  spatial hash — the mulberry32 PRNG and cell hash are pure 32-bit integer ops and port
  bit-exactly, so the GPU field matches the CPU one to float32 precision (executed on a live
  WebGL2 context: worst |cpu − gpu| ≈ 1.3e-6, with helicity/anisotropy/churn active). Constant
  parameters only (throws on JS-callback fields); heavier per fragment than the spectral shader —
  bake textures remain the cheap real-time GPU path.
- **WASM SIMD batch backend**: a 1.4 kB embedded f64x2 kernel (hand-written WAT, compiled by
  `wabt` at build time, base64-inlined — still zero runtime deps) takes over the spectral
  `sampleMany`/`sampleManyUW` automatically. It mirrors the JS kernel op-for-op (same Cody–Waite
  split and fdlibm polynomials, verified constant-exact), agrees to < 1e-12 (tested, decay/churn
  active, odd counts padded), and silently falls back to JS when wasm/SIMD is missing or phases
  exceed the exact-reduction range. Measured: ~5.5× a scalar `sampleUW` loop / ~3× the JS batch
  kernel in Node 20 (276 ns/pt at 48 modes), ~2× the JS kernel in Chrome.
- API: `sample`, `vorticity`, `helicityDensity`, `sampleUW` (zero-alloc), `sampleMany`,
  `sampleManyUW`, `sampleUA`, `potential`, `withBoundary`, `set`, `relativeHelicity`, `selfTest`.
- Integrations: `bake3D` / `bake2D` (RGBA float texture data) and `glsl()` (a self-contained
  GPU port of the exact field, verified equal to `sample()`). Examples for three.js, p5.js, and
  raw WebGL2.
- `tileable` option: snap wavevectors to the integer lattice for an exactly 2π-periodic,
  seamlessly tileable field.
- Written in **TypeScript** (modular `src/`, strict); built with tsup to ESM + CommonJS + an
  IIFE global (`<script>`) plus generated type declarations.
- Divergence-free to machine precision (transversality `~1e-16`); helicity tracks `p`
  (verified in `test/`).
- Visual-first README with an animated hero, live knob-sweep GIFs (helicity, coherence, slope), a
  four-renderer montage, and looping volumetric-smoke and flowing-water GIFs; `npm run assets`
  regenerates them all reproducibly (`scripts/render-assets.mjs`, pure Node + gifenc — including a
  CPU volume raymarcher and the water surface shader — no native deps).
