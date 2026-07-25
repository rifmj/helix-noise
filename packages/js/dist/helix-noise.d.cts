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

/** Create a Helix Noise field. */
declare function create(options?: HelixNoiseOptions): Field;
/** Create a sparse-atom field: broadband, infinite, amortized O(1), spatially-varying params. */
declare function createAtoms(options?: HelixAtomsOptions): AtomField;
/** Library version. */
declare const version = "1.4.0";
/** Run the built-in validation (transversality, divergence, helicity tracking). */
declare function selfTest(): SelfTestReport;
/** Default export: the Helix Noise namespace (`HelixNoise.create(...)`). */
declare const HelixNoise: {
    create: typeof create;
    createAtoms: typeof createAtoms;
    selfTest: typeof selfTest;
    version: string;
};

export { type AtomField, type Bake2DResult, type Bake3DResult, type BoundaryOptions, type BoundedField, C_TWO_SCALE, type Field, type FlowField, type GlslOptions, HelixAtoms, type HelixAtomsOptions, HelixField, type HelixNoiseOptions, type Out6, type ScaleFn, type Sdf, type SelfTestReport, type Vec3, abc, condensate, create, createAtoms, HelixNoise as default, rolloff, selfTest, shellPeak, twoScale, version };
