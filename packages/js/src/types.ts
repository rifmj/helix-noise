/** Options for {@link create}. All optional; see {@link DEFAULTS}. */
export interface HelixNoiseOptions {
  /** Number of helical modes. Cost of one sample is O(modes). Default 48. */
  modes?: number;
  /** Spectral slope s: mode amplitude ∝ |k|^-s. Default 1.6. */
  slope?: number;
  /** Helicity p ∈ [-1, 1]: energy split between the two helical states. Default 0. */
  helicity?: number;
  /** Phase coherence λ ∈ [0, 1]: inter-mode phases random → structured. Default 0. */
  coherence?: number;
  /** Smallest wavenumber (largest structures). Default 1. */
  kmin?: number;
  /** Largest wavenumber (finest detail). Default 6.2. */
  kmax?: number;
  /** Number of focus points the coherent phases organize toward. Default 3. */
  centers?: number;
  /** Output scaling; field is normalized to unit RMS speed (at t = 0), then multiplied by this. Default 1. */
  amplitude?: number;
  /** Snap wavevectors to the integer lattice → exactly 2π-periodic (seamlessly tileable). Default false. */
  tileable?: boolean;
  /** Integer seed (deterministic). Default 1. */
  seed?: number;
  /**
   * Mode layout. `"fibonacci"` (default): low-discrepancy directions (a seeded rotation of the
   * Fibonacci sphere) + stratified wavenumbers — visibly fewer interference artifacts at the same
   * mode count; the right choice for almost all rendering. `"random"`: statistically independent
   * (i.i.d.) directions and wavenumbers. Not "worse" — it trades the cleaner look for a genuine
   * random ensemble, which is what you want for Monte-Carlo work or matching an analytic
   * ensemble average. Higher variance, so it needs more modes to look as smooth.
   */
  layout?: "fibonacci" | "random";
  /**
   * Time-evolution rate χ ≥ 0 for the optional `t` argument of the samplers. Incoherent modes
   * churn at the eddy-turnover rate ω(k) = χ·kmin^⅓·k^⅔ (small scales flicker faster); coherent
   * structures sweep with their centers' velocities (|V| ~ χ) instead of dissolving. `0` freezes
   * the field. Does not change the field at t = 0. Default 1.
   */
  churn?: number;
  /**
   * Viscosity ν ≥ 0: mode amplitudes decay as e^(−νk²t) — the exact viscous factor (a single
   * mode evolving this way is an exact Navier–Stokes solution). `0` (default) = no decay.
   */
  decay?: number;
  /**
   * Custom amplitude law a(|k|) ≥ 0, replacing the power law `|k|^-slope`. Only the shape
   * matters — the field is RMS-normalized afterwards. Must be pure/deterministic.
   */
  spectrum?: (k: number) => number;
  /**
   * Direction anisotropy γ (clamped to [−0.99, 9]): mode directions are stretched along `axis`
   * by (1+γ) and renormalized. γ < 0 → wavevectors avoid the axis → structures streak *along*
   * it (jets); γ > 0 → wavevectors align with it → layers *across* it (strata). Default 0.
   */
  anisotropy?: number;
  /** Anisotropy axis (normalized internally). Default [0, 0, 1]. */
  axis?: [number, number, number];
}

export type Vec3 = [number, number, number];
export type Out6 = number[] | Float64Array | Float32Array;

/** Signed distance function: > 0 outside the obstacle, < 0 inside, 0 on the wall. */
export type Sdf = (x: number, y: number, z: number) => number;

/** Options for {@link Field.withBoundary}. */
export interface BoundaryOptions {
  /** Width of the influence band: the flow yields to the wall over 0 < d < thickness. Default 1. */
  thickness?: number;
  /**
   * Analytic SDF gradient ∇d (for a true SDF, the unit outward normal). Supplying it makes the
   * bounded field analytically divergence-free and wall-tangent to machine precision; if omitted
   * it is estimated by central differences of `sdf` with `fdStep` (costs 6 extra sdf calls per
   * sample, and exactness degrades to O(fdStep²)).
   */
  gradient?: (x: number, y: number, z: number) => ArrayLike<number>;
  /** Step for internal finite differences (SDF-gradient fallback; wrapper vorticity). Default 1e-3. */
  fdStep?: number;
}

/**
 * A {@link Field} constrained by an obstacle: velocity slides along the wall (free-slip), is zero
 * inside, equals the base field beyond the influence band, and stays exactly divergence-free —
 * it is `∇×(ramp(d)·A)` with `A` the base field's analytic vector potential.
 */
