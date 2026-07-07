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
VERSION = "1.0.0"
```

Defaults (every option):
```
modes=48, slope=1.6, helicity=0.0, coherence=0.0, kmin=1.0, kmax=6.2,
centers=3, amplitude=1.0, tileable=false, seed=1, layout="fibonacci",
churn=1.0, decay=0.0, anisotropy=0.0, axis=[0,0,1]
spectrum = optional callable (k:float)->float, no default
```

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

Given resolved params `p` and `N = modes`:

```
rng = mulberry32((seed>>>0)||1)
nc  = max(1, floor(centers))
# centers: nc points, each 3 draws
for m in 0..nc:  cx[m]=rng()*TAU; cy[m]=rng()*TAU; cz[m]=rng()*TAU
lam = clamp(coherence, 0, 1)
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
    s[j] = (rng() < (1+helicity)/2) ? 1 : -1                 # 1 draw
    a[j] = spectrum ? max(0, spectrum(km)) : pow(km, -slope)
    phr = TAU*rng()                                          # 1 draw
    c   = floor(rng()*nc)                                    # 1 draw ; ci[j]=c
    phc = -(kxc*cx[c] + kyc*cy[c] + kzc*cz[c])
    bx = (1-lam)*cos(phr) + lam*cos(phc)
    by = (1-lam)*sin(phr) + lam*sin(phc)
    ph[j] = atan2(by, bx)

# --- time evolution: ALL draws happen AFTER the spatial loop above ---
chi = max(0, churn)
sg  = chi / sqrt(3)
for m in 0..nc:   # isotropic Gaussian center velocity, Box-Muller, 4 draws each
    r1 = sqrt(-2*ln(1-rng())) ; a1 = TAU*rng()
    r2 = sqrt(-2*ln(1-rng())) ; a2 = TAU*rng()
    cvx[m] = sg*r1*cos(a1) ; cvy[m] = sg*r1*sin(a1) ; cvz[m] = sg*r2*cos(a2)
rate0 = chi * cbrt(max(kmin, 1e-9))
for j in 0..N:                # 1 draw each
    sgn = (rng() < 0.5) ? -1 : 1
    c = ci[j]
    om[j] = (1-lam)*sgn*rate0*pow(km[j], 2/3) - lam*(kx[j]*cvx[c] + ky[j]*cvy[c] + kz[j]*cvz[c])

nu = max(0, decay)
scale = 1
scale = (amplitude or 1) / (rms() or 1)      # see rms below
```

`rms()`: sample velocity on a 5×5×5 grid over [0,TAU); return sqrt(mean(|u|^2)). NOTE: rms uses the
un-scaled field (set scale=1 first). Grid point (i,j,k) → ((i/5)*TAU, (j/5)*TAU, (k/5)*TAU), i,j,k in 0..5.

## 5. Sampling (all take optional time t, default 0)

Amplitude at time t: `A[j] = a[j]` if `nu==0 or t==0`, else `a[j]*exp(-nu*km[j]^2*t)`.

`sampleUW(x,y,z,t) -> (u[3], w[3])` velocity + vorticity:
```
for each mode j:
    phi = kx[j]*x + ky[j]*y + kz[j]*z + ph[j] + om[j]*t
    c=cos(phi); sn=sin(phi)
    t_vec = A[j] * (c*e1[j] - s[j]*sn*e2[j])     # componentwise
    u += t_vec
    w += (s[j]*km[j]) * t_vec
return u*scale, w*scale
```

`sampleUA(x,y,z,t) -> (u[3], A_pot[3])` velocity + vector potential:
```
same t_vec; u += t_vec ; A_pot += (s[j]/km[j]) * t_vec ; return u*scale, A_pot*scale
```

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
Float literals must always contain `.` or `e`. Prefix `P_` = `<name>_`. Sanitize name to [A-Za-z0-9_].

## 9. Parity fixture

`parity_fixture.json` (in this folder) has, per config (A..E):
- `config`: the options
- `modes`: N, kx/ky/kz/km, e1*, e2*, s, a, ph, om, scale, nu  (full arrays)
- `samples`: list of {x,y,z,t, u:[3], w:[3], A:[3]}
- `relativeHelicity` (ng=8), `bake3d4_sum` (sum of all bake3D(4,0) floats)

Each port MUST include a test that loads this fixture, rebuilds each config, and asserts:
modes arrays, sample u/w/A, relativeHelicity, and bake sum all match within abs+rel 1e-9
(use 1e-7 for the bake sum which accumulates float32). Copy the fixture into the package's test dir.
