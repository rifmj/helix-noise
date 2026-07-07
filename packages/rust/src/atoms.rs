//! The sparse-atom flow engine: a divergence-free sum of compactly-supported helical wavelets
//! ("atoms") drawn deterministically from a spatial hash.
//!
//! Each atom is `u_atom = curl(W * A) = (grad W) x A + W * u_wave`, where `u_wave` is a helical
//! plane wave, `A = (s/|k|) * u_wave` its exact Beltrami potential, and `W = (1 - q^2)^3` a `C^2`
//! window vanishing at the support radius. Atoms live on a hash lattice (one PRNG per cell), so
//! the field is infinite, grid-free, amortized `O(1)` per sample, and any region can carry its
//! own helicity/gain. It is divergence-free exactly — every atom is a curl.
//!
//! This is a numerical-parity port of the JavaScript reference `HelixAtoms`: the integer spatial
//! hash and the per-atom `mulberry32` draw order are bit-identical, so a field built with the
//! same options and seed reproduces the reference values to floating-point tolerance.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::boundary::{BoundaryOptions, BoundedField, VectorPotential};
use crate::constants::{SpectrumFn, TAU};
use crate::field::{frame, hypot3};
use crate::rng::Mulberry32;

/// A spatially-varying scalar field `(x, y, z) -> value`, sampled once at each atom's center.
pub type ScalarField3 = Box<dyn Fn(f64, f64, f64) -> f64>;

/// Options for constructing a [`HelixAtoms`] field.
///
/// Build one with `AtomOptions::default()` and override individual fields with struct-update
/// syntax. The three callback fields (`helicity_field`, `gain_field`, `spectrum`) are `None` by
/// default; when set they are sampled at atom centers / wavenumbers and frozen into each atom.
///
/// ```
/// use helix_noise::AtomOptions;
/// let opts = AtomOptions { octaves: 4, helicity: 0.7, seed: 42, ..Default::default() };
/// # let _ = opts;
/// ```
pub struct AtomOptions {
    /// Octave layers; each halves the atom radius and doubles the wavenumber.
    pub octaves: usize,
    /// Atoms per hash cell (a cell is one atom diameter wide). Density / quality knob.
    pub atoms_per_cell: usize,
    /// Support radius of the largest atoms (octave 0); octave `o` uses `radius / 2^o`.
    pub radius: f64,
    /// Wavelengths across an atom's diameter — sets `|k| * radius` per octave.
    pub cycles_per_atom: f64,
    /// Amplitude `~ |k|^-slope` across octaves.
    pub slope: f64,
    /// Helicity `p` in `[-1, 1]`, as in the spectral engine.
    pub helicity: f64,
    /// Output scale. The field is normalized to unit RMS at `t = 0`, then multiplied by this.
    pub amplitude: f64,
    /// PRNG seed. `0` is treated as `1`.
    pub seed: u32,
    /// Time-evolution rate: per-atom phase churn at `omega(k) ~ k^(2/3)`. `0` freezes.
    pub churn: f64,
    /// Direction anisotropy `gamma` (clamped to `[-0.99, 9]`): streaks (`< 0`) or layers
    /// (`> 0`) along `axis`.
    pub anisotropy: f64,
    /// Anisotropy axis (normalized internally).
    pub axis: [f64; 3],
    /// Spatially-varying helicity, sampled at each atom's center. Overrides `helicity` locally.
    pub helicity_field: Option<ScalarField3>,
    /// Spatially-varying amplitude gain, sampled at each atom's center.
    pub gain_field: Option<ScalarField3>,
    /// Custom amplitude law `a(|k|) >= 0`, replacing the octave power law (shape only).
    pub spectrum: Option<SpectrumFn>,
}

