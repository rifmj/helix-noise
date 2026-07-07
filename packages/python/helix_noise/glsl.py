"""Emit self-contained GLSL that evaluates the same field on the GPU.

The mode arrays are baked as GLSL constants (the RNG is not regenerated in
the shader). Defines ``vec3 <name>(vec3 p)`` and ``vec3 <name>(vec3 p, float
t)`` and, by default, the same pair for ``<name>Curl``; optionally
``<name>Pot`` (vector potential).
"""

import re


def _to_precision(x, pr):
    """Replicate JavaScript ``Number(x).toPrecision(pr)``.

    Returns a string with ``pr`` significant digits, using fixed or
    exponential notation exactly as V8 does.
    """
    x = float(x)
    if x == 0.0:
        # JS: (0).toPrecision(p) -> "0.000..." with p-1 fractional zeros.
        if pr <= 1:
            return "0"
        return "0." + "0" * (pr - 1)

    import math

    e = math.floor(math.log10(abs(x)))
    # JS uses exponential when the decimal exponent < -6 or >= precision.
    if e < -6 or e >= pr:
        s = "{:.{}e}".format(x, pr - 1)
        mant, exp = s.split("e")
        if "." in mant:
            mant = mant.rstrip("0").rstrip(".")
        exp_i = int(exp)
        return "{}e{}{}".format(mant, "+" if exp_i >= 0 else "-", abs(exp_i))
    else:
        digits_after = pr - 1 - e
        if digits_after < 0:
            digits_after = 0
        s = "{:.{}f}".format(x, digits_after)
        return s


def _fl(x, pr):
    """GLSL float literal (always contains a '.' or 'e')."""
    s = _to_precision(x, pr)
    if re.search(r"[.eE]", s):
        return s
    return s + ".0"


def to_glsl(f, name="helixNoise", precision=7, curl=True, potential=False):
    name = re.sub(r"[^A-Za-z0-9_]", "_", name)
    pr = precision
    N = f.N
    P = name + "_"
    decay = f.nu > 0

    def v3(ax, ay, az):
        parts = [
            "vec3({},{},{})".format(_fl(ax[j], pr), _fl(ay[j], pr), _fl(az[j], pr))
            for j in range(N)
        ]
        return "vec3[{}]({})".format(N, ",".join(parts))

    def fa(arr):
        parts = [_fl(arr[j], pr) for j in range(N)]
        return "float[{}]({})".format(N, ",".join(parts))

    amp = (
        "{P}A[j] * exp(-{P}NU * dot({P}K[j], {P}K[j]) * t)".format(P=P)
        if decay
        else "{P}A[j]".format(P=P)
    )

    L = [
        "// Helix Noise — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.",
        "// {} modes. Defines vec3 {}(vec3 p) / (vec3 p, float t){}".format(
            N,
            name,
            " and vec3 {}Curl — same pair.".format(name) if curl else ".",
        ),
        "const int {P}N = {N};".format(P=P, N=N),
        "const vec3 {P}K[{N}] = {v};".format(P=P, N=N, v=v3(f.kx, f.ky, f.kz)),
        "const vec3 {P}E1[{N}] = {v};".format(P=P, N=N, v=v3(f.e1x, f.e1y, f.e1z)),
        "const vec3 {P}E2[{N}] = {v};".format(P=P, N=N, v=v3(f.e2x, f.e2y, f.e2z)),
        "const float {P}S[{N}] = {v};".format(P=P, N=N, v=fa(f.s)),
        "const float {P}A[{N}] = {v};".format(P=P, N=N, v=fa(f.a)),
        "const float {P}PH[{N}] = {v};".format(P=P, N=N, v=fa(f.ph)),
        "const float {P}OM[{N}] = {v};".format(P=P, N=N, v=fa(f.om)),
        "const float {P}SCALE = {v};".format(P=P, v=_fl(f._scale, pr)),
    ]
    if decay:
        L.append("const float {P}NU = {v};".format(P=P, v=_fl(f.nu, pr)))
    L += [
        "",
        "vec3 {name}(vec3 p, float t) {{".format(name=name),
        "  vec3 u = vec3(0.0);",
        "  for (int j = 0; j < {P}N; j++) {{".format(P=P),
        "    float phi = dot({P}K[j], p) + {P}PH[j] + {P}OM[j] * t;".format(P=P),
        "    u += ({amp}) * (cos(phi) * {P}E1[j] - {P}S[j] * sin(phi) * {P}E2[j]);".format(
            amp=amp, P=P
        ),
        "  }",
        "  return u * {P}SCALE;".format(P=P),
        "}",
        "vec3 {name}(vec3 p) {{ return {name}(p, 0.0); }}".format(name=name),
    ]
    if curl:
        L += [
            "",
            "vec3 {name}Curl(vec3 p, float t) {{".format(name=name),
            "  vec3 w = vec3(0.0);",
            "  for (int j = 0; j < {P}N; j++) {{".format(P=P),
            "    float phi = dot({P}K[j], p) + {P}PH[j] + {P}OM[j] * t;".format(P=P),
            "    vec3 tv = ({amp}) * (cos(phi) * {P}E1[j] - {P}S[j] * sin(phi) * {P}E2[j]);".format(
                amp=amp, P=P
            ),
            "    w += {P}S[j] * length({P}K[j]) * tv;".format(P=P),
            "  }",
            "  return w * {P}SCALE;".format(P=P),
            "}",
            "vec3 {name}Curl(vec3 p) {{ return {name}Curl(p, 0.0); }}".format(name=name),
        ]
    if potential:
        L += [
            "",
            "vec3 {name}Pot(vec3 p, float t) {{".format(name=name),
            "  vec3 A = vec3(0.0);",
            "  for (int j = 0; j < {P}N; j++) {{".format(P=P),
            "    float phi = dot({P}K[j], p) + {P}PH[j] + {P}OM[j] * t;".format(P=P),
            "    vec3 tv = ({amp}) * (cos(phi) * {P}E1[j] - {P}S[j] * sin(phi) * {P}E2[j]);".format(
                amp=amp, P=P
            ),
            "    A += ({P}S[j] / length({P}K[j])) * tv;".format(P=P),
            "  }",
            "  return A * {P}SCALE;".format(P=P),
            "}",
            "vec3 {name}Pot(vec3 p) {{ return {name}Pot(p, 0.0); }}".format(name=name),
        ]
    return "\n".join(L)
