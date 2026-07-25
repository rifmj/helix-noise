//! The spectral flow-field engine: a divergence-free sum of helical (Beltrami) modes,
//! evaluatable analytically at any point in space and time.

use crate::boundary::BoundedField;
use crate::constants::{ga, HelixOptions, Layout, POLAR_DEG_MAX, POLAR_SALT, TAU};
use crate::glsl::{to_glsl, GlslOptions};
use crate::rng::Mulberry32;

/// Orthonormal transverse frame `(e1, e2)` perpendicular to the unit vector `(dx, dy, dz)`.
///
/// Returns `[e1x, e1y, e1z, e2x, e2y, e2z]`. Cross-product order matches the reference.
pub(crate) fn frame(dx: f64, dy: f64, dz: f64) -> [f64; 6] {
    let (rx, ry, rz) = if dz.abs() < 0.9 {
        (0.0, 0.0, 1.0)
    } else {
        (0.0, 1.0, 0.0)
    };
    let mut e1x = ry * dz - rz * dy;
    let mut e1y = rz * dx - rx * dz;
    let mut e1z = rx * dy - ry * dx;
    let mut n = hypot3(e1x, e1y, e1z);
    if n == 0.0 {
        n = 1.0;
    }
    e1x /= n;
    e1y /= n;
    e1z /= n;
    let e2x = dy * e1z - dz * e1y;
    let e2y = dz * e1x - dx * e1z;
    let e2z = dx * e1y - dy * e1x;
    [e1x, e1y, e1z, e2x, e2y, e2z]
}

/// Uniform random rotation (row-major 3x3) from three uniforms — Shoemake's quaternion method.
fn rot_from_uniforms(u1: f64, u2: f64, u3: f64) -> [f64; 9] {
    let s1 = (1.0 - u1).sqrt();
    let s2 = u1.sqrt();
    let qx = s1 * (TAU * u2).sin();
    let qy = s1 * (TAU * u2).cos();
    let qz = s2 * (TAU * u3).sin();
    let qw = s2 * (TAU * u3).cos();
    let (xx, yy, zz) = (qx * qx, qy * qy, qz * qz);
    let (xy, xz, yz) = (qx * qy, qx * qz, qy * qz);
    let (wx, wy, wz) = (qw * qx, qw * qy, qw * qz);
    [
        1.0 - 2.0 * (yy + zz),
        2.0 * (xy - wz),
        2.0 * (xz + wy),
        2.0 * (xy + wz),
        1.0 - 2.0 * (xx + zz),
        2.0 * (yz - wx),
        2.0 * (xz - wy),
        2.0 * (yz + wx),
        1.0 - 2.0 * (xx + yy),
    ]
}

/// 3-argument hypot matching JS `Math.hypot(a, b, c)` semantics closely enough for parity.
#[inline]
pub(crate) fn hypot3(a: f64, b: f64, c: f64) -> f64 {
    // JS Math.hypot is scaling-robust; for the magnitudes here a direct sqrt agrees to ULP.
    (a * a + b * b + c * c).sqrt()
}

/// A read-only snapshot of a field's built per-mode spectral arrays. See
/// [`HelixField::mode_snapshot`].
#[derive(Clone, Debug)]
pub struct ModeSnapshot {
    /// Number of modes.
    pub n: usize,
    pub kx: Vec<f64>,
    pub ky: Vec<f64>,
    pub kz: Vec<f64>,
    pub km: Vec<f64>,
    pub a: Vec<f64>,
    pub s: Vec<f64>,
    /// Per-mode chirality `chi = ellipticity * s` (equals `s` at `ellipticity = 1`).
    pub chi: Vec<f64>,
    pub ph: Vec<f64>,
    pub om: Vec<f64>,
    pub e1x: Vec<f64>,
    pub e1y: Vec<f64>,
    pub e1z: Vec<f64>,
    pub e2x: Vec<f64>,
    pub e2y: Vec<f64>,
    pub e2z: Vec<f64>,
    pub nu: f64,
    pub scale: f64,
    /// True when the grain-axis channel folded a general transverse amplitude into the frame.
    pub general: bool,
}