impl Default for AtomOptions {
    fn default() -> Self {
        AtomOptions {
            octaves: 3,
            atoms_per_cell: 8,
            radius: 1.6,
            cycles_per_atom: 2.0,
            slope: 1.6,
            helicity: 0.0,
            amplitude: 1.0,
            seed: 1,
            churn: 1.0,
            anisotropy: 0.0,
            axis: [0.0, 0.0, 1.0],
            helicity_field: None,
            gain_field: None,
            spectrum: None,
        }
    }
}

/// One compactly-supported helical atom, with its local parameters frozen at its center.
#[derive(Clone)]
struct Atom {
    /// Center.
    c: [f64; 3],
    /// Wavevector `k = |k| * dir`.
    k: [f64; 3],
    /// `|k|`.
    km: f64,
    /// Helical sign `s in {-1, +1}`.
    s: f64,
    /// Amplitude `a`.
    a: f64,
    /// Base phase.
    ph: f64,
    /// Temporal phase rate.
    rate: f64,
    /// `s / |k|` — the wave-potential scale.
    gsk: f64,
    /// Transverse frame vector `e1`.
    e1: [f64; 3],
    /// Transverse frame vector `e2`.
    e2: [f64; 3],
}

/// 32-bit `Math.imul(a, b)`: the low 32 bits of the product, `a` reduced mod `2^32` first.
#[inline]
fn imul(a: i64, b: u32) -> u32 {
    (a as i32 as u32).wrapping_mul(b)
}

/// Avalanche hash of a cell address `(i, j, k)` (each reduced mod `2^32`) mixed with `seed`.
/// Bit-identical to the JS reference `hcell`.
#[inline]
fn hcell(i: i64, j: i64, k: i64, seed: u32) -> u32 {
    let mut h = seed ^ imul(i, 0x27d4_eb2d) ^ imul(j, 0x1656_67b1) ^ imul(k, 0x9e37_79b1);
    h = (h ^ (h >> 15)).wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^ (h >> 16)
}

/// The sparse-atom engine. See the [module docs](self).
pub struct HelixAtoms {
    opts: AtomOptions,
    k_base: f64,
    scale: f64,
    cells: RefCell<HashMap<i64, Rc<Vec<Atom>>>>,
}

impl HelixAtoms {
    /// Build an atom field from `opts`.
    pub fn new(opts: AtomOptions) -> Self {
        let k_base = (opts.cycles_per_atom * std::f64::consts::PI) / opts.radius;
        let mut f = HelixAtoms {
            opts,
            k_base,
            scale: 1.0,
            cells: RefCell::new(HashMap::new()),
        };
        f.reinit();
        f
    }

    /// Alias for [`HelixAtoms::new`], mirroring the reference `createAtoms`.
    pub fn create(opts: AtomOptions) -> Self {
        Self::new(opts)
    }

    /// Replace the options and re-tune: recompute the base wavenumber, flush the atom cache,
    /// and renormalize to unit RMS. Returns `&mut self` for chaining.
    pub fn set(&mut self, opts: AtomOptions) -> &mut Self {
        self.opts = opts;
        self.reinit();
        self
    }

    /// Current options.
    pub fn options(&self) -> &AtomOptions {
        &self.opts
    }

    /// The base wavenumber `|k|` of octave 0 (`cycles_per_atom * pi / radius`).
    pub fn k_base(&self) -> f64 {
        self.k_base
    }

    /// The RMS-normalization scale applied to every sample.
    pub fn scale(&self) -> f64 {
        self.scale
    }

    fn reinit(&mut self) {
        self.k_base = (self.opts.cycles_per_atom * std::f64::consts::PI) / self.opts.radius;
        self.cells.borrow_mut().clear();
        self.scale = 1.0;
        let rms = self.rms();
        let amp = if self.opts.amplitude == 0.0 { 1.0 } else { self.opts.amplitude };
        let denom = if rms == 0.0 { 1.0 } else { rms };
        self.scale = amp / denom;
    }