export interface BoundedField {
  /** The unconstrained field this wraps (spectral or atom engine). */
  readonly base: FlowField;
  /** The obstacle's signed distance function. */
  readonly sdf: Sdf;
  /** Bounded velocity [u, v, w]; tangent at the wall, 0 inside, → base far away. */
  sample(x: number, y: number, z: number, t?: number): Vec3;
  /** Vorticity of the bounded field (central differences of `sample`, O(fdStep²)). */
  vorticity(x: number, y: number, z: number, t?: number): Vec3;
  /** u·ω of the bounded field (vorticity via central differences). */
  helicityDensity(x: number, y: number, z: number, t?: number): number;
  /** Velocity (0..2, analytic) + vorticity (3..5, central differences) in one pass. */
  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
  /** The ramped vector potential `ramp(d)·A` — its exact curl is this bounded field. */
  potential(x: number, y: number, z: number, t?: number): Vec3;
  /** Bake rgb = bounded velocity, a = bounded helicity density (FD vorticity — slow, offline). */
  bake3D(n: number, t?: number): Bake3DResult;
  /**
   * Bake rgb = ramped potential `ramp(d)·A`, a = sdf. Take the curl in your shader (central
   * differences of the trilinear samples): the result is obstacle-aware AND discretely
   * divergence-free — the cheap GPU path for bounded flow.
   */
  bakePotential3D(n: number, t?: number): Bake3DResult;
}

/**
 * The sampling surface shared by every divergence-free flow in this package (the spectral
 * {@link Field}, the sparse {@link AtomField}, …). Anything that exposes an exact vector
 * potential gets boundaries and divergence-free bakes for free.
 */
export interface FlowField {
  /** Divergence-free velocity [u, v, w] at (x, y, z), optionally at time t. */
  sample(x: number, y: number, z: number, t?: number): Vec3;
  /** Vorticity (curl u) [wx, wy, wz] at (x, y, z), optionally at time t. */
  vorticity(x: number, y: number, z: number, t?: number): Vec3;
  /** Helicity density u·ω at (x, y, z), optionally at time t. Sign = local handedness. */
  helicityDensity(x: number, y: number, z: number, t?: number): number;
  /** Velocity (indices 0..2) and vorticity (indices 3..5) in one pass, zero allocation. */
  sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
  /** Velocity (0..2) and vector potential A (3..5) in one pass, zero allocation. ∇×A = u exactly. */
  sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
  /** The analytic vector potential A with ∇×A = u. */
  potential(x: number, y: number, z: number, t?: number): Vec3;
  /** Bake an n³ RGBA float volume (rgb = velocity, a = helicity), optionally at time t. */
  bake3D(n: number, t?: number): Bake3DResult;
  /** Bake an nx×ny RGBA float slice at height z (rgb = velocity, a = helicity), optionally at time t. */
  bake2D(nx: number, ny: number, z?: number, t?: number): Bake2DResult;
  /** Bake rgb = vector potential A (FD-curl it in the shader → discretely div-free velocity). */
  bakePotential3D(n: number, t?: number): Bake3DResult;
  /** Constrain the field with an SDF obstacle (free-slip, still exactly divergence-free). */
  withBoundary(sdf: Sdf, opts?: BoundaryOptions): BoundedField;
}

/** A generated flow field. Immutable spectrum until {@link Field.set} is called. */
export interface Field extends FlowField {
  /** Current parameters. */
  readonly params: Required<Omit<HelixNoiseOptions, "spectrum">> & Pick<HelixNoiseOptions, "spectrum">;
  /**
   * Batch velocities: `pos` is n interleaved points [x0,y0,z0, x1,…]; writes n interleaved
   * [u,v,w] into `out` (same length as `pos`; allocated as a Float64Array if omitted).
   * Mode-major and tiled — measurably faster than looping `sampleUW` over a particle system.
   */
  sampleMany<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t?: number): T;
  /** Batch velocity + vorticity: writes n interleaved [u,v,w,wx,wy,wz] (out length = 2 × pos length). */
  sampleManyUW<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t?: number): T;
  /** Re-tune any subset of params and rebuild the modes. Returns this. */
  set(options: HelixNoiseOptions): Field;
  /** Relative helicity ⟨u·ω⟩/(‖u‖‖ω‖) on an ng³ grid; should track helicity p. Default ng = 12. */
  relativeHelicity(ng?: number): number;
  /** Emit self-contained GLSL (WebGL2) defining `vec3 <name>(vec3 p)` + `(vec3 p, float t)` (+ curl). */
  glsl(opts?: GlslOptions): string;
}

