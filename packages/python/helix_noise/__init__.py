"""Helix Noise — a spectral, divergence-free helical flow-field generator.

Grid-free analytic vector fields built from a sum of Beltrami (helical) modes,
with optional free-slip SDF boundaries and a GLSL shader emitter. This is a
Python + numpy port of the JavaScript ``helix-noise`` library, verified against
the reference fixture for the spectral engine and the SDF boundary — see
:data:`SPEC_VERSION` for the revision, and the parity table in
``spec/PORTING_SPEC.md`` for what is and is not ported (the sparse-atom engine,
the structure primitives and the time warps are not).
"""

from ._constants import GA, SPEC_VERSION, TAU, VERSION
from .boundary import BoundedField
from .field import HelixField, create
from .presets import (
    C_TWO_SCALE,
    NS_TARGETS,
    abc,
    condensate,
    exact_ns,
    ns_developed,
    ns_forced,
    rolloff,
    shell_peak,
    two_scale,
)

__all__ = [
    "create",
    "HelixField",
    "BoundedField",
    "shell_peak",
    "rolloff",
    "condensate",
    "abc",
    "two_scale",
    "C_TWO_SCALE",
    "exact_ns",
    "ns_developed",
    "ns_forced",
    "NS_TARGETS",
    "TAU",
    "GA",
    "VERSION",
    "SPEC_VERSION",
    "__version__",
]

__version__ = "0.6.0"
