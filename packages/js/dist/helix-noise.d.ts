/**
 * A pure per-wavenumber dial, evaluated once per mode at its final |k| (after the `tileable`
 * rounding) — exactly like the `spectrum` callable. Must be deterministic and must not draw
 * randomness: the RNG sequence is unchanged whether you pass a number or a function.
 */
type ScaleFn = (k: number) => number;
/** Options for {@link create}. All optional; see {@link DEFAULTS}. */
interface HelixNoiseOptions {
    /** Number of helical modes. Cost of one sample is O(modes). Default 48. */
    modes?: number;
    /** Spectral slope s: mode amplitude ∝ |k|^-s. Default 1.6. */
    slope?: number;
    /**
     * Helicity p ∈ [-1, 1]: energy split between the two helical states. Default 0.
     * May also be a per-wavenumber callable `(k) => p` — e.g. a strongly handed large-scale
     * condensate over mirror-symmetric fine detail (see the `condensate` preset).
     */
    helicity?: number | ScaleFn;
    /**
     * Phase coherence λ ∈ [0, 1]: inter-mode phases random → structured. Default 0.
     * May also be a per-wavenumber callable `(k) => λ` (clamped per mode) — e.g. organized
     * large-scale rollers carrying incoherent fine detail (see the `rolloff` preset).
     */
    coherence?: number | ScaleFn;
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
    /**
     * World-space **grain axis** for linear polarization — the direction the flow's texture combs
     * along. `null` (default) leaves the channel off, and the field is then exactly what previous
     * versions produced. Normalized internally.
     *
     * Turning it on re-rolls the texture: the channel draws each mode's amplitude from a Gaussian
     * with the requested transverse covariance (from a second, independent RNG stream), so the
     * *statistics* are what you asked for but the particular realization changes — even at
     * `polarizationBias: 0`.
     */
    polarizationAxis?: [number, number, number] | null;
    /**
     * Strength d ∈ [0, 0.95] of the linear polarization along `polarizationAxis`. Only meaningful
     * when that axis is set. Physically the polarization degree is capped: `d` and the per-mode
     * chirality χ = ε·s are jointly clamped to √(d² + χ²) ≤ 0.97, so a fully circular field
     * (`ellipticity: 1`) leaves almost no room for grain — lower `ellipticity` to open it up.
     */
    polarizationBias?: number;
    /**
     * Temporal **flutter** ≥ 0: a fast, deterministic wobble added to each wave's phase, on top of
     * the smooth drift `churn` already gives it. Real turbulence does not just advect — a good part
     * of the local strain fluctuates on a timescale far shorter than an eddy turnover, and this is
     * the knob for that shimmer. In radians of phase; `0.3` is a visible flicker, `1` is agitated.
     *
     * The wobble is a second harmonic at an irrational multiple of the churn rate, so it never
     * resynchronizes into a pulse, and it is written to vanish exactly at `t = 0` — like `churn`,
     * it never changes the static field. Consumes no RNG draws.
     */
    flutter?: number;
    /**
     * Polarization ellipticity ε ∈ [0, 1] (clamped): per-mode chirality χ = ε·s, where s = ±1 is the
     * helicity-biased sign. `1` (default) = circular/Beltrami modes — tubes & corkscrews, the classic
     * engine, bit-identical. `0` = linearly polarized modes — sheets & jets, zero helicity.
     * Intermediate values morph the texture at fixed spectrum and fixed `helicity`. Deterministic:
     * consumes no RNG draws, so the mode layout is untouched. Note that at ε = 0 the `helicity`
     * slider has no visual effect (all modes achiral) and `relativeHelicity()` reads ~0.
     */
    ellipticity?: number;
}
type Vec3 = [number, number, number];
type Out6 = number[] | Float64Array | Float32Array;
/** Signed distance function: > 0 outside the obstacle, < 0 inside, 0 on the wall. */
type Sdf = (x: number, y: number, z: number) => number;
/** Options for {@link Field.withBoundary}. */
interface BoundaryOptions {
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
interface BoundedField {
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
interface FlowField {
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
interface Field extends FlowField {
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
    /** Relative helicity straight from the mode arrays — the exact, grid-free value at time t. */
    relativeHelicitySpectral(t?: number): number;
    /** Analytic velocity gradient, row-major `out9[3m + n] = ∂u_n/∂x_m` (9 floats). */
    sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, t?: number): T;
    /** Q-criterion `½(|Ω|² − |S|²)` — positive inside vortex cores. */
    qCriterion(x: number, y: number, z: number, t?: number): number;
    /** λ₂ criterion — the middle eigenvalue of `S² + Ω²`; negative inside a vortex core. */
    lambda2(x: number, y: number, z: number, t?: number): number;
    /** Vortex stretching `ξ̂·S·ξ̂` — positive where the vorticity is being spun up. */
    stretching(x: number, y: number, z: number, t?: number): number;
    /** Emit self-contained GLSL (WebGL2) defining `vec3 <name>(vec3 p)` + `(vec3 p, float t)` (+ curl). */
    glsl(opts?: GlslOptions): string;
}
/** Options for {@link createAtoms}. All optional. */
interface HelixAtomsOptions {
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
interface AtomField extends FlowField {
    /** Current parameters. */
    readonly params: Required<Omit<HelixAtomsOptions, "helicityField" | "gainField" | "spectrum">> & Pick<HelixAtomsOptions, "helicityField" | "gainField" | "spectrum">;
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
interface Bake3DResult {
    data: Float32Array;
    size: number;
    channels: 4;
}
interface Bake2DResult {
    data: Float32Array;
    width: number;
    height: number;
    channels: 4;
}
interface GlslOptions {
    /** Function name (also namespaces the baked constants). Default "helixNoise". */
    name?: string;
    /** Significant digits for baked floats. Default 7. */
    precision?: number;
    /** Also emit `<name>Curl(vec3 p)`. Default true. */
    curl?: boolean;
    /** Also emit the vector potential `<name>Pot(vec3 p)` — for in-shader SDF boundaries. Default false. */
    potential?: boolean;
    /**
     * Also emit `mat3 <name>Grad(vec3 p)` (the analytic velocity gradient) and `float <name>Q(vec3 p)`
     * (the Q-criterion) — for colouring particles by vortex structure on the GPU. Default false.
     */
    gradient?: boolean;
}
interface SelfTestReport {
    /** max |k·e|, exact transversality (should be ~1e-16). */
    transversality: number;
    /** Finite-difference divergence rms (pure O(h²) truncation). */
    fdDivergenceRms: number;
    /** Relative helicity keyed by p ("-1", "-0.5", "0", "0.5", "1"). */
    rhoVsP: Record<string, number>;
    /** max |ρ_measured − 2χ/(1+χ²)| over single-mode fields at ε ∈ {0, 0.5, 1} (should be ~1e-12). */
    ellipticityRho: number;
    /** FD-divergence rms at ε = 0.5 (pure O(h²) truncation, like {@link fdDivergenceRms}). */
    fdDivergenceRmsElliptic: number;
}
/**
 * The raw baked mode data a {@link Field} exposes, consumed by the GLSL generator.
 * @internal
 */
interface ModeData {
    N: number;
    kx: Float64Array;
    ky: Float64Array;
    kz: Float64Array;
    km: Float64Array;
    e1x: Float64Array;
    e1y: Float64Array;
    e1z: Float64Array;
    e2x: Float64Array;
    e2y: Float64Array;
    e2z: Float64Array;
    s: Float64Array;
    a: Float64Array;
    ph: Float64Array;
    /** Per-mode chirality χ[j] = ellipticity · s[j] ∈ [−1, 1] (equals `s` at ellipticity = 1). */
    chi: Float64Array;
    /**
     * Set when the modes carry a general transverse polarization (the grain-axis channel), so the
     * curl and potential must use the cross-product form instead of any circular shortcut.
     */
    _general?: boolean;
    /** Flutter amplitude (radians of phase wobble); 0 = off. */
    _flutter?: number;
    /** Per-mode flutter rate, baked alongside the phases when flutter is on. */
    _omf?: Float64Array;
    /** Per-mode phase rate (rad per unit time): eddy churn + coherent sweep. */
    om: Float64Array;
    /** Viscous decay rate ν (amplitudes ∝ e^(−νk²t)); 0 = none. */
    nu: number;
    _scale: number;
}

/**
 * An explicit, RNG-free mode table for closed-form preset fields (e.g. `abc()`).
 * `e1`/`e2` are always recomputed with the engine's own `frame()`. @internal
 */
interface DirectModes {
    k: [number, number, number][];
    s: number[];
    a: number[];
    ph: number[];
    scale: number;
}
/**
 * A divergence-free helical flow field, evaluatable at any point (grid-free) as an analytic sum
 * of Beltrami modes. Construct via {@link create}.
 */
declare class HelixField implements Field, ModeData {
    params: Field["params"];
    N: number;
    kx: Float64Array;
    ky: Float64Array;
    kz: Float64Array;
    km: Float64Array;
    a: Float64Array;
    s: Float64Array;
    ph: Float64Array;
    /** Per-mode chirality χ = ellipticity·s ∈ [−1,1]: ±1 circular (Beltrami), 0 linear. */
    chi: Float64Array;
    /** Per-mode phase rate (rad per unit time): eddy churn + coherent sweep. */
    om: Float64Array;
    e1x: Float64Array;
    e1y: Float64Array;
    e1z: Float64Array;
    e2x: Float64Array;
    e2y: Float64Array;
    e2z: Float64Array;
    /** Per-center sweep velocities (coherent structures translate with these). @internal */
    cvx: Float64Array;
    cvy: Float64Array;
    cvz: Float64Array;
    /** Viscous decay rate ν (amplitudes ∝ e^(−νk²t)); 0 = none. */
    nu: number;
    _scale: number;
    /**
     * True when every mode is fully circular (ellipticity === 1). Gates the legacy Beltrami
     * shortcut `w = (s·κ)·u_j`, which is algebraically equal to the general two-term curl but
     * rounds differently — the parity fixture pins the shortcut's bits. @internal
     */
    _beltrami: boolean;
    /** True when the grain-axis channel folded a general transverse amplitude into the frame. */
    _general: boolean;
    /** Curl frame for general modes: w = A·(cos φ·w1 − sin φ·w2). Allocated only when needed. */
    w1x?: Float64Array;
    w1y?: Float64Array;
    w1z?: Float64Array;
    w2x?: Float64Array;
    w2y?: Float64Array;
    w2z?: Float64Array;
    /** Flutter amplitude (radians of phase wobble); 0 = off. @internal */
    _flutter: number;
    /** Per-mode flutter rate — an irrational multiple of the churn rate. @internal */
    _omf?: Float64Array;
    private _phT;
    private _tPh;
    /** Bumped on every rebuild — the wasm backend uses it to re-upload mode data. @internal */
    _buildStamp: number;
    /** Test/bench escape hatch: set true to force the JS batch kernel. @internal */
    _noWasm: boolean;
    private _aT;
    private _tAmp;
    private _tile;
    /**
     * Set when the modes come from a closed-form preset instead of the RNG (see
     * {@link DirectModes}); `set()` refuses to regenerate such a field. @internal
     */
    _fixed: boolean;
    constructor(opts?: HelixNoiseOptions, direct?: DirectModes);
    /** Install an explicit, closed-form mode table (no RNG draws at all). @internal */
    private _installDirect;
    private _alloc;
    private _build;
    /**
     * Linear-polarization ("grain axis") post-pass. Each mode's circular amplitude is replaced by a
     * Gaussian sample with the requested 2×2 transverse covariance `J = I + d·R(2ψ) + χ·N`, drawn
     * from a **second, independent** RNG stream — so every draw of the main build above happens in
     * the same order with the same use, and a field with the channel off is bit-identical to one
     * built before the channel existed.
     *
     * The sampled amplitude is folded straight into the stored frame (`e1`, `e2` stop being
     * orthonormal, `s` becomes 1), which leaves the velocity formula untouched; only the curl and
     * potential need the general cross-product form, precomputed here as `w1`/`w2`.
     */
    private _polarize;
    private _allocGeneral;
    /** Mode amplitudes at time t: a·e^(−νk²t), cached per t (recomputed once per frame, not per sample). */
    private _amps;
    /**
     * Per-mode phases at time t: `ph` plus the flutter harmonic, which is written as
     * `sin(ω_f t + ph) − sin(ph)` so it is exactly zero at `t = 0`. Cached per t, like the
     * decayed amplitudes — recomputed once a frame, not once a sample.
     */
    private _phases;
    sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
    sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
    sample(x: number, y: number, z: number, t?: number): Vec3;
    vorticity(x: number, y: number, z: number, t?: number): Vec3;
    helicityDensity(x: number, y: number, z: number, t?: number): number;
    potential(x: number, y: number, z: number, t?: number): Vec3;
    withBoundary(sdf: Sdf, opts?: BoundaryOptions): BoundedField;
    sampleMany<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t?: number): T;
    sampleManyUW<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t?: number): T;
    /**
     * Batch kernel: mode-major and tiled. Each mode's constants stay in registers while a tile of
     * points streams through L1; accumulation is in f64 scratch regardless of `out`'s type.
     */
    private _many;
    private _rms;
    set(opts: HelixNoiseOptions): Field;
    relativeHelicity(ng?: number): number;
    /**
     * Relative helicity computed straight from the mode arrays, with no grid at all.
     *
     * Writing each mode as `u_j = Re[v_j e^(iφ)]` with `v_j = a_j(e1 + i·e2)` (the same complex
     * amplitude the samplers use), the space averages are exact sums:
     * `⟨|u|²⟩ = ½Σ|v|²`, `⟨|ω|²⟩ = ½Σ|k×v|²`, `⟨u·ω⟩ = ½ΣRe[v̄·(i k×v)]`.
     *
     * This is the infinite-volume value — {@link relativeHelicity} differs from it only by the
     * cross-mode terms a finite grid fails to cancel. For a single mode it is exactly `2χ/(1+χ²)`,
     * and under viscous decay it is constant in time when all modes share one `|k|`.
     */
    /**
     * Velocity gradient `∂u_n/∂x_m`, analytically — no finite differences. Written row-major into
     * `out9` as `[∂u/∂x, ∂v/∂x, ∂w/∂x, ∂u/∂y, …]`, i.e. `out9[3m + n] = ∂u_n/∂x_m`.
     *
     * This is what the rendering diagnostics are built from: {@link qCriterion} finds vortex cores,
     * {@link lambda2} finds them the other standard way, and {@link stretching} says whether a
     * vortex is being spun up or torn apart. Colour particles by any of them.
     */
    sampleGrad<T extends Out6>(x: number, y: number, z: number, out9: T, t?: number): T;
    /**
     * The **Q-criterion**: `Q = ½(|Ω|² − |S|²)`, rotation minus strain. Positive inside vortex
     * cores, negative in shear layers — the standard way to pick filaments out of a flow, and the
     * cheapest good thing to colour particles by.
     */
    qCriterion(x: number, y: number, z: number, t?: number): number;
    /**
     * The **λ₂ criterion**: the middle eigenvalue of `S² + Ω²`. Negative inside a vortex core.
     * Stricter than {@link qCriterion} — it ignores swirl that is really just shear.
     */
    lambda2(x: number, y: number, z: number, t?: number): number;
    /**
     * Vortex **stretching** `ξ̂·S·ξ̂`: the strain felt along the local vorticity direction.
     * Positive means the vortex is being spun up (stretched), negative means it is being squashed.
     * Zero where there is no vorticity to speak of.
     */
    stretching(x: number, y: number, z: number, t?: number): number;
    relativeHelicitySpectral(t?: number): number;
    bake3D(n: number, t?: number): Bake3DResult;
    bakePotential3D(n: number, t?: number): Bake3DResult;
    bake2D(nx: number, ny: number, z?: number, t?: number): Bake2DResult;
    glsl(opts?: GlslOptions): string;
}

/**
 * The sparse-atom engine. The field is a sum of compactly-supported helical wavelets ("atoms"):
 *
 *   u_atom = ∇×(W·A) = ∇W×A + W·u_wave
 *
 * where u_wave is a helical plane wave, A = (s/|k|)·u_wave its exact Beltrami potential, and
 * W = (1−q²)³ a C² window vanishing at the support radius. Atoms are drawn deterministically
 * from a spatial hash (one PRNG per cell), so the field is infinite, grid-free, amortized O(1)
 * per sample, and any region can carry its own helicity/gain. Divergence-free exactly — every
 * atom is a curl.
 */
declare class HelixAtoms implements AtomField {
    params: AtomField["params"];
    private _scale;
    private _cells;
    private _kBase;
    private _mk;
    private _mv;
    constructor(opts?: HelixAtomsOptions);
    private _merge;
    private _init;
    set(opts: HelixAtomsOptions): AtomField;
    /** Atoms of one hash cell (cell size = atom diameter), generated on first use and cached. */
    private _cell;
    /**
     * Core evaluation. mode 0: u only → out[0..2]. mode 1: u + analytic vorticity → out[0..5].
     * mode 2: u + potential ΣW·A → out[0..5].
     */
    private _eval;
    sample(x: number, y: number, z: number, t?: number): Vec3;
    private _t6;
    sampleUW<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
    sampleUA<T extends Out6>(x: number, y: number, z: number, out6: T, t?: number): T;
    vorticity(x: number, y: number, z: number, t?: number): Vec3;
    helicityDensity(x: number, y: number, z: number, t?: number): number;
    potential(x: number, y: number, z: number, t?: number): Vec3;
    withBoundary(sdf: Sdf, opts?: BoundaryOptions): BoundedField;
    glsl(opts?: GlslOptions): string;
    sampleMany<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t?: number): T;
    sampleManyUW<T extends Out6 = Float64Array>(pos: ArrayLike<number>, out?: T, t?: number): T;
    relativeHelicity(ng?: number): number;
    private _rms;
    bake3D(n: number, t?: number): Bake3DResult;
    bake2D(nx: number, ny: number, z?: number, t?: number): Bake2DResult;
    bakePotential3D(n: number, t?: number): Bake3DResult;
}

/**
 * Ready-made shapes for the per-wavenumber dials (`spectrum`, `coherence`, `helicity`) plus two
 * field factories. Everything here is a pure function of `|k|` or a closed form — no RNG, so
 * mixing presets in never disturbs a field's mode layout.
 */
/**
 * Spectrum preset: a Gaussian shell bump `a(k) = exp(−(k−kPeak)²/(2·width²))` — an
 * energy-containing band instead of a power law. Pair it with `kmin ≈ kPeak − 3·width` and
 * `kmax ≈ kPeak + 3·width` so the discarded tails stay near 1%.
 *
 * ```js
 * create({ spectrum: shellPeak(3), kmin: 1, kmax: 6 });
 * ```
 */
declare function shellPeak(kPeak: number, width?: number): ScaleFn;
/**
 * Coherence preset: `λ(k) = clamp(1 − k/kc, 0, 1)` — organized structure at large scales,
 * fading to uncorrelated noise above the cutoff `kc`. The "rollers carrying fine grain" look.
 */
declare function rolloff(kc: number): ScaleFn;
/**
 * Helicity preset: `p(k) = k <= kSplit ? pLarge : pSmall` — a handed large-scale condensate
 * over a (near-)mirror-symmetric fine-scale background, the polarization profile measured on
 * forced turbulence.
 */
declare function condensate(kSplit: number, pLarge: number, pSmall?: number): ScaleFn;
/**
 * The classical ABC (Arnold–Beltrami–Childress) cell field
 * `u = (A sin z + C cos y, B sin x + A cos z, C sin y + B cos x)`,
 * built as exactly three modes of the same engine — so `glsl()`, the bakes, `withBoundary`
 * and every sampler work on it unchanged. Consumes no RNG, is exactly 2π-tileable, and is a
 * pure Beltrami field (`∇×u = u`, potential `A = u`).
 *
 * By default this is the *literal* field (its amplitudes mean what they say). Pass
 * `amplitude` to opt into the usual RMS normalization, or `decay: ν` for the exact viscous
 * solution `u(t) = e^(−νt)·u(0)`.
 */
declare function abc(A?: number, B?: number, C?: number, opts?: {
    amplitude?: number;
    decay?: number;
}): Field;
/** Detail-amplitude constant for {@link twoScale}: `amplitude = C_TWO_SCALE / kDetail` holds the
 *  detail layer's vorticity budget fixed as you move its wavenumber. */
declare const C_TWO_SCALE = 1.6;
/**
 * The sum of two divergence-free fields — still divergence-free, and its potential is the sum
 * of theirs, so `withBoundary` and the potential bakes keep working.
 *
 * The recipe it exists for: a coherent large-scale backbone plus incoherent broadband detail.
 * Sizing the detail as `amplitude: C_TWO_SCALE / kDetail` keeps its vorticity budget constant
 * while you slide the detail scale.
 *
 * ```js
 * const kD = 8;
 * const detail = create({ spectrum: shellPeak(kD), kmin: kD - 3, kmax: kD + 3,
 *                         amplitude: C_TWO_SCALE / kD, seed: 2 });
 * const storm = twoScale(abc(3, 3, 3), detail);
 * ```
 */
declare function twoScale(base: FlowField, detail: FlowField, opts?: {
    detailGain?: number;
}): FlowField;
/** Options for {@link exactNS}. */
interface ExactNSOptions {
    /** Shell wavenumber k₀ (used for both `kmin` and `kmax`). Default 2. */
    k0?: number;
    /** Kinematic viscosity ν (becomes `decay`). Default 0.02; `0` gives the steady Euler member. */
    nu?: number;
    /** Chirality s = ±1 (becomes `helicity`, so every mode takes that sign). Default 1. */
    sign?: 1 | -1;
    /** Passed through untouched — none of these break exactness. */
    modes?: number;
    seed?: number;
    amplitude?: number;
    coherence?: number;
    centers?: number;
    layout?: "fibonacci" | "random";
}
/**
 * Options for a field that is an **exact solution of the Navier–Stokes equations**, not merely a
 * plausible-looking one: a single-wavenumber Beltrami field decaying at the exact Stokes rate.
 *
 * All modes share one `|k| = k₀` and one handedness, which makes the field Beltrami
 * (`∇×u = ±k₀·u`); the nonlinear term is then a pure gradient and is absorbed by the pressure, so
 * the flow just decays as `e^(−νk₀²t)` — which is precisely what `decay` does to every amplitude.
 *
 * ```js
 * const field = create(exactNS({ k0: 2, nu: 0.05, seed: 7 }));
 * ```
 *
 * Keep `tileable` off and `ellipticity` at 1 — integer rounding would break the single shell, and
 * elliptic modes are not Beltrami.
 */
declare function exactNS(opts?: ExactNSOptions): HelixNoiseOptions;
/**
 * Energy-weighted polarization of the two measured turbulence states these presets aim at:
 * `d` = linear polarization degree, `absP` = per-shell helical fraction, `signedP` = its signed
 * mean. Quoted so tests and docs can check what a field actually reproduces.
 */
declare const NS_TARGETS: {
    readonly dev: {
        readonly d: 1.155;
        readonly absP: 0.462;
        readonly signedP: 0.057;
    };
    readonly forced: {
        readonly d: 1.062;
        readonly absP: 0.516;
        readonly signedP: 0.229;
        readonly condensateK1: 0.55;
    };
};
/**
 * Option bundle whose **polarization** matches measured developed turbulence: per-mode helical
 * fraction |p| ≈ 0.46 with a weakly positive signed mean, i.e. strongly polarized waves whose
 * handedness nearly cancels. Both numbers are inverted exactly — `ellipticity` from
 * 2ε/(1+ε²) = |p|, and the `helicity` slider from signedP/|p|.
 *
 * Scope, honestly: the polarization is calibrated, the **spectrum is not** — this keeps the
 * default power law. Matching the measured shell spectrum needs a table this package does not
 * ship; pass your own `spectrum` if you have one.
 */
declare function nsDeveloped(overrides?: Partial<HelixNoiseOptions>): HelixNoiseOptions;
/**
 * Same as {@link nsDeveloped} for the *forced* state: more strongly polarized waves (|p| ≈ 0.52)
 * and a markedly net-handed field (signed mean +0.23), which reads as a visible overall swirl
 * direction. The measured state also carries a helical condensate at the largest scale; expressing
 * that needs a per-wavenumber `helicity` — see the `condensate` preset if you want to add one.
 *
 * Same scope caveat as {@link nsDeveloped}: polarization calibrated, spectrum not.
 */
declare function nsForced(overrides?: Partial<HelixNoiseOptions>): HelixNoiseOptions;

/** Options for {@link createRing}. */
interface RingOptions {
    /** Center of the ring. Default `[0, 0, 0]`. */
    center?: Vec3;
    /** Ring axis — the direction it travels along. Normalized internally. Default `[0, 0, 1]`. */
    axis?: Vec3;
    /** Radius of the ring's core circle. Default 1. */
    radius?: number;
    /**
     * Core thickness: the flow lives within this distance of the core circle and is exactly zero
     * outside. Must stay below `radius` (otherwise the support would touch the axis, where the
     * closed form is not smooth). Default `0.3`.
     */
    core?: number;
    /** Circulation Γ — strength and, by its sign, travel direction. Default 1. */
    circulation?: number;
    /**
     * Let the ring travel: the center advances at Kelvin's self-induced speed for a thin-core ring,
     * `U = Γ/(4πR)·(ln(8R/c) − ¼)`, so `sample(x, y, z, t)` shows it in flight. Default false.
     */
    advect?: boolean;
}
/** Kelvin's self-induced translation speed of a thin-core vortex ring. */
declare function ringSpeed(circulation: number, radius: number, core: number): number;
/**
 * A **vortex ring** — a smoke ring: a compact torus of swirling flow that pushes a jet through
 * its own middle. Closed form, exactly divergence-free, exactly zero outside the core, and with a
 * compactly supported potential, so it drops straight into `withBoundary` and the potential bakes.
 *
 * ```js
 * const ring = createRing({ radius: 1.5, core: 0.4, circulation: 2, advect: true });
 * ```
 *
 * The construction is the azimuthal potential `A = Γ·h(q/c)·ê_φ` with `q` the distance to the core
 * circle and `h(u) = (1−u²)³` a C² window; `u = ∇×A` is then dipolar flow threading the ring.
 */
declare function createRing(opts?: RingOptions): FlowField;
/**
 * Two rings fired at each other head-on — the classic colliding-rings setup, and the reason
 * `compose` exists. Equal and opposite circulation, mirrored about the origin along `axis`.
 */
declare function collidingRings(opts?: RingOptions & {
    separation?: number;
}): FlowField;
/**
 * Sum any number of flow fields. The sum of divergence-free fields is divergence-free and its
 * potential is the sum of theirs, so obstacles and potential bakes keep working — mix primitives
 * with each other or with a spectral field.
 */
declare function compose(...fields: FlowField[]): FlowField;
/**
 * A profile in the chassis coordinates `(q, z)` with `q = r²`. Taking `r²` rather than `r` as the
 * argument is what makes the axis behave: it forces the parity every smooth axisymmetric field
 * must have, so no implementation ever has to special-case `r = 0`.
 *
 * Supply `dq` and `dz` to get an exactly divergence-free field. Without them the partials are
 * estimated by central differences, and the divergence is then O(h²) rather than machine zero.
 */
interface AxiProfile {
    (q: number, z: number): number;
    /** ∂/∂q. Optional; central differences are used when absent. */
    dq?: (q: number, z: number) => number;
    /** ∂/∂z. Optional; central differences are used when absent. */
    dz?: (q: number, z: number) => number;
}
/** Options for {@link axisymmetric}. */
interface AxisymOptions {
    /** Stream profile `P` in `ψ = r²·P(r², z)`. Default: none (no poloidal flow). */
    stream?: AxiProfile;
    /** Swirl profile `h` in `Γ = r²·h(r², z)`. Default: none (no rotation). */
    swirl?: AxiProfile;
    /**
     * Antiderivative `H(q, z) = ∫₀^q h dt` of the swirl profile, used only by `potential()`.
     * Supply it for an exact vector potential; without it a fixed Simpson rule is used.
     */
    swirlIntegral?: (q: number, z: number) => number;
    center?: Vec3;
    /** Symmetry axis; normalized internally. Default `[0, 0, 1]`. */
    axis?: Vec3;
}
/**
 * The **axisymmetric chassis**: any pair of smooth profiles becomes a swirling, exactly
 * incompressible field that is smooth on its own axis.
 *
 * ```js
 * const funnel = axisymmetric({
 *   stream: (q, z) => Math.exp(-q) * z,      // ψ = r²·P
 *   swirl: (q) => Math.exp(-2 * q),          // Γ = r²·h
 * });
 * ```
 *
 * With `ψ = r²P(r², z)` and `Γ = r²h(r², z)` the cylindrical formulas lose their division by `r`
 * entirely — `u^r = −r·∂_z P`, `u^z = 2P + 2q·∂_q P`, `u^θ = r·h` — so the axis is an ordinary
 * point rather than a removable singularity, and there is no seam down the middle.
 *
 * **This is not a Navier–Stokes solution.** An arbitrary pair of profiles gives a field that is
 * exactly incompressible and smooth, nothing more. For one that does solve the equations, see
 * {@link strainedColumn}.
 */
declare function axisymmetric(opts?: AxisymOptions): FlowField;
/** Options for {@link strainedColumn}. */
interface StrainedColumnOptions {
    /** Inward strain rate `a` — how hard the flow squeezes toward the axis. Default 0.7. */
    strain?: number;
    /** Viscosity `ν`. With `strain` it fixes the core radius `√(2ν/a)`. Default 0.05. */
    viscosity?: number;
    /** Circulation `ε` — how fast the column spins. Default 1. */
    circulation?: number;
    center?: Vec3;
    axis?: Vec3;
}
/**
 * A **strained vortex column** — a tornado, and an *exact stationary solution* of the
 * Navier–Stokes equations:
 *
 * ```
 * u^r = −a·r,   u^z = 2a·z,   u^θ = ε(1 − e^(−a r²/2ν)) / r
 * ```
 *
 * An inward strain holds the filament open against viscosity, and the balance is exact: the
 * vorticity is purely axial and Gaussian, `ω_z = (εa/ν)·e^(−a r²/2ν)`, with core radius
 * `√(2ν/a)`. Raise the strain and the filament gets **thinner and brighter at once**, because the
 * peak `εa/ν` climbs as the width falls — which is how a real intensifying vortex reads.
 *
 * Note that the strain field grows with distance (`u ~ a·r`), so this is a **local-domain** object:
 * bound the region you render, or the far field will dominate. Its vector potential is exact but
 * grows logarithmically and is *not* compactly supported — a swirling column cannot have a compact
 * one — so an obstacle far from the column is affected slightly, unlike with {@link createRing}.
 */
declare function strainedColumn(opts?: StrainedColumnOptions): FlowField;
/** Core radius `√(2ν/a)` of a {@link strainedColumn} — where its Gaussian vorticity falls to 1/e. */
declare function columnCore(strain: number, viscosity: number): number;
/** Peak axial vorticity `εa/ν` at the axis of a {@link strainedColumn}. */
declare function columnPeakVorticity(strain: number, viscosity: number, circulation: number): number;
/**
 * A **counter-rotating pair** — two parallel strained columns, side by side, spinning opposite ways.
 *
 * They are offset *across* the axis, not stacked along it. Stacking is the tempting arrangement and
 * it is degenerate: a column's vorticity `ω_z = (εa/ν)·e^(−a r²/2ν)` depends on `r` alone and never
 * decays along `z`, so two on a shared axis with opposite circulation cancel each other **globally**
 * — every trace of rotation, everywhere, leaving nothing but a doubled strain.
 *
 * Offset laterally, they instead do what a real vortex pair does. On the mid-plane the two cores sit
 * at equal distance, so the swirl contributions are mirror images: the component *through* the plane
 * cancels identically while the in-plane component doubles. Two exact consequences, both worth
 * checking rather than believing —
 *
 * - the mid-plane is **impermeable**: `u·n̂ = 0` on it exactly, an invisible wall the flow never
 *   crosses, with the strain's own inflow cancelling there too;
 * - the vorticity vanishes on that plane and *only* there, so the two filaments stay individually
 *   bright — and between them the doubled swirl drives a **jet** along the plane.
 *
 * `separation` is the distance between the two axes; `offsetAxis` is the direction they are
 * separated along (any vector not parallel to `axis` — its perpendicular part is used).
 */
declare function counterSwirlColumns(opts?: StrainedColumnOptions & {
    separation?: number;
    offsetAxis?: Vec3;
}): FlowField;

/** Options for {@link collapse}. */
interface CollapseOptions {
    /** The instant the collapse completes. Sampling is only defined for `t < T`. Default 1. */
    T?: number;
    /**
     * Space exponent. `0 < q < 1` completes in finite time; as `q → 1` it becomes a gentle drift
     * that never quite arrives. Default 0.6.
     */
    q?: number;
    /** The point everything focuses on. Default `[0, 0, 0]`. */
    center?: Vec3;
    /**
     * Tie the amplitude to the scale (`A = |L′|`), so the flow speeds up exactly as fast as it
     * shrinks and the norms follow `‖u‖∞ = q(T−t)^(q−1)`. Set false to zoom without accelerating.
     * Divergence-freedom holds either way. Default true.
     */
    tieAmplitude?: boolean;
    /**
     * Floor on `T − t`, so an animation that runs past `T` degrades instead of returning `Infinity`.
     * Default `1e-4`.
     */
    minTau?: number;
    /**
     * Freeze the wrapped field's own clock, so the warp supplies *all* the motion. Default true,
     * and for {@link dssCollapse} it is what makes the loop exact: self-similarity says the profile
     * repeats, which it cannot do if the profile is itself churning. Set false to let the wrapped
     * field evolve as well — the collapse still works, but the picture no longer closes on itself.
     */
    freezeProfile?: boolean;
}
/** Options for {@link dssCollapse}. */
interface DssOptions extends CollapseOptions {
    /** Discrete zoom ratio: the picture repeats every `log λ` of renormalization time. Default 2. */
    lambda?: number;
    /** Space exponent `b`. Default 0.6. */
    b?: number;
    /** Amplitude exponent `a`. Default 0.8. */
    a?: number;
    /** 1-periodic, strictly positive scale modulation. Default `1 + 0.25·cos(2πφ)`. */
    scaleProfile?: (phase01: number) => number;
    /** 1-periodic, strictly positive amplitude modulation. Default `1`. */
    ampProfile?: (phase01: number) => number;
}
/**
 * Wrap a field in a **focusing** time warp: the whole pattern shrinks toward `center` like
 * `(T − t)^q` while the flow speeds up like `(T − t)^(q−1)`.
 *
 * ```js
 * const imploding = collapse(create({ modes: 48, tileable: true }), { T: 6, q: 0.55 });
 * ```
 *
 * `q` is the drama knob: near 1 a slow gathering, small a violent snap. The collapse *completes*
 * (rather than asymptoting) exactly when `q < 1`.
 *
 * Two practical notes. Sampling past `T` is clamped by `minTau`, not allowed to diverge. And
 * because the warp samples the wrapped field at `(x − c)/L` with `L → 0`, it walks ever further
 * into that field's far reaches — wrap a `tileable` field or a closed-form primitive if you want
 * the structure to survive deep zooms instead of dissolving into hash.
 */
declare function collapse(field: FlowField, opts?: CollapseOptions): FlowField;
/**
 * The **log-periodic** version: the same focusing, dressed with a modulation that makes it an
 * *exact loop*.
 *
 * Driving by the renormalization time `s = −log(T − t)`, the scale is `(T−t)^b·Θ(s/log λ)` and the
 * amplitude `(T−t)^(−a)·𝒜(s/log λ)` with `Θ` and `𝒜` 1-periodic. So every time `s` advances by
 * `log λ`, the field is **identical to what it was, up to a rescale** by `λ^(−b)` in space and
 * `λ^a` in amplitude — one rendered period tiles the whole collapse, with no cross-fade and no
 * drift. That is the difference between a Droste zoom that is faked and one that closes.
 *
 * The exponents are free parameters here. A hypothetical Navier–Stokes singularity would have to
 * satisfy `1/2 < b < 1` and `b < a < (1+b)/2`, but that is a *necessary* budget constraint on an
 * object nobody has exhibited — it is offered as a sane starting range, not enforced, and this
 * warp is a kinematic animation law rather than a claim about turbulence.
 */
declare function dssCollapse(field: FlowField, opts?: DssOptions): FlowField;

/** Create a Helix Noise field. */
declare function create(options?: HelixNoiseOptions): Field;
/** Create a sparse-atom field: broadband, infinite, amortized O(1), spatially-varying params. */
declare function createAtoms(options?: HelixAtomsOptions): AtomField;
/** Library version. */
declare const version = "1.8.0";
/** Run the built-in validation (transversality, divergence, helicity tracking). */
declare function selfTest(): SelfTestReport;
/** Default export: the Helix Noise namespace (`HelixNoise.create(...)`). */
declare const HelixNoise: {
    create: typeof create;
    createAtoms: typeof createAtoms;
    selfTest: typeof selfTest;
    version: string;
};

export { type AtomField, type AxiProfile, type AxisymOptions, type Bake2DResult, type Bake3DResult, type BoundaryOptions, type BoundedField, C_TWO_SCALE, type CollapseOptions, type DssOptions, type ExactNSOptions, type Field, type FlowField, type GlslOptions, HelixAtoms, type HelixAtomsOptions, HelixField, type HelixNoiseOptions, NS_TARGETS, type Out6, type RingOptions, type ScaleFn, type Sdf, type SelfTestReport, type StrainedColumnOptions, type Vec3, abc, axisymmetric, collapse, collidingRings, columnCore, columnPeakVorticity, compose, condensate, counterSwirlColumns, create, createAtoms, createRing, HelixNoise as default, dssCollapse, exactNS, nsDeveloped, nsForced, ringSpeed, rolloff, selfTest, shellPeak, strainedColumn, twoScale, version };
