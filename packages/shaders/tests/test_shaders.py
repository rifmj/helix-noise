#!/usr/bin/env python3
"""Tests for the Helix Noise shader generator (stdlib only).

1. GLSL parity: generate.py for configs A and D must equal the reference GLSL by
   parsed floats (tol 1e-6) AND identical non-numeric structure.
2. Structural checks for hlsl / wgsl / godot targets (signatures present, braces
   and parens balanced, constant-array counts match N).
3. Numeric self-check: parse the constants generate.py emits for config A, evaluate
   the field formula in pure Python at the fixture's sample points, and assert it
   matches parity_fixture.json A samples within 1e-6 (proves the shader math is
   correct without a GPU).
"""

import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEN = os.path.join(ROOT, "generate.py")
FIXTURE = os.path.join(HERE, "parity_fixture.json")
REF_A = os.path.join(HERE, "ref_glsl_A.glsl")
REF_D = os.path.join(HERE, "ref_glsl_D_decay.glsl")

FLOAT_RE = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")


def run_gen(args):
    out = subprocess.run(
        [sys.executable, GEN] + args,
        capture_output=True, text=True, check=True,
    )
    return out.stdout


def parse_floats(text):
    """Extract every numeric literal, ignoring array-size brackets like [8]."""
    # Remove bracketed integer sizes so vec3[8](...) doesn't leak the 8.
    cleaned = re.sub(r"\[\d+\]", "[]", text)
    return [float(m) for m in FLOAT_RE.findall(cleaned)]


def strip_floats(text):
    """Replace every float literal with a placeholder to compare structure only."""
    cleaned = re.sub(r"\[\d+\]", "[N]", text)
    return FLOAT_RE.sub("#", cleaned)


def assert_close(a, b, tol, ctx):
    if abs(a - b) > tol + tol * max(abs(a), abs(b)):
        raise AssertionError("%s: %r vs %r (|d|=%g > tol %g)" % (ctx, a, b, abs(a - b), tol))


# ---------------------------------------------------------------------------
# 1. GLSL parity vs reference files
# ---------------------------------------------------------------------------
def test_glsl_parity():
    cases = [
        (["--target", "glsl", "--modes", "8", "--seed", "1", "--potential"], REF_A, "A"),
        (["--target", "glsl", "--modes", "6", "--seed", "3", "--decay", "0.02",
          "--churn", "1.0"], REF_D, "D"),
    ]
    for args, ref_path, label in cases:
        gen = run_gen(args)
        with open(ref_path) as fh:
            ref = fh.read()

        gf = parse_floats(gen)
        rf = parse_floats(ref)
        assert len(gf) == len(rf), (
            "config %s: float count %d != ref %d" % (label, len(gf), len(rf))
        )
        for i, (a, b) in enumerate(zip(gf, rf)):
            assert_close(a, b, 1e-6, "config %s float #%d" % (label, i))

        # Structure (everything except the numeric literals) must match, ignoring
        # trailing whitespace / newline differences.
        gs = "\n".join(line.rstrip() for line in strip_floats(gen).splitlines() if line.strip() or True)
        rs = "\n".join(line.rstrip() for line in strip_floats(ref).splitlines() if line.strip() or True)
        assert gs.strip() == rs.strip(), "config %s: non-numeric structure differs" % label
        print("  [ok] GLSL config %s: %d floats within 1e-6, structure identical" % (label, len(gf)))


# ---------------------------------------------------------------------------
# 2. Structural checks for hlsl / wgsl / godot
# ---------------------------------------------------------------------------
def _balanced(text):
    pairs = {")": "(", "}": "{"}
    openers = set(pairs.values())
    stack = []
    for ch in text:
        if ch in openers:
            stack.append(ch)
        elif ch in pairs:
            if not stack or stack[-1] != pairs[ch]:
                return False
            stack.pop()
    return not stack


def _count_array_elems(block, elem_prefix):
    """Count occurrences of elem_prefix( inside a constant declaration block."""
    return block.count(elem_prefix)


def test_structural_targets():
    N = 8
    specs = {
        "hlsl": {
            "sig": [r"float3\s+helixNoise\s*\(\s*float3\s+p\s*,\s*float\s+t\s*\)",
                    r"float3\s+helixNoise\s*\(\s*float3\s+p\s*\)",
                    r"float3\s+helixNoiseCurl\s*\(",
                    r"float3\s+helixNoisePot\s*\("],
            "vec_ctor": "float3(",
            "k_decl": r"static const float3 helixNoise_K\[8\] = \{([^;]*)\};",
        },
        "wgsl": {
            "sig": [r"fn\s+helixNoise\s*\(\s*p:\s*vec3f\s*,\s*t:\s*f32\s*\)\s*->\s*vec3f",
                    r"fn\s+helixNoise0\s*\(\s*p:\s*vec3f\s*\)\s*->\s*vec3f",
                    r"fn\s+helixNoiseCurl\s*\(",
                    r"fn\s+helixNoisePot\s*\("],
            "vec_ctor": "vec3f(",
            "k_decl": r"const helixNoise_K = array<vec3f, 8>\(([^;]*)\);",
        },
        "godot": {
            "sig": [r"vec3\s+helixNoise\s*\(\s*vec3\s+p\s*,\s*float\s+t\s*\)",
                    r"vec3\s+helixNoise\s*\(\s*vec3\s+p\s*\)",
                    r"vec3\s+helixNoiseCurl\s*\(",
                    r"vec3\s+helixNoisePot\s*\("],
            "vec_ctor": "vec3(",
            "k_decl": r"const vec3\[8\] helixNoise_K = \{([^;]*)\};",
        },
    }
    for target, spec in specs.items():
        out = run_gen(["--target", target, "--modes", str(N), "--seed", "1", "--potential"])
        for pat in spec["sig"]:
            assert re.search(pat, out), "%s: missing signature /%s/" % (target, pat)
        assert _balanced(out), "%s: unbalanced braces/parens" % target
        m = re.search(spec["k_decl"], out)
        assert m, "%s: could not locate K constant declaration" % target
        count = _count_array_elems(m.group(1), spec["vec_ctor"])
        assert count == N, "%s: K array has %d elems, expected %d" % (target, count, N)
        print("  [ok] %s: signatures present, balanced, K has %d vec elements" % (target, N))


