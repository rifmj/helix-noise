"""Numerical-parity tests against the JS reference fixture.

Runs under pytest and standalone (``python3 tests/test_parity.py``) using
only the standard library + numpy.
"""

import json
import math
import os
import re
import sys

import numpy as np

# Make the package importable when run as a plain script.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import helix_noise as hn

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "parity_fixture.json")

ATOL = 1e-9
RTOL = 1e-9
BAKE_TOL = 1e-7  # bake sum accumulates float32

MODE_CONFIGS = [
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
    "R_flutter",
]

# Callable options travel in the fixture as {"$preset": name, "args": [...]} descriptors.
PRESET_REGISTRY = {
    "shellPeak": hn.shell_peak,
    "rolloff": hn.rolloff,
    "condensate": hn.condensate,
}


def _resolve(config):
    out = {}
    for k, v in config.items():
        if isinstance(v, dict) and "$preset" in v:
            out[k] = PRESET_REGISTRY[v["$preset"]](*v["args"])
        else:
            out[k] = v
    return out

# JS-style camelCase config keys -> python snake_case create() kwargs.
KEY_MAP = {"layout": "layout", "axis": "axis"}


def _load():
    with open(FIXTURE) as fp:
        return json.load(fp)


def _close(actual, expected, atol=ATOL, rtol=RTOL):
    return abs(actual - expected) <= atol + rtol * abs(expected)


def _build(config):
    return hn.create(**_resolve(config))


def _check_modes(f, modes, label):
    assert f.N == modes["N"], "{}: N {} != {}".format(label, f.N, modes["N"])
    arrays = {
        "kx": f.kx, "ky": f.ky, "kz": f.kz, "km": f.km,
        "e1x": f.e1x, "e1y": f.e1y, "e1z": f.e1z,
        "e2x": f.e2x, "e2y": f.e2y, "e2z": f.e2z,
        "s": f.s, "chi": f.chi, "a": f.a, "ph": f.ph, "om": f.om,
    }
    for key, arr in arrays.items():
        exp = np.asarray(modes[key], dtype=np.float64)
        got = np.asarray(arr, dtype=np.float64)
        assert got.shape == exp.shape, "{}.{}: shape {} != {}".format(
            label, key, got.shape, exp.shape
        )
        for j in range(len(exp)):
            assert _close(got[j], exp[j]), "{}.{}[{}]: {!r} != {!r}".format(
                label, key, j, got[j], exp[j]
            )
    assert _close(f._scale, modes["scale"]), "{}.scale: {} != {}".format(
        label, f._scale, modes["scale"]
    )
    assert _close(f.nu, modes["nu"]), "{}.nu: {} != {}".format(label, f.nu, modes["nu"])


def _check_samples(f, samples, label):
    for si, s in enumerate(samples):
        x, y, z = s["x"], s["y"], s["z"]
        t = s.get("t", 0.0)
        u, w = f.sample_uw(x, y, z, t)
        _, A = f.sample_ua(x, y, z, t)
        for c in range(3):
            assert _close(u[c], s["u"][c]), "{} sample[{}].u[{}]: {!r} != {!r}".format(
                label, si, c, u[c], s["u"][c]
            )
            assert _close(w[c], s["w"][c]), "{} sample[{}].w[{}]: {!r} != {!r}".format(
                label, si, c, w[c], s["w"][c]
            )
            assert _close(A[c], s["A"][c]), "{} sample[{}].A[{}]: {!r} != {!r}".format(
                label, si, c, A[c], s["A"][c]
            )
        # vectorized path must agree with scalar
        vu, vw = f.sample_many_uw([[x, y, z]], t)
        for c in range(3):
            assert _close(vu[0, c], u[c]), "{} many.u mismatch".format(label)
            assert _close(vw[0, c], w[c]), "{} many.w mismatch".format(label)


def _check_relhelicity(f, expected, label):
    got = f.relative_helicity(8)
    assert _close(got, expected), "{} relativeHelicity: {!r} != {!r}".format(
        label, got, expected
    )


def _check_bakesum(f, expected, label):
    data = f.bake3d(4, 0.0)
    got = float(data.astype(np.float32).sum(dtype=np.float64))
    assert _close(got, expected, atol=BAKE_TOL, rtol=BAKE_TOL), (
        "{} bake3d4_sum: {!r} != {!r}".format(label, got, expected)
    )


def test_mode_configs():
    data = _load()
    for label in MODE_CONFIGS:
        entry = data[label]
        f = _build(entry["config"])
        _check_modes(f, entry["modes"], label)
        _check_samples(f, entry["samples"], label)
        _check_relhelicity(f, entry["relativeHelicity"], label)
        _check_bakesum(f, entry["bake3d4_sum"], label)


def test_boundary_F():
    _check_boundary("boundary_F")


def test_boundary_L_elliptic():
    """Same wrapper on elliptic modes: the analytic potential stays exact for every chi."""
    _check_boundary("boundary_L_elliptic")