/// A divergence-free helical flow field, evaluatable grid-free as an analytic sum of Beltrami
/// modes. Construct via [`HelixField::new`] or [`HelixField::create`].
pub struct HelixField {
    /// Number of modes.
    pub(crate) n: usize,
    pub(crate) kx: Vec<f64>,
    pub(crate) ky: Vec<f64>,
    pub(crate) kz: Vec<f64>,
    pub(crate) km: Vec<f64>,
    pub(crate) a: Vec<f64>,
    pub(crate) s: Vec<f64>,
    /// Per-mode chirality `chi = ellipticity * s`: +-1 circular (Beltrami), 0 linear.
    pub(crate) chi: Vec<f64>,
    pub(crate) ph: Vec<f64>,
    /// Per-mode phase rate (rad per unit time): eddy churn + coherent sweep.
    pub(crate) om: Vec<f64>,
    pub(crate) e1x: Vec<f64>,
    pub(crate) e1y: Vec<f64>,
    pub(crate) e1z: Vec<f64>,
    pub(crate) e2x: Vec<f64>,
    pub(crate) e2y: Vec<f64>,
    pub(crate) e2z: Vec<f64>,
    /// Viscous decay rate `nu` (amplitudes ~ `e^(-nu k^2 t)`); 0 = none.
    pub(crate) nu: f64,
    pub(crate) scale: f64,
    /// True when every mode is fully circular (`ellipticity == 1`): gates the legacy Beltrami
    /// shortcut, whose exact rounding the parity fixture pins.
    pub(crate) beltrami: bool,
    /// True when the grain-axis channel folded a general transverse amplitude into the frame.
    pub(crate) general: bool,
    /// Curl frame for general modes: `w = a*(cos(phi)*w1 - sin(phi)*w2)`.
    pub(crate) w1: Vec<[f64; 3]>,
    pub(crate) w2: Vec<[f64; 3]>,
    /// Set when the modes come from a closed-form preset instead of the RNG.
    pub(crate) fixed: bool,
    opts: HelixOptions,
}

impl HelixField {
    /// Build a field from options.
    pub fn new(opts: HelixOptions) -> Self {
        let n = opts.modes;
        let mut f = HelixField {
            n,
            kx: vec![0.0; n],
            ky: vec![0.0; n],
            kz: vec![0.0; n],
            km: vec![0.0; n],
            a: vec![0.0; n],
            s: vec![0.0; n],
            chi: vec![0.0; n],
            ph: vec![0.0; n],
            om: vec![0.0; n],
            e1x: vec![0.0; n],
            e1y: vec![0.0; n],
            e1z: vec![0.0; n],
            e2x: vec![0.0; n],
            e2y: vec![0.0; n],
            e2z: vec![0.0; n],
            nu: 0.0,
            scale: 1.0,
            beltrami: true,
            general: false,
            w1: Vec::new(),
            w2: Vec::new(),
            fixed: false,
            opts,
        };
        f.build();
        f
    }

    /// Build a field from an explicit, closed-form mode table — no RNG draws at all.
    ///
    /// `e1`/`e2` are always recomputed with the engine's own `frame()`, and `om` is zero
    /// (preset fields are steady). Used by the preset factories; `set_options` refuses to
    /// regenerate such a field.
    pub(crate) fn from_modes(
        k: &[[f64; 3]],
        s: &[f64],
        a: &[f64],
        ph: &[f64],
        scale: f64,
        decay: f64,
    ) -> Self {
        let n = k.len();
        let mut f = HelixField::new(HelixOptions {
            modes: n,
            tileable: true,
            churn: 0.0,
            decay,
            ..Default::default()
        });
        for j in 0..n {
            let (kx, ky, kz) = (k[j][0], k[j][1], k[j][2]);
            let km = hypot3(kx, ky, kz);
            f.kx[j] = kx;
            f.ky[j] = ky;
            f.kz[j] = kz;
            f.km[j] = km;
            let fr = frame(kx / km, ky / km, kz / km);
            f.e1x[j] = fr[0];
            f.e1y[j] = fr[1];
            f.e1z[j] = fr[2];
            f.e2x[j] = fr[3];
            f.e2y[j] = fr[4];
            f.e2z[j] = fr[5];
            f.s[j] = s[j];
            f.chi[j] = s[j];
            f.a[j] = a[j];
            f.ph[j] = ph[j];
            f.om[j] = 0.0;
        }
        f.nu = decay.max(0.0);
        f.beltrami = true;
        f.scale = scale;
        f.fixed = true;
        f
    }

    /// Convenience alias for [`HelixField::new`].
    pub fn create(opts: HelixOptions) -> Self {
        HelixField::new(opts)
    }

    /// Number of modes.
    pub fn modes(&self) -> usize {
        self.n
    }

