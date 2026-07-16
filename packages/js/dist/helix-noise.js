// src/constants.ts
var TAU = 2 * Math.PI;
var VERSION = "1.1.0";
var DEFAULTS = {
  modes: 48,
  // number of helical modes (cost of one sample is O(modes))
  slope: 1.6,
  // spectral slope s: amplitude ~ |k|^-s  (steep = big swirls)
  helicity: 0,
  // p in [-1, 1]: energy split between +/- helical states
  coherence: 0,
  // lambda in [0, 1]: phases random -> structured (fixed spectrum)
  kmin: 1,
  // smallest wavenumber (largest structures)
  kmax: 6.2,
  // largest wavenumber (finest detail)
  centers: 3,
  // focus points the coherent phases organize toward
  amplitude: 1,
  // output scale; normalized to unit RMS speed, then * amplitude
  tileable: false,
  // snap wavevectors to the integer lattice => exactly 2*PI-periodic
  seed: 1,
  layout: "fibonacci",
  // mode layout: low-discrepancy directions + stratified spectrum ("random" = i.i.d. ensemble)
  churn: 1,
  // time-evolution rate for sample(x, y, z, t): eddy-turnover phase churn + structure sweep
  decay: 0,
  // viscosity nu >= 0: mode amplitudes decay as e^(-nu k^2 t)
  anisotropy: 0,
  // direction stretch along `axis`: < 0 streaks along it, > 0 layers across it
  axis: [0, 0, 1]
  // anisotropy axis
};

// src/rng.ts
function mulberry32(a) {
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// src/glsl.ts
function fl(x, pr) {
  const s = Number(x).toPrecision(pr);
  return /[.eE]/.test(s) ? s : s + ".0";
}
function toGLSL(f, opts = {}) {
  const name = (opts.name ?? "helixNoise").replace(/[^A-Za-z0-9_]/g, "_");
  const pr = opts.precision ?? 7;
  const curl = opts.curl !== false;
  const pot = opts.potential === true;
  const N = f.N;
  const P = name + "_";
  const decay = f.nu > 0;
  const v3 = (cx, cy, cz) => {
    const ax = f[cx], ay = f[cy], az = f[cz];
    const parts = [];
    for (let j = 0; j < N; j++) parts.push(`vec3(${fl(ax[j], pr)},${fl(ay[j], pr)},${fl(az[j], pr)})`);
    return `vec3[${N}](${parts.join(",")})`;
  };
  const fa = (c) => {
    const arr = f[c];
    const parts = [];
    for (let j = 0; j < N; j++) parts.push(fl(arr[j], pr));
    return `float[${N}](${parts.join(",")})`;
  };
  const amp = decay ? `${P}A[j] * exp(-${P}NU * dot(${P}K[j], ${P}K[j]) * t)` : `${P}A[j]`;
  const L = [
    "// Helix Noise \u2014 generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.",
    `// ${N} modes. Defines vec3 ${name}(vec3 p) / (vec3 p, float t)${curl ? ` and vec3 ${name}Curl \u2014 same pair.` : "."}`,
    `const int ${P}N = ${N};`,
    `const vec3 ${P}K[${N}] = ${v3("kx", "ky", "kz")};`,
    `const vec3 ${P}E1[${N}] = ${v3("e1x", "e1y", "e1z")};`,
    `const vec3 ${P}E2[${N}] = ${v3("e2x", "e2y", "e2z")};`,
    `const float ${P}S[${N}] = ${fa("s")};`,
    `const float ${P}A[${N}] = ${fa("a")};`,
    `const float ${P}PH[${N}] = ${fa("ph")};`,
    `const float ${P}OM[${N}] = ${fa("om")};`,
    `const float ${P}SCALE = ${fl(f._scale, pr)};`,
    ...decay ? [`const float ${P}NU = ${fl(f.nu, pr)};`] : [],
    "",
    `vec3 ${name}(vec3 p, float t) {`,
    "  vec3 u = vec3(0.0);",
    `  for (int j = 0; j < ${P}N; j++) {`,
    `    float phi = dot(${P}K[j], p) + ${P}PH[j] + ${P}OM[j] * t;`,
    `    u += (${amp}) * (cos(phi) * ${P}E1[j] - ${P}S[j] * sin(phi) * ${P}E2[j]);`,
    "  }",
    `  return u * ${P}SCALE;`,
    "}",
    `vec3 ${name}(vec3 p) { return ${name}(p, 0.0); }`
  ];
  if (curl) {
    L.push(
      "",
      `vec3 ${name}Curl(vec3 p, float t) {`,
      "  vec3 w = vec3(0.0);",
      `  for (int j = 0; j < ${P}N; j++) {`,
      `    float phi = dot(${P}K[j], p) + ${P}PH[j] + ${P}OM[j] * t;`,
      `    vec3 tv = (${amp}) * (cos(phi) * ${P}E1[j] - ${P}S[j] * sin(phi) * ${P}E2[j]);`,
      `    w += ${P}S[j] * length(${P}K[j]) * tv;`,
      "  }",
      `  return w * ${P}SCALE;`,
      "}",
      `vec3 ${name}Curl(vec3 p) { return ${name}Curl(p, 0.0); }`
    );
  }
  if (pot) {
    L.push(
      "",
      `vec3 ${name}Pot(vec3 p, float t) {`,
      "  vec3 A = vec3(0.0);",
      `  for (int j = 0; j < ${P}N; j++) {`,
      `    float phi = dot(${P}K[j], p) + ${P}PH[j] + ${P}OM[j] * t;`,
      `    vec3 tv = (${amp}) * (cos(phi) * ${P}E1[j] - ${P}S[j] * sin(phi) * ${P}E2[j]);`,
      `    A += (${P}S[j] / length(${P}K[j])) * tv;`,
      "  }",
      `  return A * ${P}SCALE;`,
      "}",
      `vec3 ${name}Pot(vec3 p) { return ${name}Pot(p, 0.0); }`
    );
  }
  return L.join("\n");
}

// src/boundary.ts
function ramp(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const x2 = x * x;
  return x * (15 - 10 * x2 + 3 * x2 * x2) / 8;
}
function dramp(x) {
  if (x < 0 || x >= 1) return 0;
  const w = 1 - x * x;
  return 15 / 8 * w * w;
}
var BoundedFieldImpl = class {
  constructor(base, sdf, opts) {
    this._ua = [0, 0, 0, 0, 0, 0];
    this._fa = [0, 0, 0];
    this._fb = [0, 0, 0];
    this.base = base;
    this.sdf = sdf;
    this.th = Math.max(opts?.thickness ?? 1, 1e-9);
    this.h = opts?.fdStep ?? 1e-3;
    this.grad = opts?.gradient;
  }
  /** Core: bounded velocity into out[0..2]. */
  _u(x, y, z, t, out, o = 0) {
    const d = this.sdf(x, y, z);
    if (d <= 0) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      return;
    }
    const ua = this._ua;
    this.base.sampleUA(x, y, z, ua, t);
    const q = d / this.th;
    if (q >= 1) {
      out[o] = ua[0];
      out[o + 1] = ua[1];
      out[o + 2] = ua[2];
      return;
    }
    let gx, gy, gz;
    if (this.grad) {
      const g = this.grad(x, y, z);
      gx = g[0];
      gy = g[1];
      gz = g[2];
    } else {
      const h = this.h, s = this.sdf;
      gx = (s(x + h, y, z) - s(x - h, y, z)) / (2 * h);
      gy = (s(x, y + h, z) - s(x, y - h, z)) / (2 * h);
      gz = (s(x, y, z + h) - s(x, y, z - h)) / (2 * h);
    }
    const r = ramp(q), rp = dramp(q) / this.th;
    const cx = gy * ua[5] - gz * ua[4];
    const cy = gz * ua[3] - gx * ua[5];
    const cz = gx * ua[4] - gy * ua[3];
    out[o] = rp * cx + r * ua[0];
    out[o + 1] = rp * cy + r * ua[1];
    out[o + 2] = rp * cz + r * ua[2];
  }
  sample(x, y, z, t = 0) {
    const f = this._fa;
    this._u(x, y, z, t, f);
    return [f[0], f[1], f[2]];
  }
  sampleUW(x, y, z, out6, t = 0) {
    this._u(x, y, z, t, out6, 0);
    const h = this.h, a = this._fa, b = this._fb;
    this._u(x, y + h, z, t, a);
    this._u(x, y - h, z, t, b);
    const uzy = (a[2] - b[2]) / (2 * h), uxy = (a[0] - b[0]) / (2 * h);
    this._u(x, y, z + h, t, a);
    this._u(x, y, z - h, t, b);
    const uyz = (a[1] - b[1]) / (2 * h), uxz = (a[0] - b[0]) / (2 * h);
    this._u(x + h, y, z, t, a);
    this._u(x - h, y, z, t, b);
    const uyx = (a[1] - b[1]) / (2 * h), uzx = (a[2] - b[2]) / (2 * h);
    out6[3] = uzy - uyz;
    out6[4] = uxz - uzx;
    out6[5] = uyx - uxy;
    return out6;
  }
  vorticity(x, y, z, t = 0) {
    const o = this._ua;
    this.sampleUW(x, y, z, o, t);
    return [o[3], o[4], o[5]];
  }
  helicityDensity(x, y, z, t = 0) {
    const o = this._ua;
    this.sampleUW(x, y, z, o, t);
    return o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
  }
  potential(x, y, z, t = 0) {
    const d = this.sdf(x, y, z);
    if (d <= 0) return [0, 0, 0];
    const ua = this._ua;
    this.base.sampleUA(x, y, z, ua, t);
    const r = ramp(d / this.th);
    return [r * ua[3], r * ua[4], r * ua[5]];
  }
  bake3D(n, t = 0) {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      this.sampleUW(x / n * TAU, y / n * TAU, z / n * TAU, o, t);
      data[p] = o[0];
      data[p + 1] = o[1];
      data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }
  bakePotential3D(n, t = 0) {
    const data = new Float32Array(n * n * n * 4), ua = this._ua;
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = x / n * TAU, py = y / n * TAU, pz = z / n * TAU;
      const d = this.sdf(px, py, pz);
      if (d <= 0) {
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
      } else {
        this.base.sampleUA(px, py, pz, ua, t);
        const r = ramp(d / this.th);
        data[p] = r * ua[3];
        data[p + 1] = r * ua[4];
        data[p + 2] = r * ua[5];
      }
      data[p + 3] = d;
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }
};