    /// Atoms of one hash cell (cell size = atom diameter), generated on first use and cached.
    fn cell(&self, o: usize, ci: i64, cj: i64, ck: i64) -> Rc<Vec<Atom>> {
        let key: i64 =
            ((o as i64 * 65536 + (ci & 0xffff)) * 65536 + (cj & 0xffff)) * 65536 + (ck & 0xffff);
        if let Some(c) = self.cells.borrow().get(&key) {
            return c.clone();
        }
        // Crude, cheap eviction — matches the reference's cap. Values are unaffected.
        if self.cells.borrow().len() >= 16384 {
            self.cells.borrow_mut().clear();
        }
        let atoms = Rc::new(self.gen_cell(o, ci, cj, ck));
        self.cells.borrow_mut().insert(key, atoms.clone());
        atoms
    }

    /// Deterministically generate a cell's atoms from its spatial-hash PRNG.
    fn gen_cell(&self, o: usize, ci: i64, cj: i64, ck: i64) -> Vec<Atom> {
        let p = &self.opts;
        let rho = p.radius / (1u32 << o) as f64;
        let l = 2.0 * rho; // cell size = atom diameter -> only 2x2x2 cells cover any point
        let kc = self.k_base * (1u32 << o) as f64;
        let npc = p.atoms_per_cell.max(1);
        let base_seed = if p.seed == 0 { 1 } else { p.seed };
        let cell_seed = base_seed.wrapping_add((o as u32).wrapping_mul(0x9e37_79b9));
        let mut rng = Mulberry32::new(hcell(ci, cj, ck, cell_seed));
        let chi = p.churn.max(0.0);
        let rate0 = chi * self.k_base.cbrt();
        let gam = p.anisotropy.clamp(-0.99, 9.0);
        let mut an = hypot3(p.axis[0], p.axis[1], p.axis[2]);
        if an == 0.0 {
            an = 1.0;
        }
        let (anx, any, anz) = (p.axis[0] / an, p.axis[1] / an, p.axis[2] / an);

        let mut atoms = Vec::with_capacity(npc);
        for _ in 0..npc {
            let cx = (ci as f64 + rng.next_f64()) * l;
            let cy = (cj as f64 + rng.next_f64()) * l;
            let cz = (ck as f64 + rng.next_f64()) * l;
            let zd = 2.0 * rng.next_f64() - 1.0;
            let th = TAU * rng.next_f64();
            let rd = (1.0 - zd * zd).max(0.0).sqrt();
            let mut dx = rd * th.cos();
            let mut dy = rd * th.sin();
            let mut dz = zd;
            if gam != 0.0 {
                // Stretch the wavevector direction along the anisotropy axis.
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
            let km = kc * (0.85 + 0.3 * rng.next_f64());
            let pl = match &p.helicity_field {
                Some(f) => f(cx, cy, cz).clamp(-1.0, 1.0),
                None => p.helicity,
            };
            let s = if rng.next_f64() < (1.0 + pl) / 2.0 { 1.0 } else { -1.0 };
            let gain = match &p.gain_field {
                Some(f) => f(cx, cy, cz),
                None => 1.0,
            };
            let ph = TAU * rng.next_f64();
            let sgn = if rng.next_f64() < 0.5 { -1.0 } else { 1.0 };
            let a = gain
                * match &p.spectrum {
                    Some(sp) => sp(km).max(0.0),
                    None => (km / self.k_base).powf(-p.slope),
                };
            let fr = frame(dx, dy, dz);
            atoms.push(Atom {
                c: [cx, cy, cz],
                k: [km * dx, km * dy, km * dz],
                km,
                s,
                a,
                ph,
                rate: sgn * rate0 * km.powf(2.0 / 3.0),
                gsk: s / km,
                e1: [fr[0], fr[1], fr[2]],
                e2: [fr[3], fr[4], fr[5]],
            });
        }
        atoms
    }

    /// Core evaluation. `mode 0`: velocity only. `mode 1`: velocity + analytic vorticity.
    /// `mode 2`: velocity + potential `sum W*A`. Returns `[u; w-or-A]`, RMS-scaled; the last
    /// three entries are zero for mode 0.
    fn eval(&self, x: f64, y: f64, z: f64, t: f64, mode: u8) -> [f64; 6] {
        let p = &self.opts;
        let sc = self.scale;
        let (mut ux, mut uy, mut uz) = (0.0, 0.0, 0.0);
        let (mut vx, mut vy, mut vz) = (0.0, 0.0, 0.0);
        for o in 0..p.octaves {
            let rho = p.radius / (1u32 << o) as f64;
            let l = 2.0 * rho;
            let rho2 = rho * rho;
            let bi = (x / l - 0.5).floor() as i64;
            let bj = (y / l - 0.5).floor() as i64;
            let bk = (z / l - 0.5).floor() as i64;
            for dc in 0..8u32 {
                let ci = bi + (dc & 1) as i64;
                let cj = bj + ((dc >> 1) & 1) as i64;
                let ck = bk + ((dc >> 2) & 1) as i64;
                let cell = self.cell(o, ci, cj, ck);
                for at in cell.iter() {
                    let dxx = x - at.c[0];
                    let dyy = y - at.c[1];
                    let dzz = z - at.c[2];
                    let r2 = dxx * dxx + dyy * dyy + dzz * dzz;
                    if r2 >= rho2 {
                        continue;
                    }
                    let beta = 1.0 - r2 / rho2;
                    let b2 = beta * beta;
                    let w = b2 * beta;
                    let (kx, ky, kz) = (at.k[0], at.k[1], at.k[2]);
                    let phi = kx * dxx + ky * dyy + kz * dzz + at.ph + at.rate * t;
                    let c = phi.cos();
                    let sn = phi.sin();
                    let s = at.s;
                    let a = at.a;
                    let gsk = at.gsk;
                    let twx = a * (c * at.e1[0] - s * sn * at.e2[0]); // u_wave
                    let twy = a * (c * at.e1[1] - s * sn * at.e2[1]);
                    let twz = a * (c * at.e1[2] - s * sn * at.e2[2]);
                    let ax = gsk * twx; // wave potential A
                    let ay = gsk * twy;
                    let az = gsk * twz;
                    let gw = (-6.0 * b2) / rho2; // grad W = gw * d
                    let gwx = gw * dxx;
                    let gwy = gw * dyy;
                    let gwz = gw * dzz;
                    // u_atom = grad W x A + W * u_wave
                    ux += gwy * az - gwz * ay + w * twx;
                    uy += gwz * ax - gwx * az + w * twy;
                    uz += gwx * ay - gwy * ax + w * twz;
                    if mode == 2 {
                        // potential of the atom: W * A
                        vx += w * ax;
                        vy += w * ay;
                        vz += w * az;
                    } else if mode == 1 {
                        // omega = curl u_atom = curl curl (W A), all closed-form.
                        let apx = gsk * a * (-sn * at.e1[0] - s * c * at.e2[0]); // A'
                        let apy = gsk * a * (-sn * at.e1[1] - s * c * at.e2[1]);
                        let apz = gsk * a * (-sn * at.e1[2] - s * c * at.e2[2]);
                        let da = dxx * ax + dyy * ay + dzz * az;
                        let c1 = (12.0 * b2) / rho2;
                        let c2 = (24.0 * beta) / (rho2 * rho2);
                        let kgw = kx * gwx + ky * gwy + kz * gwz;
                        let gap = gwx * apx + gwy * apy + gwz * apz;
                        let skw = s * at.km * w;
                        vx += c1 * ax + c2 * (da * dxx - r2 * ax) + gap * kx - 2.0 * kgw * apx
                            + skw * twx;
                        vy += c1 * ay + c2 * (da * dyy - r2 * ay) + gap * ky - 2.0 * kgw * apy
                            + skw * twy;
                        vz += c1 * az + c2 * (da * dzz - r2 * az) + gap * kz - 2.0 * kgw * apz
                            + skw * twz;
                    }
                }
            }
        }
        let mut out = [0.0; 6];
        out[0] = ux * sc;
        out[1] = uy * sc;
        out[2] = uz * sc;
        if mode != 0 {
            out[3] = vx * sc;
            out[4] = vy * sc;
            out[5] = vz * sc;
        }
        out
    }

    /// Divergence-free velocity `[u, v, w]` at `(x, y, z)`.
    pub fn sample(&self, x: f64, y: f64, z: f64) -> [f64; 3] {
        let o = self.eval(x, y, z, 0.0, 0);
        [o[0], o[1], o[2]]
    }

    /// Velocity at `(x, y, z)`, animated at time `t`.
    pub fn sample_t(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        let o = self.eval(x, y, z, t, 0);
        [o[0], o[1], o[2]]
    }

    /// Velocity and its analytic vorticity in one pass: `(u, w)`.
    pub fn sample_uw(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        let o = self.eval(x, y, z, t, 1);
        ([o[0], o[1], o[2]], [o[3], o[4], o[5]])
    }

    /// Velocity and its exact vector potential `A` in one pass: `(u, A)`.
    pub fn sample_ua(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        let o = self.eval(x, y, z, t, 2);
        ([o[0], o[1], o[2]], [o[3], o[4], o[5]])
    }

    /// Vorticity (curl u) at `(x, y, z, t)`.
    pub fn vorticity(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.sample_uw(x, y, z, t).1
    }

    /// Helicity density `u . omega` at `(x, y, z, t)`.
    pub fn helicity_density(&self, x: f64, y: f64, z: f64, t: f64) -> f64 {
        let (u, w) = self.sample_uw(x, y, z, t);
        u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
    }

    /// Exact vector potential `A` at `(x, y, z, t)`.
    pub fn potential(&self, x: f64, y: f64, z: f64, t: f64) -> [f64; 3] {
        self.sample_ua(x, y, z, t).1
    }

    /// Batch velocities for interleaved `[x, y, z, ...]` points, returning `[u, v, w, ...]`.
    pub fn sample_many(&self, pos: &[f64], t: f64) -> Vec<f64> {
        let n = pos.len() / 3;
        let mut out = vec![0.0; 3 * n];
        for i in 0..n {
            let o = self.eval(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], t, 0);
            out[3 * i] = o[0];
            out[3 * i + 1] = o[1];
            out[3 * i + 2] = o[2];
        }
        out
    }