    /// A read-only snapshot of the built per-mode arrays (the spectral state).
    ///
    /// Primarily useful for diagnostics, serialization, and cross-implementation parity checks.
    pub fn mode_snapshot(&self) -> ModeSnapshot {
        ModeSnapshot {
            n: self.n,
            kx: self.kx.clone(),
            ky: self.ky.clone(),
            kz: self.kz.clone(),
            km: self.km.clone(),
            a: self.a.clone(),
            s: self.s.clone(),
            chi: self.chi.clone(),
            ph: self.ph.clone(),
            om: self.om.clone(),
            e1x: self.e1x.clone(),
            e1y: self.e1y.clone(),
            e1z: self.e1z.clone(),
            e2x: self.e2x.clone(),
            e2y: self.e2y.clone(),
            e2z: self.e2z.clone(),
            nu: self.nu,
            scale: self.scale,
            general: self.general,
        }
    }

    /// The resolved options this field was built from.
    pub fn options(&self) -> &HelixOptions {
        &self.opts
    }

    fn build(&mut self) {
        let p = &self.opts;
        let n = self.n;
        let mut rng = Mulberry32::seeded(p.seed);

        let nc = (p.centers.max(1)) as usize;
        let mut cx = vec![0.0f64; nc];
        let mut cy = vec![0.0f64; nc];
        let mut cz = vec![0.0f64; nc];
        for m in 0..nc {
            cx[m] = rng.next_f64() * TAU;
            cy[m] = rng.next_f64() * TAU;
            cz[m] = rng.next_f64() * TAU;
        }

        // coherence / helicity accept a scalar or a pure per-wavenumber callable. Neither ever
        // gates an rng() call, so the draw sequence is identical either way.
        let lam = p.coherence.clamp(0.0, 1.0);
        let mut lam_arr = vec![lam; n];
        let fib = p.layout != Layout::Random;
        let mut ci = vec![0usize; n];
        let gam = p.anisotropy.clamp(-0.99, 9.0);
        // Polarization ellipticity: chi_j = eps*s_j. Draw-free, so the RNG sequence is identical
        // for every eps; eps == 1 keeps the legacy Beltrami path the parity fixture pins.
        let eps = p.ellipticity.clamp(0.0, 1.0);
        self.beltrami = eps == 1.0;
        let mut an = hypot3(p.axis[0], p.axis[1], p.axis[2]);
        if an == 0.0 {
            an = 1.0;
        }
        let anx = p.axis[0] / an;
        let any = p.axis[1] / an;
        let anz = p.axis[2] / an;

        let ga_val = ga();

        // Fibonacci-only precompute (skipped entirely when layout == random).
        let mut rot = [0.0f64; 9];
        let mut kms = vec![0.0f64; n];
        let mut perm = vec![0usize; n];
        if fib {
            rot = rot_from_uniforms(rng.next_f64(), rng.next_f64(), rng.next_f64());
            for i in 0..n {
                kms[i] = p.kmin + (p.kmax - p.kmin) * ((i as f64 + rng.next_f64()) / n as f64);
            }
            for i in 0..n {
                perm[i] = i;
            }
            let mut i = n as isize - 1;
            while i > 0 {
                let j = (rng.next_f64() * (i as f64 + 1.0)) as usize;
                perm.swap(i as usize, j);
                i -= 1;
            }
        }

        for j in 0..n {
            let (mut dx, mut dy, mut dz, mut km);
            if fib {
                let zf = 1.0 - (2.0 * j as f64 + 1.0) / n as f64;
                let rf = (1.0 - zf * zf).max(0.0).sqrt();
                let th = j as f64 * ga_val;
                let fx = rf * th.cos();
                let fy = rf * th.sin();
                let fz = zf;
                let r = &rot;
                dx = r[0] * fx + r[1] * fy + r[2] * fz;
                dy = r[3] * fx + r[4] * fy + r[5] * fz;
                dz = r[6] * fx + r[7] * fy + r[8] * fz;
                km = kms[perm[j]];
            } else {
                let z = 2.0 * rng.next_f64() - 1.0;
                let th = TAU * rng.next_f64();
                let r = (1.0 - z * z).sqrt();
                dx = r * th.cos();
                dy = r * th.sin();
                dz = z;
                km = p.kmin + (p.kmax - p.kmin) * rng.next_f64();
            }
            if gam != 0.0 {
                let dn = dx * anx + dy * any + dz * anz;
                dx += gam * dn * anx;
                dy += gam * dn * any;
                dz += gam * dn * anz;
                let mut dm = hypot3(dx, dy, dz);
                if dm == 0.0 {
                    dm = 1.0;
                }
                dx /= dm;
                dy /= dm;
                dz /= dm;
            }
            let mut kxc = km * dx;
            let mut kyc = km * dy;
            let mut kzc = km * dz;
            if p.tileable {
                kxc = kxc.round();
                kyc = kyc.round();
                kzc = kzc.round();
                if kxc == 0.0 && kyc == 0.0 && kzc == 0.0 {
                    kxc = 1.0;
                }
                km = hypot3(kxc, kyc, kzc);
                dx = kxc / km;
                dy = kyc / km;
                dz = kzc / km;
            }
            self.kx[j] = kxc;
            self.ky[j] = kyc;
            self.kz[j] = kzc;
            self.km[j] = km;
            let fr = frame(dx, dy, dz);
            self.e1x[j] = fr[0];
            self.e1y[j] = fr[1];
            self.e1z[j] = fr[2];
            self.e2x[j] = fr[3];
            self.e2y[j] = fr[4];
            self.e2z[j] = fr[5];
            let p_j = match &p.helicity_fn {
                Some(f) => f(km),
                None => p.helicity,
            };
            self.s[j] = if rng.next_f64() < (1.0 + p_j) / 2.0 {
                1.0
            } else {
                -1.0
            };
            self.chi[j] = eps * self.s[j];
            self.a[j] = match &p.spectrum {
                Some(sp) => sp(km).max(0.0),
                None => km.powf(-p.slope),
            };
            let phr = TAU * rng.next_f64();
            let c = (rng.next_f64() * nc as f64) as usize;
            ci[j] = c;
            let phc = -(kxc * cx[c] + kyc * cy[c] + kzc * cz[c]);
            // Additive phase interpolation (helical-fields Eq. 9): the structured center
            // reference stays at full weight while the random part fades as λ→1.
            // ph = φc + (1−λ)·φr — uniform-random at λ=0, locked to the reference at λ=1,
            // and well-defined for every λ (no λ=½ antipodal singularity of the earlier
            // complex-plane "chord" blend). |a_j| is untouched, so the energy spectrum and
            // helicity bias are frozen at every λ; only the phase moves.
            let lam_j = match &p.coherence_fn {
                Some(f) => f(km).clamp(0.0, 1.0),
                None => lam,
            };
            lam_arr[j] = lam_j;
            self.ph[j] = phc + (1.0 - lam_j) * phr;
        }

        // Time evolution — all draws happen AFTER the spatial loop, so the t = 0 field is
        // unchanged by the time knobs.
        let churn_rate = p.churn.max(0.0); // `chi` is reserved for chirality
        let mut cvx = vec![0.0f64; nc];
        let mut cvy = vec![0.0f64; nc];
        let mut cvz = vec![0.0f64; nc];
        let sg = churn_rate / 3.0_f64.sqrt();
        for m in 0..nc {
            let r1 = (-2.0 * (1.0 - rng.next_f64()).ln()).sqrt();
            let a1 = TAU * rng.next_f64();
            let r2 = (-2.0 * (1.0 - rng.next_f64()).ln()).sqrt();
            let a2 = TAU * rng.next_f64();
            cvx[m] = sg * r1 * a1.cos();
            cvy[m] = sg * r1 * a1.sin();
            cvz[m] = sg * r2 * a2.cos();
        }
        let rate0 = churn_rate * p.kmin.max(1e-9).cbrt();
        for j in 0..n {
            let sgn = if rng.next_f64() < 0.5 { -1.0 } else { 1.0 };
            let c = ci[j];
            let lam_j = lam_arr[j];
            self.om[j] = (1.0 - lam_j) * sgn * rate0 * self.km[j].powf(2.0 / 3.0)
                - lam_j * (self.kx[j] * cvx[c] + self.ky[j] * cvy[c] + self.kz[j] * cvz[c]);
        }

        self.nu = p.decay.max(0.0);
        let amp = if p.amplitude != 0.0 { p.amplitude } else { 1.0 };
        self.polarize(); // grain-axis channel (no-op unless polarization_axis is set)

        self.scale = 1.0;
        let rms = self.rms();
        self.scale = amp / if rms != 0.0 { rms } else { 1.0 };
    }