// src/wasm-kernel.ts
var WASM_B64 = "AGFzbQEAAAABEgFgDn9/fH9/f39/f39/f39/AAMCAQAFBgEBBICAAQcOAgNtZW0CAARtYW55AAAKtwoBtAoDB38CfBt7IAFBCGwhE0EAIQ4CQANAIA4gAE4NASAOQYACaiEPIA8gAEoEQCAAIQ8LQQAhEQJAA0AgESABTg0BIAQgEUEIbGohEiASKwMA/RQhFyASIBNqKwMA/RQhGCASIBNBAmxqKwMA/RQhGSASIBNBA2xqKwMA/RQhGiASIBNBBGxqKwMAIAKi/RQhGyASIBNBBWxqKwMAIRYgEiATQQZsaisDACEVIBYgEiATQQdsaisDAKL9FCEiIBUgEiATQQhsaisDAKL9FCEcIBUgEiATQQlsaisDAKL9FCEdIBUgEiATQQpsaisDAKL9FCEeIBUgFqIhFSAVIBIgE0ELbGorAwCi/RQhHyAVIBIgE0EMbGorAwCi/RQhICAVIBIgE0ENbGorAwCi/RQhISAOIRACQANAIBAgD04NASAQQQhsIRQgFyAFIBRq/QAEAP3yASAYIAYgFGr9AAQA/fIB/fABIBkgByAUav0ABAD98gH98AEgGv3wASAb/fABISMgI/0Mg8jJbTBf5D+DyMltMF/kP/3yAf2UASEkICMgJP0MAABAVPsh+T8AAEBU+yH5P/3yAf3xASElICUgJP0MAABgGmG00D0AAGAaYbTQPf3yAf3xASElICUgJP0Mc3ADLooZoztzcAMuihmjO/3yAf3xASElICUgJf3yASEmICUgJSAm/fIB/QxJVVVVVVXFv0lVVVVVVcW/ICb9DKb4EBEREYE/pvgQERERgT8gJv0M1WHBGaABKr/VYcEZoAEqvyAm/Qx9/rFX4x3HPn3+sVfjHcc+ICb9DOucK4rm5Vq+65wriublWr4gJv0MfNXPWjrZ5T181c9aOtnlPf3yAf3wAf3yAf3wAf3yAf3wAf3yAf3wAf3yAf3wAf3yAf3wASEn/QwAAAAAAADwPwAAAAAAAPA//QwAAAAAAADgPwAAAAAAAOA/ICb98gH98QEgJiAm/fIB/QxMVVVVVVWlP0xVVVVVVaU/ICb9DHdRwRZswVa/d1HBFmzBVr8gJv0MkBXLGaAB+j6QFcsZoAH6PiAm/QytUpyAT36Svq1SnIBPfpK+ICb9DMSxtL2e7iE+xLG0vZ7uIT4gJv0M1DiIvun6qL3UOIi+6fqovf3yAf3wAf3yAf3wAf3yAf3wAf3yAf3wAf3yAf3wAf3yAf3wASEoICT9/AEhKSAp/QwBAAAAAQAAAAEAAAABAAAA/U79/gEhKv0MAAAAAAAA8D8AAAAAAADwPyAp/QwCAAAAAgAAAAIAAAACAAAA/U79/gH98QEhK/0MAAAAAAAA8D8AAAAAAADwPyAp/QwBAAAAAQAAAAEAAAABAAAA/a4B/QwCAAAAAgAAAAIAAAACAAAA/U79/gH98QEhLCArICcgKiAoICf98QH98gH98AH98gEhLSAsICggKiAnICj98QH98gH98AH98gEhLiAuIBz98gEgLSAf/fIB/fEBIS8gLiAd/fIBIC0gIP3yAf3xASEwIC4gHv3yASAtICH98gH98QEhMSAIIBRqIAggFGr9AAQAIC/98AH9CwQAIAkgFGogCSAUav0ABAAgMP3wAf0LBAAgCiAUaiAKIBRq/QAEACAx/fAB/QsEACADBEAgCyAUaiALIBRq/QAEACAiIC/98gH98AH9CwQAIAwgFGogDCAUav0ABAAgIiAw/fIB/fAB/QsEACANIBRqIA0gFGr9AAQAICIgMf3yAf3wAf0LBAALIBBBAmohEAwACwsgEUEBaiERDAALCyAOQYACaiEODAALCws=";

