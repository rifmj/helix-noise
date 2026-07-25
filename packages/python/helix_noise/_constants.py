"""Shared constants and default options for Helix Noise."""

import math

TAU = 2.0 * math.pi

# Golden angle (radians) — the Fibonacci-sphere azimuth increment.
GA = math.pi * (3.0 - math.sqrt(5.0))

#: Seed salt for the polarization channel's second RNG stream (32-bit wrapping add).
#: Golden ratio -- the flutter harmonic's rate multiplier (never resynchronizes with churn).
PHI = (1.0 + math.sqrt(5.0)) / 2.0

POLAR_SALT = 0x9E3779B9
#: Polarization-degree ball radius: sqrt(d^2 + chi^2) is clamped to this (PSD of the covariance).
POLAR_DEG_MAX = 0.97

VERSION = "0.6.0"

# Default options, filled in for every field. ``spectrum`` stays optional
# (there is no default spectral-law callable).
DEFAULTS = {
    "modes": 48,        # number of helical modes (cost of one sample is O(modes))
    "slope": 1.6,       # spectral slope s: amplitude ~ |k|^-s (steep = big swirls)
    "helicity": 0.0,    # p in [-1, 1]: energy split between +/- helical states
    "coherence": 0.0,   # lambda in [0, 1]: phases random -> structured
    "kmin": 1.0,        # smallest wavenumber (largest structures)
    "kmax": 6.2,        # largest wavenumber (finest detail)
    "centers": 3,       # focus points the coherent phases organize toward
    "amplitude": 1.0,   # output scale; normalized to unit RMS speed, then * amplitude
    "tileable": False,  # snap wavevectors to integer lattice => exactly 2*pi-periodic
    "seed": 1,
    "layout": "fibonacci",  # "fibonacci" (low-discrepancy) or "random" (i.i.d. ensemble)
    "churn": 1.0,       # time-evolution rate for sample(x, y, z, t)
    "decay": 0.0,       # viscosity nu >= 0: mode amplitudes decay as e^(-nu k^2 t)
    "anisotropy": 0.0,  # direction stretch along `axis`
    "axis": [0.0, 0.0, 1.0],  # anisotropy axis
    "polarizationAxis": None,  # world grain axis for linear polarization; None = channel off
    "polarizationBias": 0.0,   # linear-polarization strength d along that axis
    "flutter": 0.0,      # fast deterministic phase wobble on top of the churn drift
    "ellipticity": 1.0,  # eps in [0,1]: per-mode chirality chi = eps*s (1 = circular, 0 = linear)
}
