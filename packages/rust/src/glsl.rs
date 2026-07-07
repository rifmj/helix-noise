//! GLSL / shader emitter.
//!
//! Bakes the computed mode arrays as GLSL constants and emits a self-contained function that
//! evaluates the exact same field on the GPU (GLSL ES 3.00 / WebGL2). It does not regenerate
//! the RNG in the shader.

use crate::field::HelixField;

/// Options for [`HelixField::glsl`](crate::HelixField::glsl).
#[derive(Clone, Debug)]
pub struct GlslOptions {
    /// Base function name. Sanitized to `[A-Za-z0-9_]`. Defaults to `helixNoise`.
    pub name: String,
    /// Significant digits for baked float literals. Defaults to 7.
    pub precision: usize,
    /// Also emit the `<name>Curl` (vorticity) pair. Defaults to `true`.
    pub curl: bool,
    /// Also emit the `<name>Pot` (vector potential) pair. Defaults to `false`.
    pub potential: bool,
}

impl Default for GlslOptions {
    fn default() -> Self {
        GlslOptions {
            name: "helixNoise".to_string(),
            precision: 7,
            curl: true,
            potential: false,
        }
    }
}

/// Format a finite `f64` exactly like JavaScript `Number(x).toPrecision(p)`.
fn to_precision(x: f64, p: usize) -> String {
    let p = p.max(1);
    if x == 0.0 {
        // JS: (0).toPrecision(p) -> "0" for p==1, else "0.000..." with p-1 trailing zeros.
        if p == 1 {
            return "0".to_string();
        }
        let mut s = String::from("0.");
        for _ in 0..(p - 1) {
            s.push('0');
        }
        return s;
    }

    let neg = x < 0.0;
    let ax = x.abs();

    // Normalized scientific form with p significant digits: "d.ddde±EE".
    let sci = format!("{:.*e}", p - 1, ax);
    // Split mantissa / exponent.
    let (mant, exp_str) = sci.split_once('e').expect("scientific notation");
    let e: i32 = exp_str.parse().expect("exponent");
    // Digits without the decimal point (exactly p significant digits).
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    debug_assert_eq!(digits.len(), p);

    // ECMAScript ToPrecision notation selection: exponential if e < -6 or e >= p.
    let body = if e < -6 || e >= p as i32 {
        // Exponential: d.ddde±E  (mantissa always shows all p digits).
        let mut m = String::new();
        m.push(digits.as_bytes()[0] as char);
        if p > 1 {
            m.push('.');
            m.push_str(&digits[1..]);
        }
        let sign = if e >= 0 { '+' } else { '-' };
        format!("{m}e{sign}{}", e.abs())
    } else if e >= 0 {
        // Fixed, magnitude >= 1: e+1 digits before the point.
        let int_len = (e + 1) as usize;
        if int_len >= p {
            // All significant digits are integral; pad with zeros to reach the point.
            let mut s = String::from(&digits);
            for _ in 0..(int_len - p) {
                s.push('0');
            }
            s
        } else {
            let mut s = String::from(&digits[..int_len]);
            s.push('.');
            s.push_str(&digits[int_len..]);
            s
        }
    } else {
        // Fixed, magnitude < 1: "0.00...digits" with -(e+1) leading zeros after the point.
        let lead = (-e - 1) as usize;
        let mut s = String::from("0.");
        for _ in 0..lead {
            s.push('0');
        }
        s.push_str(&digits);
        s
    };

    if neg {
        format!("-{body}")
    } else {
        body
    }
}

/// GLSL float literal (always contains `.` or `e`/`E`).
fn fl(x: f64, pr: usize) -> String {
    let s = to_precision(x, pr);
    if s.contains(['.', 'e', 'E']) {
        s
    } else {
        format!("{s}.0")
    }
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect()
}

