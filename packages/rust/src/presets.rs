//! Ready-made shapes for the per-wavenumber dials, plus two field factories.
//!
//! Everything here is a pure function of `|k|` or a closed form — no RNG, so mixing presets in
//! never disturbs a field's mode layout.

use crate::boundary::VectorPotential;
use crate::constants::{HelixOptions, ScaleFn};
use crate::field::HelixField;

/// Spectrum preset: a Gaussian shell bump `a(k) = exp(-(k-k_peak)^2 / (2*width^2))` — an
/// energy-containing band instead of a power law. Pair it with `kmin ≈ k_peak - 3*width` and
/// `kmax ≈ k_peak + 3*width` so the discarded tails stay near 1%.
pub fn shell_peak(k_peak: f64, width: f64) -> ScaleFn {
    let w = if width.abs() == 0.0 { 1.0 } else { width.abs() };
    Box::new(move |k: f64| (-(k - k_peak) * (k - k_peak) / (2.0 * w * w)).exp())
}

/// Coherence preset: `lambda(k) = clamp(1 - k/kc, 0, 1)` — organized structure at large scales,
/// fading to uncorrelated noise above the cutoff `kc`.
pub fn rolloff(kc: f64) -> ScaleFn {
    Box::new(move |k: f64| (1.0 - k / kc).clamp(0.0, 1.0))
}

/// Helicity preset: `p(k) = if k <= k_split { p_large } else { p_small }` — a handed large-scale
/// condensate over a (near-)mirror-symmetric fine-scale background.
pub fn condensate(k_split: f64, p_large: f64, p_small: f64) -> ScaleFn {
    Box::new(move |k: f64| if k <= k_split { p_large } else { p_small })
}

/// Options for [`abc`].
#[derive(Default)]
pub struct AbcOptions {
    /// When set, RMS-normalize to this amplitude (via the closed form `sqrt(A²+B²+C²)`).
    /// When `None` (the default) the literal field is returned.
    pub amplitude: Option<f64>,
    /// Viscosity `nu`: gives the exact viscous solution `u(t) = e^(-nu t) u(0)`.
    pub decay: f64,
}

/// The classical ABC (Arnold–Beltrami–Childress) cell field
/// `u = (A sin z + C cos y, B sin x + A cos z, C sin y + B cos x)`, built as exactly three
/// modes of the same engine — so `glsl()`, the bakes, `with_boundary` and every sampler work
/// on it unchanged. Consumes no RNG, is exactly 2π-tileable, and is a pure Beltrami field
/// (`curl u = u`, potential `A = u`).
pub fn abc(a: f64, b: f64, c: f64, opts: AbcOptions) -> HelixField {
    use std::f64::consts::PI;
    // Closed-form RMS: the 5³ grid mean of |u|² is exactly A²+B²+C² in exact arithmetic, so
    // never route this through rms() — float summation order would move it by ~1 ulp.
    let rms = (a * a + b * b + c * c).sqrt();
    let scale = match opts.amplitude {
        None => 1.0,
        Some(amp) => amp / if rms == 0.0 { 1.0 } else { rms },
    };
    HelixField::from_modes(
        &[[0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        &[1.0, 1.0, 1.0],
        &[a, b, c],
        &[-PI / 2.0, -PI / 2.0, PI],
        scale,
        opts.decay,
    )
}

/// Detail-amplitude constant for [`TwoScale`]: `amplitude = C_TWO_SCALE / k_detail` holds the
/// detail layer's vorticity budget fixed as you move its wavenumber.
pub const C_TWO_SCALE: f64 = 1.6;

/// A coherent large-scale backbone plus incoherent broadband detail: the componentwise sum of
/// two divergence-free fields, which is divergence-free, and whose potential is the sum of
/// theirs (so boundaries keep working).
pub struct TwoScale<'a> {
    /// The large-scale backbone.
    pub base: &'a HelixField,
    /// The fine-scale layer.
    pub detail: &'a HelixField,
    /// Multiplier on the detail layer's output.
    pub detail_gain: f64,
}

impl<'a> TwoScale<'a> {
    /// Compose two fields; `detail_gain` scales the detail layer (1.0 = as built).
    pub fn new(base: &'a HelixField, detail: &'a HelixField, detail_gain: f64) -> Self {
        TwoScale { base, detail, detail_gain }
    }

    /// Velocity `u` and vorticity `w` of the composite.
    pub fn sample_uw(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        let (bu, bw) = self.base.sample_uw(x, y, z, t);
        let (du, dw) = self.detail.sample_uw(x, y, z, t);
        let g = self.detail_gain;
        let mut u = [0.0; 3];
        let mut w = [0.0; 3];
        for i in 0..3 {
            u[i] = bu[i] + g * du[i];
            w[i] = bw[i] + g * dw[i];
        }
        (u, w)
    }

    /// Velocity `u` and analytic vector potential `A` of the composite.
    pub fn sample_ua(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        let (bu, ba) = self.base.sample_ua(x, y, z, t);
        let (du, da) = self.detail.sample_ua(x, y, z, t);
        let g = self.detail_gain;
        let mut u = [0.0; 3];
        let mut a = [0.0; 3];
        for i in 0..3 {
            u[i] = bu[i] + g * du[i];
            a[i] = ba[i] + g * da[i];
        }
        (u, a)
    }

    /// Velocity of the composite at time 0.
    pub fn sample(&self, x: f64, y: f64, z: f64) -> [f64; 3] {
        self.sample_uw(x, y, z, 0.0).0
    }

    /// Vorticity of the composite.
    pub fn vorticity(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.sample_uw(x, y, z, t).1
    }

    /// Helicity density `u·w` of the composite.
    pub fn helicity_density(&self, x: f64, y: f64, z: f64, t: f64) -> f64 {
        let (u, w) = self.sample_uw(x, y, z, t);
        u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
    }

    /// The composite's analytic vector potential.
    pub fn potential(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.sample_ua(x, y, z, t).1
    }
}

impl VectorPotential for TwoScale<'_> {
    fn velocity_and_potential(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        self.sample_ua(x, y, z, t)
    }
}


