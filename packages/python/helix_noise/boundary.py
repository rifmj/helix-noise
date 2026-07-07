"""Free-slip SDF obstacle boundary for a Helix Noise field.

The bounded velocity is ``curl(ramp(d/th) * A)`` where ``A`` is the base
field's analytic vector potential and ``d = sdf(x, y, z)``. Expanded exactly
as ``ramp' * (grad_d x A) + ramp * u`` it stays divergence-free (it is a
curl), is tangent to the wall, zero inside, and identical to the base field
beyond the influence band.
"""

import math

import numpy as np

from ._constants import TAU


def _ramp(x):
    """Bridson's free-slip quintic; ramp(0)=0, ramp'(0)=15/8>0 (slip, not no-slip)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    x2 = x * x
    return (x * (15.0 - 10.0 * x2 + 3.0 * x2 * x2)) / 8.0


def _dramp(x):
    if x < 0 or x >= 1:
        return 0.0
    w = 1.0 - x * x
    return (15.0 / 8.0) * w * w


class BoundedField:
    """A Helix Noise field constrained by an SDF obstacle (free-slip)."""

    def __init__(self, base, sdf, thickness=1.0, gradient=None, fd_step=1e-3):
        self.base = base
        self.sdf = sdf
        self.th = max(thickness if thickness is not None else 1.0, 1e-9)
        self.h = fd_step
        self.grad = gradient

    def _u(self, x, y, z, t):
        """Bounded velocity (ux, uy, uz) at a point."""
        d = self.sdf(x, y, z)
        if d <= 0:
            return (0.0, 0.0, 0.0)
        u, A = self.base.sample_ua(x, y, z, t)
        q = d / self.th
        if q >= 1:
            return (u[0], u[1], u[2])
        if self.grad is not None:
            g = self.grad(x, y, z)
            gx, gy, gz = g[0], g[1], g[2]
        else:
            h = self.h
            s = self.sdf
            gx = (s(x + h, y, z) - s(x - h, y, z)) / (2.0 * h)
            gy = (s(x, y + h, z) - s(x, y - h, z)) / (2.0 * h)
            gz = (s(x, y, z + h) - s(x, y, z - h)) / (2.0 * h)
        r = _ramp(q)
        rp = _dramp(q) / self.th
        cx = gy * A[2] - gz * A[1]
        cy = gz * A[0] - gx * A[2]
        cz = gx * A[1] - gy * A[0]
        return (rp * cx + r * u[0], rp * cy + r * u[1], rp * cz + r * u[2])

    def sample(self, x, y, z, t=0.0):
        """Bounded velocity ``(u, v, w)`` at a point."""
        return self._u(x, y, z, t)

    def sample_uw(self, x, y, z, t=0.0):
        """Bounded velocity + vorticity; vorticity is via central differences of ``u``."""
        u = self._u(x, y, z, t)
        h = self.h
        a = self._u(x, y + h, z, t)
        b = self._u(x, y - h, z, t)
        uzy = (a[2] - b[2]) / (2.0 * h)
        uxy = (a[0] - b[0]) / (2.0 * h)
        a = self._u(x, y, z + h, t)
        b = self._u(x, y, z - h, t)
        uyz = (a[1] - b[1]) / (2.0 * h)
        uxz = (a[0] - b[0]) / (2.0 * h)
        a = self._u(x + h, y, z, t)
        b = self._u(x - h, y, z, t)
        uyx = (a[1] - b[1]) / (2.0 * h)
        uzx = (a[2] - b[2]) / (2.0 * h)
        w = (uzy - uyz, uxz - uzx, uyx - uxy)
        return (u, w)

    def vorticity(self, x, y, z, t=0.0):
        """Bounded vorticity ``(wx, wy, wz)`` at a point."""
        return self.sample_uw(x, y, z, t)[1]

    def helicity_density(self, x, y, z, t=0.0):
        """Bounded scalar helicity density ``u . w`` at a point."""
        u, w = self.sample_uw(x, y, z, t)
        return u[0] * w[0] + u[1] * w[1] + u[2] * w[2]

    def potential(self, x, y, z, t=0.0):
        """Ramped vector potential ``ramp(d/th) * A`` at a point (zero inside)."""
        d = self.sdf(x, y, z)
        if d <= 0:
            return (0.0, 0.0, 0.0)
        _, A = self.base.sample_ua(x, y, z, t)
        r = _ramp(d / self.th)
        return (r * A[0], r * A[1], r * A[2])

    def bake3d(self, n, t=0.0):
        """Bake bounded velocity + helicity density on an ``n^3`` grid, float32 ``(n,n,n,4)``."""
        data = np.empty((n, n, n, 4), dtype=np.float32)
        for z in range(n):
            for y in range(n):
                for x in range(n):
                    u, w = self.sample_uw(
                        (x / n) * TAU, (y / n) * TAU, (z / n) * TAU, t
                    )
                    data[z, y, x, 0] = u[0]
                    data[z, y, x, 1] = u[1]
                    data[z, y, x, 2] = u[2]
                    data[z, y, x, 3] = u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
        return data

    def bake_potential3d(self, n, t=0.0):
        """Bake ramped potential (rgb) + raw SDF value (a) on an ``n^3`` grid."""
        data = np.empty((n, n, n, 4), dtype=np.float32)
        for z in range(n):
            for y in range(n):
                for x in range(n):
                    px = (x / n) * TAU
                    py = (y / n) * TAU
                    pz = (z / n) * TAU
                    d = self.sdf(px, py, pz)
                    if d <= 0:
                        data[z, y, x, 0] = 0.0
                        data[z, y, x, 1] = 0.0
                        data[z, y, x, 2] = 0.0
                    else:
                        _, A = self.base.sample_ua(px, py, pz, t)
                        r = _ramp(d / self.th)
                        data[z, y, x, 0] = r * A[0]
                        data[z, y, x, 1] = r * A[1]
                        data[z, y, x, 2] = r * A[2]
                    data[z, y, x, 3] = d
        return data
