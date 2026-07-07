//! WebAssembly bindings for [`helix_noise`], generated with `wasm-bindgen`.
//!
//! This crate wraps the zero-dependency Rust core and exposes a small, JS-friendly surface: both
//! engines ([`Field`] — spectral, [`Atoms`] — sparse wavelets), point and batch sampling,
//! vorticity / helicity / potential, and texture bakes. The heavy math runs as native WebAssembly
//! at the same numerical parity as every other port.
//!
//! Options are passed as a plain JS object; only numeric / string / boolean / axis-array fields
//! are read — the Rust-native callback options (`spectrum`, `helicityField`, `gainField`) are not
//! exposed across the wasm boundary. Array returns come back as typed arrays (`Float64Array` for
//! `f64` results, `Float32Array` for bakes).

use helix_noise::{AtomOptions, GlslOptions, HelixAtoms, HelixField, HelixOptions, Layout};
use wasm_bindgen::prelude::*;

// ---- JS options object readers -------------------------------------------------------------

fn num(opts: &JsValue, key: &str) -> Option<f64> {
    js_sys::Reflect::get(opts, &JsValue::from_str(key))
        .ok()
        .and_then(|v| v.as_f64())
}

fn boolean(opts: &JsValue, key: &str) -> Option<bool> {
    js_sys::Reflect::get(opts, &JsValue::from_str(key))
        .ok()
        .and_then(|v| v.as_bool())
}

fn text(opts: &JsValue, key: &str) -> Option<String> {
    js_sys::Reflect::get(opts, &JsValue::from_str(key))
        .ok()
        .and_then(|v| v.as_string())
}

fn vec3(opts: &JsValue, key: &str) -> Option<[f64; 3]> {
    let v = js_sys::Reflect::get(opts, &JsValue::from_str(key)).ok()?;
    if !js_sys::Array::is_array(&v) {
        return None;
    }
    let a = js_sys::Array::from(&v);
    Some([
        a.get(0).as_f64().unwrap_or(0.0),
        a.get(1).as_f64().unwrap_or(0.0),
        a.get(2).as_f64().unwrap_or(0.0),
    ])
}

fn field_options(opts: &JsValue) -> HelixOptions {
    let mut o = HelixOptions::default();
    if !opts.is_object() {
        return o;
    }
    if let Some(v) = num(opts, "modes") {
        o.modes = v as usize;
    }
    if let Some(v) = num(opts, "slope") {
        o.slope = v;
    }
    if let Some(v) = num(opts, "helicity") {
        o.helicity = v;
    }
    if let Some(v) = num(opts, "coherence") {
        o.coherence = v;
    }
    if let Some(v) = num(opts, "kmin") {
        o.kmin = v;
    }
    if let Some(v) = num(opts, "kmax") {
        o.kmax = v;
    }
    if let Some(v) = num(opts, "centers") {
        o.centers = v as i64;
    }
    if let Some(v) = num(opts, "amplitude") {
        o.amplitude = v;
    }
    if let Some(v) = num(opts, "seed") {
        o.seed = v as u32;
    }
    if let Some(v) = num(opts, "churn") {
        o.churn = v;
    }
    if let Some(v) = num(opts, "decay") {
        o.decay = v;
    }
    if let Some(v) = num(opts, "anisotropy") {
        o.anisotropy = v;
    }
    if let Some(v) = boolean(opts, "tileable") {
        o.tileable = v;
    }
    if let Some(s) = text(opts, "layout") {
        if let Some(l) = Layout::from_str_opt(&s) {
            o.layout = l;
        }
    }
    if let Some(a) = vec3(opts, "axis") {
        o.axis = a;
    }
    o
}