/// Options for [`exact_ns`].
pub struct ExactNsOptions {
    /// Shell wavenumber `k0` (used for both `kmin` and `kmax`).
    pub k0: f64,
    /// Kinematic viscosity `nu` (becomes `decay`); `0` gives the steady Euler member.
    pub nu: f64,
    /// Chirality `+1` or `-1` (becomes `helicity`, so every mode takes that sign).
    pub sign: f64,
}

impl Default for ExactNsOptions {
    fn default() -> Self {
        ExactNsOptions { k0: 2.0, nu: 0.02, sign: 1.0 }
    }
}

/// Options for a field that is an **exact solution of the Navier–Stokes equations**.
///
/// All modes share one `|k| = k0` and one handedness, which makes the field Beltrami
/// (`curl u = ±k0·u`); the nonlinear term is then a pure gradient absorbed by the pressure, so
/// the flow simply decays as `e^(-nu·k0²·t)` — exactly what `decay` does to every amplitude.
///
/// ```
/// use helix_noise::{exact_ns, ExactNsOptions, HelixField, HelixOptions};
/// let f = HelixField::create(HelixOptions { seed: 7, ..exact_ns(ExactNsOptions::default()) });
/// ```
pub fn exact_ns(o: ExactNsOptions) -> HelixOptions {
    HelixOptions {
        kmin: o.k0,
        kmax: o.k0,        // one shell: |k| is the same for every mode
        helicity: o.sign,  // p = ±1 makes every drawn sign that sign
        churn: 0.0,        // om = 0; viscous decay is the only time dependence
        decay: o.nu,
        tileable: false,
        ellipticity: 1.0, // Beltrami — the whole point
        ..Default::default()
    }
}

/// Energy-weighted polarization of a measured turbulence state.
pub struct NsTargets {
    /// Linear-polarization degree.
    pub d: f64,
    /// Per-shell helical fraction `|p|`.
    pub abs_p: f64,
    /// Its signed mean.
    pub signed_p: f64,
}

/// Measured developed-turbulence polarization.
pub const NS_TARGETS_DEV: NsTargets = NsTargets { d: 1.155, abs_p: 0.462, signed_p: 0.057 };
/// Measured forced-turbulence polarization.
pub const NS_TARGETS_FORCED: NsTargets = NsTargets { d: 1.062, abs_p: 0.516, signed_p: 0.229 };

/// Invert the per-mode relative helicity `2e/(1+e²) = p` for `e`.
fn eps_for_p(p: f64) -> f64 {
    (1.0 - (1.0 - p * p).sqrt()) / p
}

fn ns_bundle(t: &NsTargets) -> HelixOptions {
    HelixOptions {
        modes: 96,
        layout: crate::constants::Layout::Random, // a genuine ensemble, as the target was measured
        kmin: 1.0,
        kmax: 15.0, // the band holding ~99% of the measured energy
        ellipticity: eps_for_p(t.abs_p),
        helicity: t.signed_p / t.abs_p,
        ..Default::default()
    }
}

/// Option bundle whose **polarization** matches measured developed turbulence: per-mode helical
/// fraction `|p| ≈ 0.46` with a weakly positive signed mean. Both numbers are inverted exactly.
///
/// Scope, honestly: the polarization is calibrated, the **spectrum is not** — this keeps the
/// default power law. Supply your own `spectrum` if you have a measured one.
pub fn ns_developed() -> HelixOptions {
    ns_bundle(&NS_TARGETS_DEV)
}

/// As [`ns_developed`] for the *forced* state: more strongly polarized waves (`|p| ≈ 0.52`) and a
/// markedly net-handed field, which reads as a visible overall swirl direction. Same scope caveat.
pub fn ns_forced() -> HelixOptions {
    ns_bundle(&NS_TARGETS_FORCED)
}
