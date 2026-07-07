"""Shared constants and default options for Helix Noise."""

import math

TAU = 2.0 * math.pi

# Golden angle (radians) — the Fibonacci-sphere azimuth increment.
GA = math.pi * (3.0 - math.sqrt(5.0))

VERSION = "1.0.0"

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
}