    /// Amplitude for mode `j` at time `t`.
    #[inline]
    fn amp_at(&self, j: usize, t: f64) -> f64 {
        if !(self.nu > 0.0) || t == 0.0 {
            self.a[j]
        } else {
            self.a[j] * (-self.nu * self.km[j] * self.km[j] * t).exp()
        }
    }

    /// Grain-axis channel: fold a Gaussian transverse amplitude into the stored frame.
    ///
    /// Draws come from a *second*, independent mulberry32 stream, so every draw of the main
    /// build happens in the same order with the same use — a field with the channel off is
    /// bit-identical to one built before the channel existed. See spec §4b.
    fn polarize(&mut self) {
        self.general = false;
        let (ax, d0) = match self.opts.polarization_axis {
            None => return,
            Some(ax) => (ax, self.opts.polarization_bias.clamp(0.0, 0.95)),
        };
        let an = {
            let h = hypot3(ax[0], ax[1], ax[2]);
            if h == 0.0 { 1.0 } else { h }
        };
        let (nx, ny, nz) = (ax[0] / an, ax[1] / an, ax[2] / an);
        let seed_eff = if self.opts.seed == 0 { 1 } else { self.opts.seed };
        let seed2 = seed_eff.wrapping_add(POLAR_SALT);
        let mut rng2 = Mulberry32::new(if seed2 == 0 { 1 } else { seed2 });
        let n = self.n;
        self.w1 = vec![[0.0; 3]; n];
        self.w2 = vec![[0.0; 3]; n];

        for j in 0..n {
            // Complex standard normals (E|z|^2 = 1): no factor 2 under the sqrt.
            let r1 = (-(1.0 - rng2.next_f64()).ln()).sqrt();
            let t1 = TAU * rng2.next_f64();
            let (z1r, z1i) = (r1 * t1.cos(), r1 * t1.sin());
            let r2 = (-(1.0 - rng2.next_f64()).ln()).sqrt();
            let t2 = TAU * rng2.next_f64();
            let (z2r, z2i) = (r2 * t2.cos(), r2 * t2.sin());

            let km = self.km[j];
            let (dx, dy, dz) = (self.kx[j] / km, self.ky[j] / km, self.kz[j] / km);
            let e1 = [self.e1x[j], self.e1y[j], self.e1z[j]];
            let e2 = [self.e2x[j], self.e2y[j], self.e2z[j]];

            let ndk = nx * dx + ny * dy + nz * dz;
            let (mut tx, mut ty, mut tz) = (nx - ndk * dx, ny - ndk * dy, nz - ndk * dz);
            let tl = hypot3(tx, ty, tz);
            let (mut c2, mut s2) = (1.0, 0.0);
            if tl > 1e-6 {
                tx /= tl;
                ty /= tl;
                tz /= tl;
                let ct = tx * e1[0] + ty * e1[1] + tz * e1[2];
                let st = tx * e2[0] + ty * e2[1] + tz * e2[2];
                let psi = st.atan2(ct);
                c2 = (2.0 * psi).cos();
                s2 = (2.0 * psi).sin();
            }

            let (mut dd, mut pp) = (d0, self.chi[j]);
            let deg = dd.hypot(pp);
            if deg > POLAR_DEG_MAX {
                let f = POLAR_DEG_MAX / deg;
                dd *= f;
                pp *= f;
            }
            let (j11, j22) = (1.0 + dd * c2, 1.0 - dd * c2);
            let (j21r, j21i) = (dd * s2, pp);
            let l11 = j11.max(1e-12).sqrt();
            let (l21r, l21i) = (j21r / l11, j21i / l11);
            let l22 = (j22 - (j21r * j21r + j21i * j21i) / j11).max(0.0).sqrt();

            let (a1r, a1i) = (l11 * z1r, l11 * z1i);
            let a2r = l21r * z1r - l21i * z1i + l22 * z2r;
            let a2i = l21r * z1i + l21i * z1r + l22 * z2i;
            let mut f1 = [0.0; 3];
            let mut f2 = [0.0; 3];
            for c in 0..3 {
                f1[c] = a1r * e1[c] + a2r * e2[c];
                f2[c] = a1i * e1[c] + a2i * e2[c];
            }
            self.e1x[j] = f1[0];
            self.e1y[j] = f1[1];
            self.e1z[j] = f1[2];
            self.e2x[j] = f2[0];
            self.e2y[j] = f2[1];
            self.e2z[j] = f2[2];
            self.s[j] = 1.0;
            self.chi[j] = 1.0;

            let (kx, ky, kz) = (self.kx[j], self.ky[j], self.kz[j]);
            self.w1[j] = [
                -(ky * f2[2] - kz * f2[1]),
                -(kz * f2[0] - kx * f2[2]),
                -(kx * f2[1] - ky * f2[0]),
            ];
            self.w2[j] = [
                ky * f1[2] - kz * f1[1],
                kz * f1[0] - kx * f1[2],
                kx * f1[1] - ky * f1[0],
            ];
        }
        self.beltrami = false;
        self.general = true;
    }