// src/wasm.ts
var kernelState;
function b64bytes(s) {
  const g = globalThis;
  if (g.Buffer) return new Uint8Array(g.Buffer.from(s, "base64"));
  const bin = g.atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function kernel() {
  if (kernelState === void 0) {
    try {
      const WA = globalThis.WebAssembly;
      if (!WA) throw new Error("no wasm");
      const inst = new WA.Instance(new WA.Module(b64bytes(WASM_B64)), {});
      kernelState = { mem: inst.exports.mem, many: inst.exports.many };
    } catch {
      kernelState = null;
    }
  }
  return kernelState;
}
var ARRS = ["kx", "ky", "kz", "ph", "om", "s", "a", "km", "e1x", "e1y", "e1z", "e2x", "e2y", "e2z"];
var PHI_MAX = 1e6;
var owner = null;
var ownerStamp = -1;
var capN = 0;
var capPts = 0;
var f64 = null;
var mdO = 0;
var pxO = 0;
var pyO = 0;
var pzO = 0;
var uxO = 0;
var uyO = 0;
var uzO = 0;
var wxO = 0;
var wyO = 0;
var wzO = 0;
function ensure(k, N, nPts) {
  if (N <= capN && nPts <= capPts && f64 && f64.buffer === k.mem.buffer) return;
  capN = Math.max(N, capN);
  capPts = Math.max(nPts, capPts, 4096);
  const al = (x) => x + 15 & ~15;
  mdO = 16;
  pxO = al(mdO + 14 * capN * 8);
  pyO = al(pxO + capPts * 8);
  pzO = al(pyO + capPts * 8);
  uxO = al(pzO + capPts * 8);
  uyO = al(uxO + capPts * 8);
  uzO = al(uyO + capPts * 8);
  wxO = al(uzO + capPts * 8);
  wyO = al(wxO + capPts * 8);
  wzO = al(wyO + capPts * 8);
  const need = al(wzO + capPts * 8);
  const have = k.mem.buffer.byteLength;
  if (need > have) k.mem.grow(Math.ceil((need - have) / 65536));
  f64 = new Float64Array(k.mem.buffer);
  owner = null;
}
function runWasm(field, amps, pos, out, t, uw, sc) {
  const k = kernel();
  if (!k) return false;
  const N = field.N;
  const n = pos.length / 3 | 0;
  const n2 = n + (n & 1);
  ensure(k, N, n2);
  const m = f64;
  if (owner !== field || ownerStamp !== field._buildStamp) {
    for (let ai = 0; ai < ARRS.length; ai++) {
      const src = ARRS[ai] === "a" ? amps : field[ARRS[ai]];
      m.set(src, (mdO >> 3) + ai * capN);
    }
    owner = field;
    ownerStamp = field._buildStamp;
  } else if (amps !== field.a) {
    m.set(amps, (mdO >> 3) + 6 * capN);
  }
  const xb = pxO >> 3, yb = pyO >> 3, zb = pzO >> 3;
  let mx = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    m[xb + i] = x;
    m[yb + i] = y;
    m[zb + i] = z;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax > mx) mx = ax;
    if (ay > mx) mx = ay;
    if (az > mx) mx = az;
  }
  if (n2 > n) {
    m[xb + n] = m[xb + n - 1];
    m[yb + n] = m[yb + n - 1];
    m[zb + n] = m[zb + n - 1];
  }
  let kmax = 0, omax = 0;
  for (let j = 0; j < N; j++) {
    const ks = Math.abs(field.kx[j]) + Math.abs(field.ky[j]) + Math.abs(field.kz[j]);
    if (ks > kmax) kmax = ks;
    const ao = Math.abs(field.om[j]);
    if (ao > omax) omax = ao;
  }
  if (mx * kmax + Math.PI + omax * Math.abs(t) >= PHI_MAX) return false;
  const st = uw ? 6 : 3;
  m.fill(0, uxO >> 3, (uxO >> 3) + n2);
  m.fill(0, uyO >> 3, (uyO >> 3) + n2);
  m.fill(0, uzO >> 3, (uzO >> 3) + n2);
  if (uw) {
    m.fill(0, wxO >> 3, (wxO >> 3) + n2);
    m.fill(0, wyO >> 3, (wyO >> 3) + n2);
    m.fill(0, wzO >> 3, (wzO >> 3) + n2);
  }
  k.many(n2, N, t, uw ? 1 : 0, mdO, pxO, pyO, pzO, uxO, uyO, uzO, wxO, wyO, wzO);
  const ub = uxO >> 3, vb = uyO >> 3, wb = uzO >> 3;
  const qb = wxO >> 3, rb = wyO >> 3, sb = wzO >> 3;
  for (let i = 0; i < n; i++) {
    const o = st * i;
    out[o] = m[ub + i] * sc;
    out[o + 1] = m[vb + i] * sc;
    out[o + 2] = m[wb + i] * sc;
    if (uw) {
      out[o + 3] = m[qb + i] * sc;
      out[o + 4] = m[rb + i] * sc;
      out[o + 5] = m[sb + i] * sc;
    }
  }
  return true;
}

