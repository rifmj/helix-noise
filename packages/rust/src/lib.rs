//! # Helix Noise
//!
//! A divergence-free **helical (Beltrami) spectral flow-field** noise. The field is an analytic
//! sum of divergence-free helical modes, so it can be evaluated grid-free at any point in space
//! and time and its curl (vorticity) and vector potential come out in closed form. Handy for
//! curl-noise particle advection, smoke and fluid-looking motion, procedural vector textures,
//! and GPU flow shaders.
//!
//! This crate is a port of the JavaScript `helix-noise` library with numerical parity: the
//! deterministic `mulberry32` mode-construction stream is bit-identical, so a field built with
//! the same options and seed reproduces the reference values to floating-point tolerance.
//!
//! The crate has **zero runtime dependencies** and no threads or I/O in the hot path, so it
//! compiles cleanly to WebAssembly.
//!
//! ## Quickstart
//!
//! ```
//! use helix_noise::{HelixField, HelixOptions};
//!
//! let field = HelixField::new(HelixOptions { seed: 42, modes: 48, ..Default::default() });
//!
//! // Velocity at a point.
//! let u = field.sample(1.0, 2.0, 3.0);
//!
//! // Velocity animated in time.
//! let u_t = field.sample_t(1.0, 2.0, 3.0, 0.5);
//!
//! // Velocity + vorticity in one pass.
//! let (u, w) = field.sample_uw(1.0, 2.0, 3.0, 0.0);
//! # let _ = (u, w, u_t);
//! ```
//!
//! ## Custom spectrum
//!
//! ```
//! use helix_noise::{HelixField, HelixOptions};
//! let field = HelixField::new(HelixOptions {
//!     spectrum: Some(Box::new(|k: f64| (-k).exp())),
//!     ..Default::default()
//! });
//! # let _ = field.sample(0.0, 0.0, 0.0);
//! ```
//!
//! ## Obstacles (free-slip boundary)
//!
//! ```
//! use helix_noise::{HelixField, HelixOptions, BoundaryOptions};
//! let field = HelixField::new(HelixOptions::default());
//! let bounded = field.with_boundary(
//!     |x: f64, y: f64, z: f64| ((x - 3.0).powi(2) + (y - 3.0).powi(2) + (z - 3.0).powi(2)).sqrt() - 1.2,
//!     BoundaryOptions { thickness: 0.9, ..Default::default() },
//! );
//! let u = bounded.sample(2.0, 2.0, 2.0, 0.0);
//! # let _ = u;
//! ```
//!
//! ## Scope
//!
//! Covers both engines — the spectral [`HelixField`] and the sparse-atom [`HelixAtoms`] — plus
//! the free-slip SDF boundary (which wraps either) and the GLSL/shader emitter. The atom-engine
//! GLSL emitter of the JS reference is a documented follow-up and not yet ported.

mod atoms;
mod boundary;
mod constants;
mod field;
mod glsl;
mod rng;

pub use atoms::{AtomOptions, HelixAtoms, ScalarField3};
pub use boundary::{BoundaryOptions, BoundedField, VectorPotential};
pub use constants::{ga, HelixOptions, Layout, SpectrumFn, TAU, VERSION};
pub use field::{HelixField, ModeSnapshot};
pub use glsl::GlslOptions;
pub use rng::Mulberry32;