/// Emit self-contained GLSL for the field `f`.
pub fn to_glsl(f: &HelixField, opts: &GlslOptions) -> String {
    let name = sanitize(&opts.name);
    let pr = opts.precision;
    let curl = opts.curl;
    let pot = opts.potential;
    let n = f.n;
    let pfx = format!("{name}_");
    let decay = f.nu > 0.0;

    let v3 = |ax: &[f64], ay: &[f64], az: &[f64]| -> String {
        let mut parts: Vec<String> = Vec::with_capacity(n);
        for j in 0..n {
            parts.push(format!(
                "vec3({},{},{})",
                fl(ax[j], pr),
                fl(ay[j], pr),
                fl(az[j], pr)
            ));
        }
        format!("vec3[{n}]({})", parts.join(","))
    };
    let fa = |arr: &[f64]| -> String {
        let mut parts: Vec<String> = Vec::with_capacity(n);
        for j in 0..n {
            parts.push(fl(arr[j], pr));
        }
        format!("float[{n}]({})", parts.join(","))
    };

    let amp = if decay {
        format!(
            "{pfx}A[j] * exp(-{pfx}NU * dot({pfx}K[j], {pfx}K[j]) * t)"
        )
    } else {
        format!("{pfx}A[j]")
    };

    let mut l: Vec<String> = Vec::new();
    l.push(
        "// Helix Noise — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field."
            .to_string(),
    );
    l.push(format!(
        "// {n} modes. Defines vec3 {name}(vec3 p) / (vec3 p, float t){}",
        if curl {
            format!(" and vec3 {name}Curl — same pair.")
        } else {
            ".".to_string()
        }
    ));
    l.push(format!("const int {pfx}N = {n};"));
    l.push(format!(
        "const vec3 {pfx}K[{n}] = {};",
        v3(&f.kx, &f.ky, &f.kz)
    ));
    l.push(format!(
        "const vec3 {pfx}E1[{n}] = {};",
        v3(&f.e1x, &f.e1y, &f.e1z)
    ));
    l.push(format!(
        "const vec3 {pfx}E2[{n}] = {};",
        v3(&f.e2x, &f.e2y, &f.e2z)
    ));
    l.push(format!("const float {pfx}S[{n}] = {};", fa(&f.s)));
    l.push(format!("const float {pfx}A[{n}] = {};", fa(&f.a)));
    l.push(format!("const float {pfx}PH[{n}] = {};", fa(&f.ph)));
    l.push(format!("const float {pfx}OM[{n}] = {};", fa(&f.om)));
    l.push(format!("const float {pfx}SCALE = {};", fl(f.scale, pr)));
    if decay {
        l.push(format!("const float {pfx}NU = {};", fl(f.nu, pr)));
    }
    l.push(String::new());
    l.push(format!("vec3 {name}(vec3 p, float t) {{"));
    l.push("  vec3 u = vec3(0.0);".to_string());
    l.push(format!("  for (int j = 0; j < {pfx}N; j++) {{"));
    l.push(format!(
        "    float phi = dot({pfx}K[j], p) + {pfx}PH[j] + {pfx}OM[j] * t;"
    ));
    l.push(format!(
        "    u += ({amp}) * (cos(phi) * {pfx}E1[j] - {pfx}S[j] * sin(phi) * {pfx}E2[j]);"
    ));
    l.push("  }".to_string());
    l.push(format!("  return u * {pfx}SCALE;"));
    l.push("}".to_string());
    l.push(format!("vec3 {name}(vec3 p) {{ return {name}(p, 0.0); }}"));

    if curl {
        l.push(String::new());
        l.push(format!("vec3 {name}Curl(vec3 p, float t) {{"));
        l.push("  vec3 w = vec3(0.0);".to_string());
        l.push(format!("  for (int j = 0; j < {pfx}N; j++) {{"));
        l.push(format!(
            "    float phi = dot({pfx}K[j], p) + {pfx}PH[j] + {pfx}OM[j] * t;"
        ));
        l.push(format!(
            "    vec3 tv = ({amp}) * (cos(phi) * {pfx}E1[j] - {pfx}S[j] * sin(phi) * {pfx}E2[j]);"
        ));
        l.push(format!("    w += {pfx}S[j] * length({pfx}K[j]) * tv;"));
        l.push("  }".to_string());
        l.push(format!("  return w * {pfx}SCALE;"));
        l.push("}".to_string());
        l.push(format!(
            "vec3 {name}Curl(vec3 p) {{ return {name}Curl(p, 0.0); }}"
        ));
    }
    if pot {
        l.push(String::new());
        l.push(format!("vec3 {name}Pot(vec3 p, float t) {{"));
        l.push("  vec3 A = vec3(0.0);".to_string());
        l.push(format!("  for (int j = 0; j < {pfx}N; j++) {{"));
        l.push(format!(
            "    float phi = dot({pfx}K[j], p) + {pfx}PH[j] + {pfx}OM[j] * t;"
        ));
        l.push(format!(
            "    vec3 tv = ({amp}) * (cos(phi) * {pfx}E1[j] - {pfx}S[j] * sin(phi) * {pfx}E2[j]);"
        ));
        l.push(format!("    A += ({pfx}S[j] / length({pfx}K[j])) * tv;"));
        l.push("  }".to_string());
        l.push(format!("  return A * {pfx}SCALE;"));
        l.push("}".to_string());
        l.push(format!(
            "vec3 {name}Pot(vec3 p) {{ return {name}Pot(p, 0.0); }}"
        ));
    }
    l.join("\n")
}

#[cfg(test)]
mod tests {
    use super::to_precision;

    #[test]
    fn precision_matches_js() {
        assert_eq!(to_precision(3.0812074604625157, 7), "3.081207");
        assert_eq!(to_precision(-0.2202505, 7), "-0.2202505");
        assert_eq!(to_precision(0.0, 7), "0.000000");
        assert_eq!(to_precision(1.0, 7), "1.000000");
        assert_eq!(to_precision(-1.0, 7), "-1.000000");
        assert_eq!(to_precision(0.006179634, 7), "0.006179634");
        assert_eq!(to_precision(1.0064280688992224, 7), "1.006428");
        assert_eq!(to_precision(1e-7, 7), "1.000000e-7");
        assert_eq!(to_precision(1234567.89, 7), "1234568");
        assert_eq!(to_precision(0.0000123456, 7), "0.00001234560");
        assert_eq!(to_precision(1e20, 7), "1.000000e+20");
        assert_eq!(to_precision(123456700000.0, 7), "1.234567e+11");
    }
}