def _check_boundary(label):
    data = _load()
    entry = data[label]
    base = _build(entry["base_config"])

    def sdf(x, y, z):
        return math.hypot(x - 3.0, y - 3.0, z - 3.0) - 1.2

    bf = base.with_boundary(
        sdf, thickness=entry["thickness"], fd_step=entry["fdStep"]
    )
    for si, s in enumerate(entry["samples"]):
        x, y, z = s["x"], s["y"], s["z"]
        t = s.get("t", 0.0)
        u, w = bf.sample_uw(x, y, z, t)
        pot = bf.potential(x, y, z, t)
        for c in range(3):
            assert _close(u[c], s["u"][c]), "{}[{}].u[{}]: {!r} != {!r}".format(
                label, si, c, u[c], s["u"][c]
            )
            assert _close(w[c], s["w"][c]), "{}[{}].w[{}]: {!r} != {!r}".format(
                label, si, c, w[c], s["w"][c]
            )
            assert _close(pot[c], s["pot"][c]), (
                "{}[{}].pot[{}]: {!r} != {!r}".format(label, si, c, pot[c], s["pot"][c])
            )


def _parse_floats(text):
    return [float(m) for m in re.findall(r"-?\d+\.?\d*(?:[eE][+-]?\d+)?", text)]


def test_glsl_A_numeric():
    data = _load()
    f = _build(data["A_default_small"]["config"])
    got = f.glsl(name="helixNoise", precision=7, curl=True, potential=True)
    with open(os.path.join(HERE, "ref_glsl_A.glsl")) as fp:
        ref = fp.read()
    gf = _parse_floats(got)
    rf = _parse_floats(ref)
    assert len(gf) == len(rf), "glsl float count {} != {}".format(len(gf), len(rf))
    for i, (g, r) in enumerate(zip(gf, rf)):
        assert _close(g, r, atol=1e-6, rtol=1e-6), "glsl float[{}]: {!r} != {!r}".format(
            i, g, r
        )


def test_glsl_Q_grain():
    """The grain-axis (general) curl/potential bodies match the JS emitter."""
    data = _load()
    f = _build(data["Q_grain"]["config"])
    got = f.glsl(name="helixNoise", precision=7, curl=True, potential=True)
    with open(os.path.join(HERE, "ref_glsl_Q_grain.glsl")) as fp:
        ref = fp.read()
    assert "cross(" in got, "grain-axis curl must use the cross-product body"
    gf, rf = _parse_floats(got), _parse_floats(ref)
    assert len(gf) == len(rf), "glsl float count {} != {}".format(len(gf), len(rf))
    for i, (g, r) in enumerate(zip(gf, rf)):
        assert _close(g, r, atol=1e-6, rtol=1e-6), "glsl float[{}]: {!r} != {!r}".format(i, g, r)


def test_glsl_K_elliptic():
    """The general-chi curl/potential bodies (ellipticity != 1) match the JS emitter."""
    data = _load()
    f = _build(data["K_elliptic_half"]["config"])
    got = f.glsl(name="helixNoise", precision=7, curl=True, potential=True)
    with open(os.path.join(HERE, "ref_glsl_K_elliptic.glsl")) as fp:
        ref = fp.read()
    assert "tw / length" in got, "elliptic potential must use A = w/k^2"
    gf = _parse_floats(got)
    rf = _parse_floats(ref)
    assert len(gf) == len(rf), "glsl float count {} != {}".format(len(gf), len(rf))
    for i, (g, r) in enumerate(zip(gf, rf)):
        assert _close(g, r, atol=1e-6, rtol=1e-6), "glsl float[{}]: {!r} != {!r}".format(
            i, g, r
        )


def test_abc_factory():
    """The closed-form abc() field (spec §10.2) matches the reference mode-for-mode."""
    data = _load()
    entry = data["P_abc"]
    f = hn.abc(*entry["factory"]["args"])
    _check_modes(f, entry["modes"], "P_abc")
    _check_samples(f, entry["samples"], "P_abc")
    _check_relhelicity(f, entry["relativeHelicity"], "P_abc")
    _check_bakesum(f, entry["bake3d4_sum"], "P_abc")


def _run_all():
    test_mode_configs()
    print("mode configs (A-E, J-K, M-O, Q): modes, samples, relHelicity, bake sum, vectorized OK")
    test_abc_factory()
    print("P_abc factory: modes, samples, relHelicity, bake sum OK")
    test_boundary_F()
    print("boundary_F: u, w, potential OK")
    test_boundary_L_elliptic()
    print("boundary_L_elliptic: u, w, potential OK")
    test_glsl_A_numeric()
    print("glsl A numeric parity OK")
    test_glsl_K_elliptic()
    print("glsl K (elliptic) numeric parity OK")
    test_glsl_Q_grain()
    print("glsl Q (grain axis) numeric parity OK")
    print("\nALL PARITY TESTS PASSED")


if __name__ == "__main__":
    try:
        _run_all()
    except AssertionError as e:
        print("PARITY FAILURE:", e)
        sys.exit(1)
