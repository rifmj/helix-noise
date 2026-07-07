//! The spectral flow-field engine: a divergence-free sum of helical (Beltrami) modes,
//! evaluatable analytically at any point in space and time.

use crate::boundary::BoundedField;
use crate::constants::{ga, HelixOptions, Layout, TAU};
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
            opts,
        };
        f.build();
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

        let lam = p.coherence.clamp(0.0, 1.0);
        let fib = p.layout != Layout::Random;
        let mut ci = vec![0usize; n];
        let gam = p.anisotropy.clamp(-0.99, 9.0);
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
            self.s[j] = if rng.next_f64() < (1.0 + p.helicity) / 2.0 {
                1.0
            } else {
                -1.0
            };
            self.a[j] = match &p.spectrum {
                Some(sp) => sp(km).max(0.0),
                None => km.powf(-p.slope),
            };
            let phr = TAU * rng.next_f64();
            let c = (rng.next_f64() * nc as f64) as usize;
            ci[j] = c;
            let phc = -(kxc * cx[c] + kyc * cy[c] + kzc * cz[c]);
            let bx = (1.0 - lam) * phr.cos() + lam * phc.cos();
            let by = (1.0 - lam) * phr.sin() + lam * phc.sin();
            self.ph[j] = by.atan2(bx);
        }

        // Time evolution — all draws happen AFTER the spatial loop, so the t = 0 field is
        // unchanged by the time knobs.
        let chi = p.churn.max(0.0);
        let mut cvx = vec![0.0f64; nc];
        let mut cvy = vec![0.0f64; nc];
        let mut cvz = vec![0.0f64; nc];
        let sg = chi / 3.0_f64.sqrt();
        for m in 0..nc {
            let r1 = (-2.0 * (1.0 - rng.next_f64()).ln()).sqrt();
            let a1 = TAU * rng.next_f64();
            let r2 = (-2.0 * (1.0 - rng.next_f64()).ln()).sqrt();
            let a2 = TAU * rng.next_f64();
            cvx[m] = sg * r1 * a1.cos();
            cvy[m] = sg * r1 * a1.sin();
            cvz[m] = sg * r2 * a2.cos();
        }
        let rate0 = chi * p.kmin.max(1e-9).cbrt();
        for j in 0..n {
            let sgn = if rng.next_f64() < 0.5 { -1.0 } else { 1.0 };
            let c = ci[j];
            self.om[j] = (1.0 - lam) * sgn * rate0 * self.km[j].powf(2.0 / 3.0)
                - lam * (self.kx[j] * cvx[c] + self.ky[j] * cvy[c] + self.kz[j] * cvz[c]);
        }

        self.nu = p.decay.max(0.0);

        self.scale = 1.0;
        let rms = self.rms();
        let amp = if p.amplitude != 0.0 { p.amplitude } else { 1.0 };
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

    /// Velocity `u` and vorticity `w` at `(x, y, z, t)`. Returns `(u, w)`.
    pub fn sample_uw(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        let sc = self.scale;
        let (mut ux, mut uy, mut uz) = (0.0, 0.0, 0.0);
        let (mut wx, mut wy, mut wz) = (0.0, 0.0, 0.0);
        for j in 0..self.n {
            let phi = self.kx[j] * x + self.ky[j] * y + self.kz[j] * z + self.ph[j] + self.om[j] * t;
            let c = phi.cos();
            let sn = phi.sin();
            let s = self.s[j];
            let a = self.amp_at(j, t);
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
        }
        ([ux * sc, uy * sc, uz * sc], [wx * sc, wy * sc, wz * sc])
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
            let s = self.s[j];
            let a = self.amp_at(j, t);
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
