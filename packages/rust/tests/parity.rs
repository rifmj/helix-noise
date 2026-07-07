//! Numerical-parity tests against the JS reference fixture.
//!
//! Rebuilds every fixture config, then asserts the full mode arrays, sample outputs (u/w/A),
//! relative helicity, and bake sums match the reference within tolerance. Also checks that the
//! GLSL emitter for config A reproduces the reference shader's float constants.

use helix_noise::{BoundaryOptions, GlslOptions, HelixField, HelixOptions, Layout};
use serde_json::Value;

const FIXTURE: &str = include_str!("parity_fixture.json");
const REF_GLSL_A: &str = include_str!("ref_glsl_A.glsl");

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

fn build_from_config(cfg: &Value) -> HelixField {
    let mut o = HelixOptions::default();
    let m = cfg.as_object().unwrap();
    if let Some(v) = m.get("modes") {
        o.modes = v.as_u64().unwrap() as usize;
    }
    if let Some(v) = m.get("slope") {
        o.slope = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("helicity") {
        o.helicity = v.as_f64().unwrap();
    }
    if let Some(v) = m.get("coherence") {
        o.coherence = v.as_f64().unwrap();
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
    for name in ["A_default_small", "B_helical_coherent", "C_random_aniso", "D_decay_time", "E_tileable"] {
        let entry = &root[name];
        let f = build_from_config(&entry["config"]);
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
    let root: Value = serde_json::from_str(FIXTURE).unwrap();
    let entry = &root["boundary_F"];
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
            assert_close(u[c], eu[c], &format!("boundary_F.sample[{si}].u[{c}]"));
            assert_close(w[c], ew[c], &format!("boundary_F.sample[{si}].w[{c}]"));
            assert_close(pot[c], ep[c], &format!("boundary_F.sample[{si}].pot[{c}]"));
        }
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
