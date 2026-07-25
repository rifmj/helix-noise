"""Ready-made shapes for the per-wavenumber dials, plus two field factories.

Everything here is a pure function of ``|k|`` or a closed form -- no RNG, so mixing
presets in never disturbs a field's mode layout.
"""

import math

from .field import HelixField

__all__ = [
    "shell_peak",
    "rolloff",
    "condensate",
    "abc",
    "two_scale",
    "C_TWO_SCALE",
]


def shell_peak(k_peak, width=1.0):
    """Spectrum preset: a Gaussian shell bump ``a(k) = exp(-(k-k_peak)^2/(2*width^2))``.

    An energy-containing band instead of a power law. Pair with
    ``kmin ~ k_peak - 3*width`` and ``kmax ~ k_peak + 3*width`` so the discarded
    tails stay near 1%.
    """
    w = abs(width) or 1.0

    def a(k):
        return math.exp(-(k - k_peak) * (k - k_peak) / (2.0 * w * w))

    return a


def rolloff(kc):
    """Coherence preset: ``lam(k) = clamp(1 - k/kc, 0, 1)``.

    Organized structure at large scales, fading to uncorrelated noise above ``kc``.
    """

    def lam(k):
        return min(1.0, max(0.0, 1.0 - k / kc))

    return lam


def condensate(k_split, p_large, p_small=0.0):
    """Helicity preset: ``p(k) = p_large if k <= k_split else p_small``.

    A handed large-scale condensate over a (near-)mirror-symmetric fine background.
    """

    def p(k):
        return p_large if k <= k_split else p_small

    return p


def abc(A=1.0, B=1.0, C=1.0, amplitude=None, decay=0.0):
    """The classical ABC (Arnold-Beltrami-Childress) cell field, as three engine modes.

    ``u = (A sin z + C cos y, B sin x + A cos z, C sin y + B cos x)`` -- exactly
    2*pi-tileable, a pure Beltrami field (``curl u = u``, potential ``A = u``), and
    built without touching the RNG. Every sampler, bake, ``glsl()`` and
    ``with_boundary`` works on it unchanged.

    Default is the *literal* field (its amplitudes mean what they say). Pass
    ``amplitude`` to opt into the usual RMS normalization, or ``decay=nu`` for the
    exact viscous solution ``u(t) = exp(-nu t) u(0)``.
    """
    half_pi = math.pi / 2.0
    # Closed-form RMS: the 5^3 grid mean of |u|^2 is exactly A^2+B^2+C^2 in exact
    # arithmetic, so never route this through _rms() -- summation order moves it by ~1 ulp.
    rms = math.sqrt(A * A + B * B + C * C)
    scale = 1.0 if amplitude is None else amplitude / (rms or 1.0)
    return HelixField._from_modes(
        k=[(0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
        s=[1.0, 1.0, 1.0],
        a=[A, B, C],
        ph=[-half_pi, -half_pi, math.pi],
        scale=scale,
        decay=decay,
    )


#: Detail-amplitude constant for :func:`two_scale`: ``amplitude = C_TWO_SCALE / k_detail``
#: holds the detail layer's vorticity budget fixed as you move its wavenumber.
C_TWO_SCALE = 1.6


class TwoScaleField(object):
    """Componentwise sum of two divergence-free fields (still divergence-free)."""

    def __init__(self, base, detail, detail_gain=1.0):
        self.base = base
        self.detail = detail
        self.detail_gain = detail_gain

    def sample_uw(self, x, y, z, t=0.0):
        bu, bw = self.base.sample_uw(x, y, z, t)
        du, dw = self.detail.sample_uw(x, y, z, t)
        g = self.detail_gain
        return (
            tuple(bu[c] + g * du[c] for c in range(3)),
            tuple(bw[c] + g * dw[c] for c in range(3)),
        )

    def sample_ua(self, x, y, z, t=0.0):
        bu, ba = self.base.sample_ua(x, y, z, t)
        du, da = self.detail.sample_ua(x, y, z, t)
        g = self.detail_gain
        return (
            tuple(bu[c] + g * du[c] for c in range(3)),
            tuple(ba[c] + g * da[c] for c in range(3)),
        )

    def sample(self, x, y, z, t=0.0):
        return self.sample_uw(x, y, z, t)[0]

    def vorticity(self, x, y, z, t=0.0):
        return self.sample_uw(x, y, z, t)[1]

    def helicity_density(self, x, y, z, t=0.0):
        u, w = self.sample_uw(x, y, z, t)
        return u[0] * w[0] + u[1] * w[1] + u[2] * w[2]

    def potential(self, x, y, z, t=0.0):
        return self.sample_ua(x, y, z, t)[1]

    def with_boundary(self, sdf, thickness=1.0, gradient=None, fd_step=1e-3):
        from .boundary import BoundedField

        return BoundedField(self, sdf, thickness=thickness, gradient=gradient, fd_step=fd_step)


def two_scale(base, detail, detail_gain=1.0):
    """A coherent large-scale backbone plus incoherent broadband detail.

    The sum of two divergence-free fields is divergence-free, and its potential is the
    sum of theirs, so ``with_boundary`` keeps working. Sizing the detail as
    ``amplitude=C_TWO_SCALE / k_detail`` keeps its vorticity budget constant while you
    slide the detail scale.
    """
    return TwoScaleField(base, detail, detail_gain)
