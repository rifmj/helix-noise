//! Shared numeric constants and the option / configuration types.

use std::fmt;

/// `2*pi`.
pub const TAU: f64 = std::f64::consts::TAU;

/// Golden angle in radians — the Fibonacci-sphere azimuth increment.
///
/// Computed exactly as the JS reference does, `pi * (3 - sqrt(5))`, at first use, so the
/// transcendental rounding matches bit-for-bit rather than relying on a written literal.
#[inline]
pub fn ga() -> f64 {
    std::f64::consts::PI * (3.0 - 5.0_f64.sqrt())
}

/// Library version string, mirroring the reference package.
/// Seed salt for the polarization channel's second RNG stream (32-bit wrapping add).
pub const POLAR_SALT: u32 = 0x9E37_79B9;
/// Polarization-degree ball radius: `sqrt(d^2 + chi^2)` is clamped to this (PSD of the covariance).
pub const POLAR_DEG_MAX: f64 = 0.97;

pub const VERSION: &str = "1.1.0";

/// Mode layout strategy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layout {
    /// Low-discrepancy: a seeded random rotation of the Fibonacci sphere for directions,
    /// a stratified (jittered) spectrum, and a random direction <-> wavenumber pairing.
    Fibonacci,
    /// Independent, identically-distributed ensemble: an independent direction and
    /// wavenumber drawn per mode (Monte-Carlo / ensemble average).
    Random,
}

impl Default for Layout {
    fn default() -> Self {
        Layout::Fibonacci
    }
}

impl Layout {
    /// Parse from the string spelling used by the JS reference / fixture.
    pub fn from_str_opt(s: &str) -> Option<Layout> {
        match s {
            "fibonacci" => Some(Layout::Fibonacci),
            "random" => Some(Layout::Random),
            _ => None,
        }
    }

    /// The string spelling used by the JS reference / fixture.
    pub fn as_str(self) -> &'static str {
        match self {
            Layout::Fibonacci => "fibonacci",
            Layout::Random => "random",
        }
    }
}

impl fmt::Display for Layout {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A user-supplied spectral amplitude law `|k| -> amplitude`.
///
/// Stored boxed so the field owns it and stays `Send`-free-of-constraints while remaining
/// ergonomic. When present it overrides the default power law `|k|^-slope`.
pub type SpectrumFn = Box<dyn Fn(f64) -> f64>;

/// A pure per-wavenumber dial, evaluated once per mode at its final `|k|` (after the
/// `tileable` rounding) — exactly like [`SpectrumFn`]. Must be deterministic and must not
/// draw randomness: the RNG sequence is unchanged whether you set the scalar or the callable.
pub type ScaleFn = Box<dyn Fn(f64) -> f64>;

/// Options for constructing a [`crate::HelixField`].
///
/// Every field has a sensible default; build one with `HelixOptions::default()` and override
/// individual fields with struct-update syntax:
///
/// ```
/// use helix_noise::{HelixOptions, Layout};
/// let opts = HelixOptions { modes: 64, seed: 42, helicity: 0.8, ..Default::default() };
/// # let _ = opts;
/// ```
pub struct HelixOptions {
    /// Number of helical modes. The cost of one sample is `O(modes)`.
    pub modes: usize,
    /// Spectral slope `s`: amplitude ~ `|k|^-s` (steeper = larger swirls).
    pub slope: f64,
    /// Helicity `p` in `[-1, 1]`: the energy split between `+`/`-` helical states.
    pub helicity: f64,
    /// Coherence `lambda` in `[0, 1]`: phases random (0) -> structured (1).
    pub coherence: f64,
    /// Smallest wavenumber (largest structures).
    pub kmin: f64,
    /// Largest wavenumber (finest detail).
    pub kmax: f64,
    /// Number of focus points the coherent phases organize toward.
    pub centers: i64,
    /// Output scale. The field is normalized to unit RMS speed, then multiplied by this.
    pub amplitude: f64,
    /// Snap wavevectors to the integer lattice so the field is exactly `2*pi`-periodic.
    pub tileable: bool,
    /// PRNG seed. `0` is treated as `1`.
    pub seed: u32,
    /// Mode layout strategy.
    pub layout: Layout,
    /// Time-evolution rate for `sample_t`: eddy-turnover phase churn + structure sweep.
    pub churn: f64,
    /// Viscosity `nu >= 0`: mode amplitudes decay as `e^(-nu k^2 t)`.
    pub decay: f64,
    /// Direction stretch along `axis`: `< 0` streaks along it, `> 0` layers across it.
    pub anisotropy: f64,
    /// Anisotropy axis.
    pub axis: [f64; 3],
    /// Polarization ellipticity `eps` in `[0, 1]` (clamped): per-mode chirality `chi = eps*s`.
    /// `1` (default) = circular/Beltrami modes (tubes & corkscrews), `0` = linearly polarized
    /// modes (sheets & jets, zero helicity). Consumes no RNG draws.
    pub ellipticity: f64,
    /// Optional spectral amplitude law. When set, overrides the default `|k|^-slope`.
    pub spectrum: Option<SpectrumFn>,
    /// Optional per-wavenumber coherence `(k) -> lambda`. When set, overrides `coherence`.
    pub coherence_fn: Option<ScaleFn>,
    /// Optional per-wavenumber helicity `(k) -> p`. When set, overrides `helicity`.
    pub helicity_fn: Option<ScaleFn>,
    /// World-space grain axis for linear polarization. `None` (default) = channel off.
    pub polarization_axis: Option<[f64; 3]>,
    /// Linear-polarization strength `d` in `[0, 0.95]` along `polarization_axis`.
    pub polarization_bias: f64,
}

impl Default for HelixOptions {
    fn default() -> Self {
        HelixOptions {
            modes: 48,
            slope: 1.6,
            helicity: 0.0,
            coherence: 0.0,
            kmin: 1.0,
            kmax: 6.2,
            centers: 3,
            amplitude: 1.0,
            tileable: false,
            seed: 1,
            layout: Layout::Fibonacci,
            churn: 1.0,
            decay: 0.0,
            anisotropy: 0.0,
            axis: [0.0, 0.0, 1.0],
            ellipticity: 1.0,
            spectrum: None,
            coherence_fn: None,
            helicity_fn: None,
            polarization_axis: None,
            polarization_bias: 0.0,
        }
    }
}

impl fmt::Debug for HelixOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HelixOptions")
            .field("modes", &self.modes)
            .field("slope", &self.slope)
            .field("helicity", &self.helicity)
            .field("coherence", &self.coherence)
            .field("kmin", &self.kmin)
            .field("kmax", &self.kmax)
            .field("centers", &self.centers)
            .field("amplitude", &self.amplitude)
            .field("tileable", &self.tileable)
            .field("seed", &self.seed)
            .field("layout", &self.layout)
            .field("churn", &self.churn)
            .field("decay", &self.decay)
            .field("anisotropy", &self.anisotropy)
            .field("axis", &self.axis)
            .field("ellipticity", &self.ellipticity)
            .field("spectrum", &self.spectrum.as_ref().map(|_| "<fn>"))
            .field("coherence_fn", &self.coherence_fn.as_ref().map(|_| "<fn>"))
            .field("helicity_fn", &self.helicity_fn.as_ref().map(|_| "<fn>"))
            .field("polarization_axis", &self.polarization_axis)
            .field("polarization_bias", &self.polarization_bias)
            .finish()
    }
}