    /// Velocity `u` and vorticity `w` at `(x, y, z, t)`. Returns `(u, w)`.
    pub fn sample_uw(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        let sc = self.scale;
        let (mut ux, mut uy, mut uz) = (0.0, 0.0, 0.0);
        let (mut wx, mut wy, mut wz) = (0.0, 0.0, 0.0);
        for j in 0..self.n {
            let phi = self.kx[j] * x + self.ky[j] * y + self.kz[j] * z + self.ph[j] + self.om[j] * t;
            let c = phi.cos();
            let sn = phi.sin();
            let a = self.amp_at(j, t);
            if self.general {
                // Grain-axis modes: folded (non-orthonormal) frame; curl from the precomputed frame.
                ux += a * (c * self.e1x[j] - sn * self.e2x[j]);
                uy += a * (c * self.e1y[j] - sn * self.e2y[j]);
                uz += a * (c * self.e1z[j] - sn * self.e2z[j]);
                wx += a * (c * self.w1[j][0] - sn * self.w2[j][0]);
                wy += a * (c * self.w1[j][1] - sn * self.w2[j][1]);
                wz += a * (c * self.w1[j][2] - sn * self.w2[j][2]);
            } else if self.beltrami {
                // Legacy Beltrami path: bit-compatible with spec 1.0 (w = s*k * u).
                let s = self.s[j];
                let tx = a * (c * self.e1x[j] - s * sn * self.e2x[j]);
                let ty = a * (c * self.e1y[j] - s * sn * self.e2y[j]);
                let tz = a * (c * self.e1z[j] - s * sn * self.e2z[j]);
                ux += tx;
                uy += ty;
                uz += tz;
                let g = s * self.km[j];
                wx += g * tx;
                wy += g * ty;
                wz += g * tz;
            } else {
                // Elliptic modes: w_j = a*k*(chi*cos(phi)*e1 - sin(phi)*e2).
                let xi = self.chi[j];
                let (cx, sx) = (xi * c, xi * sn);
                ux += a * (c * self.e1x[j] - sx * self.e2x[j]);
                uy += a * (c * self.e1y[j] - sx * self.e2y[j]);
                uz += a * (c * self.e1z[j] - sx * self.e2z[j]);
                let gk = a * self.km[j];
                wx += gk * (cx * self.e1x[j] - sn * self.e2x[j]);
                wy += gk * (cx * self.e1y[j] - sn * self.e2y[j]);
                wz += gk * (cx * self.e1z[j] - sn * self.e2z[j]);
            }
        }
        ([ux * sc, uy * sc, uz * sc], [wx * sc, wy * sc, wz * sc])
    }

