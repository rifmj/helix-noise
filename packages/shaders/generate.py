#!/usr/bin/env python3
"""Helix Noise — shader generator.

Bakes the mode arrays of a divergence-free helical flow field into ready-to-paste
shader constants + function bodies for several shading languages (GLSL ES 3.00,
HLSL, WGSL, Godot .gdshader).

This script is SELF-CONTAINED: it embeds the RNG (mulberry32) and the field
builder, so it has no third-party dependencies (stdlib only).

Usage:
    python3 generate.py --target glsl --modes 48 --seed 1 [options]

Run with --help for the full option list.

This is a port of the JavaScript `helix-noise` library. The generated GLSL target
reproduces that library's `field.glsl()` output; the other targets emit the same
baked constants with per-language syntax.

MIT License. Author: Rifat Jumagulov.
"""

import argparse
import math
import sys
from decimal import Decimal, ROUND_HALF_UP

TAU = 2.0 * math.pi
GA = math.pi * (3.0 - math.sqrt(5.0))  # golden angle
VERSION = "1.1.0"


# ---------------------------------------------------------------------------
# RNG — mulberry32 (bit-exact 32-bit integer stream)
# ---------------------------------------------------------------------------
def mulberry32(seed):
    a = seed & 0xFFFFFFFF

    def rng():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = (a ^ (a >> 15)) & 0xFFFFFFFF
        t = (t * ((a | 1) & 0xFFFFFFFF)) & 0xFFFFFFFF
        inner = (t ^ (t >> 7)) & 0xFFFFFFFF
        inner = (inner * ((t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        t = (((t + inner) & 0xFFFFFFFF) ^ t) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return rng


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def frame(dx, dy, dz):
    """Orthonormal transverse frame (e1, e2) perpendicular to unit (dx,dy,dz)."""
    if abs(dz) < 0.9:
        rx, ry, rz = 0.0, 0.0, 1.0
    else:
        rx, ry, rz = 0.0, 1.0, 0.0
    e1x = ry * dz - rz * dy
    e1y = rz * dx - rx * dz
    e1z = rx * dy - ry * dx
    n = math.hypot(e1x, e1y, e1z) or 1.0
    e1x /= n
    e1y /= n
    e1z /= n
    e2x = dy * e1z - dz * e1y
    e2y = dz * e1x - dx * e1z
    e2z = dx * e1y - dy * e1x
    return (e1x, e1y, e1z, e2x, e2y, e2z)


def rot_from_uniforms(u1, u2, u3):
    """Shoemake uniform random rotation, row-major 3x3."""
    s1 = math.sqrt(1.0 - u1)
    s2 = math.sqrt(u1)
    qx = s1 * math.sin(TAU * u2)
    qy = s1 * math.cos(TAU * u2)
    qz = s2 * math.sin(TAU * u3)
    qw = s2 * math.cos(TAU * u3)
    xx, yy, zz = qx * qx, qy * qy, qz * qz
    xy, xz, yz = qx * qy, qx * qz, qy * qz
    wx, wy, wz = qw * qx, qw * qy, qw * qz
    return [
        1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
        2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
        2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
    ]


# ---------------------------------------------------------------------------
# Field builder — produces the baked mode arrays (matches the JS reference)
# ---------------------------------------------------------------------------
DEFAULTS = {
    "modes": 48,
    "slope": 1.6,
    "helicity": 0.0,
    "coherence": 0.0,
    "kmin": 1.0,
    "kmax": 6.2,
    "centers": 3,
    "amplitude": 1.0,
    "tileable": False,
    "seed": 1,
    "layout": "fibonacci",
    "churn": 1.0,
    "decay": 0.0,
    "anisotropy": 0.0,
    "axis": (0.0, 0.0, 1.0),
    "spectrum": None,
}


class HelixField:
    """A divergence-free helical flow field, evaluatable analytically at any point."""

    def __init__(self, **opts):
        p = dict(DEFAULTS)
        for k, v in opts.items():
            if k in DEFAULTS and v is not None:
                p[k] = v
        self.params = p
        self.N = int(p["modes"])
        self._build()

    def _build(self):
        p = self.params
        N = self.N
        rng = mulberry32((p["seed"] & 0xFFFFFFFF) or 1)
        nc = max(1, int(p["centers"]))
        cx = [0.0] * nc
        cy = [0.0] * nc
        cz = [0.0] * nc
        for m in range(nc):
            cx[m] = rng() * TAU
            cy[m] = rng() * TAU
            cz[m] = rng() * TAU
        lam = min(1.0, max(0.0, p["coherence"]))
        fib = p["layout"] != "random"
        ci = [0] * N
        gam = min(9.0, max(-0.99, p["anisotropy"]))
        ax = p["axis"]
        an = math.hypot(ax[0], ax[1], ax[2]) or 1.0
        anx, any_, anz = ax[0] / an, ax[1] / an, ax[2] / an

        rot = kms = perm = None
        if fib:
            rot = rot_from_uniforms(rng(), rng(), rng())
            kms = [0.0] * N
            for i in range(N):
                kms[i] = p["kmin"] + (p["kmax"] - p["kmin"]) * ((i + rng()) / N)
            perm = list(range(N))
            for i in range(N - 1, 0, -1):
                j = int(rng() * (i + 1))
                perm[i], perm[j] = perm[j], perm[i]

        kx = [0.0] * N
        ky = [0.0] * N
        kz = [0.0] * N
        km = [0.0] * N
        a = [0.0] * N
        s = [0.0] * N
        ph = [0.0] * N
        om = [0.0] * N
        e1x = [0.0] * N
        e1y = [0.0] * N
        e1z = [0.0] * N
        e2x = [0.0] * N
        e2y = [0.0] * N
        e2z = [0.0] * N

        for j in range(N):
            if fib:
                zf = 1.0 - (2 * j + 1) / N
                rf = math.sqrt(max(0.0, 1.0 - zf * zf))
                th = j * GA
                fx = rf * math.cos(th)
                fy = rf * math.sin(th)
                fz = zf
                R = rot
                dx = R[0] * fx + R[1] * fy + R[2] * fz
                dy = R[3] * fx + R[4] * fy + R[5] * fz
                dz = R[6] * fx + R[7] * fy + R[8] * fz
                kmj = kms[perm[j]]
            else:
                z = 2.0 * rng() - 1.0
                th = TAU * rng()
                r = math.sqrt(1.0 - z * z)
                dx = r * math.cos(th)
                dy = r * math.sin(th)
                dz = z
                kmj = p["kmin"] + (p["kmax"] - p["kmin"]) * rng()
            if gam != 0.0:
                dn = dx * anx + dy * any_ + dz * anz
                dx += gam * dn * anx
                dy += gam * dn * any_
                dz += gam * dn * anz
                dm = math.hypot(dx, dy, dz) or 1.0
                dx /= dm
                dy /= dm
                dz /= dm
            kxc = kmj * dx
            kyc = kmj * dy
            kzc = kmj * dz
            if p["tileable"]:
                kxc = float(round_half_away(kxc))
                kyc = float(round_half_away(kyc))
                kzc = float(round_half_away(kzc))
                if kxc == 0.0 and kyc == 0.0 and kzc == 0.0:
                    kxc = 1.0
                kmj = math.hypot(kxc, kyc, kzc)
                dx = kxc / kmj
                dy = kyc / kmj
                dz = kzc / kmj
            kx[j] = kxc
            ky[j] = kyc
            kz[j] = kzc
            km[j] = kmj
            f = frame(dx, dy, dz)
            e1x[j], e1y[j], e1z[j] = f[0], f[1], f[2]
            e2x[j], e2y[j], e2z[j] = f[3], f[4], f[5]
            s[j] = 1.0 if rng() < (1.0 + p["helicity"]) / 2.0 else -1.0
            spec = p["spectrum"]
            a[j] = max(0.0, spec(kmj)) if spec else math.pow(kmj, -p["slope"])
            phr = TAU * rng()
            c = int(rng() * nc)
            ci[j] = c
            phc = -(kxc * cx[c] + kyc * cy[c] + kzc * cz[c])
            # Additive phase interpolation (helical-fields Eq. 9): reference at full
            # weight, random part fading as lam->1; well-defined for every lam (no
            # lam=1/2 antipodal singularity of the old complex-plane "chord" blend).
            ph[j] = phc + (1.0 - lam) * phr

        # Time evolution — all draws AFTER the spatial loop.
        chi = max(0.0, p["churn"])
        cvx = [0.0] * nc
        cvy = [0.0] * nc
        cvz = [0.0] * nc
        sg = chi / math.sqrt(3.0)
        for m in range(nc):
            r1 = math.sqrt(-2.0 * math.log(1.0 - rng()))
            a1 = TAU * rng()
            r2 = math.sqrt(-2.0 * math.log(1.0 - rng()))
            a2 = TAU * rng()
            cvx[m] = sg * r1 * math.cos(a1)
            cvy[m] = sg * r1 * math.sin(a1)
            cvz[m] = sg * r2 * math.cos(a2)
        rate0 = chi * math.cbrt(max(p["kmin"], 1e-9))
        for j in range(N):
            sgn = -1.0 if rng() < 0.5 else 1.0
            c = ci[j]
            om[j] = (1.0 - lam) * sgn * rate0 * math.pow(km[j], 2.0 / 3.0) - lam * (
                kx[j] * cvx[c] + ky[j] * cvy[c] + kz[j] * cvz[c]
            )

        self.kx, self.ky, self.kz, self.km = kx, ky, kz, km
        self.a, self.s, self.ph, self.om = a, s, ph, om
        self.e1x, self.e1y, self.e1z = e1x, e1y, e1z
        self.e2x, self.e2y, self.e2z = e2x, e2y, e2z
        self.nu = max(0.0, p["decay"])
        self._scale = 1.0
        self._scale = (p["amplitude"] or 1.0) / (self._rms() or 1.0)

    # -- sampling (used for rms + the numeric self-check) --------------------
    def _amp(self, j, t):
        if not (self.nu > 0.0) or t == 0.0:
            return self.a[j]
        return self.a[j] * math.exp(-self.nu * self.km[j] * self.km[j] * t)

    def sample_uw(self, x, y, z, t=0.0):
        ux = uy = uz = wx = wy = wz = 0.0
        for j in range(self.N):
            phi = self.kx[j] * x + self.ky[j] * y + self.kz[j] * z + self.ph[j] + self.om[j] * t
            c = math.cos(phi)
            sn = math.sin(phi)
            s = self.s[j]
            a = self._amp(j, t)
            tx = a * (c * self.e1x[j] - s * sn * self.e2x[j])
            ty = a * (c * self.e1y[j] - s * sn * self.e2y[j])
            tz = a * (c * self.e1z[j] - s * sn * self.e2z[j])
            ux += tx
            uy += ty
            uz += tz
            g = s * self.km[j]
            wx += g * tx
            wy += g * ty
            wz += g * tz
        sc = self._scale
        return (ux * sc, uy * sc, uz * sc, wx * sc, wy * sc, wz * sc)

    def _rms(self):
        ng = 5
        ssum = 0.0
        n = 0
        for i in range(ng):
            for j in range(ng):
                for k in range(ng):
                    o = self.sample_uw((i / ng) * TAU, (j / ng) * TAU, (k / ng) * TAU)
                    ssum += o[0] * o[0] + o[1] * o[1] + o[2] * o[2]
                    n += 1
        return math.sqrt(ssum / n)


def round_half_away(x):
    """Match JS Math.round: round half toward +infinity."""
    return math.floor(x + 0.5)


# ---------------------------------------------------------------------------
# Float formatting — reproduces JS Number.prototype.toPrecision(pr)
# ---------------------------------------------------------------------------
def js_toprecision(x, p):
    if x != x or x in (float("inf"), float("-inf")):
        return repr(x)
    if x == 0.0:
        return "0" if p == 1 else "0." + "0" * (p - 1)
    neg = x < 0.0
    d = Decimal(abs(x))
    e = d.adjusted()
    q = Decimal(1).scaleb(e - (p - 1))
    r = (d / q).to_integral_value(rounding=ROUND_HALF_UP) * q
    e2 = e if r == 0 else r.adjusted()
    if e2 < -6 or e2 >= p:
        mant = r.scaleb(-e2)
        s = format(mant, "." + str(p - 1) + "f")
        expstr = ("e+" if e2 >= 0 else "e-") + str(abs(e2))
        out = s + expstr
    else:
        decimals = max(0, p - 1 - e2)
        out = format(r, "." + str(decimals) + "f")
    return ("-" if neg else "") + out


def fl(x, pr):
    """GLSL/HLSL/WGSL/Godot float literal (always has a '.' or exponent)."""
    s = js_toprecision(float(x), pr)
    return s if ("." in s or "e" in s or "E" in s) else s + ".0"


# ---------------------------------------------------------------------------
# Shader emitters
# ---------------------------------------------------------------------------
def sanitize_name(name):
    return "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in name)


def _mode_columns(f, pr):
    """Return the per-mode literal columns shared by all emitters."""
    N = f.N
    K = [(fl(f.kx[j], pr), fl(f.ky[j], pr), fl(f.kz[j], pr)) for j in range(N)]
    E1 = [(fl(f.e1x[j], pr), fl(f.e1y[j], pr), fl(f.e1z[j], pr)) for j in range(N)]
    E2 = [(fl(f.e2x[j], pr), fl(f.e2y[j], pr), fl(f.e2z[j], pr)) for j in range(N)]
    S = [fl(f.s[j], pr) for j in range(N)]
    A = [fl(f.a[j], pr) for j in range(N)]
    PH = [fl(f.ph[j], pr) for j in range(N)]
    OM = [fl(f.om[j], pr) for j in range(N)]
    return K, E1, E2, S, A, PH, OM


def emit_glsl(f, name="helixNoise", pr=7, curl=True, pot=False):
    name = sanitize_name(name)
    N = f.N
    P = name + "_"
    decay = f.nu > 0.0
    K, E1, E2, S, A, PH, OM = _mode_columns(f, pr)

    def v3(col):
        return "vec3[%d](%s)" % (N, ",".join("vec3(%s,%s,%s)" % t for t in col))

    def fa(col):
        return "float[%d](%s)" % (N, ",".join(col))

    amp = ("%sA[j] * exp(-%sNU * dot(%sK[j], %sK[j]) * t)" % (P, P, P, P)) if decay else "%sA[j]" % P

    L = [
        "// Helix Noise — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.",
        "// %d modes. Defines vec3 %s(vec3 p) / (vec3 p, float t)%s"
        % (N, name, (" and vec3 %sCurl — same pair." % name) if curl else "."),
        "const int %sN = %d;" % (P, N),
        "const vec3 %sK[%d] = %s;" % (P, N, v3(K)),
        "const vec3 %sE1[%d] = %s;" % (P, N, v3(E1)),
        "const vec3 %sE2[%d] = %s;" % (P, N, v3(E2)),
        "const float %sS[%d] = %s;" % (P, N, fa(S)),
        "const float %sA[%d] = %s;" % (P, N, fa(A)),
        "const float %sPH[%d] = %s;" % (P, N, fa(PH)),
        "const float %sOM[%d] = %s;" % (P, N, fa(OM)),
        "const float %sSCALE = %s;" % (P, fl(f._scale, pr)),
    ]
    if decay:
        L.append("const float %sNU = %s;" % (P, fl(f.nu, pr)))
    L += [
        "",
        "vec3 %s(vec3 p, float t) {" % name,
        "  vec3 u = vec3(0.0);",
        "  for (int j = 0; j < %sN; j++) {" % P,
        "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
        "    u += (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
        "  }",
        "  return u * %sSCALE;" % P,
        "}",
        "vec3 %s(vec3 p) { return %s(p, 0.0); }" % (name, name),
    ]
    if curl:
        L += [
            "",
            "vec3 %sCurl(vec3 p, float t) {" % name,
            "  vec3 w = vec3(0.0);",
            "  for (int j = 0; j < %sN; j++) {" % P,
            "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
            "    vec3 tv = (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
            "    w += %sS[j] * length(%sK[j]) * tv;" % (P, P),
            "  }",
            "  return w * %sSCALE;" % P,
            "}",
            "vec3 %sCurl(vec3 p) { return %sCurl(p, 0.0); }" % (name, name),
        ]
    if pot:
        L += [
            "",
            "vec3 %sPot(vec3 p, float t) {" % name,
            "  vec3 A = vec3(0.0);",
            "  for (int j = 0; j < %sN; j++) {" % P,
            "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
            "    vec3 tv = (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
            "    A += (%sS[j] / length(%sK[j])) * tv;" % (P, P),
            "  }",
            "  return A * %sSCALE;" % P,
            "}",
            "vec3 %sPot(vec3 p) { return %sPot(p, 0.0); }" % (name, name),
        ]
    return "\n".join(L)


def emit_hlsl(f, name="helixNoise", pr=7, curl=True, pot=False):
    name = sanitize_name(name)
    N = f.N
    P = name + "_"
    decay = f.nu > 0.0
    K, E1, E2, S, A, PH, OM = _mode_columns(f, pr)

    def v3(col):
        return "{ %s }" % (", ".join("float3(%s, %s, %s)" % t for t in col))

    def fa(col):
        return "{ %s }" % (", ".join(col))

    amp = ("%sA[j] * exp(-%sNU * dot(%sK[j], %sK[j]) * t)" % (P, P, P, P)) if decay else "%sA[j]" % P

    L = [
        "// Helix Noise — generated HLSL (Unity / Unreal). Divergence-free velocity field.",
        "// %d modes. Defines float3 %s(float3 p, float t) / (float3 p)." % (N, name),
        "static const int %sN = %d;" % (P, N),
        "static const float3 %sK[%d] = %s;" % (P, N, v3(K)),
        "static const float3 %sE1[%d] = %s;" % (P, N, v3(E1)),
        "static const float3 %sE2[%d] = %s;" % (P, N, v3(E2)),
        "static const float %sS[%d] = %s;" % (P, N, fa(S)),
        "static const float %sA[%d] = %s;" % (P, N, fa(A)),
        "static const float %sPH[%d] = %s;" % (P, N, fa(PH)),
        "static const float %sOM[%d] = %s;" % (P, N, fa(OM)),
        "static const float %sSCALE = %s;" % (P, fl(f._scale, pr)),
    ]
    if decay:
        L.append("static const float %sNU = %s;" % (P, fl(f.nu, pr)))
    L += [
        "",
        "float3 %s(float3 p, float t) {" % name,
        "  float3 u = float3(0.0, 0.0, 0.0);",
        "  [loop] for (int j = 0; j < %sN; j++) {" % P,
        "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
        "    u += (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
        "  }",
        "  return u * %sSCALE;" % P,
        "}",
        "float3 %s(float3 p) { return %s(p, 0.0); }" % (name, name),
    ]
    if curl:
        L += [
            "",
            "float3 %sCurl(float3 p, float t) {" % name,
            "  float3 w = float3(0.0, 0.0, 0.0);",
            "  [loop] for (int j = 0; j < %sN; j++) {" % P,
            "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
            "    float3 tv = (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
            "    w += %sS[j] * length(%sK[j]) * tv;" % (P, P),
            "  }",
            "  return w * %sSCALE;" % P,
            "}",
            "float3 %sCurl(float3 p) { return %sCurl(p, 0.0); }" % (name, name),
        ]
    if pot:
        L += [
            "",
            "float3 %sPot(float3 p, float t) {" % name,
            "  float3 A = float3(0.0, 0.0, 0.0);",
            "  [loop] for (int j = 0; j < %sN; j++) {" % P,
            "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
            "    float3 tv = (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
            "    A += (%sS[j] / length(%sK[j])) * tv;" % (P, P),
            "  }",
            "  return A * %sSCALE;" % P,
            "}",
            "float3 %sPot(float3 p) { return %sPot(p, 0.0); }" % (name, name),
        ]
    return "\n".join(L)


def emit_wgsl(f, name="helixNoise", pr=7, curl=True, pot=False):
    name = sanitize_name(name)
    N = f.N
    P = name + "_"
    decay = f.nu > 0.0
    K, E1, E2, S, A, PH, OM = _mode_columns(f, pr)

    def v3(col):
        return "array<vec3f, %d>(%s)" % (N, ", ".join("vec3f(%s, %s, %s)" % t for t in col))

    def fa(col):
        return "array<f32, %d>(%s)" % (N, ", ".join(col))

    amp = ("%sA[j] * exp(-%sNU * dot(%sK[j], %sK[j]) * t)" % (P, P, P, P)) if decay else "%sA[j]" % P

    L = [
        "// Helix Noise — generated WGSL (WebGPU). Divergence-free velocity field.",
        "// %d modes. Defines fn %s(p, t) / %s0(p)." % (N, name, name),
        "const %sN: i32 = %d;" % (P, N),
        "const %sK = %s;" % (P, v3(K)),
        "const %sE1 = %s;" % (P, v3(E1)),
        "const %sE2 = %s;" % (P, v3(E2)),
        "const %sS = %s;" % (P, fa(S)),
        "const %sA = %s;" % (P, fa(A)),
        "const %sPH = %s;" % (P, fa(PH)),
        "const %sOM = %s;" % (P, fa(OM)),
        "const %sSCALE: f32 = %s;" % (P, fl(f._scale, pr)),
    ]
    if decay:
        L.append("const %sNU: f32 = %s;" % (P, fl(f.nu, pr)))
    L += [
        "",
        "fn %s(p: vec3f, t: f32) -> vec3f {" % name,
        "  var u = vec3f(0.0);",
        "  for (var j: i32 = 0; j < %sN; j = j + 1) {" % P,
        "    let phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
        "    u = u + (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
        "  }",
        "  return u * %sSCALE;" % P,
        "}",
        "fn %s0(p: vec3f) -> vec3f { return %s(p, 0.0); }" % (name, name),
    ]
    if curl:
        L += [
            "",
            "fn %sCurl(p: vec3f, t: f32) -> vec3f {" % name,
            "  var w = vec3f(0.0);",
            "  for (var j: i32 = 0; j < %sN; j = j + 1) {" % P,
            "    let phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
            "    let tv = (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
            "    w = w + %sS[j] * length(%sK[j]) * tv;" % (P, P),
            "  }",
            "  return w * %sSCALE;" % P,
            "}",
            "fn %sCurl0(p: vec3f) -> vec3f { return %sCurl(p, 0.0); }" % (name, name),
        ]
    if pot:
        L += [
            "",
            "fn %sPot(p: vec3f, t: f32) -> vec3f {" % name,
            "  var a = vec3f(0.0);",
            "  for (var j: i32 = 0; j < %sN; j = j + 1) {" % P,
            "    let phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
            "    let tv = (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
            "    a = a + (%sS[j] / length(%sK[j])) * tv;" % (P, P),
            "  }",
            "  return a * %sSCALE;" % P,
            "}",
            "fn %sPot0(p: vec3f) -> vec3f { return %sPot(p, 0.0); }" % (name, name),
        ]
    return "\n".join(L)


def emit_godot(f, name="helixNoise", pr=7, curl=True, pot=False):
    name = sanitize_name(name)
    N = f.N
    P = name + "_"
    decay = f.nu > 0.0
    K, E1, E2, S, A, PH, OM = _mode_columns(f, pr)

    def v3(col):
        return "const vec3[%d] %s = {%s};" % (N, "%s", ", ".join("vec3(%s, %s, %s)" % t for t in col))

    def fa(col):
        return "const float[%d] %s = {%s};" % (N, "%s", ", ".join(col))

    amp = ("%sA[j] * exp(-%sNU * dot(%sK[j], %sK[j]) * t)" % (P, P, P, P)) if decay else "%sA[j]" % P

    L = [
        "// Helix Noise — generated Godot shader include (.gdshader). Divergence-free velocity field.",
        "// %d modes. Defines vec3 %s(vec3 p, float t) / (vec3 p)." % (N, name),
        "const int %sN = %d;" % (P, N),
        v3(K) % ("%sK" % P),
        v3(E1) % ("%sE1" % P),
        v3(E2) % ("%sE2" % P),
        fa(S) % ("%sS" % P),
        fa(A) % ("%sA" % P),
        fa(PH) % ("%sPH" % P),
        fa(OM) % ("%sOM" % P),
        "const float %sSCALE = %s;" % (P, fl(f._scale, pr)),
    ]
    if decay:
        L.append("const float %sNU = %s;" % (P, fl(f.nu, pr)))
    L += [
        "",
        "vec3 %s(vec3 p, float t) {" % name,
        "  vec3 u = vec3(0.0);",
        "  for (int j = 0; j < %sN; j++) {" % P,
        "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
        "    u += (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
        "  }",
        "  return u * %sSCALE;" % P,
        "}",
        "vec3 %s(vec3 p) { return %s(p, 0.0); }" % (name, name),
    ]
    if curl:
        L += [
            "",
            "vec3 %sCurl(vec3 p, float t) {" % name,
            "  vec3 w = vec3(0.0);",
            "  for (int j = 0; j < %sN; j++) {" % P,
            "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
            "    vec3 tv = (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
            "    w += %sS[j] * length(%sK[j]) * tv;" % (P, P),
            "  }",
            "  return w * %sSCALE;" % P,
            "}",
            "vec3 %sCurl(vec3 p) { return %sCurl(p, 0.0); }" % (name, name),
        ]
    if pot:
        L += [
            "",
            "vec3 %sPot(vec3 p, float t) {" % name,
            "  vec3 A = vec3(0.0);",
            "  for (int j = 0; j < %sN; j++) {" % P,
            "    float phi = dot(%sK[j], p) + %sPH[j] + %sOM[j] * t;" % (P, P, P),
            "    vec3 tv = (%s) * (cos(phi) * %sE1[j] - %sS[j] * sin(phi) * %sE2[j]);" % (amp, P, P, P),
            "    A += (%sS[j] / length(%sK[j])) * tv;" % (P, P),
            "  }",
            "  return A * %sSCALE;" % P,
            "}",
            "vec3 %sPot(vec3 p) { return %sPot(p, 0.0); }" % (name, name),
        ]
    return "\n".join(L)


EMITTERS = {
    "glsl": emit_glsl,
    "hlsl": emit_hlsl,
    "wgsl": emit_wgsl,
    "godot": emit_godot,
}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def build_field_from_args(args):
    return HelixField(
        modes=args.modes,
        seed=args.seed,
        slope=args.slope,
        helicity=args.helicity,
        coherence=args.coherence,
        kmin=args.kmin,
        kmax=args.kmax,
        centers=args.centers,
        amplitude=args.amplitude,
        tileable=args.tileable,
        layout=args.layout,
        churn=args.churn,
        decay=args.decay,
        anisotropy=args.anisotropy,
        axis=tuple(args.axis) if args.axis else (0.0, 0.0, 1.0),
    )


def make_parser():
    ap = argparse.ArgumentParser(
        description="Generate a ready-to-paste Helix Noise shader (baked constants + function body)."
    )
    ap.add_argument("--target", choices=list(EMITTERS.keys()), default="glsl",
                    help="shading language (default: glsl)")
    ap.add_argument("--modes", type=int, default=48, help="number of helical modes (default: 48)")
    ap.add_argument("--seed", type=int, default=1, help="RNG seed (default: 1)")
    ap.add_argument("--slope", type=float, default=1.6, help="spectral slope (default: 1.6)")
    ap.add_argument("--helicity", type=float, default=0.0, help="helicity in [-1,1] (default: 0)")
    ap.add_argument("--coherence", type=float, default=0.0, help="coherence in [0,1] (default: 0)")
    ap.add_argument("--kmin", type=float, default=1.0, help="min wavenumber (default: 1.0)")
    ap.add_argument("--kmax", type=float, default=6.2, help="max wavenumber (default: 6.2)")
    ap.add_argument("--centers", type=int, default=3, help="coherence centers (default: 3)")
    ap.add_argument("--amplitude", type=float, default=1.0, help="output amplitude (default: 1.0)")
    ap.add_argument("--tileable", action="store_true", help="snap wavevectors to integer lattice")
    ap.add_argument("--layout", choices=["fibonacci", "random"], default="fibonacci",
                    help="mode layout (default: fibonacci)")
    ap.add_argument("--churn", type=float, default=1.0, help="time-evolution rate (default: 1.0)")
    ap.add_argument("--decay", type=float, default=0.0, help="viscous decay nu>=0 (default: 0)")
    ap.add_argument("--anisotropy", type=float, default=0.0, help="axis stretch (default: 0)")
    ap.add_argument("--axis", type=float, nargs=3, default=[0.0, 0.0, 1.0],
                    metavar=("X", "Y", "Z"), help="anisotropy axis (default: 0 0 1)")
    ap.add_argument("--name", default="helixNoise", help="emitted function name (default: helixNoise)")
    ap.add_argument("--precision", type=int, default=7, help="float literal precision (default: 7)")
    ap.add_argument("--no-curl", dest="curl", action="store_false", help="omit the Curl (vorticity) function")
    ap.add_argument("--potential", action="store_true", help="also emit the vector-potential function")
    return ap


def main(argv=None):
    args = make_parser().parse_args(argv)
    field = build_field_from_args(args)
    emitter = EMITTERS[args.target]
    out = emitter(field, name=args.name, pr=args.precision, curl=args.curl, pot=args.potential)
    sys.stdout.write(out + "\n")


if __name__ == "__main__":
    main()