# ---------------------------------------------------------------------------
# 3. Numeric self-check: evaluate emitted GLSL constants in pure Python
# ---------------------------------------------------------------------------
def parse_glsl_constants(glsl):
    """Extract the baked constant arrays from emitted GLSL into python lists."""
    def vec3_array(tag):
        m = re.search(r"helixNoise_%s\[\d+\]\s*=\s*vec3\[\d+\]\((.*?)\);" % tag, glsl)
        body = m.group(1)
        vecs = re.findall(r"vec3\(([^)]*)\)", body)
        return [tuple(float(x) for x in v.split(",")) for v in vecs]

    def float_array(tag):
        m = re.search(r"helixNoise_%s\[\d+\]\s*=\s*float\[\d+\]\((.*?)\);" % tag, glsl)
        return [float(x) for x in m.group(1).split(",")]

    def scalar(tag):
        m = re.search(r"helixNoise_%s\s*=\s*([-+0-9.eE]+);" % tag, glsl)
        return float(m.group(1)) if m else None

    K = vec3_array("K")
    E1 = vec3_array("E1")
    E2 = vec3_array("E2")
    S = float_array("S")
    A = float_array("A")
    PH = float_array("PH")
    OM = float_array("OM")
    SCALE = scalar("SCALE")
    NU = scalar("NU")
    return dict(K=K, E1=E1, E2=E2, S=S, A=A, PH=PH, OM=OM, SCALE=SCALE, NU=NU)


def eval_field(consts, x, y, z, t):
    """Evaluate u, w, A_pot from baked constants — the exact shader formula."""
    K, E1, E2, S, A, PH, OM = (
        consts["K"], consts["E1"], consts["E2"], consts["S"],
        consts["A"], consts["PH"], consts["OM"],
    )
    scale = consts["SCALE"]
    nu = consts["NU"]
    u = [0.0, 0.0, 0.0]
    w = [0.0, 0.0, 0.0]
    apot = [0.0, 0.0, 0.0]
    for j in range(len(K)):
        kx, ky, kz = K[j]
        phi = kx * x + ky * y + kz * z + PH[j] + OM[j] * t
        amp = A[j]
        if nu is not None and nu > 0.0 and t != 0.0:
            amp = A[j] * math.exp(-nu * (kx * kx + ky * ky + kz * kz) * t)
        c = math.cos(phi)
        sn = math.sin(phi)
        s = S[j]
        tv = [
            amp * (c * E1[j][0] - s * sn * E2[j][0]),
            amp * (c * E1[j][1] - s * sn * E2[j][1]),
            amp * (c * E1[j][2] - s * sn * E2[j][2]),
        ]
        km = math.sqrt(kx * kx + ky * ky + kz * kz)
        for i in range(3):
            u[i] += tv[i]
            w[i] += s * km * tv[i]
            apot[i] += (s / km) * tv[i]
    return (
        [c * scale for c in u],
        [c * scale for c in w],
        [c * scale for c in apot],
    )


def test_numeric_self_check():
    with open(FIXTURE) as fh:
        fixture = json.load(fh)
    cfg = fixture["A_default_small"]["config"]
    # Emit at full double precision so the numeric self-check isolates the shader
    # FORMULA (phase, frame, helicity sign, km weighting, scale) from constant
    # rounding. The default 7-sig-fig emission is what test_glsl_parity checks
    # against the reference; here we prove the math itself to 1e-6.
    args = ["--target", "glsl", "--modes", str(cfg["modes"]),
            "--seed", str(cfg["seed"]), "--potential", "--precision", "17"]
    glsl = run_gen(args)
    consts = parse_glsl_constants(glsl)

    samples = fixture["A_default_small"]["samples"]
    n = 0
    for smp in samples:
        u, w, apot = eval_field(consts, smp["x"], smp["y"], smp["z"], smp.get("t", 0.0))
        for i in range(3):
            assert_close(u[i], smp["u"][i], 1e-6, "A sample u[%d]" % i)
            assert_close(w[i], smp["w"][i], 1e-6, "A sample w[%d]" % i)
            assert_close(apot[i], smp["A"][i], 1e-6, "A sample A[%d]" % i)
        n += 1
    print("  [ok] numeric self-check: %d sample points, u/w/A within 1e-6 (full-precision constants)" % n)


def main():
    print("test_glsl_parity")
    test_glsl_parity()
    print("test_structural_targets")
    test_structural_targets()
    print("test_numeric_self_check")
    test_numeric_self_check()
    print("\nALL TESTS PASSED")


if __name__ == "__main__":
    main()