// src/field.ts
var _tmp6 = [0, 0, 0, 0, 0, 0];
var GA = Math.PI * (3 - Math.sqrt(5));
var TILE = 256;
var TWO_OVER_PI = 0.6366197723675814;
var PIO2_1 = 1.5707963267341256;
var PIO2_2 = 6077100506303966e-26;
var PIO2_3 = 20222662487959506e-37;
var PHI_MAX2 = 1e6;
var S1 = -0.16666666666666632;
var S2 = 0.00833333333332249;
var S3 = -1984126982985795e-19;
var S4 = 27557313707070068e-22;
var S5 = -25050760253406863e-24;
var S6 = 158969099521155e-24;
var C1 = 0.0416666666666666;
var C2 = -0.001388888888887411;
var C3 = 2480158728947673e-20;
var C4 = -27557314351390663e-23;
var C5 = 2087572321298175e-24;
var C6 = -11359647557788195e-27;
function frame(dx, dy, dz, out) {
  let rx, ry, rz;
  if (Math.abs(dz) < 0.9) {
    rx = 0;
    ry = 0;
    rz = 1;
  } else {
    rx = 0;
    ry = 1;
    rz = 0;
  }
  let e1x = ry * dz - rz * dy, e1y = rz * dx - rx * dz, e1z = rx * dy - ry * dx;
  const n = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= n;
  e1y /= n;
  e1z /= n;
  const e2x = dy * e1z - dz * e1y, e2y = dz * e1x - dx * e1z, e2z = dx * e1y - dy * e1x;
  out[0] = e1x;
  out[1] = e1y;
  out[2] = e1z;
  out[3] = e2x;
  out[4] = e2y;
  out[5] = e2z;
}
function rotFromUniforms(u1, u2, u3) {
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  const qx = s1 * Math.sin(TAU * u2), qy = s1 * Math.cos(TAU * u2);
  const qz = s2 * Math.sin(TAU * u3), qw = s2 * Math.cos(TAU * u3);
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return new Float64Array([
    1 - 2 * (yy + zz),
    2 * (xy - wz),
    2 * (xz + wy),
    2 * (xy + wz),
    1 - 2 * (xx + zz),
    2 * (yz - wx),
    2 * (xz - wy),
    2 * (yz + wx),
    1 - 2 * (xx + yy)
  ]);
}
var HelixField = class {
  // batch-sampler accumulator scratch
  constructor(opts) {
    /** Viscous decay rate ν (amplitudes ∝ e^(−νk²t)); 0 = none. */
    this.nu = 0;
    this._scale = 1;
    /** Bumped on every rebuild — the wasm backend uses it to re-upload mode data. @internal */
    this._buildStamp = 0;
    /** Test/bench escape hatch: set true to force the JS batch kernel. @internal */
    this._noWasm = false;
    this._aT = null;
    // decayed-amplitude cache, valid at time _tAmp
    this._tAmp = NaN;
    this._tile = null;
    this.params = { ...DEFAULTS };
    if (opts) {
      for (const k of Object.keys(opts)) {
        if ((k in DEFAULTS || k === "spectrum") && opts[k] !== void 0) {
          this.params[k] = opts[k];
        }
      }
    }
    this._alloc(this.params.modes);
    this._build();
  }
  _alloc(N) {
    this.N = N;
    this.kx = new Float64Array(N);
    this.ky = new Float64Array(N);
    this.kz = new Float64Array(N);
    this.km = new Float64Array(N);
    this.a = new Float64Array(N);
    this.s = new Float64Array(N);
    this.ph = new Float64Array(N);
    this.om = new Float64Array(N);
    this.e1x = new Float64Array(N);
    this.e1y = new Float64Array(N);
    this.e1z = new Float64Array(N);
    this.e2x = new Float64Array(N);
    this.e2y = new Float64Array(N);
    this.e2z = new Float64Array(N);
  }
  _build() {
    const p = this.params;
    const rng = mulberry32(p.seed >>> 0 || 1);
    const N = this.N;
    const nc = Math.max(1, p.centers | 0);
    const cx = new Float64Array(nc), cy = new Float64Array(nc), cz = new Float64Array(nc);
    for (let m = 0; m < nc; m++) {
      cx[m] = rng() * TAU;
      cy[m] = rng() * TAU;
      cz[m] = rng() * TAU;
    }
    const fr = [0, 0, 0, 0, 0, 0];
    const lam = Math.min(1, Math.max(0, p.coherence));
    const fib = p.layout !== "random";
    const ci = new Int32Array(N);
    const gam = Math.min(9, Math.max(-0.99, p.anisotropy));
    const an = Math.hypot(p.axis[0], p.axis[1], p.axis[2]) || 1;
    const anx = p.axis[0] / an, any = p.axis[1] / an, anz = p.axis[2] / an;
    let rot = null;
    let kms = null;
    let perm = null;
    if (fib) {
      rot = rotFromUniforms(rng(), rng(), rng());
      kms = new Float64Array(N);
      for (let i = 0; i < N; i++) kms[i] = p.kmin + (p.kmax - p.kmin) * ((i + rng()) / N);
      perm = new Int32Array(N);
      for (let i = 0; i < N; i++) perm[i] = i;
      for (let i = N - 1; i > 0; i--) {
        const j = rng() * (i + 1) | 0;
        const tmp = perm[i];
        perm[i] = perm[j];
        perm[j] = tmp;
      }
    }
    for (let j = 0; j < N; j++) {
      let dx, dy, dz, km;
      if (fib) {
        const zf = 1 - (2 * j + 1) / N, rf = Math.sqrt(Math.max(0, 1 - zf * zf)), th = j * GA;
        const fx = rf * Math.cos(th), fy = rf * Math.sin(th), fz = zf;
        const R = rot;
        dx = R[0] * fx + R[1] * fy + R[2] * fz;
        dy = R[3] * fx + R[4] * fy + R[5] * fz;
        dz = R[6] * fx + R[7] * fy + R[8] * fz;
        km = kms[perm[j]];
      } else {
        const z = 2 * rng() - 1, th = TAU * rng(), r = Math.sqrt(1 - z * z);
        dx = r * Math.cos(th);
        dy = r * Math.sin(th);
        dz = z;
        km = p.kmin + (p.kmax - p.kmin) * rng();
      }
      if (gam !== 0) {
        const dn = dx * anx + dy * any + dz * anz;
        dx += gam * dn * anx;
        dy += gam * dn * any;
        dz += gam * dn * anz;
        const dm = Math.hypot(dx, dy, dz) || 1;
        dx /= dm;
        dy /= dm;
        dz /= dm;
      }
      let kxc = km * dx, kyc = km * dy, kzc = km * dz;
      if (p.tileable) {
        kxc = Math.round(kxc);
        kyc = Math.round(kyc);
        kzc = Math.round(kzc);
        if (kxc === 0 && kyc === 0 && kzc === 0) kxc = 1;
        km = Math.hypot(kxc, kyc, kzc);
        dx = kxc / km;
        dy = kyc / km;
        dz = kzc / km;
      }
      this.kx[j] = kxc;
      this.ky[j] = kyc;
      this.kz[j] = kzc;
      this.km[j] = km;
      frame(dx, dy, dz, fr);
      this.e1x[j] = fr[0];
      this.e1y[j] = fr[1];
      this.e1z[j] = fr[2];
      this.e2x[j] = fr[3];
      this.e2y[j] = fr[4];
      this.e2z[j] = fr[5];
      this.s[j] = rng() < (1 + p.helicity) / 2 ? 1 : -1;
      this.a[j] = p.spectrum ? Math.max(0, p.spectrum(km)) : Math.pow(km, -p.slope);
      const phr = TAU * rng();
      const c = rng() * nc | 0;
      ci[j] = c;
      const phc = -(kxc * cx[c] + kyc * cy[c] + kzc * cz[c]);
      this.ph[j] = phc + (1 - lam) * phr;
    }
    const chi = Math.max(0, p.churn);
    this.cvx = new Float64Array(nc);
    this.cvy = new Float64Array(nc);
    this.cvz = new Float64Array(nc);
    const sg = chi / Math.sqrt(3);
    for (let m = 0; m < nc; m++) {
      const r1 = Math.sqrt(-2 * Math.log(1 - rng())), a1 = TAU * rng();
      const r2 = Math.sqrt(-2 * Math.log(1 - rng())), a2 = TAU * rng();
      this.cvx[m] = sg * r1 * Math.cos(a1);
      this.cvy[m] = sg * r1 * Math.sin(a1);
      this.cvz[m] = sg * r2 * Math.cos(a2);
    }
    const rate0 = chi * Math.cbrt(Math.max(p.kmin, 1e-9));
    for (let j = 0; j < N; j++) {
      const sgn = rng() < 0.5 ? -1 : 1;
      const c = ci[j];
      this.om[j] = (1 - lam) * sgn * rate0 * Math.pow(this.km[j], 2 / 3) - lam * (this.kx[j] * this.cvx[c] + this.ky[j] * this.cvy[c] + this.kz[j] * this.cvz[c]);
    }
    this.nu = Math.max(0, p.decay);
    this._tAmp = NaN;
    this._buildStamp++;
    this._scale = 1;
    this._scale = (p.amplitude || 1) / (this._rms() || 1);
  }
  /** Mode amplitudes at time t: a·e^(−νk²t), cached per t (recomputed once per frame, not per sample). */
  _amps(t) {
    if (!(this.nu > 0) || t === 0) return this.a;
    if (t !== this._tAmp || !this._aT || this._aT.length !== this.N) {
      if (!this._aT || this._aT.length !== this.N) this._aT = new Float64Array(this.N);
      const nu = this.nu;
      for (let j = 0; j < this.N; j++) this._aT[j] = this.a[j] * Math.exp(-nu * this.km[j] * this.km[j] * t);
      this._tAmp = t;
    }
    return this._aT;
  }
  sampleUW(x, y, z, out6, t = 0) {
    const N = this.N, sc = this._scale, A = this._amps(t);
    let ux = 0, uy = 0, uz = 0, wx = 0, wy = 0, wz = 0;
    for (let j = 0; j < N; j++) {
      const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + this.ph[j] + this.om[j] * t;
      const c = Math.cos(phi), sn = Math.sin(phi), s = this.s[j], a = A[j];
      const tx = a * (c * this.e1x[j] - s * sn * this.e2x[j]);
      const ty = a * (c * this.e1y[j] - s * sn * this.e2y[j]);
      const tz = a * (c * this.e1z[j] - s * sn * this.e2z[j]);
      ux += tx;
      uy += ty;
      uz += tz;
      const g = s * this.km[j];
      wx += g * tx;
      wy += g * ty;
      wz += g * tz;
    }
    out6[0] = ux * sc;
    out6[1] = uy * sc;
    out6[2] = uz * sc;
    out6[3] = wx * sc;
    out6[4] = wy * sc;
    out6[5] = wz * sc;
    return out6;
  }
  sampleUA(x, y, z, out6, t = 0) {
    const N = this.N, sc = this._scale, A = this._amps(t);
    let ux = 0, uy = 0, uz = 0, ax = 0, ay = 0, az = 0;
    for (let j = 0; j < N; j++) {
      const phi = this.kx[j] * x + this.ky[j] * y + this.kz[j] * z + this.ph[j] + this.om[j] * t;
      const c = Math.cos(phi), sn = Math.sin(phi), s = this.s[j], a = A[j];
      const tx = a * (c * this.e1x[j] - s * sn * this.e2x[j]);
      const ty = a * (c * this.e1y[j] - s * sn * this.e2y[j]);
      const tz = a * (c * this.e1z[j] - s * sn * this.e2z[j]);
      ux += tx;
      uy += ty;
      uz += tz;
      const g = s / this.km[j];
      ax += g * tx;
      ay += g * ty;
      az += g * tz;
    }
    out6[0] = ux * sc;
    out6[1] = uy * sc;
    out6[2] = uz * sc;
    out6[3] = ax * sc;
    out6[4] = ay * sc;
    out6[5] = az * sc;
    return out6;
  }
  sample(x, y, z, t = 0) {
    this.sampleUW(x, y, z, _tmp6, t);
    return [_tmp6[0], _tmp6[1], _tmp6[2]];
  }
  vorticity(x, y, z, t = 0) {
    this.sampleUW(x, y, z, _tmp6, t);
    return [_tmp6[3], _tmp6[4], _tmp6[5]];
  }
  helicityDensity(x, y, z, t = 0) {
    this.sampleUW(x, y, z, _tmp6, t);
    return _tmp6[0] * _tmp6[3] + _tmp6[1] * _tmp6[4] + _tmp6[2] * _tmp6[5];
  }
  potential(x, y, z, t = 0) {
    this.sampleUA(x, y, z, _tmp6, t);
    return [_tmp6[3], _tmp6[4], _tmp6[5]];
  }
  withBoundary(sdf, opts) {
    return new BoundedFieldImpl(this, sdf, opts);
  }
  sampleMany(pos, out, t = 0) {
    const o = out ?? new Float64Array(pos.length);
    this._many(pos, o, t, false);
    return o;
  }
  sampleManyUW(pos, out, t = 0) {
    const o = out ?? new Float64Array(2 * pos.length);
    this._many(pos, o, t, true);
    return o;
  }
  /**
   * Batch kernel: mode-major and tiled. Each mode's constants stay in registers while a tile of
   * points streams through L1; accumulation is in f64 scratch regardless of `out`'s type.
   */
  _many(pos, out, t, uw) {
    const n = pos.length / 3 | 0;
    const st = uw ? 6 : 3;
    if (out.length < st * n) throw new Error(`helix-noise: out needs ${st * n} floats, got ${out.length}`);
    const N = this.N, sc = this._scale, A = this._amps(t);
    if (!this._noWasm && n >= 64 && runWasm(this, A, pos, out, t, uw, sc)) return;
    if (!this._tile) this._tile = new Float64Array(TILE * 6);
    const acc = this._tile;
    for (let i0 = 0; i0 < n; i0 += TILE) {
      const m = Math.min(TILE, n - i0);
      acc.fill(0, 0, st * m);
      for (let j = 0; j < N; j++) {
        const kx = this.kx[j], ky = this.ky[j], kz = this.kz[j];
        const ph = this.ph[j], omt = this.om[j] * t, s = this.s[j], a = A[j];
        const b1x = a * this.e1x[j], b1y = a * this.e1y[j], b1z = a * this.e1z[j];
        const as = a * s;
        const b2x = as * this.e2x[j], b2y = as * this.e2y[j], b2z = as * this.e2z[j];
        const g = s * this.km[j];
        for (let i = 0; i < m; i++) {
          const q = 3 * (i0 + i);
          const phi = kx * pos[q] + ky * pos[q + 1] + kz * pos[q + 2] + ph + omt;
          let c, sn;
          if (phi > -PHI_MAX2 && phi < PHI_MAX2) {
            const qn = Math.round(phi * TWO_OVER_PI);
            const r = phi - qn * PIO2_1 - qn * PIO2_2 - qn * PIO2_3;
            const z = r * r;
            const ps = r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
            const pc = 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
            const k = qn & 3, swap = k & 1;
            sn = (1 - (k & 2)) * (ps + swap * (pc - ps));
            c = (1 - (k + 1 & 2)) * (pc + swap * (ps - pc));
          } else {
            c = Math.cos(phi);
            sn = Math.sin(phi);
          }
          const tx = c * b1x - sn * b2x;
          const ty = c * b1y - sn * b2y;
          const tz = c * b1z - sn * b2z;
          const w = st * i;
          acc[w] += tx;
          acc[w + 1] += ty;
          acc[w + 2] += tz;
          if (uw) {
            acc[w + 3] += g * tx;
            acc[w + 4] += g * ty;
            acc[w + 5] += g * tz;
          }
        }
      }
      for (let i = 0; i < m; i++) {
        const w = st * i, o = st * (i0 + i);
        out[o] = acc[w] * sc;
        out[o + 1] = acc[w + 1] * sc;
        out[o + 2] = acc[w + 2] * sc;
        if (uw) {
          out[o + 3] = acc[w + 3] * sc;
          out[o + 4] = acc[w + 4] * sc;
          out[o + 5] = acc[w + 5] * sc;
        }
      }
    }
  }
  _rms() {
    const ng = 5, o = [0, 0, 0, 0, 0, 0];
    let s = 0, n = 0;
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      this.sampleUW(i / ng * TAU, j / ng * TAU, k / ng * TAU, o);
      s += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      n++;
    }
    return Math.sqrt(s / n);
  }
  set(opts) {
    const reAlloc = !!opts && "modes" in opts && opts.modes !== this.params.modes;
    for (const k of Object.keys(opts)) {
      if ((k in DEFAULTS || k === "spectrum") && opts[k] !== void 0) {
        this.params[k] = opts[k];
      }
    }
    if (reAlloc) this._alloc(this.params.modes);
    this._build();
    return this;
  }
  relativeHelicity(ng = 12) {
    let H = 0, un = 0, wn = 0;
    const o = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      this.sampleUW(i / ng * TAU, j / ng * TAU, k / ng * TAU, o);
      H += o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      un += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      wn += o[3] * o[3] + o[4] * o[4] + o[5] * o[5];
    }
    return H / (Math.sqrt(un * wn) || 1);
  }
  bake3D(n, t = 0) {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      this.sampleUW(x / n * TAU, y / n * TAU, z / n * TAU, o, t);
      data[p] = o[0];
      data[p + 1] = o[1];
      data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }
  bakePotential3D(n, t = 0) {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = x / n * TAU, py = y / n * TAU, pz = z / n * TAU;
      this.sampleUA(px, py, pz, o, t);
      data[p] = o[3];
      data[p + 1] = o[4];
      data[p + 2] = o[5];
      this.sampleUW(px, py, pz, o, t);
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }
  bake2D(nx, ny, z = 0, t = 0) {
    const data = new Float32Array(nx * ny * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      this.sampleUW(i / nx * TAU, j / ny * TAU, z, o, t);
      data[p] = o[0];
      data[p + 1] = o[1];
      data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, width: nx, height: ny, channels: 4 };
  }
  glsl(opts) {
    return toGLSL(this, opts);
  }
};