fn atom_options(opts: &JsValue) -> AtomOptions {
    let mut o = AtomOptions::default();
    if !opts.is_object() {
        return o;
    }
    if let Some(v) = num(opts, "octaves") {
        o.octaves = v as usize;
    }
    if let Some(v) = num(opts, "atomsPerCell") {
        o.atoms_per_cell = v as usize;
    }
    if let Some(v) = num(opts, "radius") {
        o.radius = v;
    }
    if let Some(v) = num(opts, "cyclesPerAtom") {
        o.cycles_per_atom = v;
    }
    if let Some(v) = num(opts, "slope") {
        o.slope = v;
    }
    if let Some(v) = num(opts, "helicity") {
        o.helicity = v;
    }
    if let Some(v) = num(opts, "amplitude") {
        o.amplitude = v;
    }
    if let Some(v) = num(opts, "seed") {
        o.seed = v as u32;
    }
    if let Some(v) = num(opts, "churn") {
        o.churn = v;
    }
    if let Some(v) = num(opts, "anisotropy") {
        o.anisotropy = v;
    }
    if let Some(a) = vec3(opts, "axis") {
        o.axis = a;
    }
    o
}

// ---- Spectral engine -----------------------------------------------------------------------

/// The spectral flow field: a divergence-free sum of helical (Beltrami) modes.
#[wasm_bindgen]
pub struct Field {
    inner: HelixField,
}

#[wasm_bindgen]
impl Field {
    /// Create a field from a JS options object (all fields optional), e.g.
    /// `new Field({ modes: 48, helicity: 0.8, coherence: 0.5, seed: 42 })`.
    #[wasm_bindgen(constructor)]
    pub fn new(opts: JsValue) -> Field {
        Field {
            inner: HelixField::new(field_options(&opts)),
        }
    }

    /// Velocity `[u, v, w]` at `(x, y, z)`.
    pub fn sample(&self, x: f64, y: f64, z: f64) -> Vec<f64> {
        self.inner.sample(x, y, z).to_vec()
    }

    /// Velocity `[u, v, w]` at `(x, y, z)`, animated at time `t`.
    #[wasm_bindgen(js_name = sampleT)]
    pub fn sample_t(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        self.inner.sample_t(x, y, z, t).to_vec()
    }

    /// Velocity + analytic vorticity: `[u, v, w, wx, wy, wz]`.
    #[wasm_bindgen(js_name = sampleUW)]
    pub fn sample_uw(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        let (u, w) = self.inner.sample_uw(x, y, z, t);
        vec![u[0], u[1], u[2], w[0], w[1], w[2]]
    }

    /// Velocity + analytic vector potential: `[u, v, w, Ax, Ay, Az]`.
    #[wasm_bindgen(js_name = sampleUA)]
    pub fn sample_ua(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        let (u, a) = self.inner.sample_ua(x, y, z, t);
        vec![u[0], u[1], u[2], a[0], a[1], a[2]]
    }

    /// Vorticity `[wx, wy, wz]` at `(x, y, z, t)`.
    pub fn vorticity(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        self.inner.vorticity(x, y, z, t).to_vec()
    }

    /// Helicity density `u . omega`.
    #[wasm_bindgen(js_name = helicityDensity)]
    pub fn helicity_density(&self, x: f64, y: f64, z: f64, t: f64) -> f64 {
        self.inner.helicity_density(x, y, z, t)
    }

    /// Vector potential `[Ax, Ay, Az]`.
    pub fn potential(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        self.inner.potential(x, y, z, t).to_vec()
    }

    /// Batch velocities for interleaved `[x, y, z, ...]` points; returns `[u, v, w, ...]`.
    #[wasm_bindgen(js_name = sampleMany)]
    pub fn sample_many(&self, pos: &[f64], t: f64) -> Vec<f64> {
        let n = pos.len() / 3;
        let mut out = vec![0.0; 3 * n];
        for i in 0..n {
            let u = self.inner.sample_t(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], t);
            out[3 * i] = u[0];
            out[3 * i + 1] = u[1];
            out[3 * i + 2] = u[2];
        }
        out
    }

    /// Bake a `n^3` RGBA volume (`Float32Array`): rgb = velocity, a = helicity density.
    pub fn bake3d(&self, n: usize, t: f64) -> Vec<f32> {
        self.inner.bake3d(n, t)
    }

    /// Bake an `nx * ny` RGBA slice at height `z` (`Float32Array`).
    pub fn bake2d(&self, nx: usize, ny: usize, z: f64, t: f64) -> Vec<f32> {
        self.inner.bake2d(nx, ny, z, t)
    }

    /// Number of modes.
    pub fn modes(&self) -> usize {
        self.inner.modes()
    }

    /// Emit self-contained GLSL (ES 3.00 / WebGL2) evaluating this exact field on the GPU.
    pub fn glsl(&self, name: Option<String>, potential: Option<bool>) -> String {
        let mut g = GlslOptions::default();
        if let Some(n) = name {
            g.name = n;
        }
        if let Some(p) = potential {
            g.potential = p;
        }
        self.inner.glsl(&g)
    }
}

