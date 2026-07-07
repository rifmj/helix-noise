"""The spectral Helix Noise engine: a divergence-free helical flow field.

The field is an analytic sum of Beltrami (helical) modes and can be evaluated
grid-free at any point in space and time. Construct one with :func:`create`.
"""

import math

import numpy as np

from ._constants import DEFAULTS, GA, TAU
from ._rng import mulberry32
from .glsl import to_glsl


def _frame(dx, dy, dz):
    """Orthonormal transverse frame (e1, e2) perpendicular to unit (dx, dy, dz)."""
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
    return e1x, e1y, e1z, e2x, e2y, e2z


def _rot_from_uniforms(u1, u2, u3):
    """Uniform random rotation (row-major 3x3) — Shoemake's quaternion method."""
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


class HelixField:
    """A divergence-free helical flow field evaluatable at any point.

    Construct via :func:`create`. Mode arrays are exposed as numpy float64
    arrays; per-point sampling returns plain Python tuples/floats, and the
    ``sample_many*`` methods are numpy-vectorized.
    """

    def __init__(self, **opts):
        self.params = dict(DEFAULTS)
        self.params["spectrum"] = None
        self._apply_opts(opts)
        self._build()

    # ------------------------------------------------------------------ setup

    def _apply_opts(self, opts):
        for k, v in opts.items():
            if (k in DEFAULTS or k == "spectrum") and v is not None:
                self.params[k] = v

    def _build(self):
        p = self.params
        seed = int(p["seed"]) & 0xFFFFFFFF
        rng = mulberry32(seed or 1)
        N = int(p["modes"])
        self.N = N

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
        gam = min(9.0, max(-0.99, p["anisotropy"]))
        axis = p["axis"]
        an = math.hypot(axis[0], axis[1], axis[2]) or 1.0
        anx, any_, anz = axis[0] / an, axis[1] / an, axis[2] / an

        kx = np.zeros(N)
        ky = np.zeros(N)
        kz = np.zeros(N)
        km = np.zeros(N)
        a = np.zeros(N)
        s = np.zeros(N)
        ph = np.zeros(N)
        om = np.zeros(N)
        e1x = np.zeros(N)
        e1y = np.zeros(N)
        e1z = np.zeros(N)
        e2x = np.zeros(N)
        e2y = np.zeros(N)
        e2z = np.zeros(N)
        ci = [0] * N

        rot = None
        kms = None
        perm = None
        if fib:
            rot = _rot_from_uniforms(rng(), rng(), rng())
            kms = [0.0] * N
            kmin = p["kmin"]
            kmax = p["kmax"]
            for i in range(N):
                kms[i] = kmin + (kmax - kmin) * ((i + rng()) / N)
            perm = list(range(N))
            for i in range(N - 1, 0, -1):
                j = int(rng() * (i + 1))
                perm[i], perm[j] = perm[j], perm[i]

        spectrum = p.get("spectrum")
        slope = p["slope"]
        kmin = p["kmin"]
        kmax = p["kmax"]
        tileable = bool(p["tileable"])

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
                kmj = kmin + (kmax - kmin) * rng()

            if gam != 0:
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
            if tileable:
                kxc = float(round(kxc))
                kyc = float(round(kyc))
                kzc = float(round(kzc))
                if kxc == 0 and kyc == 0 and kzc == 0:
                    kxc = 1.0
                kmj = math.hypot(kxc, kyc, kzc)
                dx = kxc / kmj
                dy = kyc / kmj
                dz = kzc / kmj

            kx[j] = kxc
            ky[j] = kyc
            kz[j] = kzc
            km[j] = kmj

            f1x, f1y, f1z, f2x, f2y, f2z = _frame(dx, dy, dz)
            e1x[j] = f1x
            e1y[j] = f1y
            e1z[j] = f1z
            e2x[j] = f2x
            e2y[j] = f2y
            e2z[j] = f2z

            s[j] = 1.0 if rng() < (1.0 + p["helicity"]) / 2.0 else -1.0
            a[j] = max(0.0, spectrum(kmj)) if spectrum else math.pow(kmj, -slope)
            phr = TAU * rng()
            c = int(rng() * nc)
            ci[j] = c
            phc = -(kxc * cx[c] + kyc * cy[c] + kzc * cz[c])
            bx = (1.0 - lam) * math.cos(phr) + lam * math.cos(phc)
            by = (1.0 - lam) * math.sin(phr) + lam * math.sin(phc)
            ph[j] = math.atan2(by, bx)

        # Time evolution: all draws AFTER the spatial loop, so the t=0 field is
        # unchanged by the time knobs.
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

        rate0 = chi * np.cbrt(max(kmin, 1e-9))
        for j in range(N):
            sgn = -1.0 if rng() < 0.5 else 1.0
            c = ci[j]
            om[j] = (
                (1.0 - lam) * sgn * rate0 * math.pow(km[j], 2.0 / 3.0)
                - lam * (kx[j] * cvx[c] + ky[j] * cvy[c] + kz[j] * cvz[c])
            )

        self.kx, self.ky, self.kz, self.km = kx, ky, kz, km
        self.a, self.s, self.ph, self.om = a, s, ph, om
        self.e1x, self.e1y, self.e1z = e1x, e1y, e1z
        self.e2x, self.e2y, self.e2z = e2x, e2y, e2z
        self.cvx = np.array(cvx)
        self.cvy = np.array(cvy)
        self.cvz = np.array(cvz)
        self.nu = max(0.0, p["decay"])

        self._scale = 1.0
        self._scale = (p["amplitude"] or 1.0) / (self._rms() or 1.0)

    # ------------------------------------------------------------ amplitudes

    def _amps(self, t):
        if not (self.nu > 0) or t == 0:
            return self.a
        return self.a * np.exp(-self.nu * self.km * self.km * t)

    # ------------------------------------------------------- scalar samplers

    def sample_uw(self, x, y, z, t=0.0):
        """Return ``((ux, uy, uz), (wx, wy, wz))`` — velocity and vorticity."""
        A = self._amps(t)
        ux = uy = uz = wx = wy = wz = 0.0
        kx, ky, kz, km = self.kx, self.ky, self.kz, self.km
        ph, om, s = self.ph, self.om, self.s
        e1x, e1y, e1z = self.e1x, self.e1y, self.e1z
        e2x, e2y, e2z = self.e2x, self.e2y, self.e2z
        for j in range(self.N):
            phi = kx[j] * x + ky[j] * y + kz[j] * z + ph[j] + om[j] * t
            c = math.cos(phi)
            sn = math.sin(phi)
            sj = s[j]
            aj = A[j]
            tx = aj * (c * e1x[j] - sj * sn * e2x[j])
            ty = aj * (c * e1y[j] - sj * sn * e2y[j])
            tz = aj * (c * e1z[j] - sj * sn * e2z[j])
            ux += tx
            uy += ty
            uz += tz
            g = sj * km[j]
            wx += g * tx
            wy += g * ty
            wz += g * tz
        sc = self._scale
        return ((ux * sc, uy * sc, uz * sc), (wx * sc, wy * sc, wz * sc))

    def sample_ua(self, x, y, z, t=0.0):
        """Return ``((ux, uy, uz), (Ax, Ay, Az))`` — velocity and vector potential."""
        A = self._amps(t)
        ux = uy = uz = ax = ay = az = 0.0
        kx, ky, kz, km = self.kx, self.ky, self.kz, self.km
        ph, om, s = self.ph, self.om, self.s
        e1x, e1y, e1z = self.e1x, self.e1y, self.e1z
        e2x, e2y, e2z = self.e2x, self.e2y, self.e2z
        for j in range(self.N):
            phi = kx[j] * x + ky[j] * y + kz[j] * z + ph[j] + om[j] * t
            c = math.cos(phi)
            sn = math.sin(phi)
            sj = s[j]
            aj = A[j]
            tx = aj * (c * e1x[j] - sj * sn * e2x[j])
            ty = aj * (c * e1y[j] - sj * sn * e2y[j])
            tz = aj * (c * e1z[j] - sj * sn * e2z[j])
            ux += tx
            uy += ty
            uz += tz
            g = sj / km[j]
            ax += g * tx
            ay += g * ty
            az += g * tz
        sc = self._scale
        return ((ux * sc, uy * sc, uz * sc), (ax * sc, ay * sc, az * sc))

    def sample(self, x, y, z, t=0.0):
        """Velocity ``(u, v, w)`` at a point."""
        return self.sample_uw(x, y, z, t)[0]

    def vorticity(self, x, y, z, t=0.0):
        """Vorticity ``(wx, wy, wz)`` at a point."""
        return self.sample_uw(x, y, z, t)[1]

    def helicity_density(self, x, y, z, t=0.0):
        """Scalar helicity density ``u . w`` at a point."""
        u, w = self.sample_uw(x, y, z, t)
        return u[0] * w[0] + u[1] * w[1] + u[2] * w[2]

    def potential(self, x, y, z, t=0.0):
        """Vector potential ``(Ax, Ay, Az)`` at a point."""
        return self.sample_ua(x, y, z, t)[1]

    # ---------------------------------------------------- vectorized samplers

    def _many_core(self, pos, t):
        """Return (u, w) arrays of shape (n, 3) for an (n, 3) position array."""
        pos = np.asarray(pos, dtype=np.float64).reshape(-1, 3)
        A = np.asarray(self._amps(t), dtype=np.float64)
        # phase: (n, N)
        phi = (
            pos[:, 0:1] * self.kx
            + pos[:, 1:2] * self.ky
            + pos[:, 2:3] * self.kz
            + self.ph
            + self.om * t
        )
        c = np.cos(phi)
        sn = np.sin(phi)
        s = self.s
        # t_vec components: (n, N)
        tx = A * (c * self.e1x - s * sn * self.e2x)
        ty = A * (c * self.e1y - s * sn * self.e2y)
        tz = A * (c * self.e1z - s * sn * self.e2z)
        sc = self._scale
        u = np.empty((pos.shape[0], 3))
        u[:, 0] = tx.sum(axis=1) * sc
        u[:, 1] = ty.sum(axis=1) * sc
        u[:, 2] = tz.sum(axis=1) * sc
        g = s * self.km
        w = np.empty((pos.shape[0], 3))
        w[:, 0] = (g * tx).sum(axis=1) * sc
        w[:, 1] = (g * ty).sum(axis=1) * sc
        w[:, 2] = (g * tz).sum(axis=1) * sc
        return u, w

    def sample_many(self, pos, t=0.0):
        """Vectorized velocity for an ``(n, 3)`` (or flat) position array.

        Returns an ``(n, 3)`` numpy array of velocities.
        """
        u, _ = self._many_core(pos, t)
        return u

    def sample_many_uw(self, pos, t=0.0):
        """Vectorized velocity and vorticity; returns ``(u, w)`` each ``(n, 3)``."""
        return self._many_core(pos, t)

    # -------------------------------------------------------------- diagnostics

    def _rms(self):
        ng = 5
        s = 0.0
        n = 0
        for i in range(ng):
            for j in range(ng):
                for k in range(ng):
                    u, _ = self.sample_uw(
                        (i / ng) * TAU, (j / ng) * TAU, (k / ng) * TAU
                    )
                    s += u[0] * u[0] + u[1] * u[1] + u[2] * u[2]
                    n += 1
        return math.sqrt(s / n)

    def relative_helicity(self, ng=12):
        """Normalized mean helicity over an ``ng^3`` grid on ``[0, TAU)``."""
        H = un = wn = 0.0
        for i in range(ng):
            for j in range(ng):
                for k in range(ng):
                    u, w = self.sample_uw(
                        (i / ng) * TAU, (j / ng) * TAU, (k / ng) * TAU
                    )
                    H += u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
                    un += u[0] * u[0] + u[1] * u[1] + u[2] * u[2]
                    wn += w[0] * w[0] + w[1] * w[1] + w[2] * w[2]
        return H / (math.sqrt(un * wn) or 1.0)

    # --------------------------------------------------------------- bakes

    def bake3d(self, n, t=0.0):
        """Bake velocity + helicity density on an ``n^3`` grid.

        Returns a ``(n, n, n, 4)`` float32 array; rgba = (ux, uy, uz, u.w).
        """
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

    def bake2d(self, nx, ny, z=0.0, t=0.0):
        """Bake a ``(ny, nx, 4)`` float32 slice at height ``z``."""
        data = np.empty((ny, nx, 4), dtype=np.float32)
        for j in range(ny):
            for i in range(nx):
                u, w = self.sample_uw((i / nx) * TAU, (j / ny) * TAU, z, t)
                data[j, i, 0] = u[0]
                data[j, i, 1] = u[1]
                data[j, i, 2] = u[2]
                data[j, i, 3] = u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
        return data

    def bake_potential3d(self, n, t=0.0):
        """Bake vector potential + helicity density on an ``n^3`` grid.

        Returns ``(n, n, n, 4)`` float32; rgb = A_pot, a = u.w.
        """
        data = np.empty((n, n, n, 4), dtype=np.float32)
        for z in range(n):
            for y in range(n):
                for x in range(n):
                    px = (x / n) * TAU
                    py = (y / n) * TAU
                    pz = (z / n) * TAU
                    _, A = self.sample_ua(px, py, pz, t)
                    u, w = self.sample_uw(px, py, pz, t)
                    data[z, y, x, 0] = A[0]
                    data[z, y, x, 1] = A[1]
                    data[z, y, x, 2] = A[2]
                    data[z, y, x, 3] = u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
        return data

    # ---------------------------------------------------------------- misc

    def with_boundary(self, sdf, thickness=1.0, gradient=None, fd_step=1e-3):
        """Constrain this field by an SDF obstacle (free-slip). See :class:`BoundedField`."""
        from .boundary import BoundedField

        return BoundedField(
            self, sdf, thickness=thickness, gradient=gradient, fd_step=fd_step
        )

    def glsl(self, name="helixNoise", precision=7, curl=True, potential=False):
        """Emit self-contained GLSL (ES 3.00 / WebGL2) evaluating this field."""
        return to_glsl(
            self, name=name, precision=precision, curl=curl, potential=potential
        )

    def set(self, **opts):
        """Update options and rebuild in place; returns self."""
        self._apply_opts(opts)
        self._build()
        return self


def create(**opts):
    """Create a :class:`HelixField` from keyword options (see ``DEFAULTS``)."""
    return HelixField(**opts)
