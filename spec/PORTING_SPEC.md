# Helix Noise — Porting Spec (single source of truth)

This distills the **spectral engine** of the reference JS library
(`PRODUCTS/helix-noise/src/{constants,rng,field,glsl}.ts`) into a language-agnostic algorithm.
Port it faithfully; the parity fixture proves you got it right.

**Scope for v0.1 of every port:** the spectral engine + `withBoundary` (SDF free-slip) + a GLSL/shader
emitter where relevant. The *atom engine* (`atoms.ts`) is explicitly OUT of scope for v0.1 — note it
as a documented follow-up. Do not invent it.

All floating-point math is IEEE-754 double. The RNG stream is bit-exact across languages (verified);
only transcendental functions (sin/cos/pow/cbrt/atan2/exp) differ by ~1 ULP, so field values match the
JS reference to ~1e-12 relative, NOT bit-for-bit. Parity tests must use a tolerance (abs+rel ~1e-9).

---

## 1. Constants

```
TAU  = 2*pi
GA   = pi * (3 - sqrt(5))     # golden angle (Fibonacci sphere azimuth step)
VERSION = "1.8.0"
```

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

**Spec version: 1.3** (1.1 adds `ellipticity` and the §10 presets, 1.2 the §4b grain-axis channel, 1.3 the §4c flutter harmonic; spec-1.0 fields are the `ellipticity=1.0` special case,
bit-identical — see the normative shortcut note in §5).

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

## 6. Bakes / diagnostics

`bake3D(n,t)`: for z,y,x in 0..n (x fastest), sample at ((x/n)*TAU,(y/n)*TAU,(z/n)*TAU);
store rgba = (u.x,u.y,u.z, dot(u,w)). Row-major flat Float32, length n^3*4.
`bake2D(nx,ny,z,t)`: j(0..ny) outer, i(0..nx) inner; point ((i/nx)*TAU,(j/ny)*TAU,z); rgba as above.
`bakePotential3D(n,t)`: rgb = A_pot (from sampleUA), a = dot(u,w) (from sampleUW at same point).
`relativeHelicity(ng=12)`: over ng^3 grid on [0,TAU): H=sum dot(u,w); un=sum|u|^2; wn=sum|w|^2;
   return H / (sqrt(un*wn) or 1).

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

`parity_fixture.json` (in this folder) has, per config (A..E, J..K):
- `config`: the options
- `modes`: N, kx/ky/kz/km, e1*, e2*, s, chi, a, ph, om, scale, nu  (full arrays)
- `samples`: list of {x,y,z,t, u:[3], w:[3], A:[3]}
- `relativeHelicity` (ng=8), `bake3d4_sum` (sum of all bake3D(4,0) floats)

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