    /// Relative helicity straight from the mode arrays — no grid at all.
    ///
    /// Writing each mode as `u_j = Re[v_j e^(i phi)]` with `v_j = a_j(e1' + i e2')`, the space
    /// averages are exact sums. This is the infinite-volume value; [`Self::relative_helicity`]
    /// differs from it only by the cross-mode terms a finite grid fails to cancel. For a single
    /// mode it is exactly `2 chi / (1 + chi^2)`.
    pub fn relative_helicity_spectral(&self, t: f64) -> f64 {
        let (mut h, mut e, mut z) = (0.0, 0.0, 0.0);
        for j in 0..self.n {
            let km = self.km[j];
            let k2 = km * km;
            let a = self.a[j];
            let mut m = a * a;
            if self.nu > 0.0 && t != 0.0 {
                m *= (-2.0 * self.nu * k2 * t).exp();
            }
            let e1 = [self.e1x[j], self.e1y[j], self.e1z[j]];
            let mut e2 = [self.e2x[j], self.e2y[j], self.e2z[j]];
            let (w1, w2) = if self.general {
                (self.w1[j], self.w2[j])
            } else {
                let chi = self.chi[j];
                let ck = chi * km;
                let w1 = [ck * e1[0], ck * e1[1], ck * e1[2]];
                let w2 = [km * e2[0], km * e2[1], km * e2[2]];
                for c in 0..3 {
                    e2[c] *= chi;
                }
                (w1, w2)
            };
            let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            e += 0.5 * m * (dot(e1, e1) + dot(e2, e2));
            z += 0.5 * m * (dot(w1, w1) + dot(w2, w2));
            h += 0.5 * m * (dot(e1, w1) + dot(e2, w2));
        }
        let denom = (e * z).sqrt();
        h / if denom != 0.0 { denom } else { 1.0 }
    }