/** Options for {@link createAtoms}. All optional. */
export interface HelixAtomsOptions {
  /** Octave layers; each halves the atom radius and doubles the wavenumber. Default 3. */
  octaves?: number;
  /** Atoms per hash cell (a cell is one atom diameter wide). Density/quality knob. Default 8. */
  atomsPerCell?: number;
  /** Support radius of the largest atoms (octave 0); octave o uses radius/2^o. Default 1.6. */
  radius?: number;
  /** Wavelengths across an atom's diameter — sets |k|·radius per octave. Default 2. */
  cyclesPerAtom?: number;
  /** Amplitude ∝ |k|^-slope across octaves. Default 1.6. */
  slope?: number;
  /** Helicity p ∈ [-1, 1], as in the spectral engine. Default 0. */
  helicity?: number;
  /** Output scale (field normalized to unit RMS at t = 0, then multiplied). Default 1. */
  amplitude?: number;
  /** Integer seed (deterministic). Default 1. */
  seed?: number;
  /** Time-evolution rate: per-atom phase churn at ω(k) ∝ k^⅔. 0 freezes. Default 1. */
  churn?: number;
  /**
   * Spatially-varying helicity: sampled once at each atom's center (must be pure/static;
   * call `set({})` after changing it to flush the atom cache). Overrides `helicity` locally.
   */
  helicityField?: (x: number, y: number, z: number) => number;
  /** Spatially-varying amplitude gain, sampled at atom centers (same caching rule). */
  gainField?: (x: number, y: number, z: number) => number;
  /** Custom amplitude law a(|k|) ≥ 0 replacing the octave power law (shape only; same purity rule). */
  spectrum?: (k: number) => number;
  /** Direction anisotropy γ, as in the spectral engine: streaks (γ<0) or layers (γ>0) along `axis`. Default 0. */
  anisotropy?: number;
  /** Anisotropy axis (normalized internally). Default [0, 0, 1]. */
  axis?: [number, number, number];
}

/**
 * The sparse-atom engine: a sum of compactly-supported helical wavelets placed by a spatial
 * hash — broadband (octaves), infinite and grid-free, amortized O(1) per sample, with
 * spatially-varying parameters. Each atom is `∇×(W·A)` (window × helical-wave potential), so
 * the field is exactly divergence-free and has an exact potential `Σ W·A` — boundaries and
 * divergence-free bakes work the same as for the spectral engine.
 */
export interface AtomField extends FlowField {
  /** Current parameters. */
  readonly params: Required<Omit<HelixAtomsOptions, "helicityField" | "gainField" | "spectrum">> &
    Pick<HelixAtomsOptions, "helicityField" | "gainField" | "spectrum">;
  /** Re-tune any subset of params; flushes the atom cache. Returns this. */
  set(options: HelixAtomsOptions): AtomField;
  /** Relative helicity ⟨u·ω⟩/(‖u‖‖ω‖) sampled on a grid spanning a few atom radii. */
  relativeHelicity(ng?: number): number;
  /** Batch velocities for interleaved `[x,y,z,…]` points (allocation-free with `out`). */
  sampleMany<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t?: number): T;
  /** Batch velocity + analytic vorticity, 6 floats per point. */
  sampleManyUW<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t?: number): T;
  /**
   * Emit self-contained GLSL that regenerates the atoms in-shader from the spatial hash
   * (bit-exact integer PRNG; float32 rounding only). Constant parameters only — throws if
   * `helicityField`/`gainField`/`spectrum` are set. Heavier per fragment than the spectral
   * `glsl()`; for cheap real-time GPU use prefer the bake textures.
   */
  glsl(opts?: GlslOptions): string;
}

export interface Bake3DResult {
  data: Float32Array;
  size: number;
  channels: 4;
}

export interface Bake2DResult {
  data: Float32Array;
  width: number;
  height: number;
  channels: 4;
}

export interface GlslOptions {
  /** Function name (also namespaces the baked constants). Default "helixNoise". */
  name?: string;
  /** Significant digits for baked floats. Default 7. */
  precision?: number;
  /** Also emit `<name>Curl(vec3 p)`. Default true. */
  curl?: boolean;
  /** Also emit the vector potential `<name>Pot(vec3 p)` — for in-shader SDF boundaries. Default false. */
  potential?: boolean;
}

export interface SelfTestReport {
  /** max |k·e|, exact transversality (should be ~1e-16). */
  transversality: number;
  /** Finite-difference divergence rms (pure O(h²) truncation). */
  fdDivergenceRms: number;
  /** Relative helicity keyed by p ("-1", "-0.5", "0", "0.5", "1"). */
  rhoVsP: Record<string, number>;
}

/**
 * The raw baked mode data a {@link Field} exposes, consumed by the GLSL generator.
 * @internal
 */
export interface ModeData {
  N: number;
  kx: Float64Array; ky: Float64Array; kz: Float64Array;
  km: Float64Array;
  e1x: Float64Array; e1y: Float64Array; e1z: Float64Array;
  e2x: Float64Array; e2y: Float64Array; e2z: Float64Array;
  s: Float64Array; a: Float64Array; ph: Float64Array;
  /** Per-mode phase rate (rad per unit time): eddy churn + coherent sweep. */
  om: Float64Array;
  /** Viscous decay rate ν (amplitudes ∝ e^(−νk²t)); 0 = none. */
  nu: number;
  _scale: number;
}
