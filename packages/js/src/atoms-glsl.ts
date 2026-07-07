import type { AtomField, GlslOptions } from "./types";

/** GLSL float literal (always has a decimal point or exponent). */
function fl(x: number, pr: number): string {
  const s = Number(x).toPrecision(pr);
  return /[.eE]/.test(s) ? s : s + ".0";
}

/**
 * Emit self-contained GLSL (ES 3.00 / WebGL2) that regenerates and evaluates the atom field on
 * the GPU. The spatial hash and mulberry32 PRNG are pure 32-bit integer ops, so atoms are
 * reproduced bit-exactly; the only divergence from the CPU field is float32 rounding (~1e-4
 * relative). Atoms are regenerated per fragment (no cache on a GPU) — cost is
 * octaves × 8 cells × atomsPerCell per call, so this is for moderate resolutions or offline
 * passes; for cheap real-time use prefer `bake3D()` / `bakePotential3D()` textures.
 *
 * Constant parameters only: throws if `helicityField` / `gainField` / `spectrum` are set
 * (JS callbacks cannot be ported — bake instead).
 */
export function atomsToGLSL(f: AtomField, kBase: number, scale: number, opts: GlslOptions = {}): string {
  const p = f.params;
  if (p.helicityField || p.gainField || p.spectrum) {
    throw new Error(
      "helix-noise: glsl() on an atom field requires constant parameters — " +
        "helicityField/gainField/spectrum are JS callbacks; use bake3D()/bakePotential3D() instead."
    );
  }
  const name = (opts.name ?? "helixAtoms").replace(/[^A-Za-z0-9_]/g, "_");
  const pr = opts.precision ?? 7;
  const curl = opts.curl !== false;
  const pot = opts.potential === true;
  const P = name + "_";

  const oct = Math.max(1, p.octaves | 0);
  const npc = Math.max(1, p.atomsPerCell | 0);
  const seedU = (p.seed >>> 0) || 1;
  const oseed: string[] = [];
  for (let o = 0; o < oct; o++) oseed.push(((seedU + Math.imul(o, 0x9e3779b9)) >>> 0) + "u");
  const gam = Math.min(9, Math.max(-0.99, p.anisotropy));
  const an = Math.hypot(p.axis[0], p.axis[1], p.axis[2]) || 1;
  const chi = Math.max(0, p.churn);
  const rate0 = chi * Math.cbrt(kBase);

  // One atom's parameters, drawn in the engine's exact order (each P_rng call sequenced in its
  // own statement — GLSL does not define cross-argument evaluation order).
  const gen: string[] = [
    `        float g1 = ${P}rng(st); float g2 = ${P}rng(st); float g3 = ${P}rng(st);`,
    "        vec3 c = (vec3(cc) + vec3(g1, g2, g3)) * L;",
    `        float zd = 2.0 * ${P}rng(st) - 1.0;`,
    `        float th = 6.28318530717958648 * ${P}rng(st);`,
    "        float rd = sqrt(max(0.0, 1.0 - zd * zd));",
    "        vec3 d = vec3(rd * cos(th), rd * sin(th), zd);",
    ...(gam !== 0
      ? [
          `        d += ${fl(gam, pr)} * dot(d, ${P}AXIS) * ${P}AXIS;`,
          "        d = normalize(d);",
        ]
      : []),
    `        float km = kc * (0.85 + 0.3 * ${P}rng(st));`,
    `        float s = ${P}rng(st) < ${fl((1 + p.helicity) / 2, pr)} ? 1.0 : -1.0;`,
    `        float ph = 6.28318530717958648 * ${P}rng(st);`,
    `        float sgn = ${P}rng(st) < 0.5 ? -1.0 : 1.0;`,
    "        vec3 dd = p - c;",
    "        float r2 = dot(dd, dd);",
    "        if (r2 >= r2max) continue;",
    `        float om = sgn * ${fl(rate0, pr)} * pow(km, 0.66666666666666663);`,
    `        float a = pow(km * ${fl(1 / kBase, pr)}, ${fl(-p.slope, pr)});`,
    `        vec3 e1, e2; ${P}frame(d, e1, e2);`,
    "        vec3 k = km * d;",
    "        float beta = 1.0 - r2 / r2max, b2 = beta * beta, w = b2 * beta;",
    "        float phi = dot(k, dd) + ph + om * t;",
    "        float cph = cos(phi), sph = sin(phi);",
    "        vec3 tw = a * (cph * e1 - s * sph * e2);",
  ];

  const loops = (body: string[]): string[] => [
    `  for (int o = 0; o < ${P}OCT; o++) {`,
    `    float rho = ${fl(p.radius, pr)} / float(1 << o);`,
    "    float L = 2.0 * rho, r2max = rho * rho;",
    `    float kc = ${fl(kBase, pr)} * float(1 << o);`,
    "    ivec3 base = ivec3(floor(p / L - 0.5));",
    "    for (int dc = 0; dc < 8; dc++) {",
    "      ivec3 cc = base + ivec3(dc & 1, (dc >> 1) & 1, (dc >> 2) & 1);",
    `      uint st = ${P}hash(cc, ${P}OSEED[o]);`,
    `      for (int m = 0; m < ${P}NPC; m++) {`,
    ...gen,
    ...body,
    "      }",
    "    }",
    "  }",
  ];

  const L: string[] = [
    "// Helix Noise atoms — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.",
    `// ${oct} octaves × 8 cells × ${npc} atoms per sample, regenerated in-shader from the spatial hash.`,
    `// Defines vec3 ${name}(vec3 p) / (vec3 p, float t)${curl ? ` and ${name}Curl` : ""}${pot ? ` and ${name}Pot` : ""}.`,
    `const int ${P}OCT = ${oct};`,
    `const int ${P}NPC = ${npc};`,
    `const uint ${P}OSEED[${oct}] = uint[${oct}](${oseed.join(",")});`,
    `const float ${P}SCALE = ${fl(scale, pr)};`,
    ...(gam !== 0
      ? [`const vec3 ${P}AXIS = vec3(${fl(p.axis[0] / an, pr)},${fl(p.axis[1] / an, pr)},${fl(p.axis[2] / an, pr)});`]
      : []),
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
      "        u += cross(gw, A) + w * tw;",
    ]),
    `  return u * ${P}SCALE;`,
    "}",
    `vec3 ${name}(vec3 p) { return ${name}(p, 0.0); }`,
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
        "        wv += c1 * A + c2 * (dA * dd - r2 * A) + dot(gw, ap) * k - 2.0 * dot(k, gw) * ap + s * km * w * tw;",
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
