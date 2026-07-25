//! Numerical-parity tests against the JS reference fixture.
//!
//! Rebuilds every fixture config, then asserts the full mode arrays, sample outputs (u/w/A),
//! relative helicity, and bake sums match the reference within tolerance. Also checks that the
//! GLSL emitter for config A reproduces the reference shader's float constants.

use helix_noise::{
    abc, condensate, exact_ns, ns_developed, ns_forced, rolloff, shell_peak, AbcOptions,
    AtomOptions, BoundaryOptions, ExactNsOptions, GlslOptions, HelixAtoms, HelixField, HelixOptions,
    Layout, NS_TARGETS_DEV, NS_TARGETS_FORCED,
};
use serde_json::Value;

const FIXTURE: &str = include_str!("parity_fixture.json");
const REF_GLSL_A: &str = include_str!("ref_glsl_A.glsl");
const REF_GLSL_K: &str = include_str!("ref_glsl_K_elliptic.glsl");
const REF_GLSL_Q: &str = include_str!("ref_glsl_Q_grain.glsl");

/// Absolute+relative closeness, matching the spec tolerance (abs+rel 1e-9).
fn close(got: f64, exp: f64, atol: f64, rtol: f64) -> bool {
    let diff = (got - exp).abs();
    diff <= atol + rtol * exp.abs()
}

fn assert_close(got: f64, exp: f64, what: &str) {
    assert!(
        close(got, exp, 1e-9, 1e-9),
        "{what}: got {got}, expected {exp} (diff {})",
        (got - exp).abs()
    );
}

fn arr(v: &Value) -> Vec<f64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_f64().unwrap())
        .collect()
}

