# Helix Noise — Porting Spec (single source of truth)

This distills the reference JS library (`packages/js/src/`) into a language-agnostic algorithm.
Port it faithfully; the parity fixture proves you got it right.

### Scope, per feature (and what is fixture-covered)

The spectral engine is the cross-port core and the only thing the parity fixture pins. Everything
else below is specified so that a port **transcribes rather than re-derives** — the table says where
each block already exists, not what a port is forbidden to add.

| block | spec § | JS | Python | Rust | WASM | shaders | in fixture |
|---|---|---|---|---|---|---|---|
| spectral engine (build + sampling) | §§1–6 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `withBoundary` (SDF free-slip) | §7 | ✅ | ✅ | ✅ | — | — | ✅ |
| GLSL / shader emitter | §8 | ✅ | ✅ | ✅ | ✅ | ✅ 4 targets | ✅ (GLSL) |
| scale-fn + `abc` + `twoScale` presets | §10.1–10.3 | ✅ | ✅ | ✅ | — | ⚠️ no `twoScale` | ✅ |
| NS presets (`exactNS`, `nsDeveloped`, `nsForced`) | §10.4–10.5 | ✅ | ✅ | ✅ | — | — | ❌ |
| `relativeHelicitySpectral` | §6.1 | ✅ | ✅ | ✅ | — | — | ❌ |
| structure primitives (rings, chassis, columns) | §11 | ✅ | — | — | — | — | ❌ |
| time warps (`collapse`, `dssCollapse`) | §12 | ✅ | — | — | — | — | ❌ |
| gradient + diagnostics (`sampleGrad`, `Q`, `λ₂`, stretching) | §13 | ✅ | — | — | — | — | ❌ |
| atom engine | §14 | ✅ | — | ✅ | ✅ | — | ✅ 3 configs |

**NOTE (normative):** a `❌` in the last column means a port may implement the block but **cannot
prove it** against `spec/parity_fixture.json` — the fixture only covers the spectral engine,
`withBoundary` and the GLSL emitter. Adding a block to the fixture requires regenerating it from
`packages/js` (see §9), and any block added to a second port SHOULD be added to the fixture in the
same change. Blocks marked JS-only in §§11–13 are closed forms with no RNG, so they can be
fixture-covered cheaply whenever a second port wants them; they are not out of scope by design, only
unported so far.

All floating-point math is IEEE-754 double. The RNG stream is bit-exact across languages (verified);
only transcendental functions (sin/cos/pow/cbrt/atan2/exp) differ by ~1 ULP, so field values match the
JS reference to ~1e-12 relative, NOT bit-for-bit. Parity tests must use a tolerance (abs+rel ~1e-9).

---

## 1. Constants

```
TAU  = 2*pi
GA   = pi * (3 - sqrt(5))     # golden angle (Fibonacci sphere azimuth step)
VERSION = "1.11.3"     # mirrors packages/js/src/constants.ts verbatim
```

**NOTE (normative):** `VERSION` is whatever the JS reference *exports*, and as of `1.11.3` that is
the package version — the two are now pinned to each other by a test in `packages/js/test`, which is
what closed the `1.11.1`/`1.11.2` drift (`constants.ts` sat at `1.11.0` while `package.json` moved).
Ports MUST mirror the exported constant.

Defaults (every option):
```
modes=48, slope=1.6, helicity=0.0, coherence=0.0, kmin=1.0, kmax=6.2,   # helicity/coherence:
                                                                       #   number OR pure (k)->value
centers=3, amplitude=1.0, tileable=false, seed=1, layout="fibonacci",
churn=1.0, decay=0.0, anisotropy=0.0, axis=[0,0,1], ellipticity=1.0,
polarizationAxis=null, polarizationBias=0.0,                           # spec 1.2
flutter=0.0                                                            # spec 1.3
spectrum = optional callable (k:float)->float, no default

PHI           = (1+sqrt(5))/2   # flutter rate multiplier (irrational => never resynchronizes)
POLAR_SALT    = 0x9E3779B9   # second-stream seed salt (32-bit wrapping add)
POLAR_DEG_MAX = 0.97         # polarization-degree ball radius (PSD of the 2x2 covariance)
```

**Spec version: 1.11.3** — the spec now tracks the JS reference's package version rather than an
independent counter. The independent counter is what let the spec sit at `1.3` while the reference
shipped through `1.11.2`: two version lines that could drift silently, and did. One line cannot.

Field-affecting blocks, in the order they landed (a block absent from a build changes nothing):

| shipped in | block | spec § |
|---|---|---|
| 1.1 | `ellipticity` + scale-fn presets | §5, §10.1 |
| 1.2 | grain-axis / polarization channel | §4b |
| 1.3 | flutter harmonic; scale-dependent `helicity`/`coherence`; `abc`; `twoScale` | §4c, §4, §10.2–10.3 |
| 1.5 | NS presets `exactNS` / `nsDeveloped` / `nsForced`; `relativeHelicitySpectral` | §10.4–10.5, §6.1 |
| 1.6 | structure primitives — rings, `ringSpeed`, `compose` | §11.3–11.4 |
| 1.7 | `sampleGrad` + `qCriterion` / `lambda2` / `stretching`; `glsl({gradient:true})` | §13 |
| 1.9 | axisymmetric `(ψ, Γ)` chassis; strained + counter-swirl columns | §11.1–11.2, §11.4 |
| 1.10 | time warps `collapse` / `dssCollapse` | §12 |
| 1.11.0 | diagnostics moved from `Field` onto **every** `FlowField` | §5.1, §13 |
| 1.11.1 | closed-form cylindrical partials for the axisymmetric family | §11.1–11.2, §13.2 |
| 1.11.3 | the scratch-buffer rule — six aliasing/frame corrections across `compose`, `twoScale`, warps, `withBoundary` and the axisymmetric frame | §7, §10.3, §11.0, §11.6, §12 |

spec-1.0 fields are the `ellipticity=1.0` special case, bit-identical — see the normative shortcut
note in §5.

## 2. mulberry32 (VERIFIED bit-exact — do NOT change the integer ops)

JS reference:
```js
function mulberry32(a){return function(){
  a|=0; a=(a+0x6d2b79f5)|0;
  let t=Math.imul(a^(a>>>15),1|a);
  t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return((t^(t>>>14))>>>0)/4294967296; };}
```

Python (proven identical stream):
```python
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
```

Rust (use `u32` wrapping arithmetic — `wrapping_add`, `wrapping_mul`; `>>` on u32 is logical):
```rust
pub struct Mulberry32 { a: u32 }
impl Mulberry32 {
    pub fn new(seed: u32) -> Self { Self { a: seed } }
    pub fn next_f64(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b79f5);
        let mut t = (self.a ^ (self.a >> 15)).wrapping_mul(self.a | 1);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61))) ^ t;
        (((t ^ (t >> 14)) as f64)) / 4294967296.0
    }
}
```
Seed init: `rng = mulberry32((seed >>> 0) || 1)` — i.e. `let s = (seed as u32); if s==0 {1} else {s}`.

## 3. Helpers

`frame(dx,dy,dz) -> (e1, e2)` orthonormal transverse frame ⟂ unit (dx,dy,dz):
```
if abs(dz) < 0.9: r = (0,0,1) else r = (0,1,0)
e1 = normalize(r × d)          # (ry*dz - rz*dy, rz*dx - rx*dz, rx*dy - ry*dx); if |e1|==0 use 1
e2 = d × e1                     # (dy*e1z - dz*e1y, dz*e1x - dx*e1z, dx*e1y - dy*e1x)
```
Note cross-product order exactly as above.

`rotFromUniforms(u1,u2,u3) -> 3x3 row-major` (Shoemake uniform random rotation):
```
s1=sqrt(1-u1); s2=sqrt(u1)
qx=s1*sin(TAU*u2); qy=s1*cos(TAU*u2); qz=s2*sin(TAU*u3); qw=s2*cos(TAU*u3)
xx=qx*qx; yy=qy*qy; zz=qz*qz; xy=qx*qy; xz=qx*qz; yz=qy*qz; wx=qw*qx; wy=qw*qy; wz=qw*qz
R = [ 1-2(yy+zz),  2(xy-wz),    2(xz+wy),
      2(xy+wz),    1-2(xx+zz),  2(yz-wx),
      2(xz-wy),    2(yz+wx),    1-2(xx+yy) ]   # row-major
```

## 4. Build (EXACT order of rng() draws — this order is load-bearing)

The number and order of `rng()` draws is a function of `(modes, centers, layout)` only:
`7*nc + 6N + 2` (fibonacci), `7*nc + 7N` (random). `helicity` and `coherence` never gate a
draw — `helicity` is only the comparison threshold of an always-executed draw, `coherence`
only a blend weight in arithmetic on already-drawn values. Scalar and callable forms are
therefore draw-sequence-identical, and a constant callable MUST reproduce the scalar config
bit-identically within a port.

Given resolved params `p` and `N = modes`:

