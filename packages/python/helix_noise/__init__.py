"""Helix Noise — a spectral, divergence-free helical flow-field generator.

Grid-free analytic vector fields built from a sum of Beltrami (helical) modes,
with optional free-slip SDF boundaries and a GLSL shader emitter. This is a
Python + numpy port of the JavaScript ``helix-noise`` library, numerically at
parity with the reference.
"""

from ._constants import GA, TAU, VERSION
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
    "__version__",
]

__version__ = "0.6.0"