/// Map a fixture preset descriptor onto this port's preset registry.
fn preset_from(d: &serde_json::Map<String, Value>) -> helix_noise::ScaleFn {
    let name = d["$preset"].as_str().unwrap();
    let a: Vec<f64> = d["args"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    match name {
        "shellPeak" => shell_peak(a[0], *a.get(1).unwrap_or(&1.0)),
        "rolloff" => rolloff(a[0]),
        "condensate" => condensate(a[0], a[1], *a.get(2).unwrap_or(&0.0)),
        other => panic!("unknown fixture preset {other}"),
    }
}

fn build_from_config(cfg: &Value) -> HelixField {
    let mut o = HelixOptions::default();
    let m = cfg.as_object().unwrap();
    if let Some(v) = m.get("modes") {
        o.modes = v.as_u64().unwrap() as usize;
    }
    if let Some(v) = m.get("slope") {
        o.slope = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("helicity").and_then(|v| v.as_f64()) {
        o.helicity = v;
    }
    if let Some(v) = m.get("coherence").and_then(|v| v.as_f64()) {
        o.coherence = v;
    }
    if let Some(v) = m.get("kmin") {
        o.kmin = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("kmax") {
        o.kmax = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("centers") {
        o.centers = v.as_i64().unwrap();
    }
    if let Some(v) = m.get("amplitude") {
        o.amplitude = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("tileable") {
        o.tileable = v.as_bool().unwrap();
    }
    if let Some(v) = m.get("seed") {
        o.seed = v.as_u64().unwrap() as u32;
    }
    // Callable options travel in the fixture as {"$preset": name, "args": [...]} descriptors.
    if let Some(v) = m.get("coherence").and_then(|v| v.as_object()) {
        o.coherence_fn = Some(preset_from(v));
    }
    if let Some(v) = m.get("helicity").and_then(|v| v.as_object()) {
        o.helicity_fn = Some(preset_from(v));
    }
    if let Some(v) = m.get("spectrum").and_then(|v| v.as_object()) {
        o.spectrum = Some(preset_from(v));
    }
    if let Some(v) = m.get("polarizationAxis").and_then(|v| v.as_array()) {
        o.polarization_axis = Some([
            v[0].as_f64().unwrap(),
            v[1].as_f64().unwrap(),
            v[2].as_f64().unwrap(),
        ]);
    }
    if let Some(v) = m.get("polarizationBias") {
        o.polarization_bias = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("ellipticity") {
        o.ellipticity = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("layout") {
        o.layout = Layout::from_str_opt(v.as_str().unwrap()).unwrap();
    }
    if let Some(v) = m.get("churn") {
        o.churn = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("decay") {
        o.decay = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("anisotropy") {
        o.anisotropy = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("axis") {
        let a = arr(v);
        o.axis = [a[0], a[1], a[2]];
    }
    HelixField::new(o)
}

/// Compare one baked mode array against the field's live arrays via a getter closure.
fn check_mode_array(name: &str, modes: &Value, key: &str, got: &[f64]) {
    let exp = arr(&modes[key]);
    assert_eq!(exp.len(), got.len(), "{name}.{key} length");
    for (j, (&g, &e)) in got.iter().zip(exp.iter()).enumerate() {
        assert_close(g, e, &format!("{name}.{key}[{j}]"));
    }
}

#[test]
fn spectral_configs_match_fixture() {
    let root: Value = serde_json::from_str(FIXTURE).unwrap();
    for name in [
        "A_default_small",
        "B_helical_coherent",
        "C_random_aniso",
        "D_decay_time",
        "E_tileable",
        "J_elliptic_linear",
        "K_elliptic_half",
        "M_coherence_k",
        "N_helicity_k",
        "O_shellpeak",
        "Q_grain",
    ] {
        let entry = &root[name];
        let f = build_from_config(&entry["config"]);
        check_field_against(name, &f, entry);
    }
}

/// Mode arrays, samples, relative helicity and the bake checksum of one spectral config.
fn check_field_against(name: &str, f: &HelixField, entry: &Value) {
    {
        let modes = &entry["modes"];

        assert_eq!(f.modes(), modes["N"].as_u64().unwrap() as usize, "{name} N");

        // Reconstruct each per-mode array from public sampling is not possible directly, so we
        // pull them from the GLSL-independent accessors below. Since fields are crate-private,
        // we compare the mode arrays via a debug snapshot exposed for tests.
        let snap = f.mode_snapshot();
        check_mode_array(name, modes, "kx", &snap.kx);
        check_mode_array(name, modes, "ky", &snap.ky);
        check_mode_array(name, modes, "kz", &snap.kz);
        check_mode_array(name, modes, "km", &snap.km);
        check_mode_array(name, modes, "e1x", &snap.e1x);
        check_mode_array(name, modes, "e1y", &snap.e1y);
        check_mode_array(name, modes, "e1z", &snap.e1z);
        check_mode_array(name, modes, "e2x", &snap.e2x);
        check_mode_array(name, modes, "e2y", &snap.e2y);
        check_mode_array(name, modes, "e2z", &snap.e2z);
        check_mode_array(name, modes, "s", &snap.s);
        check_mode_array(name, modes, "chi", &snap.chi);
        check_mode_array(name, modes, "a", &snap.a);
        check_mode_array(name, modes, "ph", &snap.ph);
        check_mode_array(name, modes, "om", &snap.om);
        assert_close(snap.scale, modes["scale"].as_f64().unwrap(), &format!("{name}.scale"));
        assert_close(snap.nu, modes["nu"].as_f64().unwrap(), &format!("{name}.nu"));

        // Samples: u / w / A.
        for (si, s) in entry["samples"].as_array().unwrap().iter().enumerate() {
            let x = s["x"].as_f64().unwrap();
            let y = s["y"].as_f64().unwrap();
            let z = s["z"].as_f64().unwrap();
            let t = s["t"].as_f64().unwrap();
            let (u, w) = f.sample_uw(x, y, z, t);
            let (_, a) = f.sample_ua(x, y, z, t);
            let eu = arr(&s["u"]);
            let ew = arr(&s["w"]);
            let ea = arr(&s["A"]);
            for c in 0..3 {
                assert_close(u[c], eu[c], &format!("{name}.sample[{si}].u[{c}]"));
                assert_close(w[c], ew[c], &format!("{name}.sample[{si}].w[{c}]"));
                assert_close(a[c], ea[c], &format!("{name}.sample[{si}].A[{c}]"));
            }
        }

        // Relative helicity (fixture uses ng = 8).
        let rh = f.relative_helicity(8);
        assert_close(rh, entry["relativeHelicity"].as_f64().unwrap(), &format!("{name}.relativeHelicity"));

        // Bake sum: sum of all bake3D(4, 0) floats (f32 accumulation -> looser tol).
        let bake = f.bake3d(4, 0.0);
        let sum: f64 = bake.iter().map(|&x| x as f64).sum();
        let exp_sum = entry["bake3d4_sum"].as_f64().unwrap();
        assert!(
            close(sum, exp_sum, 1e-7, 1e-7),
            "{name}.bake3d4_sum: got {sum}, expected {exp_sum}"
        );
    }
}

#[test]
fn boundary_matches_fixture() {
    check_boundary("boundary_F");
}

/// Same wrapper on elliptic modes: the analytic potential stays exact for every chi.
#[test]
fn boundary_elliptic_matches_fixture() {
    check_boundary("boundary_L_elliptic");
}

fn check_boundary(label: &str) {
    let root: Value = serde_json::from_str(FIXTURE).unwrap();
    let entry = &root[label];
    let base = build_from_config(&entry["base_config"]);
    let thickness = entry["thickness"].as_f64().unwrap();
    let fd_step = entry["fdStep"].as_f64().unwrap();

    // sphere SDF centered at (3,3,3), radius 1.2 — no analytic gradient (central-diff path).
    let bounded = base.with_boundary(
        |x: f64, y: f64, z: f64| ((x - 3.0).powi(2) + (y - 3.0).powi(2) + (z - 3.0).powi(2)).sqrt() - 1.2,
        BoundaryOptions { thickness, fd_step, gradient: None },
    );

    for (si, s) in entry["samples"].as_array().unwrap().iter().enumerate() {
        let x = s["x"].as_f64().unwrap();
        let y = s["y"].as_f64().unwrap();
        let z = s["z"].as_f64().unwrap();
        let (u, w) = bounded.sample_uw(x, y, z, 0.0);
        let pot = bounded.potential(x, y, z, 0.0);
        let eu = arr(&s["u"]);
        let ew = arr(&s["w"]);
        let ep = arr(&s["pot"]);
        for c in 0..3 {
            assert_close(u[c], eu[c], &format!("{label}.sample[{si}].u[{c}]"));
            assert_close(w[c], ew[c], &format!("{label}.sample[{si}].w[{c}]"));
            assert_close(pot[c], ep[c], &format!("{label}.sample[{si}].pot[{c}]"));
        }
    }
}

fn build_atoms_from_config(cfg: &Value) -> HelixAtoms {
    let mut o = AtomOptions::default();
    let m = cfg.as_object().unwrap();
    if let Some(v) = m.get("octaves") {
        o.octaves = v.as_u64().unwrap() as usize;
    }
    if let Some(v) = m.get("atomsPerCell") {
        o.atoms_per_cell = v.as_u64().unwrap() as usize;
    }
    if let Some(v) = m.get("radius") {
        o.radius = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("cyclesPerAtom") {
        o.cycles_per_atom = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("slope") {
        o.slope = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("helicity").and_then(|v| v.as_f64()) {
        o.helicity = v;
    }
    if let Some(v) = m.get("amplitude") {
        o.amplitude = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("seed") {
        o.seed = v.as_u64().unwrap() as u32;
    }
    if let Some(v) = m.get("churn") {
        o.churn = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("anisotropy") {
        o.anisotropy = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("axis") {
        let a = arr(v);
        o.axis = [a[0], a[1], a[2]];
    }
    HelixAtoms::new(o)
}

#[test]
fn atom_configs_match_fixture() {
    let root: Value = serde_json::from_str(FIXTURE).unwrap();
    for name in ["G_atoms_default", "H_atoms_helical", "I_atoms_aniso"] {
        let entry = &root[name];
        let f = build_atoms_from_config(&entry["config"]);

        // Derived constants: the RMS-normalization scale and the octave-0 base wavenumber.
        assert_close(f.scale(), entry["scale"].as_f64().unwrap(), &format!("{name}.scale"));
        assert_close(f.k_base(), entry["kBase"].as_f64().unwrap(), &format!("{name}.kBase"));

        // Samples: u / w (analytic vorticity) / A (analytic potential).
        for (si, s) in entry["samples"].as_array().unwrap().iter().enumerate() {
            let x = s["x"].as_f64().unwrap();
            let y = s["y"].as_f64().unwrap();
            let z = s["z"].as_f64().unwrap();
            let t = s["t"].as_f64().unwrap();
            let (u, w) = f.sample_uw(x, y, z, t);
            let (_, a) = f.sample_ua(x, y, z, t);
            let eu = arr(&s["u"]);
            let ew = arr(&s["w"]);
            let ea = arr(&s["A"]);
            for c in 0..3 {
                assert_close(u[c], eu[c], &format!("{name}.sample[{si}].u[{c}]"));
                assert_close(w[c], ew[c], &format!("{name}.sample[{si}].w[{c}]"));
                assert_close(a[c], ea[c], &format!("{name}.sample[{si}].A[{c}]"));
            }
        }

        // Relative helicity (fixture uses ng = 8).
        let rh = f.relative_helicity(8);
        assert_close(rh, entry["relativeHelicity"].as_f64().unwrap(), &format!("{name}.relativeHelicity"));

        // Bake sum: sum of all bake3D(4, 0) floats (f32 accumulation -> looser tol).
        let bake = f.bake3d(4, 0.0);
        let sum: f64 = bake.iter().map(|&x| x as f64).sum();
        let exp_sum = entry["bake3d4_sum"].as_f64().unwrap();
        assert!(
            close(sum, exp_sum, 1e-7, 1e-7),
            "{name}.bake3d4_sum: got {sum}, expected {exp_sum}"
        );
    }
}

#[test]
fn atoms_accept_boundary() {
    // The generalized boundary wraps the atom engine too: zero inside the obstacle, exactly the
    // base field far outside the influence band.
    let f = HelixAtoms::new(AtomOptions { seed: 3, ..Default::default() });
    let sphere = |x: f64, y: f64, z: f64| {
        ((x - 3.0).powi(2) + (y - 3.0).powi(2) + (z - 3.0).powi(2)).sqrt() - 1.2
    };
    let bounded = f.with_boundary(sphere, BoundaryOptions { thickness: 0.9, ..Default::default() });

    let inside = bounded.sample(3.0, 3.0, 3.0, 0.0);
    assert_eq!(inside, [0.0, 0.0, 0.0], "atom flow must vanish inside the obstacle");

    let far = (10.0, 10.0, 10.0);
    let ub = bounded.sample(far.0, far.1, far.2, 0.0);
    let uf = f.sample(far.0, far.1, far.2);
    for c in 0..3 {
        assert_close(ub[c], uf[c], &format!("bounded atom far-field[{c}]"));
    }
}

/// Extract every float literal from a GLSL string, in order.
fn glsl_floats(src: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let bytes = src.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        let start_of_number = (c.is_ascii_digit()
            || (c == '-' && i + 1 < bytes.len() && (bytes[i + 1] as char).is_ascii_digit())
            || (c == '.' && i + 1 < bytes.len() && (bytes[i + 1] as char).is_ascii_digit()))
            && (i == 0 || !prev_is_ident(bytes[i - 1] as char));
        if start_of_number {
            let s = i;
            if bytes[i] as char == '-' {
                i += 1;
            }
            while i < bytes.len() {
                let ch = bytes[i] as char;
                if ch.is_ascii_digit() || ch == '.' {
                    i += 1;
                } else if (ch == 'e' || ch == 'E')
                    && i + 1 < bytes.len()
                    && ((bytes[i + 1] as char).is_ascii_digit()
                        || bytes[i + 1] as char == '+'
                        || bytes[i + 1] as char == '-')
                {
                    i += 2;
                } else {
                    break;
                }
            }
            let tok = &src[s..i];
            if let Ok(v) = tok.parse::<f64>() {
                out.push(v);
            }
        } else {
            i += 1;
        }
    }
    out
}

/// True if `c` is an identifier char (so a number preceded by it is really part of a name).
fn prev_is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

#[test]
fn glsl_config_a_matches_reference() {
    let root: Value = serde_json::from_str(FIXTURE).unwrap();
    let f = build_from_config(&root["A_default_small"]["config"]);
    // Reference GLSL includes the Pot function, so enable it.
    let src = f.glsl(&GlslOptions { potential: true, ..Default::default() });

    let got = glsl_floats(&src);
    let exp = glsl_floats(REF_GLSL_A);
    assert_eq!(got.len(), exp.len(), "GLSL float count differs\n--- got ---\n{src}");
    for (i, (&g, &e)) in got.iter().zip(exp.iter()).enumerate() {
        assert!(
            close(g, e, 1e-6, 1e-6),
            "GLSL float #{i}: got {g}, expected {e}"
        );
    }
}

/// The general-chi curl/potential bodies (ellipticity != 1) match the JS emitter.
#[test]
fn glsl_config_k_elliptic_matches_reference() {
    let root: Value = serde_json::from_str(FIXTURE).unwrap();
    let f = build_from_config(&root["K_elliptic_half"]["config"]);
    let src = f.glsl(&GlslOptions { potential: true, ..Default::default() });
    assert!(src.contains("tw / length"), "elliptic potential must use A = w/k^2");
    let got = glsl_floats(&src);
    let exp = glsl_floats(REF_GLSL_K);
    assert_eq!(got.len(), exp.len(), "GLSL float count differs\n--- got ---\n{src}");
    for (i, (&g, &e)) in got.iter().zip(exp.iter()).enumerate() {
        assert!(close(g, e, 1e-6, 1e-6), "GLSL float #{i}: got {g}, expected {e}");
    }
}

/// The closed-form abc() field (spec §10.2) matches the reference mode-for-mode.
#[test]
fn abc_factory_matches_fixture() {
    let root: Value = serde_json::from_str(FIXTURE).unwrap();
    let entry = &root["P_abc"];
    let a = entry["factory"]["args"].as_array().unwrap();
    let f = abc(
        a[0].as_f64().unwrap(),
        a[1].as_f64().unwrap(),
        a[2].as_f64().unwrap(),
        AbcOptions::default(),
    );
    check_field_against("P_abc", &f, entry);
}

/// The grain-axis (general) curl/potential bodies match the JS emitter.
#[test]
fn glsl_config_q_grain_matches_reference() {
    let root: Value = serde_json::from_str(FIXTURE).unwrap();
    let f = build_from_config(&root["Q_grain"]["config"]);
    let src = f.glsl(&GlslOptions { potential: true, ..Default::default() });
    assert!(src.contains("cross("), "grain-axis curl must use the cross-product body");
    let got = glsl_floats(&src);
    let exp = glsl_floats(REF_GLSL_Q);
    assert_eq!(got.len(), exp.len(), "GLSL float count differs\n--- got ---\n{src}");
    for (i, (&g, &e)) in got.iter().zip(exp.iter()).enumerate() {
        assert!(close(g, e, 1e-6, 1e-6), "GLSL float #{i}: got {g}, expected {e}");
    }
}

/// exact_ns(): a single-shell Beltrami field with the exact Stokes decay.
#[test]
fn exact_ns_is_beltrami_and_decays_exactly() {
    let (k0, nu) = (2.0, 0.05);
    let f = HelixField::create(HelixOptions {
        seed: 7,
        modes: 24,
        ..exact_ns(ExactNsOptions { k0, nu, sign: 1.0 })
    });
    let snap = f.mode_snapshot();
    for j in 0..snap.n {
        assert!((snap.km[j] - k0).abs() < 1e-12, "mode {j} sits on the single shell");
        assert_eq!(snap.s[j], 1.0, "mode {j} takes the requested chirality");
        assert_eq!(snap.om[j], 0.0, "no churn");
    }
    for &t in &[0.0, 1.7] {
        let (u, w) = f.sample_uw(1.0, 2.0, 3.0, t);
        for c in 0..3 {
            assert!((w[c] - k0 * u[c]).abs() < 1e-12, "curl u = k0*u at t={t}");
        }
    }
    let t = 2.5;
    let d = (-nu * k0 * k0 * t).exp();
    let u0 = f.sample_uw(1.0, 2.0, 3.0, 0.0).0;
    let ut = f.sample_uw(1.0, 2.0, 3.0, t).0;
    for c in 0..3 {
        assert!((ut[c] - d * u0[c]).abs() < 1e-12, "u(t) = e^(-nu k0^2 t) u(0)");
    }
    assert!((f.relative_helicity_spectral(0.0) - 1.0).abs() < 1e-12, "rho = +1");
    assert!((f.relative_helicity_spectral(t) - 1.0).abs() < 1e-12, "conserved under decay");
}

/// The NS bundles invert the measured polarization exactly.
#[test]
fn ns_bundles_match_measured_polarization() {
    for (o, t) in [(ns_developed(), &NS_TARGETS_DEV), (ns_forced(), &NS_TARGETS_FORCED)] {
        let e = o.ellipticity;
        let p_mode = 2.0 * e / (1.0 + e * e);
        assert!((p_mode - t.abs_p).abs() < 1e-12, "per-mode |p| = {p_mode}, want {}", t.abs_p);
        assert!((o.helicity * t.abs_p - t.signed_p).abs() < 1e-12, "signed mean");
    }
}

/// One mode's spectral helicity is exactly 2*chi/(1+chi^2).
#[test]
fn spectral_helicity_matches_the_closed_form() {
    for &eps in &[0.0, 0.3, 0.5, 1.0] {
        let f = HelixField::create(HelixOptions {
            modes: 1, seed: 3, tileable: true, kmin: 2.0, kmax: 2.0,
            helicity: 1.0, ellipticity: eps, ..Default::default()
        });
        let chi = f.mode_snapshot().chi[0];
        let want = 2.0 * chi / (1.0 + chi * chi);
        assert!((f.relative_helicity_spectral(0.0) - want).abs() < 1e-12, "eps={eps}");
    }
}