```
rng = mulberry32((seed>>>0)||1)
nc  = max(1, floor(centers))
# centers: nc points, each 3 draws
for m in 0..nc:  cx[m]=rng()*TAU; cy[m]=rng()*TAU; cz[m]=rng()*TAU
lamFn = coherence callable if provided else (k -> clamp(coherence, 0, 1))
      # per-mode lam_j = clamp(lamFn(km[j]), 0, 1), at the FINAL km[j] (post tileable
      # rounding), like the spectrum callable. Consumes NO draws.
fib = (layout != "random")
gam = clamp(anisotropy, -0.99, 9)
an  = hypot(axis) or 1 ; (anx,any,anz) = axis/an

# --- fibonacci-only precompute (skipped entirely when layout=="random") ---
if fib:
    rot = rotFromUniforms(rng(), rng(), rng())        # 3 draws
    kms[i] = kmin + (kmax-kmin) * ((i + rng())/N)  for i in 0..N   # N draws, in order i=0..N-1
    perm = [0..N-1]; Fisher-Yates: for i in N-1..1: j=floor(rng()*(i+1)); swap(perm[i],perm[j])  # N-1 draws

# --- per mode j in 0..N ---
for j in 0..N:
    if fib:
        zf = 1 - (2j+1)/N ; rf = sqrt(max(0,1-zf*zf)) ; th = j*GA
        f = (rf*cos(th), rf*sin(th), zf)
        d = R * f            # row-major matrix-vector: dx=R0*fx+R1*fy+R2*fz, etc.
        km = kms[perm[j]]
    else:  # random
        z = 2*rng()-1 ; th = TAU*rng() ; r = sqrt(1-z*z)
        d = (r*cos(th), r*sin(th), z) ; km = kmin + (kmax-kmin)*rng()   # 3 draws total
    if gam != 0:
        dn = dot(d, an_axis)
        d += gam*dn*an_axis ; d = normalize(d)   # |d| or 1
    (kxc,kyc,kzc) = km * d
    if tileable:
        kxc=round(kxc); kyc=round(kyc); kzc=round(kzc)
        if kxc==0 and kyc==0 and kzc==0: kxc=1
        km=hypot(kxc,kyc,kzc); d=(kxc,kyc,kzc)/km
    store kx[j],ky[j],kz[j]=kxc,kyc,kzc ; km[j]=km
    (e1,e2) = frame(d)
    p_j    = helicity callable ? helicity(km[j]) : helicity   # NO draw
    s[j]   = (rng() < (1+p_j)/2) ? 1 : -1                     # 1 draw
    chi[j] = clamp(ellipticity, 0, 1) * s[j]                 # NO draw — deterministic post-transform
    a[j] = spectrum ? max(0, spectrum(km)) : pow(km, -slope)
    phr = TAU*rng()                                          # 1 draw
    c   = floor(rng()*nc)                                    # 1 draw ; ci[j]=c
    phc = -(kxc*cx[c] + kyc*cy[c] + kzc*cz[c])
    # additive phase interpolation (helical-fields Eq. 9): reference at full weight,
    # random part fades as lam->1. Well-defined for every lam (no lam=1/2 antipodal
    # singularity of the old complex-plane "chord" blend atan2((1-lam)e^iphr+lam e^iphc)).
    lam_j = clamp(lamFn(km[j]), 0, 1)                        # NO draw ; store for the om loop
    ph[j] = phc + (1-lam_j)*phr                              # lam=0 -> uniform random ; lam=1 -> phc

# --- time evolution: ALL draws happen AFTER the spatial loop above ---
churn_rate = max(0, churn)          # NB: the symbol `chi` is reserved for chirality (above)
sg  = churn_rate / sqrt(3)
for m in 0..nc:   # isotropic Gaussian center velocity, Box-Muller, 4 draws each
    r1 = sqrt(-2*ln(1-rng())) ; a1 = TAU*rng()
    r2 = sqrt(-2*ln(1-rng())) ; a2 = TAU*rng()
    cvx[m] = sg*r1*cos(a1) ; cvy[m] = sg*r1*sin(a1) ; cvz[m] = sg*r2*cos(a2)
rate0 = churn_rate * cbrt(max(kmin, 1e-9))
for j in 0..N:                # 1 draw each
    sgn = (rng() < 0.5) ? -1 : 1
    c = ci[j]
    om[j] = (1-lam_j)*sgn*rate0*pow(km[j], 2/3) - lam_j*(kx[j]*cvx[c] + ky[j]*cvy[c] + kz[j]*cvz[c])

nu = max(0, decay)
scale = 1
scale = (amplitude or 1) / (rms() or 1)      # see rms below
```

`rms()`: sample velocity on a 5×5×5 grid over [0,TAU); return sqrt(mean(|u|^2)). NOTE: rms uses the
un-scaled field (set scale=1 first). Grid point (i,j,k) → ((i/5)*TAU, (j/5)*TAU, (k/5)*TAU), i,j,k in 0..5.

## 4b. Polarization channel (spec 1.2) — grain axis / linear polarization

Skipped entirely when `polarizationAxis == null`: no second stream is created and the algorithm is
exactly §4. When set, **every §4 draw still happens in the same order with the same use** — the
channel is a post-pass consuming a SECOND, independent stream.

```
seedEff = (seed >>> 0) || 1                    # identical to §4's effective seed
seed2   = (seedEff + POLAR_SALT) >>> 0         # 32-bit wrapping add
rng2    = mulberry32(seed2 || 1)
```

The additive salt puts stream 2 a fixed ~6.1e8 draws down the same mulberry32 orbit — five orders
of magnitude beyond what any build consumes, so the two never overlap. (An XOR salt would make the
offset seed-dependent and unauditable; rejected.)

Post-pass: runs AFTER the `om[]` loop and BEFORE the rms/scale step, so normalization sees the
polarized field. With `n = polarizationAxis / (hypot || 1)`, `d = clamp(polarizationBias, 0, 0.95)`:

```
for j in 0..N:            # ascending j; EXACTLY 4 rng2 draws per mode, unconditional
    # complex standard normals, E|z|^2 = 1. NOTE: no factor 2 under the sqrt, unlike the real
    # Box-Muller of §4 — each real component must be N(0, 1/2). Copying -2*ln(...) here ships a
    # 2x-variance stream that only the fixture catches.
    r1 = sqrt(-ln(1 - rng2())) ; t1 = TAU*rng2() ; z1 = (r1*cos t1, r1*sin t1)
    r2 = sqrt(-ln(1 - rng2())) ; t2 = TAU*rng2() ; z2 = (r2*cos t2, r2*sin t2)

    d_hat = (kx,ky,kz)/km ; ndk = n . d_hat ; T = n - ndk*d_hat ; tl = |T|
    if tl > 1e-6: psi = atan2((T/tl).e2, (T/tl).e1) ; c2 = cos 2psi ; s2 = sin 2psi
    else:         c2 = 1 ; s2 = 0            # k parallel to the axis: grain undefined

    dd = d ; pp = chi[j] ; deg = hypot(dd, pp)
    if deg > POLAR_DEG_MAX: dd *= POLAR_DEG_MAX/deg ; pp *= POLAR_DEG_MAX/deg
    J11 = 1 + dd*c2 ; J22 = 1 - dd*c2 ; J21 = (dd*s2, pp)              # complex (re, im)
    L11 = sqrt(max(J11, 1e-12)) ; L21 = J21/L11 ; L22 = sqrt(max(J22 - |J21|^2/J11, 0))
    alpha1 = L11*z1 ; alpha2 = L21*z1 + L22*z2                          # complex arithmetic

    # fold into the stored frame; ph[j], om[j], a[j] all unchanged
    e1[j], e2[j] <- ( Re(alpha1)*e1 + Re(alpha2)*e2 , Im(alpha1)*e1 + Im(alpha2)*e2 )
    s[j] <- 1 ; chi[j] <- 1
    w1[j] = -(k x e2[j]) ; w2[j] = (k x e1[j])                          # curl frame, precomputed
mark the field GENERAL: the samplers and emitters take the general path of §5 / §8.
```

The folded `e1`/`e2` are no longer orthonormal — that is the point: they carry the sampled complex
amplitude. Divergence-freedom is untouched (`k . e1 = k . e2 = 0` still holds), so `withBoundary`
and the potential bakes need no change.

## 4c. Flutter (spec 1.3) — fast temporal decorrelation

A deterministic second harmonic on each mode's phase. No draws, and no effect at `t = 0`.

```
flutter >= 0                            # radians of phase wobble; 0 = off (skip entirely)
base    = PHI * rate0 * pow(max(kmax, kmin), 2/3)     # rate0 from §4's time block
omf[j]  = base * (1 + 0.25*cos(ph[j]))                # per-mode spread, deterministic

# the phase used by EVERY sampler and emitter becomes
ph_eff[j](t) = ph[j] + flutter * (sin(omf[j]*t + ph[j]) - sin(ph[j]))
```

The `- sin(ph[j])` term is normative: it makes the harmonic vanish exactly at `t = 0`, so the
static field is bit-identical to a `flutter = 0` build. The rate is the *finest* scale's eddy rate
times PHI, so the wobble is faster than any mode's own drift and never resynchronizes with it.
When `churn = 0`, `rate0 = 0` and flutter is inert — a frozen field stays frozen.

## 5. Sampling (all take optional time t, default 0)

Amplitude at time t: `A[j] = a[j]` if `nu==0 or t==0`, else `a[j]*exp(-nu*km[j]^2*t)`.

`sampleUW(x,y,z,t) -> (u[3], w[3])` velocity + vorticity:
```
for each mode j:
    phi = kx[j]*x + ky[j]*y + kz[j]*z + ph_eff[j](t) + om[j]*t     # ph_eff = ph unless flutter (§4c)
    c=cos(phi); sn=sin(phi)
    t_vec = A[j] * (c*e1[j] - chi[j]*sn*e2[j])          # velocity term (general chi)
    u += t_vec
    if ellipticity == 1:                                # Beltrami shortcut — REQUIRED at eps=1
        w += (s[j]*km[j]) * t_vec
    else:
        w += (A[j]*km[j]) * (chi[j]*c*e1[j] - sn*e2[j]) # general two-term curl
return u*scale, w*scale
```

