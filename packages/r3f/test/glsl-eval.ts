// A tiny, dependency-free evaluator for the GLSL that `field.glsl()` emits. It parses the
// baked constant arrays out of the *emitted text* and runs the shader's own formula in JS.
//
// This is deliberately independent of the core's `field.sample()` code path: it does not
// import any sampling code, it re-runs exactly what the GPU would run, from the exact string
// we inject. So "eval(chunk) ≈ field.sample()" verifies that the text we hand the GPU is a
// faithful transport of the field — the parity guarantee the GPU render path relies on.
//
// It supports the subset the emitter produces (GLSL ES 3.00 const array constructors); it is
// not a general GLSL interpreter.

export interface ParsedField {
  N: number;
  K: number[][];
  E1: number[][];
  E2: number[][];
  S: number[];
  A: number[];
  PH: number[];
  OM: number[];
  SCALE: number;
  NU: number | null;
}

function vec3Array(src: string, sym: string, N: number): number[][] {
  const re = new RegExp(`const vec3 ${sym}\\[${N}\\] = vec3\\[${N}\\]\\(([\\s\\S]*?)\\);`);
  const m = src.match(re);
  if (!m) throw new Error(`missing vec3 array ${sym}`);
  const vecs = [...m[1].matchAll(/vec3\(([^)]*)\)/g)].map((v) =>
    v[1].split(",").map((x) => Number(x.trim())),
  );
  if (vecs.length !== N) throw new Error(`${sym}: expected ${N} vec3, got ${vecs.length}`);
  return vecs;
}

function floatArray(src: string, sym: string, N: number): number[] {
  const re = new RegExp(`const float ${sym}\\[${N}\\] = float\\[${N}\\]\\(([\\s\\S]*?)\\);`);
  const m = src.match(re);
  if (!m) throw new Error(`missing float array ${sym}`);
  const arr = m[1].split(",").map((x) => Number(x.trim()));
  if (arr.length !== N) throw new Error(`${sym}: expected ${N} floats, got ${arr.length}`);
  return arr;
}

function scalar(src: string, sym: string): number | null {
  const m = src.match(new RegExp(`const float ${sym} = ([^;]+);`));
  return m ? Number(m[1].trim()) : null;
}

/** Parse the emitted GLSL of `<name>` into its baked mode data. */
export function parseChunk(src: string, name = "helixNoise"): ParsedField {
  const P = name + "_";
  const nm = src.match(new RegExp(`const int ${P}N = (\\d+);`));
  if (!nm) throw new Error("missing mode count N");
  const N = Number(nm[1]);
  const SCALE = scalar(src, `${P}SCALE`);
  if (SCALE == null) throw new Error("missing SCALE");
  return {
    N,
    K: vec3Array(src, `${P}K`, N),
    E1: vec3Array(src, `${P}E1`, N),
    E2: vec3Array(src, `${P}E2`, N),
    S: floatArray(src, `${P}S`, N),
    A: floatArray(src, `${P}A`, N),
    PH: floatArray(src, `${P}PH`, N),
    OM: floatArray(src, `${P}OM`, N),
    SCALE,
    NU: scalar(src, `${P}NU`),
  };
}

/** Evaluate the emitted `<name>(p, t)` velocity — the exact loop from `toGLSL`. */
export function evalVelocity(f: ParsedField, p: [number, number, number], t = 0): [number, number, number] {
  let ux = 0, uy = 0, uz = 0;
  for (let j = 0; j < f.N; j++) {
    const k = f.K[j], e1 = f.E1[j], e2 = f.E2[j], sj = f.S[j];
    const phi = k[0] * p[0] + k[1] * p[1] + k[2] * p[2] + f.PH[j] + f.OM[j] * t;
    let amp = f.A[j];
    if (f.NU != null) amp *= Math.exp(-f.NU * (k[0] * k[0] + k[1] * k[1] + k[2] * k[2]) * t);
    const c = Math.cos(phi), s = Math.sin(phi);
    ux += amp * (c * e1[0] - sj * s * e2[0]);
    uy += amp * (c * e1[1] - sj * s * e2[1]);
    uz += amp * (c * e1[2] - sj * s * e2[2]);
  }
  return [ux * f.SCALE, uy * f.SCALE, uz * f.SCALE];
}

/** Evaluate the emitted `<name>Curl(p, t)` vorticity — the exact loop from `toGLSL`. */
export function evalCurl(f: ParsedField, p: [number, number, number], t = 0): [number, number, number] {
  let wx = 0, wy = 0, wz = 0;
  for (let j = 0; j < f.N; j++) {
    const k = f.K[j], e1 = f.E1[j], e2 = f.E2[j], sj = f.S[j];
    const phi = k[0] * p[0] + k[1] * p[1] + k[2] * p[2] + f.PH[j] + f.OM[j] * t;
    let amp = f.A[j];
    if (f.NU != null) amp *= Math.exp(-f.NU * (k[0] * k[0] + k[1] * k[1] + k[2] * k[2]) * t);
    const c = Math.cos(phi), s = Math.sin(phi);
    const kl = Math.hypot(k[0], k[1], k[2]);
    const g = sj * kl;
    wx += g * amp * (c * e1[0] - sj * s * e2[0]);
    wy += g * amp * (c * e1[1] - sj * s * e2[1]);
    wz += g * amp * (c * e1[2] - sj * s * e2[2]);
  }
  return [wx * f.SCALE, wy * f.SCALE, wz * f.SCALE];
}