// src/atoms-glsl.ts
function fl2(x, pr) {
  const s = Number(x).toPrecision(pr);
  return /[.eE]/.test(s) ? s : s + ".0";
}
function atomsToGLSL(f, kBase, scale, opts = {}) {
  const p = f.params;
  if (p.helicityField || p.gainField || p.spectrum) {
    throw new Error(
      "helix-noise: glsl() on an atom field requires constant parameters \u2014 helicityField/gainField/spectrum are JS callbacks; use bake3D()/bakePotential3D() instead."
    );
  }
  const name = (opts.name ?? "helixAtoms").replace(/[^A-Za-z0-9_]/g, "_");
  const pr = opts.precision ?? 7;
  const curl = opts.curl !== false;
  const pot = opts.potential === true;
  const P = name + "_";
  const oct = Math.max(1, p.octaves | 0);
  const npc = Math.max(1, p.atomsPerCell | 0);
  const seedU = p.seed >>> 0 || 1;
  const oseed = [];
  for (let o = 0; o < oct; o++) oseed.push((seedU + Math.imul(o, 2654435769) >>> 0) + "u");
  const gam = Math.min(9, Math.max(-0.99, p.anisotropy));
  const an = Math.hypot(p.axis[0], p.axis[1], p.axis[2]) || 1;
  const chi = Math.max(0, p.churn);
  const rate0 = chi * Math.cbrt(kBase);
  const gen = [
    `        float g1 = ${P}rng(st); float g2 = ${P}rng(st); float g3 = ${P}rng(st);`,
    "        vec3 c = (vec3(cc) + vec3(g1, g2, g3)) * L;",
    `        float zd = 2.0 * ${P}rng(st) - 1.0;`,
    `        float th = 6.28318530717958648 * ${P}rng(st);`,
    "        float rd = sqrt(max(0.0, 1.0 - zd * zd));",
    "        vec3 d = vec3(rd * cos(th), rd * sin(th), zd);",
    ...gam !== 0 ? [
      `        d += ${fl2(gam, pr)} * dot(d, ${P}AXIS) * ${P}AXIS;`,
      "        d = normalize(d);"
    ] : [],
    `        float km = kc * (0.85 + 0.3 * ${P}rng(st));`,
    `        float s = ${P}rng(st) < ${fl2((1 + p.helicity) / 2, pr)} ? 1.0 : -1.0;`,
    `        float ph = 6.28318530717958648 * ${P}rng(st);`,
    `        float sgn = ${P}rng(st) < 0.5 ? -1.0 : 1.0;`,
    "        vec3 dd = p - c;",
    "        float r2 = dot(dd, dd);",
    "        if (r2 >= r2max) continue;",
    `        float om = sgn * ${fl2(rate0, pr)} * pow(km, 0.66666666666666663);`,
    `        float a = pow(km * ${fl2(1 / kBase, pr)}, ${fl2(-p.slope, pr)});`,
    `        vec3 e1, e2; ${P}frame(d, e1, e2);`,
    "        vec3 k = km * d;",
    "        float beta = 1.0 - r2 / r2max, b2 = beta * beta, w = b2 * beta;",
    "        float phi = dot(k, dd) + ph + om * t;",
    "        float cph = cos(phi), sph = sin(phi);",
    "        vec3 tw = a * (cph * e1 - s * sph * e2);"
  ];
  const loops = (body) => [
    `  for (int o = 0; o < ${P}OCT; o++) {`,
    `    float rho = ${fl2(p.radius, pr)} / float(1 << o);`,
    "    float L = 2.0 * rho, r2max = rho * rho;",
    `    float kc = ${fl2(kBase, pr)} * float(1 << o);`,
    "    ivec3 base = ivec3(floor(p / L - 0.5));",
    "    for (int dc = 0; dc < 8; dc++) {",
    "      ivec3 cc = base + ivec3(dc & 1, (dc >> 1) & 1, (dc >> 2) & 1);",
    `      uint st = ${P}hash(cc, ${P}OSEED[o]);`,
    `      for (int m = 0; m < ${P}NPC; m++) {`,
    ...gen,
    ...body,
    "      }",
    "    }",
    "  }"
  ];
  const L = [
    "// Helix Noise atoms \u2014 generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.",
    `// ${oct} octaves \xD7 8 cells \xD7 ${npc} atoms per sample, regenerated in-shader from the spatial hash.`,
    `// Defines vec3 ${name}(vec3 p) / (vec3 p, float t)${curl ? ` and ${name}Curl` : ""}${pot ? ` and ${name}Pot` : ""}.`,
    `const int ${P}OCT = ${oct};`,
    `const int ${P}NPC = ${npc};`,
    `const uint ${P}OSEED[${oct}] = uint[${oct}](${oseed.join(",")});`,
    `const float ${P}SCALE = ${fl2(scale, pr)};`,
    ...gam !== 0 ? [`const vec3 ${P}AXIS = vec3(${fl2(p.axis[0] / an, pr)},${fl2(p.axis[1] / an, pr)},${fl2(p.axis[2] / an, pr)});`] : [],
    "",
    `uint ${P}hash(ivec3 c, uint seed) {`,
    "  uint h = seed ^ (uint(c.x) * 0x27d4eb2du) ^ (uint(c.y) * 0x165667b1u) ^ (uint(c.z) * 0x9e3779b1u);",
    "  h = (h ^ (h >> 15)) * 0x85ebca6bu;",
    "  h ^= h >> 13;",
    "  h *= 0xc2b2ae35u;",
    "  return h ^ (h >> 16);",
    "}",
    `float ${P}rng(inout uint a) {`,
    "  a += 0x6d2b79f5u;",
    "  uint t = (a ^ (a >> 15)) * (1u | a);",
    "  t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;",
    "  return float(t ^ (t >> 14)) / 4294967296.0;",
    "}",
    `void ${P}frame(vec3 d, out vec3 e1, out vec3 e2) {`,
    "  vec3 r = abs(d.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);",
    "  e1 = normalize(cross(r, d));",
    "  e2 = cross(d, e1);",
    "}",
    "",
    `vec3 ${name}(vec3 p, float t) {`,
    "  vec3 u = vec3(0.0);",
    ...loops([
      "        vec3 A = (s / km) * tw;",
      "        vec3 gw = (-6.0 * b2 / r2max) * dd;",
      "        u += cross(gw, A) + w * tw;"
    ]),
    `  return u * ${P}SCALE;`,
    "}",
    `vec3 ${name}(vec3 p) { return ${name}(p, 0.0); }`
  ];
  if (curl) {
    L.push(
      "",
      `vec3 ${name}Curl(vec3 p, float t) {`,
      "  vec3 wv = vec3(0.0);",
      ...loops([
        "        vec3 A = (s / km) * tw;",
        "        vec3 gw = (-6.0 * b2 / r2max) * dd;",
        "        vec3 ap = (s / km) * a * (-sph * e1 - s * cph * e2);",
        "        float dA = dot(dd, A);",
        "        float c1 = 12.0 * b2 / r2max, c2 = 24.0 * beta / (r2max * r2max);",
        "        wv += c1 * A + c2 * (dA * dd - r2 * A) + dot(gw, ap) * k - 2.0 * dot(k, gw) * ap + s * km * w * tw;"
      ]),
      `  return wv * ${P}SCALE;`,
      "}",
      `vec3 ${name}Curl(vec3 p) { return ${name}Curl(p, 0.0); }`
    );
  }
  if (pot) {
    L.push(
      "",
      `vec3 ${name}Pot(vec3 p, float t) {`,
      "  vec3 A9 = vec3(0.0);",
      ...loops(["        A9 += w * (s / km) * tw;"]),
      `  return A9 * ${P}SCALE;`,
      "}",
      `vec3 ${name}Pot(vec3 p) { return ${name}Pot(p, 0.0); }`
    );
  }
  return L.join("\n");
}