`sampleUA(x,y,z,t) -> (u[3], A_pot[3])` velocity + vector potential:
```
same t_vec; u += t_vec
if ellipticity == 1: A_pot += (s[j]/km[j]) * t_vec
else:                A_pot += (A[j]/km[j]) * (chi[j]*c*e1[j] - sn*e2[j])   # A_j = w_j/k^2
return u*scale, A_pot*scale
```

**General (grain-axis) fields** — when §4b ran, neither shortcut applies; use the precomputed
curl frame (`s[j] = chi[j] = 1` after the fold):

```
u     += A[j] * (c*e1[j] - sn*e2[j])
w     += A[j] * (c*w1[j] - sn*w2[j])
A_pot += (A[j]/km[j]^2) * (c*w1[j] - sn*w2[j])
```

**NOTE (normative):** at `ellipticity == 1` ports MUST take the shortcut branch. The general form
is algebraically equal but rounds differently in the last ulp, and the parity fixture pins the
shortcut's bits. The elliptic mode stays exactly divergence-free and keeps the same Coulomb-gauge
potential (`curl A = u`, `k·A = 0`) for every `chi`, so `withBoundary` needs no change.

Derived:
```
sample()          = u  from sampleUW
vorticity()       = w  from sampleUW
helicityDensity() = dot(u, w) from sampleUW
potential()       = A_pot from sampleUA
```

## 5.1 The `FlowField` contract (spec 1.11.0)

Every field type in the library — the mode sum, the atom field, the closed-form primitives of §11,
the time warps of §12, and a boundary-constrained field — answers the **same** surface. Before
1.11.0 the four gradient entries lived only on the mode sum; moving them onto the shared interface is
what makes `qCriterion` mean the same thing on a column as on a noise field.

```
sample(x,y,z,t?)            -> u[3]
vorticity(x,y,z,t?)         -> w[3]
helicityDensity(x,y,z,t?)   -> dot(u,w)
potential(x,y,z,t?)         -> A_pot[3]                  # curl A_pot = u
sampleUW(x,y,z,out6,t?)     -> out6 = [u, w]
sampleUA(x,y,z,out6,t?)     -> out6 = [u, A_pot]
sampleGrad(x,y,z,out9,t?)   -> out9[3m+n] = d u_n / d x_m # ROW-major; see §13
qCriterion / lambda2 / stretching (x,y,z,t?) -> scalar    # §13.1
bake3D(n,t?) / bake2D(nx,ny,z?,t?) / bakePotential3D(n,t?) # §6
withBoundary(sdf, opts?)    -> FlowField                  # §7
```

**NOTE (normative):** `sampleGrad` is closed-form for every field type **except** a
boundary-constrained one, whose `∇d` comes from a user-supplied SDF that in general has no analytic
derivative. That one case uses the same central differences and the same `fdStep` its `vorticity`
already uses, so the two agree exactly rather than approximately. A port MUST NOT silently substitute
finite differences anywhere else: the whole point of the contract is that `curl(sampleGrad)`
reproduces the independently-derived `sampleUW` vorticity to ~1e-14, which an FD gradient cannot do.

**NOTE (normative):** a port that implements only the spectral engine satisfies this contract for the
mode sum alone. That is a valid port. It is not a valid excuse to type the gradient entries onto the
concrete field class rather than the shared interface — doing so reproduces exactly the 1.7.0→1.11.0
defect, where the shapes existed and had no diagnostic to colour by.

## 6. Bakes / diagnostics

`bake3D(n,t)`: for z,y,x in 0..n (x fastest), sample at ((x/n)*TAU,(y/n)*TAU,(z/n)*TAU);
store rgba = (u.x,u.y,u.z, dot(u,w)). Row-major flat Float32, length n^3*4.
`bake2D(nx,ny,z,t)`: j(0..ny) outer, i(0..nx) inner; point ((i/nx)*TAU,(j/ny)*TAU,z); rgba as above.
`bakePotential3D(n,t)`: rgb = A_pot (from sampleUA), a = dot(u,w) (from sampleUW at same point).
`relativeHelicity(ng=12)`: over ng^3 grid on [0,TAU): H=sum dot(u,w); un=sum|u|^2; wn=sum|w|^2;
   return H / (sqrt(un*wn) or 1).

## 6.1 relativeHelicitySpectral(t=0) (spec 1.5)

The same ratio computed straight from the mode arrays — exact and grid-free, where §6's
`relativeHelicity` is a grid estimate of it. Uses no sampling at all:

```
H = E = Z = 0
for j in 0..N:
    k2 = km[j]^2
    m  = a[j]^2 * ((nu > 0 and t != 0) ? exp(-2*nu*k2*t) : 1)     # squared decayed amplitude
    (p1, p2) = (e1[j], e2[j])                # the stored frame, general or not
    if GENERAL (§4b ran):
        (q1, q2) = (w1[j], w2[j])            # precomputed curl frame
    else:
        q1 = (chi[j]*km[j]) * e1[j]          # NOTE: from the UNSCALED e2/e1 — see below
        q2 = km[j] * e2[j]
        p2 = chi[j] * e2[j]                  # only NOW is the velocity frame scaled by chi
    E += 0.5*m * (dot(p1,p1) + dot(p2,p2))
    Z += 0.5*m * (dot(q1,q1) + dot(q2,q2))
    H += 0.5*m * (dot(p1,q1) + dot(p2,q2))
return H / (sqrt(E*Z) or 1)
```

**NOTE (normative):** in the non-general branch the curl frame `q2 = km*e2` is built from the
**unscaled** `e2`, and `p2 = chi*e2` is formed afterwards. A port that scales `e2` by `chi` first and
then derives `q2` from it ships `q2 = chi*km*e2` and gets a wrong `Z` (and a wrong `H` for
`|chi| != 1`). At `ellipticity == 1` the two orders coincide, so this bug is invisible on every
spec-1.0 config — it only appears once `ellipticity < 1`.

**NOTE:** this is not fixture-covered. It agrees with `relativeHelicity(ng)` to ~1e-9 for few,
distinct, integer wavevectors, and legitimately diverges from it when `tileable` rounding makes
wavevectors collide (the grid estimate then sees cross terms the per-mode sum does not).

## 7. withBoundary(sdf, {thickness=1, gradient=None, fdStep=1e-3}) — free-slip obstacle

