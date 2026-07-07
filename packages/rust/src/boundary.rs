//! Free-slip SDF obstacle boundary.
//!
//! Given a signed-distance function `d = sdf(x, y, z)` (negative inside the obstacle) and the
//! base field's analytic vector potential `A`, the bounded velocity is the curl of a ramped
//! potential, expanded exactly as `u_b = ramp'(d/th) * (grad(d) x A) + ramp(d/th) * u`. It is
//! divergence-free by construction, tangent to the wall, zero inside, and identical to the base
//! field beyond the influence band.

use crate::field::HelixField;

/// Options for [`HelixField::with_boundary`](crate::HelixField::with_boundary).
pub struct BoundaryOptions {
    /// Width of the influence band, in world units. Clamped to `>= 1e-9`.
    pub thickness: f64,
    /// Finite-difference step for numerical gradients (SDF gradient and bounded vorticity).
    pub fd_step: f64,
    /// Optional analytic SDF gradient `grad(d)`. When absent, central differences are used.
    pub gradient: Option<Box<dyn Fn(f64, f64, f64) -> [f64; 3]>>,
}

impl Default for BoundaryOptions {
    fn default() -> Self {
        BoundaryOptions {
            thickness: 1.0,
            fd_step: 1e-3,
            gradient: None,
        }
    }
}

/// Bridson's free-slip ramp (the curl-noise boundary quintic). `r(0) = 0` but `r'(0) = 15/8`,
/// so the wall value is a pure tangential slip flow. `r(1) = 1` with `r'(1) = r''(1) = 0`.
#[inline]
fn ramp(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let x2 = x * x;
    (x * (15.0 - 10.0 * x2 + 3.0 * x2 * x2)) / 8.0
}

#[inline]
fn dramp(x: f64) -> f64 {
    if x < 0.0 || x >= 1.0 {
        return 0.0;
    }
    let w = 1.0 - x * x;
    (15.0 / 8.0) * w * w
}

/// A base [`HelixField`] constrained by an SDF obstacle. Borrows the base field.
pub struct BoundedField<'f, S>
where
    S: Fn(f64, f64, f64) -> f64,
{
    base: &'f HelixField,
    sdf: S,
    th: f64,
    h: f64,
    grad: Option<Box<dyn Fn(f64, f64, f64) -> [f64; 3]>>,
}

impl<'f, S> BoundedField<'f, S>
where
    S: Fn(f64, f64, f64) -> f64,
{
    pub(crate) fn new(base: &'f HelixField, sdf: S, opts: BoundaryOptions) -> Self {
        BoundedField {
            base,
            sdf,
            th: opts.thickness.max(1e-9),
            h: opts.fd_step,
            grad: opts.gradient,
        }
    }

    /// Bounded velocity at `(x, y, z, t)`.
    fn u(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        let d = (self.sdf)(x, y, z);
        if d <= 0.0 {
            return [0.0, 0.0, 0.0];
        }
        let (u_base, a) = self.base.sample_ua(x, y, z, t);
        let q = d / self.th;
        if q >= 1.0 {
            return u_base;
        }
        let (gx, gy, gz);
        if let Some(g) = &self.grad {
            let gg = g(x, y, z);
            gx = gg[0];
            gy = gg[1];
            gz = gg[2];
        } else {
            let h = self.h;
            gx = ((self.sdf)(x + h, y, z) - (self.sdf)(x - h, y, z)) / (2.0 * h);
            gy = ((self.sdf)(x, y + h, z) - (self.sdf)(x, y - h, z)) / (2.0 * h);
            gz = ((self.sdf)(x, y, z + h) - (self.sdf)(x, y, z - h)) / (2.0 * h);
        }
        let r = ramp(q);
        let rp = dramp(q) / self.th;
        let cx = gy * a[2] - gz * a[1];
        let cy = gz * a[0] - gx * a[2];
        let cz = gx * a[1] - gy * a[0];
        [rp * cx + r * u_base[0], rp * cy + r * u_base[1], rp * cz + r * u_base[2]]
    }

    /// Bounded velocity at `(x, y, z, t)`.
    pub fn sample(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.u(x, y, z, t)
    }

    /// Bounded velocity and its vorticity, the latter by central differences of the bounded
    /// velocity itself (`O(fd_step^2)`). Returns `(u, w)`.
    pub fn sample_uw(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        let u = self.u(x, y, z, t);
        let h = self.h;
        let ayp = self.u(x, y + h, z, t);
        let aym = self.u(x, y - h, z, t);
        let uzy = (ayp[2] - aym[2]) / (2.0 * h);
        let uxy = (ayp[0] - aym[0]) / (2.0 * h);
        let azp = self.u(x, y, z + h, t);
        let azm = self.u(x, y, z - h, t);
        let uyz = (azp[1] - azm[1]) / (2.0 * h);
        let uxz = (azp[0] - azm[0]) / (2.0 * h);
        let axp = self.u(x + h, y, z, t);
        let axm = self.u(x - h, y, z, t);
        let uyx = (axp[1] - axm[1]) / (2.0 * h);
        let uzx = (axp[2] - axm[2]) / (2.0 * h);
        let w = [uzy - uyz, uxz - uzx, uyx - uxy];
        (u, w)
    }

    /// Bounded vorticity at `(x, y, z, t)`.
    pub fn vorticity(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.sample_uw(x, y, z, t).1
    }

    /// Bounded helicity density `u . w`.
    pub fn helicity_density(&self, x: f64, y: f64, z: f64, t: f64) -> f64 {
        let (u, w) = self.sample_uw(x, y, z, t);
        u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
    }

    /// Bounded vector potential: `ramp(d/th) * A_base`, or zero inside the obstacle.
    pub fn potential(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        let d = (self.sdf)(x, y, z);
        if d <= 0.0 {
            return [0.0, 0.0, 0.0];
        }
        let (_, a) = self.base.sample_ua(x, y, z, t);
        let r = ramp(d / self.th);
        [r * a[0], r * a[1], r * a[2]]
    }
}