// ---- Sparse-atom engine --------------------------------------------------------------------

/// The sparse-atom flow field: a divergence-free sum of compactly-supported helical wavelets,
/// infinite and grid-free.
#[wasm_bindgen]
pub struct Atoms {
    inner: HelixAtoms,
}

#[wasm_bindgen]
impl Atoms {
    /// Create an atom field from a JS options object (all fields optional), e.g.
    /// `new Atoms({ octaves: 4, helicity: 0.7, seed: 42 })`.
    #[wasm_bindgen(constructor)]
    pub fn new(opts: JsValue) -> Atoms {
        Atoms {
            inner: HelixAtoms::new(atom_options(&opts)),
        }
    }

    /// Velocity `[u, v, w]` at `(x, y, z)`.
    pub fn sample(&self, x: f64, y: f64, z: f64) -> Vec<f64> {
        self.inner.sample(x, y, z).to_vec()
    }

    /// Velocity `[u, v, w]` at `(x, y, z)`, animated at time `t`.
    #[wasm_bindgen(js_name = sampleT)]
    pub fn sample_t(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        self.inner.sample_t(x, y, z, t).to_vec()
    }

    /// Velocity + analytic vorticity: `[u, v, w, wx, wy, wz]`.
    #[wasm_bindgen(js_name = sampleUW)]
    pub fn sample_uw(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        let (u, w) = self.inner.sample_uw(x, y, z, t);
        vec![u[0], u[1], u[2], w[0], w[1], w[2]]
    }

    /// Velocity + analytic vector potential: `[u, v, w, Ax, Ay, Az]`.
    #[wasm_bindgen(js_name = sampleUA)]
    pub fn sample_ua(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        let (u, a) = self.inner.sample_ua(x, y, z, t);
        vec![u[0], u[1], u[2], a[0], a[1], a[2]]
    }

    /// Vorticity `[wx, wy, wz]` at `(x, y, z, t)`.
    pub fn vorticity(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        self.inner.vorticity(x, y, z, t).to_vec()
    }

    /// Helicity density `u . omega`.
    #[wasm_bindgen(js_name = helicityDensity)]
    pub fn helicity_density(&self, x: f64, y: f64, z: f64, t: f64) -> f64 {
        self.inner.helicity_density(x, y, z, t)
    }

    /// Vector potential `[Ax, Ay, Az]`.
    pub fn potential(&self, x: f64, y: f64, z: f64, t: f64) -> Vec<f64> {
        self.inner.potential(x, y, z, t).to_vec()
    }

    /// Batch velocities for interleaved `[x, y, z, ...]` points; returns `[u, v, w, ...]`.
    #[wasm_bindgen(js_name = sampleMany)]
    pub fn sample_many(&self, pos: &[f64], t: f64) -> Vec<f64> {
        self.inner.sample_many(pos, t)
    }

    /// Relative helicity `<u . omega> / (||u|| ||omega||)` on an `ng^3` grid.
    #[wasm_bindgen(js_name = relativeHelicity)]
    pub fn relative_helicity(&self, ng: usize) -> f64 {
        self.inner.relative_helicity(ng)
    }

    /// Bake a `n^3` RGBA volume (`Float32Array`): rgb = velocity, a = helicity density.
    pub fn bake3d(&self, n: usize, t: f64) -> Vec<f32> {
        self.inner.bake3d(n, t)
    }

    /// Bake an `nx * ny` RGBA slice at height `z` (`Float32Array`).
    pub fn bake2d(&self, nx: usize, ny: usize, z: f64, t: f64) -> Vec<f32> {
        self.inner.bake2d(nx, ny, z, t)
    }
}

/// The wrapped core library version.
#[wasm_bindgen]
pub fn version() -> String {
    helix_noise::VERSION.to_string()
}