The bounded velocity is `∇×(ramp(d/th)·A)` = `ramp·u + ramp'·(∇d×A)`, with A the base field's
analytic vector potential and `d = sdf(x,y,z)`, `th = max(thickness, 1e-9)`. EXACT ramp (Bridson
quintic — note ramp'(0)=15/8>0, giving slip not no-slip):
```
q = d / th
ramp(q):   if q<=0 -> 0 ; if q>=1 -> 1 ; else q*(15 - 10*q^2 + 3*q^4)/8
dramp(q):  if q<0 or q>=1 -> 0 ; else (15/8)*(1 - q^2)^2
```
Velocity (via base.sampleUA → gives u_base in [0..2], A_base in [3..5]):
```
if d <= 0:  u_bounded = (0,0,0)
elif q >= 1: u_bounded = u_base
else:
    grad_d = gradient(x,y,z) if supplied else central-diff of sdf with fdStep h (6 sdf calls)
    r = ramp(q) ; rp = dramp(q)/th
    cross = grad_d × A_base = (gy*Az - gz*Ay, gz*Ax - gx*Az, gx*Ay - gy*Ax)
    u_bounded = rp*cross + r*u_base
```
vorticity(bounded) = central differences of u_bounded itself (O(fdStep^2)); the reference computes
w = (∂u_z/∂y-∂u_y/∂z, ∂u_x/∂z-∂u_z/∂x, ∂u_y/∂x-∂u_x/∂y) via ±h stencils on `_u`.
potential(bounded): if d<=0 -> 0 else ramp(d/th)*A_base.

**NOTE (normative):** §11.6's buffer rule bites hardest here, because the six ±h stencils each call
`base.sampleUA` again. The buffer that receives the base `(u, A)` MUST NOT be the one the caller is
using as its own output — `helicityDensity` reads velocity from slots 0..2 *after* those six calls
have run, and a shared buffer leaves a neighbouring point's raw base field sitting in them. Measured
inside the influence band: `+0.675` against a correct `-1.030`, i.e. the wrong sign. `vorticity` is
unaffected only because slots 3..5 are written last — do not rely on that ordering.
The `boundary_F` config in the fixture uses base config B with sdf = sphere: `hypot(x-3,y-3,z-3) - 1.2`
(no analytic gradient → central-diff path), thickness=0.9, fdStep=1e-3.

## 8. GLSL / shader emitter

The reference bakes the computed mode arrays as GLSL constants (it does NOT regenerate the RNG in
shader). Emit a self-contained function. Reference output shape (GLSL ES 3.00 / WebGL2):

```glsl
const int  P_N = N;
const vec3 P_K[N]  = vec3[N]( vec3(kx,ky,kz), ... );
const vec3 P_E1[N] = ...; const vec3 P_E2[N] = ...;
const float P_S[N]=...; P_A[N]=...; P_PH[N]=...; P_OM[N]=...;
const float P_SCALE = scale;   // and P_NU when decay>0
vec3 name(vec3 p, float t){ vec3 u=vec3(0.);
  for(int j=0;j<P_N;j++){ float phi=dot(P_K[j],p)+P_PH[j]+P_OM[j]*t;
    u += (P_A[j] /*or P_A[j]*exp(-P_NU*dot(P_K[j],P_K[j])*t)*/) * (cos(phi)*P_E1[j]-P_S[j]*sin(phi)*P_E2[j]); }
  return u*P_SCALE; }
vec3 name(vec3 p){ return name(p,0.0); }
// optional: nameCurl (w += P_S[j]*length(P_K[j])*tv), namePot (A += (P_S[j]/length(P_K[j]))*tv)
```

When `flutter > 0` the emitter also bakes `P_FL` (the amplitude) and `P_OMF[N]` (the rates), and
every `phi` line gains `+ P_FL * (sin(P_OMF[j]*t + P_PH[j]) - sin(P_PH[j]))`.

`P_S[N]` holds `chi_j = ellipticity*s_j` (continuous; equals the drawn signs when `ellipticity==1`),
so the velocity body above is already the correct general form with no ABI change. The `nameCurl`
and `namePot` shortcuts are Beltrami-only: emit them **iff every |chi_j| == 1** (byte-identical to
spec 1.0 output), otherwise emit the general two-term bodies:

For a **grain-axis** field neither shortcut applies; emit the cross-product body instead (no new
baked arrays — the folded frame is already in `P_E1`/`P_E2`, and `P_S[j] = 1`):

```glsl
vec3 tv2 = (amp) * (-sin(phi) * P_E1[j] - cos(phi) * P_E2[j]);
w += cross(P_K[j], tv2);                        // nameCurl
A += cross(P_K[j], tv2) / dot(P_K[j], P_K[j]);  // namePot
```

```glsl
// nameCurl, general chi
vec3 tw = (amp) * (P_S[j] * cos(phi) * P_E1[j] - sin(phi) * P_E2[j]);
w += length(P_K[j]) * tw;
// namePot, general chi (A_j = w_j / k^2, same tw)
A += tw / length(P_K[j]);
```
Float literals must always contain `.` or `e`. Prefix `P_` = `<name>_`. Sanitize name to [A-Za-z0-9_].

## 9. Parity fixture

`parity_fixture.json` (in this folder) has **18 configs** in three shapes.

**Spectral configs** — `A_default_small`, `B_helical_coherent`, `C_random_aniso`, `D_decay_time`,
`E_tileable`, `J_elliptic_linear`, `K_elliptic_half`, `M_coherence_k`, `N_helicity_k`, `O_shellpeak`,
`Q_grain`, `R_flutter`, `P_abc`:
- `config`: the options (`P_abc` carries `{"$factory": "abc", "args": [...]}` instead)
- `modes`: N, kx/ky/kz/km, e1*, e2*, s, chi, a, ph, om, scale, nu  (full arrays)
- `samples`: list of {x,y,z,t, u:[3], w:[3], A:[3]}
- `relativeHelicity` (ng=8), `bake3d4_sum` (sum of all bake3D(4,0) floats)

**Boundary configs** — `boundary_F`, `boundary_L_elliptic`:
- `base_config`, `thickness`, `fdStep`, `samples` (no `modes` block — the base config supplies it)

**Atom configs** — `G_atoms_default`, `H_atoms_helical`, `I_atoms_aniso`:
- `config`, `scale`, `kBase`, `samples`, `relativeHelicity`, `bake3d4_sum`
- no `modes` array: atoms are regenerated from the spatial hash, so there is nothing precomputed to
  pin. The samples are what pin them.

Callable options are stored as named preset descriptors `{"$preset": name, "args": [...]}`,
which each port maps through its own §10.1 preset registry; `P_abc` carries
`{"$factory": "abc", "args": [...]}` instead of a config. Only preset-built callables are
covered by cross-port parity — free-form user callables are out of fixture scope by
construction.

Each port MUST include a test that loads this fixture, rebuilds each config, and asserts:
modes arrays, sample u/w/A, relativeHelicity, and bake sum all match within abs+rel 1e-9
(use 1e-7 for the bake sum which accumulates float32). Copy the fixture into the package's test dir.

## 10. Presets (normative)

### 10.1 Scale-function presets

Pure functions of `|k|`; the fixture references them by name.

```
shellPeak(kPeak, width=1):      a(k)   = exp(-(k-kPeak)^2 / (2*width^2))
rolloff(kc):                    lam(k) = clamp(1 - k/kc, 0, 1)
condensate(kSplit, pL, pS=0):   p(k)   = (k <= kSplit) ? pL : pS
```

### 10.2 abc(A=1, B=1, C=1) — direct-mode field, NO RNG

Exactly these three modes (`e1`/`e2` are what `frame()` from §3 produces for these
directions — listed so a port can verify its frame implementation):

```
j=0: k=(0,0,1), e1=(1,0,0),  e2=(0,1,0), s=+1, a=A, ph=-pi/2
j=1: k=(1,0,0), e1=(0,1,0),  e2=(0,0,1), s=+1, a=B, ph=-pi/2
j=2: k=(0,1,0), e1=(-1,0,0), e2=(0,0,1), s=+1, a=C, ph=+pi
```

`om = (0,0,0)` (steady); `nu` = the `decay` option; `scale = 1` unless an `amplitude` is
given, in which case `scale = amplitude / sqrt(A^2+B^2+C^2)`.

**NOTE (normative):** that closed form equals `rms()` in exact arithmetic but differs by
~1 ulp in IEEE-754 depending on summation order — ports MUST use the closed form, never
`rms()`.

Field identity: `u = (A sin z + C cos y, B sin x + A cos z, C sin y + B cos x)`, with
`curl u = u` and `potential = u` (a pure Beltrami field), exactly `2*pi`-tileable.

### 10.3 twoScale(base, detail, detailGain=1)

`u`, `w` and `A_pot` are the componentwise sums `base + detailGain * detail`.
Divergence-free and potential-exact by linearity.

**NOTE (normative):** `twoScale` is a sum node exactly as `compose` is, so **§11.6's buffer rule
applies to it** — its two per-part buffers MUST be per-instance or per-call. Either slot may hold
another `twoScale`; with a shared buffer, nesting in `detail` drops the outer base and doubles the
inner one, while nesting in `base` is accidentally correct. See §11.6(d) for the measured witness.
`detailGain` multiplies the inner sum as a whole, not a term of it.

### 10.4 exactNS(k0=2, nu=0.02, sign=+1, ...rest) — an exact Navier-Stokes solution (spec 1.5)

Returns an **options bundle**, not a field: the caller passes it to the ordinary builder of §4. All
modes share one `|k| = k0` and one handedness, which makes the field Beltrami (`curl u = sign*k0*u`);
the nonlinear term is then a pure gradient absorbed by the pressure, and what remains is exact
viscous decay — which is precisely what §5's `decay` does to every amplitude.

```
kmin        = k0
kmax        = k0            # ONE shell: |k| identical for every mode
helicity    = sign          # p = +-1 makes every drawn sign that sign
churn       = 0             # om = 0; the only t-dependence is the viscous decay
decay       = nu            # nu = 0 gives the steady Euler member
tileable    = false
ellipticity = 1
then apply ...rest, which MAY override any of the above
```
`rest` is pass-through: `modes`, `seed`, `amplitude`, `coherence`, `centers`, `layout`.

**NOTE (normative):** exactness rests on exactly two of these and a port MUST document that, because
`rest` can silently break it — `tileable: true` rounds wavevectors to the integer lattice and
destroys the single shell, and `ellipticity < 1` makes the modes non-Beltrami. Neither is rejected;
both are overridable, and both void the claim. The other pass-throughs are safe.

Acceptance (not fixture-covered): `curl u = sign*k0*u` pointwise; `u(t) = exp(-nu*k0^2*t)*u(0)` to
machine precision; `relativeHelicitySpectral = sign` exactly and constant in `t`.

### 10.5 nsDeveloped / nsForced / NS_TARGETS (spec 1.5)

Option bundles whose **polarization** matches two measured turbulence states. `absP` is the per-mode
helical fraction, `signedP` its signed mean; `d` is the linear-polarization degree.

```
NS_TARGETS = {
  dev:    { d: 1.155, absP: 0.462, signedP: 0.057 },
  forced: { d: 1.062, absP: 0.516, signedP: 0.229, condensateK1: 0.55 },
}

epsForP(p) = (1 - sqrt(1 - p*p)) / p        # inverts the per-mode 2*eps/(1+eps^2) = p of §5

bundle(target) = {
  modes = 96, layout = "random",            # a genuine iid ensemble, as the target was measured
  kmin = 1, kmax = 15,                      # the band holding ~99% of the measured energy
  ellipticity = epsForP(target.absP),
  helicity    = target.signedP / target.absP,
}
nsDeveloped(overrides) = bundle(NS_TARGETS.dev)    then apply overrides
nsForced(overrides)    = bundle(NS_TARGETS.forced) then apply overrides
```

**NOTE (normative):** `d` and `condensateK1` are exported for tests and docs and are consumed by
**neither** bundle. Do not wire `d` into `polarizationBias`: §4b clamps the bias to `[0, 0.95]` and
the joint polarization-degree ball to `POLAR_DEG_MAX = 0.97`, so both `d` values above sit outside
what the grain channel can represent. `condensateK1` likewise needs a per-wavenumber `helicity`
callable (§10.1 `condensate`) that the bundle does not build.

**NOTE:** the polarization is calibrated; the **spectrum is not** — both bundles keep the default
power law. Matching the measured shell spectrum needs a table this package does not ship. A port MUST
carry that caveat into its own docs; it is the whole honesty of the preset.

## 11. Closed-form structure primitives (normative, spec 1.6 / 1.9)

A second field genre next to the mode sum: localized closed forms with **no RNG at all** — zero draws,
so every existing fixture config is untouched by construction. All satisfy §5.1.

### 11.0 Shared machinery

```
FD = 1e-5          # the ONLY finite-difference step in this family. NOT BoundaryOptions.fdStep.
norm3(v):  n = hypot(v) || 1 ; return v/n        # the zero vector maps to ITSELF, not to a default axis
```

Cylindrical frame, for centre `c` and unit axis `n`:

```
d = (x,y,z) - c ;  zc = dot(d, n) ;  rvec = d - zc*n ;  r = hypot(rvec)
if r > 1e-12:  e_rho = rvec / r
else:          e_rho = (|n_z| < 0.9) ? normalize(z_hat x n) = normalize(-n_y, n_x, 0)
                                     : normalize(y_hat x n) = normalize(n_z, 0, -n_x)
e_phi = n x e_rho :   px = n_y*e_z - n_z*e_y ;  py = n_z*e_x - n_x*e_z ;  pz = n_x*e_y - n_y*e_x
world(vr, vt, vz)[i] = vr*e_rho[i] + vt*e_phi[i] + vz*n[i]
```

**NOTE (normative):** `e_phi = n x e_rho` in exactly that order, and the frame rows handed to
§13.2's assembler are `[e_rho ; e_phi ; n]`. Reversing the cross product flips every swirl.

**NOTE (normative):** on the axis the transverse direction is a *free* choice but not an *arbitrary*
one — it must be orthogonal to `n`, because §13.2 uses the frame as the `E` of `E^T L E`, which is a
similarity transform only for an orthonormal `E`. Both branches above are therefore cross products
with `n`, which are exactly orthogonal, and the split at `0.9` only picks the one that is not short:
`|z_hat x n| >= 0.436` when `|n_z| < 0.9`, `|y_hat x n| >= 0.9` when it is not. Taking a raw
coordinate axis instead is the defect measured in §11.6(c). Velocity, vorticity and potential do not
care (they vanish or are frame-independent on the axis), so a port that gets this wrong will pass
every sampler test it has.

**NOTE (normative):** the family carries **three distinct axis thresholds** and they MUST NOT be
unified — `1e-12` on `r` (frame, and the ring's early return), `1e-9` on `r` (§13.2's assembler),
`1e-12` on `q = r^2` (the column's `u^theta`, i.e. `r < 1e-6`). Between `1e-12` and `1e-9` a port that
picks one threshold diverges from the reference.

Sampler wiring. `t` is **accepted and ignored** by the whole axisymmetric family (these fields are
stationary); only `createRing({advect:true})` and forwarding through §11.4's `compose` make any of them
time-dependent.

```
cyl(r, z, out6)   -> out6 = [u^r, u^theta, u^z, w^r, w^theta, w^z]
pot(r, z, out2)   -> out2 = [A_theta, A_z]           # A_rho == 0 ALWAYS, by construction
dcyl(r, z, out6)  -> out6 = [d_r u^r, d_r u^th, d_r u^z, d_z u^r, d_z u^th, d_z u^z]
```

**NOTE (normative):** a `cyl` implementation MAY write only the slots it owns; the **caller** zeroes the
buffer. A port that skips the zero-fill leaks the previous sample into the current one.

If a primitive does not set `analyticVorticity`, `sampleUW` takes central differences of the assembled
**Cartesian** velocity at `h = FD`, costing 12 extra velocity evaluations. The base `dcyl` fallback
likewise differences `cyl` in the `(r, z)` half-plane at `h = FD`, and does **not** clamp `r - h`, so it
evaluates `cyl` at negative `r`. Both shipped subclasses override `dcyl`, so that path is dead for
them — a port that adds a subclass inherits it.

### 11.1 axisymmetric(opts) — the (psi, Gamma) chassis

Any two smooth profiles define an exactly divergence-free axisymmetric-with-swirl field. With
`q = r^2`:

```
psi = r^2 * P(q, z)          Gamma = r^2 * h(q, z)
u^r     = -(1/r) d_z psi = -r * P_z
u^z     =  (1/r) d_r psi =  2*P + 2*q*P_q
u^theta =  Gamma / r     =  r * h
```

The `r^2` factorization is what enforces axis smoothness: on the axis `u -> (0, 0, 2*P(0, z))`, an
ordinary point. `stream` and `swirl` are both optional; absent both, the field is identically zero
(not an error).

Closed-form partials (`dcyl`, spec 1.11.1):

```
d_r u^r     = -P_z - 2*q*P_qz          d_z u^r     = -r * P_zz
d_r u^z     =  2*r*(4*P_q + 2*q*P_qq)  d_z u^z     =  2*P_z + 2*q*P_qz
d_r u^theta =  h + 2*q*h_q             d_z u^theta =  r * h_z
```

Divergence vanishes identically for **any** profiles: `(-P_z - 2qP_qz) + (-P_z) + (2P_z + 2qP_qz) = 0`.

**NOTE (normative):** `d_r u^z` carries a **4**, not a 2 — differentiating `u^z = 2P + 2qP_q` gives
`2P_q*(2r) + 2*(2r)*P_q + 2q*P_qq*(2r)`, and the two `4r*P_q` terms are easy to collapse into one.

Profile-derivative fallback ladder, when `AxiProfile` does not supply a derivative:

```
dq:   h_step = FD*(1 + |q|)
      (q - h_step < 0) ? ( f(q+h) - f(0) ) / (q + h)      # FORWARD, anchored at q = 0
                       : ( f(q+h) - f(q-h) ) / (2*h)
dz:   ( f(q, z+FD) - f(q, z-FD) ) / (2*FD)                # fixed step, NOT scaled
dqq:  differences dq ;  dqz: differences dq in z ;  dzz: differences dz in z
```

**NOTE (normative):** the `dq` fallback is asymmetric in `q` on purpose — the step scales as
`FD*(1+|q|)`, and below `q ~ 1e-5` (`r <~ 3.16e-3`) it degrades to a one-sided difference anchored at
`q = 0` with denominator `q + h`, so the profile is never evaluated at negative `q` (where `q = r^2` is
meaningless).

**NOTE (normative):** `dqq`/`dqz`/`dzz` difference `dq`/`dz`, which may themselves be differences. That
nested FD is the accuracy cliff. Measured gradient error vs central differences for
`P = e^-q sin z`, `h = e^-2q` at `(0.7, 0.3, 0.45)`: no derivatives `1.7e-6`; `dq`/`dz` supplied
`4.9e-11`; all five `5.6e-11`. **The trace is `<= 1.1e-16` in all three cases** — the divergence
cancellation is structural, so *the trace does not test whether the profile derivatives are right.*
The `AxiProfile` doc comment claiming `dq`/`dz` are what make the field divergence-free predates the
`dcyl` override and is wrong; what they buy is gradient accuracy.

Potential:

```
A_theta = r * P(q, z)                                        # = psi / r
A_z     = swirlIntegral ? -0.5 * H(q, z)
                        : -0.5 * (composite Simpson of h on [0, q], EXACTLY N = 24 intervals)
```

**NOTE (normative):** the Simpson panel width is `q/24`, so the fallback degrades as `r^2` grows.
Measured against exact `H` for `h = e^-2q`: `r=0.1` → `2.6e-18`; `r=0.7` → `2.4e-9`; `r=1.5` → `1.7e-6`;
`r=3.0` → `4.1e-4`. `potential()`, `bakePotential3D()` and `withBoundary()` all inherit that. Supply
`swirlIntegral` for large radii. A port substituting adaptive quadrature will not match the fixture.

**NOTE (normative):** the chassis does **not** set `analyticVorticity` — `vorticity()` is central
differences at `h = FD` even when the profile supplies every analytic derivative, while `sampleGrad`
*is* closed form. So for the chassis alone these are two different code paths agreeing only to
`O(FD^2) ~ 1e-10`. For the ring and the column both are exact and agree to `~1e-16` relative.

**NOTE (normative):** this is NOT a Navier-Stokes solution. Do not label it "exact".

### 11.2 strainedColumn(opts) — an exact stationary NS solution

```
a = strain (default 0.7, NOT clamped) ; nu = max(viscosity, 1e-9) ; eps = circulation (NOT clamped)
b = a / (2*nu) ;  analyticVorticity = TRUE

u^r     = -a*r
u^theta = (q < 1e-12) ? eps*b*r : eps*(1 - exp(-b*q))/r
u^z     =  2*a*z
omega   = (0, 0, (eps*a/nu) * exp(-b*q))        # purely axial and Gaussian
core radius = sqrt(2*nu/a) ;  peak = eps*a/nu
```

This is the classical Burgers vortex. Closed-form partials (`z`-independent):

```
x = b*r^2 ;  e = exp(-x) ;  E = (x > 1e-300) ? -expm1(-x)/x : 1
d_r u^r = -a ;  d_r u^theta = eps*b*(2*e - E) ;  d_z u^z = 2*a ;  all others 0
```

**NOTE (normative):** the `x > 1e-300` guard returns `E = 1`, the correct limit — not `0`. And write it
as `-expm1(-x)/x`, never `(1 - exp(-x))/x`, which is `0/0` at the origin and ~`1e-5` relative wrong at
`x ~ 1e-11`.

**NOTE (normative):** the **value** path is not conditioned, only the derivative path is. `u^theta` uses
a naive `1 - exp(-b*q)`, so just outside the `q < 1e-12` seam it loses digits at relative error
`~eps_mach/(b*q)`. Measured at `r = 1e-6`: `6.3e-6` at `b = 7`, **`8.0e-4` at `b = 0.05`**, `8.3e-8` at
`b = 150`. This also inflates any central-difference probe near the axis, which is an artifact of the
probe crossing the seam and **not** a `sampleGrad` error. A port writing `-expm1(-b*q)/r * eps` here is
*more* accurate than the reference and will fail bit-parity — document whichever you choose.

Potential (`A_rho = 0`):

```
A_theta = a*r*z
A_z     = -(eps/2) * G(b*r^2) ,     G(u) = gamma + ln u + E1(u)
gLog(u) = (u < 1e-8) ? u - u^2/4 : GAMMA + log(u) + expInt1(u)
GAMMA   = 0.5772156649015329
```

`G(0) = 0` (the logarithms cancel exactly), so `A_z` is regular on the axis; `G(u) ~ ln u + gamma` for
large `u`, so `A_z` grows logarithmically and is **NOT compactly supported** — the solenoid obstruction
is intrinsic. Consequence to document: an obstacle far from a column still sees non-zero `A`, so
`withBoundary` keeps exact incompressibility but only *approximate* locality. The ring's potential
**is** compact, so it has exact locality.

```
expInt1(x):
    x <= 0     -> Infinity
    x <= 1     -> s = -GAMMA - log(x) ; term = 1
                  for k = 1..29:  term *= -x/k ;  s -= term/k
                  return s
    otherwise  -> cf = 0 ; for k = 20 down to 1: cf = (k*k)/(x + 2*k + 1 - cf)
                  return exp(-x) / (x + 1 - cf)
```

**NOTE (normative, bit-pinned):** the 29-term series / 20-level continued fraction / crossover-at-`x = 1`
triple is pinned, and the crossover is **discontinuous**: `E1(1) = 0.21938393439552029` from the series
against `0.21938388241688814` from the CF, a `2.4e-7` relative step. CF-20's worst error is `2.4e-7` at
`x = 1.001`, falling to exact by `x >= 10`. A port that deepens the CF, moves the crossover, or calls a
library `E1` differs by up to `2.4e-7` relative in `A_z` — so any fixture over a column's potential must
reproduce the triple exactly or use a tolerance looser than `3e-7` relative. `gLog`'s own `u < 1e-8`
seam is likewise discontinuous by `8.5e-8` relative; keep that threshold too.

Closed-form receipt worth keeping: on the axis `Q = a^2*(eps^2/(4*nu^2) - 3)` exactly, so a vortex core
exists **iff `eps > 2*sqrt(3)*nu`**, independent of strain.

**NOTE:** the mirror sector `sigma = +-1` of the design notes did **not** ship as an API option. It is a
symmetry of the construction, not a parameter.

### 11.3 createRing(opts) / ringSpeed(circulation, radius, core)

Built as an explicit curl of a compactly supported azimuthal potential.

```
R = max(radius, 1e-9)
c = min( max(core, 1e-9), 0.95*R )         # floor FIRST, then cap
G = circulation (NOT clamped)
speed = advect ? ringSpeed(G, R, c) : 0    # uses the CLAMPED R and c
advection: subtract speed*t*n from the sample point before anything else
```

```
dr = rho - R ;  q2 = dr^2 + zc^2 ;  s = 1 - q2/c^2
h  = G*s^3                     # = A_phi
H1 = -6*G*s^2 / c^2            # = (dA/dq)/q  -- FINITE at q = 0
H2 = 24*G*s   / c^4            # = (dH1/dq)/q

u^rho   = -H1*zc               u^axial = h/rho + H1*dr        u^theta = 0   (no swirl)
A       = h * e_phi
omega   = -( 2*H1 + H2*q2 + H1*dr/rho - h/rho^2 ) * e_phi

d_r u^r = -H2*dr*zc            d_r u^th = 0    d_r u^z = H1*dr/rho - h/rho^2 + H2*dr^2 + H1
d_z u^r = -H1 - H2*zc^2        d_z u^th = 0    d_z u^z = H1*zc/rho + H2*zc*dr
```

Guards: `rho < 1e-12` → all zeros; `q2 >= c2` → all zeros (**compared on squares**, not on `q` vs `c`).

**NOTE (normative):** `h`, `H1` and `H2` all carry a positive power of `s`, so all three vanish at the
support boundary — `u`, `omega`, `A` and `grad` go to zero *continuously* rather than stepping. Use the
same `q2 >= c2` comparison to land on the same side of that seam; values there are `~1e-29`, so this is
a bit-parity concern only.

**NOTE (normative):** the `rho < 1e-12` early return is sound **only because** of the `c <= 0.95*R` cap
— at `rho = 0`, `q2 = R^2 + zc^2 >= R^2 > c^2`. A port that relaxes the cap turns that return into a
silent discontinuity.

**NOTE (normative):** `circulation` is **not the circulation.** `G` is the amplitude of `A_phi`; the
ring's net circulation is exactly **zero**, because `u == 0` on `q = c` and Stokes then forces
`∫∫ omega_phi dA = 0`. The vorticity is a signed pair, changing sign at `q/c = 1/sqrt(3)` in the
thin-core limit (measured `0.577350274` at `c/R = 1/1500` against `1/sqrt(3) = 0.577350269`). Do NOT
rescale `G` to make the circulation come out to `G` — the fixture depends on `A_phi = G*(1-q^2/c^2)^3`
literally.

```
ringSpeed(G, R, c):  r = max(R, 1e-12) ; cc = max(c, 1e-12)
                     return (G / (2*TAU*r)) * (log(8*r/cc) - 0.25)      # 2*TAU = 4*pi
```

**NOTE (normative):** `ringSpeed`'s guards are `1e-12` with **no `0.95*R` cap**, unlike the constructor's
`1e-9`-plus-cap. So called directly with `core > 0.95*R` it does not report the speed the ring actually
advects at (measured 8.5x apart). Clamp in the constructor; do NOT re-clamp inside `ringSpeed`. Nothing
guards `c > 8R`, where the log goes negative and the ring travels backwards.

### 11.4 compose / collidingRings / counterSwirlColumns

```
compose(...fields):  u, omega, A_pot and grad are each the componentwise sum over parts; t is
                     forwarded to every part. div u = 0 and curl A = u survive by linearity.

collidingRings:      compose( ring(center = c - (sep/2)*axis, circulation = +G),
                              ring(center = c + (sep/2)*axis, circulation = -G) )

counterSwirlColumns: n = norm3(perp(axis, offsetAxis))            # offset is ACROSS the axis
                     compose( column(center = c + (sep/2)*n, circulation = +G),
                              column(center = c - (sep/2)*n, circulation = -G) )

perp(ax, hint):  try hint first, then the unit vector e_m with m = argmin|ax_i| (strict <, ties
                 resolve to the LATER index); project out ax; accept when |p| > 1e-9; else (1,0,0).
                 axis=(0,0,1) -> offset = y_hat (NOT x_hat).
```

**NOTE (normative):** the two pairings use **opposite conventions** — `+G` at `-sep/2` for
`collidingRings`, `+G` at `+sep/2` for `counterSwirlColumns`. Reversed, rings recede instead of
colliding.

**NOTE (normative):** `compose` is the one place in §11 where a field calls *another* field while
holding a buffer, so its per-part accumulation buffer MUST NOT be shared — see §11.6(a) and (b) for
the two ways a shared one goes wrong and the numbers each produces. Both `collidingRings` and
`counterSwirlColumns` return a composition, so composing either with anything else nests.

**NOTE (normative):** `counterSwirlColumns` offsets across the axis, never along it. Stacked along a
shared axis the pair cancels globally (`omega_z` depends on `r` alone and never decays in `z`), leaving
only doubled strain — and every mid-plane invariant then holds **vacuously**. An acceptance test MUST
assert the off-plane non-zeros alongside the on-plane zeros.

Exact mid-plane identities for `axis = z`, offset `x`, columns at `(+-d, 0)`, on `x = 0`:
`dot(u, n) = 0` exactly; `u_y = -2*a*y - 2*eps*d*(1 - exp(-b*r^2))/r^2`; `u_z = 4*a*z`; `omega = 0` on
that plane **and only there**. The pair is NOT an NS solution — `compose` is linear, NS is not.

### 11.5 columnCore / columnPeakVorticity

```
columnCore(strain, viscosity)                = sqrt( 2*max(viscosity, 0) / max(strain, 1e-12) )
columnPeakVorticity(strain, viscosity, circ) = circ*strain / max(viscosity, 1e-12)
```

**NOTE (normative):** these two helpers and `strainedColumn` itself use **three different viscosity
floors** — `0`, `1e-12` and `1e-9` — so at degenerate inputs the helpers do not describe the field they
name. Measured: `columnPeakVorticity(0.7, 0, 1) = 7e11` while the field's own on-axis `omega_z` is
`7.0e8`, a factor of 1000. At `strain = 0` the field is identically zero while `columnCore` reports a
`3e5` core radius. A port should unify the floors or reproduce all three; the fixture cannot tell,
because it has no degenerate cases.

### 11.6 Scratch buffers, and requirements a port will not discover by testing

**THE BUFFER RULE (normative, applies package-wide, not only to §11).** A reusable scratch buffer may
be shared — module-level, or one slot reused by several methods — **only if it is never live across a
call into other code**: another field, a virtual method, or a user callback. Every buffer that *is*
live across such a call MUST be per-instance or per-call. The failure is silent by construction: the
callee is handed the very array its caller is part-way through writing, so a sum turns `out[i] += s[i]`
into `x += x`, and a value that was already stored gets replaced by the callee's own answer.

This one rule covers **six** separate defects the reference carried, in four different files — §11's
`compose` and axisymmetric partials, §10.3's `twoScale`, §12's warps, and §7's bounded field. All six
were fixed in 1.11.3; each is restated below or cross-referenced from its own section, with the number
a violating implementation actually produces.

None of them is fixture-covered, and none is reachable by testing the obvious case: (a) needs a
nesting, (b) needs non-parallel parts, (c) needs a tilted axis, (d) needs a *particular* nesting.
Ports SHOULD keep every witness as a live assertion; §13.4's rule applies to all of them (a zero is
evidence only when the corresponding non-zero has been checked too).

**(a) The accumulation buffer in `compose` MUST be per-instance or per-call, never shared.** With a
module-level scratch array, a part that is *itself* a composition receives the same array as both its
output and its scratch, and `out[i] += scratch[i]` silently becomes `x += x`. Measured on two
overlapping rings — `A = ring{center: [0,0,-0.15], radius: 1.2, core: 0.5, circulation: 1.5}`,
`B = ring{center: [0.1,0,0.15], radius: 1.0, core: 0.5, circulation: -1.1}` — at `(1.05, 0.12, 0.03)`,
in x:

```
hand sum A + B              =  6.750743634300225        # the answer
compose(A, B)  one level    =  6.750743634300225        # correct, and bit-for-bit
compose(compose(A), B)      = 10.752650072825293        # = 2*A + B
compose(compose(A, B))      =  5.4976743915503095       # = 2*B, A LOST
```

Note the third line: one level is right, so the shape of the bug is *invisible until something nests*
— and `collidingRings` and `counterSwirlColumns` **are** `compose`, which makes
`compose(collidingRings(...), spectralField)` — the exact idiom `compose` advertises — the common
case rather than an exotic one. The same applies to the `grad` accumulation, not only `u`/`omega`/`A`.
Per-instance suffices: a field cannot contain itself, so no instance is ever re-entered while its own
buffer is live.

**(b) The buffer `stretching()` reads vorticity into MUST NOT be one any composed field uses as
per-part scratch.** This is (a)'s buffer seen from the other side: the shared `stretching` hands
`sampleUW` an array that `compose` then overwrites per part, so it sees `omega = 2 x (last part)`
instead of `sum omega_i` — wrong on a composed field even at **one level**, where (a) itself is
harmless. Measured on two orthogonal columns at `(0.15, 0.12, 0.1)`: reported `1.6670309861260726`
against a recomputed `0.9141621188419307` — **82% relative error**. It is masked wherever the last
part's vorticity is nearly parallel to the total, because the factor 2 cancels in `xi = omega/|omega|`
and `xi.S.xi` is even in `xi`; that is why a suite of parallel-axis cases agrees to 9 digits. **A test
for this MUST use parts whose vorticities are not parallel, and MUST assert that they are not** —
otherwise it passes on the broken implementation. `qCriterion` and `lambda2` are unaffected at one
level (they never touch the vorticity buffer).

**(c) The on-axis frame fallback MUST be orthogonal to the axis** — see §11.0's second normative note
for the construction. Taking `e_rho = y_hat` raw when `|n_z| >= 0.9` gives `e_rho . n = n_y != 0`, so
`E^T L E` is not a similarity transform and `sampleGrad`, `qCriterion`, `lambda2` and `stretching` are
all wrong on the axis of a tilted field. Velocity, vorticity and potential are unaffected. Measured
for `strainedColumn{strain: 0.9, viscosity: 0.08, circulation: 1.3, axis: [0, 0.28, 0.96]}` sampled
exactly on its axis:

```
tr(grad) on axis  = 0.07056  = EXACTLY a*n_y^2 = 0.9 * 0.0784      # a divergence out of nothing
tr(grad) off axis = 2.2e-16                                        # the fallback is not reached
tr(grad), axis = [0, 0, 1]      = 0      # n_y = 0, so y_hat happens to be orthogonal
tr(grad), axis = [0, 0.6, 0.8]  = 0      # the |n_z| < 0.9 branch, which was always correct
Q on axis         = 47.038   against the closed form (eps*a/2nu)^2 - 3a^2 = 51.04265625
```

The trace is the cheapest witness but not the only one: `Q = -1/2 tr(G^2)` is conjugation-invariant
too, and unlike the trace it does not vanish, so it catches a bad frame that happens to preserve the
trace. **A test MUST use an axis with `|n_z| >= 0.9` AND `n_y != 0`**; the default `[0, 0, 1]` and any
`|n_z| < 0.9` axis both pass on the broken implementation.

**(d) The same rule, in three more places.** Each is a separate violation with its own witness, kept
beside the block it belongs to:

```
§10.3  twoScale     nesting in the DETAIL slot drops the outer base and doubles the inner one.
                    Measured, three mode sums at (0.83, 0.41, 0.22): sampleUW off by 1.456 on a
                    signal of 3.15, sampleGrad by 1.615. Nesting in BASE is accidentally correct,
                    so a three-scale cascade was right or wrong purely by association order.

§12    warps        warp(warp(f)) is safe by luck -- every write is out[i] = k*buf[i] at the same
                    index, so aliasing degenerates to an in-place rescale. Put a sum node between
                    them and the luck ends: warp(compose(A, warp(B))) drops A and counts B twice
                    at two different scales. Measured off by 1.187 on a signal of 1.93.

§7     withBoundary helicityDensity() handed sampleUW the same buffer the bounded-velocity core
                    refills with the RAW base field at each of its six finite-difference points,
                    so the velocity slots held a neighbour's answer. Wrong TODAY, no nesting
                    needed: inside the influence band, +0.675 reported against -1.030 -- wrong
                    sign. vorticity() survived only because slots 3..5 are written last, which is
                    luck, not design.
```

**None of it is fixture-covered.** `spec/parity_fixture.json` contains no `§11` primitive at all — its
only `axis` entries are the *anisotropy* axis of the spectral and atom configs, which never reaches
this frame. Regenerating the fixture after all six fixes reproduces it **byte-identically**, which is
the receipt that (c)'s behaviour change — real, for tilted-axis fields — moves nothing that is pinned.
A port adding §11 to the fixture (see §9) should include a tilted-axis on-axis `sampleGrad`.

## 12. Time warps (normative, spec 1.10)

A warp wraps **any** `FlowField` (§5.1) and changes how it behaves in `t` rather than what it
contains. §4's `churn` and `flutter` are local in time; these are global — the whole pattern
**focuses**, shrinking toward a point while speeding up.

Common core, for a centre `c`, a length scale `L(t) > 0` and an amplitude `A(t)`:

```
tau(t) = max(T - t, minTau)                 # clamped, never allowed to reach 0
xi     = ((x,y,z) - c) / L(t)
tb     = freezeProfile ? 0 : t              # the clock handed to the WRAPPED field

u      = A(t)         * U(xi, tb)
omega  = (A(t)/L(t))  * W(xi, tb)
A_pot  = (A(t)*L(t))  * Apot(xi, tb)
grad   = (A(t)/L(t))  * gradU(xi, tb)       # same A/L as the vorticity, same reason
```

**Divergence-freedom is unconditional.** The chain rule gives `div u = (A/L)*(div U) = 0` for **any**
positive `L(t)` and **any** `A(t)` — it does not depend on `q`, `T`, `c`, or on the amplitude being
tied to the scale. A warp cannot break the library's one guarantee whatever the caller sets.

**NOTE (normative):** the three scale factors differ — `u` by `A`, `omega` by `A/L`, `A_pot` by
`A*L`. This is the single likely implementation bug and each MUST be its own assertion. `A_pot` must
still satisfy `curl A_pot = u` after warping (it does: the warp is a coordinate change plus a scalar).

**NOTE (normative):** §11.6's buffer rule applies to the warp's own buffer, and the tempting shortcut
here is *particularly* misleading. A warp writes `out[i] = k * buf[i]` index by index, so aliasing
`out` and `buf` is harmless — `warp(warp(f))` gives the right answer with a shared buffer, which
reads as proof that sharing is fine. It is not: put a §11.4 sum node in between and
`warp(compose(A, warp(B)))` drops `A` and counts `B` twice at two different scales, because `compose`
accumulates into that buffer across its parts while the inner warp overwrites it mid-loop. A test
that only nests warp inside warp will certify a broken implementation — see §11.6(d).

### 12.1 collapse(field, opts)

```
defaults: T = 1, q = 0.6, center = [0,0,0], tieAmplitude = true,
          minTau = 1e-4, freezeProfile = true

L(t) = tau(t)^q
A(t) = tieAmplitude ? q * tau(t)^(q-1) : 1
```

`0 < q < 1` completes in finite time; `q -> 1` is a gentle drift that never arrives. The sweep
integral `int^T L^-1 dt` converges **iff `q < 1`**, which is exactly the statement that the collapse
completes rather than asymptoting. With `tieAmplitude` the norms follow
`|u|_inf = q*tau^(q-1)`, `|u|_L2 = q*tau^(2q-1)`.

### 12.2 dssCollapse(field, opts) — the exact log-periodic loop

```
extra defaults: lambda = 2, b = 0.6, a = 0.8,
                scaleProfile Theta(p) = 1 + 0.25*cos(TAU*p),  ampProfile Alpha(p) = 1

lambda = max(lambda, 1.0000001)              # guard: logL = 0 would divide by zero
logL   = ln(lambda)
s(t)   = -ln(tau(t))                         # renormalization time
phi(t) = s(t)/logL mod 1, mapped into [0,1)  # if the remainder is negative, add 1
L(t)   = tau(t)^b     * Theta(phi(t))
A(t)   = tau(t)^(-a)  * Alpha(phi(t))
```

`Theta` and `Alpha` MUST be 1-periodic and strictly positive. Under `s -> s + logL` the field repeats
**exactly**, up to `L -> lambda^(-b)*L` and `A -> lambda^a*A`: one rendered period tiles the whole
collapse, with no cross-fade and no drift. §12.1 is the member with `Theta = Alpha = 1`.

**Loop-exactness receipt** (the headline acceptance test): `u(s + logL)` equals `lambda^a * u(s)` at
`lambda^(-b)`-rescaled coordinates. Measured in the JS reference — one period `4.4e-15`, two periods
`7.1e-15`, and with `freezeProfile: false` deliberately `7.6e-1`.

**NOTE (normative):** `freezeProfile` defaults to **true** and is load-bearing, not a convenience.
`u = A(t)*U(xi)` presumes the profile `U` is fixed; a wrapped field with `churn` active is not one, and
self-similarity cannot hold for a picture that is itself evolving. The first implementation passed the
live `t` through and the loop receipt came back 11% wrong. Ports MUST keep the failing case as a live
assertion, not a caveat — a guarantee with nothing to contrast against is not checkable.

**NOTE (normative):** the exponents are **free parameters**. `1/2 < b < 1` and `b < a < (1+b)/2` is a
*necessary* budget constraint on a hypothetical Navier-Stokes singularity that nobody has exhibited.
Offer it as a preset range; do NOT clamp sliders to it, and do NOT describe the warp as blow-up,
singularity or turbulence. It is a kinematic animation law with exact incompressibility.

**Caveat to document, not to fix:** sampling the wrapped field at `xi` with `L -> 0` walks ever
further into its far field, where a non-`tileable` spectral field is uncorrelated with what was on
screen a moment earlier — a deep zoom dissolves into hash. Wrap a `tileable` field or a closed-form
primitive (§11), whose structure survives arbitrary rescaling.

## 13. Gradient and diagnostics (normative, spec 1.7 / 1.11.0)

### 13.1 Layout and the three readings

`sampleGrad` writes 9 floats, **row-major**: `g[3*m + n] = d u_n / d x_m`.

For the mode sum, differentiating §5's velocity term wave by wave:

```
d_m u_n = scale * sum_j A[j] * k[j][m] * ( -sin(phi_j)*e1[j][n] - chi[j]*cos(phi_j)*e2[j][n] )
```

with `phi_j` (flutter-shifted, §4c), `A[j]` (decayed, §5) and `chi[j]` exactly as in §5, and the same
`scale` every sampler applies. For a GENERAL grain-axis field (§4b) take `chi[j] = 1` — the folded
frame is already `(e1', e2')` — so the one line serves every mode type.

**NOTE (normative):** there is no Beltrami shortcut branch here. §5's samplers pin the
`ellipticity == 1` shortcut's bits; the gradient has one path for all `chi`.

```
Q      = -0.5 * sum_{m,n} g[3m+n] * g[3n+m]          # = 1/2(|Omega|^2 - |S|^2) for div-free flow
S      = 0.5*(G + G^T) ;  Omega = 0.5*(G - G^T)
lambda2 = middle eigenvalue of (S*S + Omega*Omega)
stretching = e.S.e  with e = omega/|omega| ;  return 0 exactly if |omega| < 1e-300
```

`eigMid3(M)` for symmetric row-major `M` — closed-form trigonometric root of the characteristic
cubic, no iteration:

```
p1 = M[1]^2 + M[2]^2 + M[5]^2
if p1 <= 1e-300:  return middle of sorted (M[0], M[4], M[8])     # already diagonal
q  = (M[0] + M[4] + M[8]) / 3
p2 = (M[0]-q)^2 + (M[4]-q)^2 + (M[8]-q)^2 + 2*p1
p  = sqrt(p2 / 6)
B  = (M - q*I) / p
r  = clamp(det(B) / 2, -1, +1)                       # rounding can push it a hair outside
ph = acos(r) / 3
e_max = q + 2*p*cos(ph) ;  e_min = q + 2*p*cos(ph + 2*pi/3)
return 3*q - e_max - e_min                           # trace - largest - smallest
```

**NOTE (normative):** the `clamp(det(B)/2, -1, 1)` is not cosmetic — without it `acos` returns NaN on
matrices that are numerically degenerate, which for this library means the common case of a nearly
axisymmetric core. Likewise the `1e-300` guards return exact zeros rather than dividing.

### 13.2 Axisymmetric fields: assembling the Cartesian gradient

For a field with `d_phi = 0`, the gradient in the local orthonormal frame `(e_rho, e_phi, e_z)` is

```
        [ d_r u^r    d_r u^theta   d_r u^z ]
L   =   [ -u^theta/r   u^r/r         0     ]   <- the frame's own rotation, not a derivative
        [ d_z u^r    d_z u^theta   d_z u^z ]

world gradient = E^T * L * E,   E rows = [e_rho, e_phi, e_z]
```

**NOTE (normative):** the middle row is where an axisymmetric gradient is usually got wrong. Nothing
varies with `phi`, yet the `phi`-derivative is non-zero because the basis vectors themselves turn. It
is also what makes `div u = d_r u^r + u^r/r + d_z u^z` come out right — omit it and the divergence
stops vanishing.

On the axis, `u^r` and `u^theta` both vanish linearly, so the ratios tend to the radial derivatives:

```
inv = (r > 1e-9) ? 1/r : 0
middle row = (r > 1e-9) ? ( -u^theta*inv , u^r*inv , 0 )
                        : ( -d_r u^theta , d_r u^r , 0 )
```

**NOTE (normative, 1.11.1):** the cylindrical partials fed to this assembler MUST be the closed forms
of §11, not central differences. The tell is the divergence: differenced partials floor it at `~1e-11`
(the finite-difference floor), closed forms reach `~1e-16`. 1.11.0 shipped the differenced version
while its own notes claimed closed form; 1.11.1 fixed it.

### 13.3 Composition

```
twoScale:   grad = grad_base + detailGain * grad_detail          # linear, exact
warp (§12): grad = (A/L) * grad_wrapped(xi)
boundary:   central differences with the same fdStep vorticity() uses (§7) -- the ONE FD path
atoms:      each atom differentiated analytically; see packages/js/src/atoms.ts
```

### 13.4 Acceptance

Verified in the JS reference for all thirteen analytic field types:

- against central differences, `<= 4e-10` relative;
- `tr(grad) = 0` to machine zero — that *is* the divergence;
- **the real cross-check:** `curl(sampleGrad)` reproduces the independently-derived `sampleUW`
  vorticity to `1e-14`. The two derivations share nothing, so this is not a tautology.
- A physical receipt rather than an identity: on a strained column `Q` changes sign at `1.13` core
  radii — `Q` comes from the gradient, the core radius `sqrt(2*nu/a)` from the closed-form Gaussian
  vorticity.

**NOTE (normative):** the test MUST refuse to pass on a field that is zero at the sample points. A
vacuous version of this check — every assertion satisfied because nothing was sampled — was caught
while writing it. An assertion on a zero is evidence only when the corresponding non-zero has been
checked too.

## 14. Atom engine — status

The sparse-atom engine (compactly supported helical atoms placed by a spatial hash) is **not
transcribed here**, but it **is** fixture-covered: `G_atoms_default`, `H_atoms_helical` and
`I_atoms_aniso` pin `scale`, `kBase`, eight u/w/A samples, `relativeHelicity` and the bake checksum
(there is no `modes` array to pin — the atoms are regenerated from the hash rather than precomputed).
It ships in JS (`packages/js/src/atoms.ts`, `atoms-glsl.ts`), Rust (`packages/rust/src/atoms.rs`) and
WASM.

Earlier revisions of this spec declared it out of scope with "do not invent it". That instruction is
obsolete twice over: there are now **two independent implementations** (JS and Rust) *and* a fixture to
check against. Port from the JS source, cross-check against Rust, and the existing three configs
already prove it — nothing new needs generating.

What holds across the engines and is worth restating: every atom is exactly `curl(W*A)`, so the field
is divergence-free at any `t` with any parameter fields; `helicityField(x,y,z)` / `gainField(x,y,z)`
are frozen into each atom at its centre; and the emitted GLSL **regenerates** the atoms in-shader from
the integer hash rather than baking arrays, so the integer PRNG must port bit-exactly (CPU/GPU agree
to `~1.3e-6` in float32 on a live WebGL2 context).