    /// Velocity `u` and analytic vector potential `A` at `(x, y, z, t)`. Returns `(u, A)`.
    pub fn sample_ua(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        let sc = self.scale;
        let (mut ux, mut uy, mut uz) = (0.0, 0.0, 0.0);
        let (mut ax, mut ay, mut az) = (0.0, 0.0, 0.0);
        for j in 0..self.n {
            let phi = self.kx[j] * x + self.ky[j] * y + self.kz[j] * z + self.ph[j] + self.om[j] * t;
            let c = phi.cos();
            let sn = phi.sin();
            let a = self.amp_at(j, t);
            if self.general {
                // A_j = w_j / k^2, same cross-product curl frame.
                ux += a * (c * self.e1x[j] - sn * self.e2x[j]);
                uy += a * (c * self.e1y[j] - sn * self.e2y[j]);
                uz += a * (c * self.e1z[j] - sn * self.e2z[j]);
                let ga = a / (self.km[j] * self.km[j]);
                ax += ga * (c * self.w1[j][0] - sn * self.w2[j][0]);
                ay += ga * (c * self.w1[j][1] - sn * self.w2[j][1]);
                az += ga * (c * self.w1[j][2] - sn * self.w2[j][2]);
            } else if self.beltrami {
                let s = self.s[j];
                let tx = a * (c * self.e1x[j] - s * sn * self.e2x[j]);
                let ty = a * (c * self.e1y[j] - s * sn * self.e2y[j]);
                let tz = a * (c * self.e1z[j] - s * sn * self.e2z[j]);
                ux += tx;
                uy += ty;
                uz += tz;
                let g = s / self.km[j];
                ax += g * tx;
                ay += g * ty;
                az += g * tz;
            } else {
                // A_j = w_j / k^2 -- same Coulomb gauge, curl A = u for every chi.
                let xi = self.chi[j];
                let (cx, sx) = (xi * c, xi * sn);
                ux += a * (c * self.e1x[j] - sx * self.e2x[j]);
                uy += a * (c * self.e1y[j] - sx * self.e2y[j]);
                uz += a * (c * self.e1z[j] - sx * self.e2z[j]);
                let ga = a / self.km[j];
                ax += ga * (cx * self.e1x[j] - sn * self.e2x[j]);
                ay += ga * (cx * self.e1y[j] - sn * self.e2y[j]);
                az += ga * (cx * self.e1z[j] - sn * self.e2z[j]);
            }
        }
        ([ux * sc, uy * sc, uz * sc], [ax * sc, ay * sc, az * sc])
    }

    /// Velocity at `(x, y, z)` at time 0.
    pub fn sample(&self, x: f64, y: f64, z: f64) -> [f64; 3] {
        self.sample_uw(x, y, z, 0.0).0
    }

    /// Velocity at `(x, y, z)` at time `t`.
    pub fn sample_t(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.sample_uw(x, y, z, t).0
    }

    /// Vorticity `w = curl(u)` at `(x, y, z, t)`.
    pub fn vorticity(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.sample_uw(x, y, z, t).1
    }

    /// Helicity density `u . w` at `(x, y, z, t)`.
    pub fn helicity_density(&self, x: f64, y: f64, z: f64, t: f64) -> f64 {
        let (u, w) = self.sample_uw(x, y, z, t);
        u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
    }

    /// Analytic vector potential `A` (with `curl(A) = u`) at `(x, y, z, t)`.
    pub fn potential(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.sample_ua(x, y, z, t).1
    }

    fn rms(&self) -> f64 {
        let ng = 5;
        let mut s = 0.0;
        let mut n = 0.0;
        for i in 0..ng {
            for j in 0..ng {
                for k in 0..ng {
                    let (u, _) = self.sample_uw(
                        (i as f64 / ng as f64) * TAU,
                        (j as f64 / ng as f64) * TAU,
                        (k as f64 / ng as f64) * TAU,
                        0.0,
                    );
                    s += u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
                    n += 1.0;
                }
            }
        }
        (s / n).sqrt()
    }