// src/atoms.ts
var ATOM_DEFAULTS = {
  octaves: 3,
  atomsPerCell: 8,
  radius: 1.6,
  cyclesPerAtom: 2,
  slope: 1.6,
  helicity: 0,
  amplitude: 1,
  seed: 1,
  churn: 1,
  anisotropy: 0,
  axis: [0, 0, 1]
};
var ATOM_CALLBACK_KEYS = ["helicityField", "gainField", "spectrum"];
var STRIDE = 18;
function hcell(i, j, k, seed) {
  let h = seed ^ Math.imul(i, 668265261) ^ Math.imul(j, 374761393) ^ Math.imul(k, 2654435761);
  h = Math.imul(h ^ h >>> 15, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  return (h ^ h >>> 16) >>> 0;
}
var HelixAtoms = class {
  constructor(opts) {
    this._scale = 1;
    this._cells = /* @__PURE__ */ new Map();
    this._kBase = 1;
    // Direct-mapped memo in front of the Map — consecutive samples reuse the same 8 cells.
    // Slots come from cheap int ops (the full key is still compared, so collisions only miss).
    this._mk = new Float64Array(64).fill(NaN);
    this._mv = new Array(64);
    this._t6 = [0, 0, 0, 0, 0, 0];
    this.params = { ...ATOM_DEFAULTS };
    if (opts) this._merge(opts);
    this._init();
  }
  _merge(opts) {
    for (const k of Object.keys(opts)) {
      if (opts[k] !== void 0 && (k in ATOM_DEFAULTS || ATOM_CALLBACK_KEYS.includes(k))) {
        this.params[k] = opts[k];
      }
    }
  }
  _init() {
    this._cells.clear();
    this._mk.fill(NaN);
    this._mv.fill(void 0);
    this._kBase = this.params.cyclesPerAtom * Math.PI / this.params.radius;
    this._scale = 1;
    this._scale = (this.params.amplitude || 1) / (this._rms() || 1);
  }
  set(opts) {
    this._merge(opts);
    this._init();
    return this;
  }
  /** Atoms of one hash cell (cell size = atom diameter), generated on first use and cached. */
  _cell(o, ci, cj, ck) {
    const key = ((o * 65536 + (ci & 65535)) * 65536 + (cj & 65535)) * 65536 + (ck & 65535);
    const slot = o + ci * 2 + cj * 4 + ck * 8 & 63;
    if (this._mk[slot] === key) return this._mv[slot];
    let atoms = this._cells.get(key);
    if (atoms) {
      this._mk[slot] = key;
      this._mv[slot] = atoms;
      return atoms;
    }
    if (this._cells.size >= 16384) this._cells.clear();
    const p = this.params;
    const rho = p.radius / (1 << o);
    const L = 2 * rho;
    const kc = this._kBase * (1 << o);
    const npc = Math.max(1, p.atomsPerCell | 0);
    const rng = mulberry32(hcell(ci, cj, ck, (p.seed >>> 0 || 1) + Math.imul(o, 2654435769)));
    const chi = Math.max(0, p.churn);
    const rate0 = chi * Math.cbrt(this._kBase);
    const gam = Math.min(9, Math.max(-0.99, p.anisotropy));
    const an = Math.hypot(p.axis[0], p.axis[1], p.axis[2]) || 1;
    const anx = p.axis[0] / an, any = p.axis[1] / an, anz = p.axis[2] / an;
    const fr = [0, 0, 0, 0, 0, 0];
    atoms = new Float64Array(npc * STRIDE);
    for (let m = 0; m < npc; m++) {
      const b = m * STRIDE;
      const cx = (ci + rng()) * L, cy = (cj + rng()) * L, cz = (ck + rng()) * L;
      const zd = 2 * rng() - 1, th = TAU * rng(), rd = Math.sqrt(Math.max(0, 1 - zd * zd));
      let dx = rd * Math.cos(th), dy = rd * Math.sin(th), dz = zd;
      if (gam !== 0) {
        const dn = dx * anx + dy * any + dz * anz;
        dx += gam * dn * anx;
        dy += gam * dn * any;
        dz += gam * dn * anz;
        const dm = Math.hypot(dx, dy, dz) || 1;
        dx /= dm;
        dy /= dm;
        dz /= dm;
      }
      const km = kc * (0.85 + 0.3 * rng());
      const pl = p.helicityField ? Math.max(-1, Math.min(1, p.helicityField(cx, cy, cz))) : p.helicity;
      const s = rng() < (1 + pl) / 2 ? 1 : -1;
      const gain = p.gainField ? p.gainField(cx, cy, cz) : 1;
      const ph = TAU * rng();
      const sgn = rng() < 0.5 ? -1 : 1;
      atoms[b] = cx;
      atoms[b + 1] = cy;
      atoms[b + 2] = cz;
      atoms[b + 3] = km * dx;
      atoms[b + 4] = km * dy;
      atoms[b + 5] = km * dz;
      atoms[b + 6] = km;
      atoms[b + 7] = s;
      atoms[b + 8] = gain * (p.spectrum ? Math.max(0, p.spectrum(km)) : Math.pow(km / this._kBase, -p.slope));
      atoms[b + 9] = ph;
      atoms[b + 10] = sgn * rate0 * Math.pow(km, 2 / 3);
      atoms[b + 11] = s / km;
      frame(dx, dy, dz, fr);
      atoms[b + 12] = fr[0];
      atoms[b + 13] = fr[1];
      atoms[b + 14] = fr[2];
      atoms[b + 15] = fr[3];
      atoms[b + 16] = fr[4];
      atoms[b + 17] = fr[5];
    }
    this._cells.set(key, atoms);
    return atoms;
  }
  /**
   * Core evaluation. mode 0: u only → out[0..2]. mode 1: u + analytic vorticity → out[0..5].
   * mode 2: u + potential ΣW·A → out[0..5].
   */
  _eval(x, y, z, t, out, mode) {
    const p = this.params, sc = this._scale;
    let ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0;
    for (let o = 0; o < p.octaves; o++) {
      const rho = p.radius / (1 << o), L = 2 * rho, rho2 = rho * rho;
      const bi = Math.floor(x / L - 0.5), bj = Math.floor(y / L - 0.5), bk = Math.floor(z / L - 0.5);
      for (let dc = 0; dc < 8; dc++) {
        const at = this._cell(o, bi + (dc & 1), bj + (dc >> 1 & 1), bk + (dc >> 2));
        for (let b = 0; b < at.length; b += STRIDE) {
          const dxx = x - at[b], dyy = y - at[b + 1], dzz = z - at[b + 2];
          const r2 = dxx * dxx + dyy * dyy + dzz * dzz;
          if (r2 >= rho2) continue;
          const beta = 1 - r2 / rho2, b2 = beta * beta, w = b2 * beta;
          const kx = at[b + 3], ky = at[b + 4], kz = at[b + 5];
          const phi = kx * dxx + ky * dyy + kz * dzz + at[b + 9] + at[b + 10] * t;
          const c = Math.cos(phi), sn = Math.sin(phi);
          const s = at[b + 7], a = at[b + 8], gsk = at[b + 11];
          const twx = a * (c * at[b + 12] - s * sn * at[b + 15]);
          const twy = a * (c * at[b + 13] - s * sn * at[b + 16]);
          const twz = a * (c * at[b + 14] - s * sn * at[b + 17]);
          const Ax = gsk * twx, Ay = gsk * twy, Az = gsk * twz;
          const gw = -6 * b2 / rho2;
          const gwx = gw * dxx, gwy = gw * dyy, gwz = gw * dzz;
          ux += gwy * Az - gwz * Ay + w * twx;
          uy += gwz * Ax - gwx * Az + w * twy;
          uz += gwx * Ay - gwy * Ax + w * twz;
          if (mode === 2) {
            vx += w * Ax;
            vy += w * Ay;
            vz += w * Az;
          } else if (mode === 1) {
            const apx = gsk * a * (-sn * at[b + 12] - s * c * at[b + 15]);
            const apy = gsk * a * (-sn * at[b + 13] - s * c * at[b + 16]);
            const apz = gsk * a * (-sn * at[b + 14] - s * c * at[b + 17]);
            const dA = dxx * Ax + dyy * Ay + dzz * Az;
            const c1 = 12 * b2 / rho2, c2 = 24 * beta / (rho2 * rho2);
            const kgw = kx * gwx + ky * gwy + kz * gwz;
            const gap = gwx * apx + gwy * apy + gwz * apz;
            const skw = s * at[b + 6] * w;
            vx += c1 * Ax + c2 * (dA * dxx - r2 * Ax) + gap * kx - 2 * kgw * apx + skw * twx;
            vy += c1 * Ay + c2 * (dA * dyy - r2 * Ay) + gap * ky - 2 * kgw * apy + skw * twy;
            vz += c1 * Az + c2 * (dA * dzz - r2 * Az) + gap * kz - 2 * kgw * apz + skw * twz;
          }
        }
      }
    }
    out[0] = ux * sc;
    out[1] = uy * sc;
    out[2] = uz * sc;
    if (mode !== 0) {
      out[3] = vx * sc;
      out[4] = vy * sc;
      out[5] = vz * sc;
    }
  }
  sample(x, y, z, t = 0) {
    const o = this._t6;
    this._eval(x, y, z, t, o, 0);
    return [o[0], o[1], o[2]];
  }
  sampleUW(x, y, z, out6, t = 0) {
    this._eval(x, y, z, t, out6, 1);
    return out6;
  }
  sampleUA(x, y, z, out6, t = 0) {
    this._eval(x, y, z, t, out6, 2);
    return out6;
  }
  vorticity(x, y, z, t = 0) {
    const o = this._t6;
    this._eval(x, y, z, t, o, 1);
    return [o[3], o[4], o[5]];
  }
  helicityDensity(x, y, z, t = 0) {
    const o = this._t6;
    this._eval(x, y, z, t, o, 1);
    return o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
  }
  potential(x, y, z, t = 0) {
    const o = this._t6;
    this._eval(x, y, z, t, o, 2);
    return [o[3], o[4], o[5]];
  }
  withBoundary(sdf, opts) {
    return new BoundedFieldImpl(this, sdf, opts);
  }
  glsl(opts) {
    return atomsToGLSL(this, this._kBase, this._scale, opts);
  }
  sampleMany(pos, out, t = 0) {
    const o = out ?? new Float64Array(pos.length);
    const n = pos.length / 3 | 0;
    if (o.length < 3 * n) throw new Error(`helix-noise: out needs ${3 * n} floats, got ${o.length}`);
    const s6 = this._t6;
    for (let i = 0; i < n; i++) {
      this._eval(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], t, s6, 0);
      o[3 * i] = s6[0];
      o[3 * i + 1] = s6[1];
      o[3 * i + 2] = s6[2];
    }
    return o;
  }
  sampleManyUW(pos, out, t = 0) {
    const o = out ?? new Float64Array(2 * pos.length);
    const n = pos.length / 3 | 0;
    if (o.length < 6 * n) throw new Error(`helix-noise: out needs ${6 * n} floats, got ${o.length}`);
    const s6 = this._t6;
    for (let i = 0; i < n; i++) {
      this._eval(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], t, s6, 1);
      for (let m = 0; m < 6; m++) o[6 * i + m] = s6[m];
    }
    return o;
  }
  relativeHelicity(ng = 12) {
    const span = 4 * this.params.radius, o = [0, 0, 0, 0, 0, 0];
    let H = 0, un = 0, wn = 0;
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      this._eval(0.13 + i / ng * span, 0.29 + j / ng * span, 0.41 + k / ng * span, 0, o, 1);
      H += o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      un += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      wn += o[3] * o[3] + o[4] * o[4] + o[5] * o[5];
    }
    return H / (Math.sqrt(un * wn) || 1);
  }
  _rms() {
    const ng = 6, span = 4 * this.params.radius, o = [0, 0, 0];
    let s = 0, n = 0;
    for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) for (let k = 0; k < ng; k++) {
      this._eval(0.13 + i / ng * span, 0.29 + j / ng * span, 0.41 + k / ng * span, 0, o, 0);
      s += o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      n++;
    }
    return Math.sqrt(s / n);
  }
  bake3D(n, t = 0) {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      this._eval(x / n * TAU, y / n * TAU, z / n * TAU, t, o, 1);
      data[p] = o[0];
      data[p + 1] = o[1];
      data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }
  bake2D(nx, ny, z = 0, t = 0) {
    const data = new Float32Array(nx * ny * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      this._eval(i / nx * TAU, j / ny * TAU, z, t, o, 1);
      data[p] = o[0];
      data[p + 1] = o[1];
      data[p + 2] = o[2];
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, width: nx, height: ny, channels: 4 };
  }
  bakePotential3D(n, t = 0) {
    const data = new Float32Array(n * n * n * 4), o = [0, 0, 0, 0, 0, 0];
    let p = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = x / n * TAU, py = y / n * TAU, pz = z / n * TAU;
      this._eval(px, py, pz, t, o, 2);
      data[p] = o[3];
      data[p + 1] = o[4];
      data[p + 2] = o[5];
      this._eval(px, py, pz, t, o, 1);
      data[p + 3] = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
      p += 4;
    }
    return { data, size: n, channels: 4 };
  }
};

