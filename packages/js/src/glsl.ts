import type { GlslOptions, ModeData } from "./types";

/** GLSL float literal (always has a decimal point or exponent). */
function fl(x: number, pr: number): string {
  const s = Number(x).toPrecision(pr);
  return /[.eE]/.test(s) ? s : s + ".0";
}

/**
 * Emit self-contained GLSL (ES 3.00 / WebGL2) that evaluates the exact same field on the GPU.
 * Defines `vec3 <name>(vec3 p)` and `vec3 <name>(vec3 p, float t)` (and, by default, the same
 * pair for `<name>Curl`). Params are baked as constants, so regenerate to re-tune. Verified
 * equal to `Field.sample` to machine precision.
 */
export function toGLSL(f: ModeData, opts: GlslOptions = {}): string {
  const name = (opts.name ?? "helixNoise").replace(/[^A-Za-z0-9_]/g, "_");
  const pr = opts.precision ?? 7;
  const curl = opts.curl !== false;
  const pot = opts.potential === true;
  const N = f.N;
  const P = name + "_";
  const decay = f.nu > 0;

  const v3 = (cx: keyof ModeData, cy: keyof ModeData, cz: keyof ModeData): string => {
    const ax = f[cx] as Float64Array, ay = f[cy] as Float64Array, az = f[cz] as Float64Array;
    const parts: string[] = [];
    for (let j = 0; j < N; j++) parts.push(`vec3(${fl(ax[j], pr)},${fl(ay[j], pr)},${fl(az[j], pr)})`);
    return `vec3[${N}](${parts.join(",")})`;
  };
  const fa = (c: keyof ModeData): string => {
    const arr = f[c] as Float64Array;
    const parts: string[] = [];
    for (let j = 0; j < N; j++) parts.push(fl(arr[j], pr));
    return `float[${N}](${parts.join(",")})`;
  };

  // Amplitude at time t: baked a_j, optionally with the viscous factor e^(-nu k^2 t).
  const amp = decay ? `${P}A[j] * exp(-${P}NU * dot(${P}K[j], ${P}K[j]) * t)` : `${P}A[j]`;

  const L: string[] = [
    "// Helix Noise — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.",
    `// ${N} modes. Defines vec3 ${name}(vec3 p) / (vec3 p, float t)${curl ? ` and vec3 ${name}Curl — same pair.` : "."}`,
    `const int ${P}N = ${N};`,
    `const vec3 ${P}K[${N}] = ${v3("kx", "ky", "kz")};`,
    `const vec3 ${P}E1[${N}] = ${v3("e1x", "e1y", "e1z")};`,
    `const vec3 ${P}E2[${N}] = ${v3("e2x", "e2y", "e2z")};`,
    `const float ${P}S[${N}] = ${fa("s")};`,
    `const float ${P}A[${N}] = ${fa("a")};`,
    `const float ${P}PH[${N}] = ${fa("ph")};`,
    `const float ${P}OM[${N}] = ${fa("om")};`,
    `const float ${P}SCALE = ${fl(f._scale, pr)};`,
    ...(decay ? [`const float ${P}NU = ${fl(f.nu, pr)};`] : []),
    "",
    `vec3 ${name}(vec3 p, float t) {`,
    "  vec3 u = vec3(0.0);",
    `  for (int j = 0; j < ${P}N; j++) {`,
    `    float phi = dot(${P}K[j], p) + ${P}PH[j] + ${P}OM[j] * t;`,
    `    u += (${amp}) * (cos(phi) * ${P}E1[j] - ${P}S[j] * sin(phi) * ${P}E2[j]);`,
    "  }",
    `  return u * ${P}SCALE;`,
    "}",
    `vec3 ${name}(vec3 p) { return ${name}(p, 0.0); }`,
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
    // Vector potential: A_j = (s_j/|k_j|)·u_j, so curl(<name>Pot) == <name> exactly. Ramp it by
    // your SDF and take an in-shader curl for obstacle-aware, divergence-free flow.
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
