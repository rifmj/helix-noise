import { TAU, VERSION } from "./constants";
import { HelixField } from "./field";
import { HelixAtoms } from "./atoms";
import { mulberry32 } from "./rng";
import type { AtomField, Field, HelixAtomsOptions, HelixNoiseOptions, SelfTestReport } from "./types";

export type {
  AtomField,
  Bake2DResult,
  Bake3DResult,
  BoundaryOptions,
  BoundedField,
  Field,
  FlowField,
  GlslOptions,
  HelixAtomsOptions,
  HelixNoiseOptions,
  Out6,
  Sdf,
  SelfTestReport,
  Vec3,
} from "./types";
export { HelixField } from "./field";
export { HelixAtoms } from "./atoms";

/** Create a Helix Noise field. */
export function create(options?: HelixNoiseOptions): Field {
  return new HelixField(options);
}

/** Create a sparse-atom field: broadband, infinite, amortized O(1), spatially-varying params. */
export function createAtoms(options?: HelixAtomsOptions): AtomField {
  return new HelixAtoms(options);
}

/** Library version. */
export const version = VERSION;

/** Run the built-in validation (transversality, divergence, helicity tracking). */
export function selfTest(): SelfTestReport {
  const f = new HelixField({ modes: 40, helicity: 0.5, slope: 1.0, coherence: 0, seed: 1 });

  // (i) analytic transversality: k · e1, k · e2 == 0 by construction
  let tmax = 0;
  for (let j = 0; j < f.N; j++) {
    const a1 = Math.abs(f.kx[j] * f.e1x[j] + f.ky[j] * f.e1y[j] + f.kz[j] * f.e1z[j]);
    const a2 = Math.abs(f.kx[j] * f.e2x[j] + f.ky[j] * f.e2y[j] + f.kz[j] * f.e2z[j]);
    tmax = Math.max(tmax, a1, a2);
  }

  // (ii) finite-difference divergence at random points (pure O(h^2) truncation)
  const h = 0.002, M = 500, rng = mulberry32(7);
  let div2 = 0;
  const oa = [0, 0, 0, 0, 0, 0], ob = [0, 0, 0, 0, 0, 0];
  for (let m = 0; m < M; m++) {
    const x = rng() * TAU, y = rng() * TAU, z = rng() * TAU;
    let d = 0;
    f.sampleUW(x + h, y, z, oa); f.sampleUW(x - h, y, z, ob); d += (oa[0] - ob[0]) / (2 * h);
    f.sampleUW(x, y + h, z, oa); f.sampleUW(x, y - h, z, ob); d += (oa[1] - ob[1]) / (2 * h);
    f.sampleUW(x, y, z + h, oa); f.sampleUW(x, y, z - h, ob); d += (oa[2] - ob[2]) / (2 * h);
    div2 += d * d;
  }
  const fdDivergenceRms = Math.sqrt(div2 / M);

  // (iii) rho(p) sweep
  const rhoVsP: Record<string, number> = {};
  for (const p of [-1, -0.5, 0, 0.5, 1]) {
    rhoVsP[String(p)] = new HelixField({ modes: 60, helicity: p, slope: 1.0, seed: 100 + ((10 * p) | 0) }).relativeHelicity(12);
  }

  return { transversality: tmax, fdDivergenceRms, rhoVsP };
}

/** Default export: the Helix Noise namespace (`HelixNoise.create(...)`). */
const HelixNoise = { create, createAtoms, selfTest, version };
export default HelixNoise;