// src/index.ts
function create(options) {
  return new HelixField(options);
}
function createAtoms(options) {
  return new HelixAtoms(options);
}
var version = VERSION;
function selfTest() {
  const f = new HelixField({ modes: 40, helicity: 0.5, slope: 1, coherence: 0, seed: 1 });
  let tmax = 0;
  for (let j = 0; j < f.N; j++) {
    const a1 = Math.abs(f.kx[j] * f.e1x[j] + f.ky[j] * f.e1y[j] + f.kz[j] * f.e1z[j]);
    const a2 = Math.abs(f.kx[j] * f.e2x[j] + f.ky[j] * f.e2y[j] + f.kz[j] * f.e2z[j]);
    tmax = Math.max(tmax, a1, a2);
  }
  const h = 2e-3, M = 500, rng = mulberry32(7);
  let div2 = 0;
  const oa = [0, 0, 0, 0, 0, 0], ob = [0, 0, 0, 0, 0, 0];
  for (let m = 0; m < M; m++) {
    const x = rng() * TAU, y = rng() * TAU, z = rng() * TAU;
    let d = 0;
    f.sampleUW(x + h, y, z, oa);
    f.sampleUW(x - h, y, z, ob);
    d += (oa[0] - ob[0]) / (2 * h);
    f.sampleUW(x, y + h, z, oa);
    f.sampleUW(x, y - h, z, ob);
    d += (oa[1] - ob[1]) / (2 * h);
    f.sampleUW(x, y, z + h, oa);
    f.sampleUW(x, y, z - h, ob);
    d += (oa[2] - ob[2]) / (2 * h);
    div2 += d * d;
  }
  const fdDivergenceRms = Math.sqrt(div2 / M);
  const rhoVsP = {};
  for (const p of [-1, -0.5, 0, 0.5, 1]) {
    rhoVsP[String(p)] = new HelixField({ modes: 60, helicity: p, slope: 1, seed: 100 + (10 * p | 0) }).relativeHelicity(12);
  }
  return { transversality: tmax, fdDivergenceRms, rhoVsP };
}
var HelixNoise = { create, createAtoms, selfTest, version };
var src_default = HelixNoise;
export {
  HelixAtoms,
  HelixField,
  create,
  createAtoms,
  src_default as default,
  selfTest,
  version
};
//# sourceMappingURL=helix-noise.js.map