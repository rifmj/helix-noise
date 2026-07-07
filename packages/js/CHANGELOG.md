# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