    /// Mean relative helicity over an `ng^3` grid on `[0, TAU)`, in `[-1, 1]`.
    pub fn relative_helicity(&self, ng: usize) -> f64 {
        let mut h = 0.0;
        let mut un = 0.0;
        let mut wn = 0.0;
        for i in 0..ng {
            for j in 0..ng {
                for k in 0..ng {
                    let (u, w) = self.sample_uw(
                        (i as f64 / ng as f64) * TAU,
                        (j as f64 / ng as f64) * TAU,
                        (k as f64 / ng as f64) * TAU,
                        0.0,
                    );
                    h += u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
                    un += u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
                    wn += w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
                }
            }
        }
        let denom = (un * wn).sqrt();
        h / if denom != 0.0 { denom } else { 1.0 }
    }

    /// Bake velocity + helicity density into a dense `n^3` RGBA `f32` volume.
    ///
    /// Layout: `x` fastest, then `y`, then `z`; each texel is `(u.x, u.y, u.z, u.w)`.
    /// Length `n^3 * 4`. Grid point `(x, y, z)` maps to `((x/n)*TAU, (y/n)*TAU, (z/n)*TAU)`.
    pub fn bake3d(&self, n: usize, t: f64) -> Vec<f32> {
        let mut data = vec![0.0f32; n * n * n * 4];
        let mut p = 0;
        for z in 0..n {
            for y in 0..n {
                for x in 0..n {
                    let (u, w) = self.sample_uw(
                        (x as f64 / n as f64) * TAU,
                        (y as f64 / n as f64) * TAU,
                        (z as f64 / n as f64) * TAU,
                        t,
                    );
                    data[p] = u[0] as f32;
                    data[p + 1] = u[1] as f32;
                    data[p + 2] = u[2] as f32;
                    data[p + 3] = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) as f32;
                    p += 4;
                }
            }
        }
        data
    }

    /// Bake a `nx * ny` RGBA `f32` slice at constant `z`. `i` fastest, then `j`.
    pub fn bake2d(&self, nx: usize, ny: usize, z: f64, t: f64) -> Vec<f32> {
        let mut data = vec![0.0f32; nx * ny * 4];
        let mut p = 0;
        for j in 0..ny {
            for i in 0..nx {
                let (u, w) = self.sample_uw(
                    (i as f64 / nx as f64) * TAU,
                    (j as f64 / ny as f64) * TAU,
                    z,
                    t,
                );
                data[p] = u[0] as f32;
                data[p + 1] = u[1] as f32;
                data[p + 2] = u[2] as f32;
                data[p + 3] = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) as f32;
                p += 4;
            }
        }
        data
    }

    /// Bake the vector potential (`rgb = A`) plus helicity density (`a = u . w`) into an
    /// `n^3` RGBA `f32` volume.
    pub fn bake_potential3d(&self, n: usize, t: f64) -> Vec<f32> {
        let mut data = vec![0.0f32; n * n * n * 4];
        let mut p = 0;
        for z in 0..n {
            for y in 0..n {
                for x in 0..n {
                    let px = (x as f64 / n as f64) * TAU;
                    let py = (y as f64 / n as f64) * TAU;
                    let pz = (z as f64 / n as f64) * TAU;
                    let (_, a) = self.sample_ua(px, py, pz, t);
                    data[p] = a[0] as f32;
                    data[p + 1] = a[1] as f32;
                    data[p + 2] = a[2] as f32;
                    let (u, w) = self.sample_uw(px, py, pz, t);
                    data[p + 3] = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) as f32;
                    p += 4;
                }
            }
        }
        data
    }

    /// Wrap this field with a free-slip SDF obstacle boundary.
    pub fn with_boundary<S>(
        &self,
        sdf: S,
        opts: crate::boundary::BoundaryOptions,
    ) -> BoundedField<'_, HelixField, S>
    where
        S: Fn(f64, f64, f64) -> f64,
    {
        BoundedField::new(self, sdf, opts)
    }

    /// Emit self-contained GLSL (ES 3.00 / WebGL2) evaluating this exact field on the GPU.
    pub fn glsl(&self, opts: &GlslOptions) -> String {
        to_glsl(self, opts)
    }
}

impl crate::boundary::VectorPotential for HelixField {
    fn velocity_and_potential(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        self.sample_ua(x, y, z, t)
    }
}