    /// Batch velocity + analytic vorticity, 6 floats per point.
    pub fn sample_many_uw(&self, pos: &[f64], t: f64) -> Vec<f64> {
        let n = pos.len() / 3;
        let mut out = vec![0.0; 6 * n];
        for i in 0..n {
            let o = self.eval(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], t, 1);
            out[6 * i..6 * i + 6].copy_from_slice(&o);
        }
        out
    }

    /// Relative helicity `<u . omega> / (||u|| ||omega||)` on an `ng^3` grid spanning a few radii.
    pub fn relative_helicity(&self, ng: usize) -> f64 {
        let span = 4.0 * self.opts.radius;
        let (mut h, mut un, mut wn) = (0.0, 0.0, 0.0);
        for i in 0..ng {
            for j in 0..ng {
                for k in 0..ng {
                    let o = self.eval(
                        0.13 + (i as f64 / ng as f64) * span,
                        0.29 + (j as f64 / ng as f64) * span,
                        0.41 + (k as f64 / ng as f64) * span,
                        0.0,
                        1,
                    );
                    h += o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
                    un += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
                    wn += o[3] * o[3] + o[4] * o[4] + o[5] * o[5];
                }
            }
        }
        let denom = (un * wn).sqrt();
        if denom == 0.0 {
            0.0
        } else {
            h / denom
        }
    }

    fn rms(&self) -> f64 {
        let ng = 6;
        let span = 4.0 * self.opts.radius;
        let (mut s, mut n) = (0.0, 0.0);
        for i in 0..ng {
            for j in 0..ng {
                for k in 0..ng {
                    let o = self.eval(
                        0.13 + (i as f64 / ng as f64) * span,
                        0.29 + (j as f64 / ng as f64) * span,
                        0.41 + (k as f64 / ng as f64) * span,
                        0.0,
                        0,
                    );
                    s += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
                    n += 1.0;
                }
            }
        }
        (s / n).sqrt()
    }

    /// Bake a `n^3` RGBA volume: `rgb` = velocity, `a` = helicity density, over `[0, 2*pi)^3`.
    /// Row-major `x` fastest, 4 channels per voxel.
    pub fn bake3d(&self, n: usize, t: f64) -> Vec<f32> {
        let mut data = vec![0.0f32; n * n * n * 4];
        let mut p = 0;
        for z in 0..n {
            for y in 0..n {
                for x in 0..n {
                    let o = self.eval(
                        (x as f64 / n as f64) * TAU,
                        (y as f64 / n as f64) * TAU,
                        (z as f64 / n as f64) * TAU,
                        t,
                        1,
                    );
                    data[p] = o[0] as f32;
                    data[p + 1] = o[1] as f32;
                    data[p + 2] = o[2] as f32;
                    data[p + 3] = (o[0] * o[3] + o[1] * o[4] + o[2] * o[5]) as f32;
                    p += 4;
                }
            }
        }
        data
    }

    /// Bake an `nx * ny` RGBA slice at height `z`: `rgb` = velocity, `a` = helicity density.
    pub fn bake2d(&self, nx: usize, ny: usize, z: f64, t: f64) -> Vec<f32> {
        let mut data = vec![0.0f32; nx * ny * 4];
        let mut p = 0;
        for j in 0..ny {
            for i in 0..nx {
                let o = self.eval(
                    (i as f64 / nx as f64) * TAU,
                    (j as f64 / ny as f64) * TAU,
                    z,
                    t,
                    1,
                );
                data[p] = o[0] as f32;
                data[p + 1] = o[1] as f32;
                data[p + 2] = o[2] as f32;
                data[p + 3] = (o[0] * o[3] + o[1] * o[4] + o[2] * o[5]) as f32;
                p += 4;
            }
        }
        data
    }

    /// Bake a `n^3` RGBA volume: `rgb` = vector potential `A`, `a` = helicity density. Take the
    /// curl of `rgb` in a shader for an obstacle-free, discretely divergence-free GPU field.
    pub fn bake_potential3d(&self, n: usize, t: f64) -> Vec<f32> {
        let mut data = vec![0.0f32; n * n * n * 4];
        let mut p = 0;
        for z in 0..n {
            for y in 0..n {
                for x in 0..n {
                    let px = (x as f64 / n as f64) * TAU;
                    let py = (y as f64 / n as f64) * TAU;
                    let pz = (z as f64 / n as f64) * TAU;
                    let a = self.eval(px, py, pz, t, 2);
                    let uw = self.eval(px, py, pz, t, 1);
                    data[p] = a[3] as f32;
                    data[p + 1] = a[4] as f32;
                    data[p + 2] = a[5] as f32;
                    data[p + 3] = (uw[0] * uw[3] + uw[1] * uw[4] + uw[2] * uw[5]) as f32;
                    p += 4;
                }
            }
        }
        data
    }

    /// Wrap this field with a free-slip SDF obstacle. See [`BoundedField`].
    pub fn with_boundary<S>(&self, sdf: S, opts: BoundaryOptions) -> BoundedField<'_, HelixAtoms, S>
    where
        S: Fn(f64, f64, f64) -> f64,
    {
        BoundedField::new(self, sdf, opts)
    }
}

impl VectorPotential for HelixAtoms {
    fn velocity_and_potential(&self, x: f64, y: f64, z: f64, t: f64) -> ([f64; 3], [f64; 3]) {
        self.sample_ua(x, y, z, t)
    }
}
