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
  ScaleFn,
  Sdf,
  SelfTestReport,
  Vec3,
} from "./types";
export { HelixField } from "./field";
export { HelixAtoms } from "./atoms";
export { shellPeak, rolloff, condensate, abc, twoScale, C_TWO_SCALE } from "./presets";

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
  const h = 0.002, M = 500;
  const oa = [0, 0, 0, 0, 0, 0], ob = [0, 0, 0, 0, 0, 0];
  const divRms = (g: HelixField, seed: number): number => {
    const rng = mulberry32(seed);
    let div2 = 0;
    for (let m = 0; m < M; m++) {
      const x = rng() * TAU, y = rng() * TAU, z = rng() * TAU;
      let d = 0;
      g.sampleUW(x + h, y, z, oa); g.sampleUW(x - h, y, z, ob); d += (oa[0] - ob[0]) / (2 * h);
      g.sampleUW(x, y + h, z, oa); g.sampleUW(x, y - h, z, ob); d += (oa[1] - ob[1]) / (2 * h);
      g.sampleUW(x, y, z + h, oa); g.sampleUW(x, y, z - h, ob); d += (oa[2] - ob[2]) / (2 * h);
      div2 += d * d;
    }
    return Math.sqrt(div2 / M);
  };
  const fdDivergenceRms = divRms(f, 7);

  // (ii-b) same check on elliptic (non-Beltrami) modes — divergence-freedom is independent of chi
  const fdDivergenceRmsElliptic = divRms(
    new HelixField({ modes: 40, helicity: 0.5, slope: 1.0, coherence: 0, seed: 1, ellipticity: 0.5 }),
    7
  );

  // (ii-c) known answer: one elliptic mode has relative helicity exactly 2*chi/(1+chi^2)
  let ellipticityRho = 0;
  for (const eps of [0, 0.5, 1]) {
    const g = new HelixField({ modes: 1, seed: 3, tileable: true, kmin: 2, kmax: 2, helicity: 1, ellipticity: eps });
    const chi = g.chi[0];
    ellipticityRho = Math.max(ellipticityRho, Math.abs(g.relativeHelicity(12) - (2 * chi) / (1 + chi * chi)));
  }

  // (iii) rho(p) sweep
  const rhoVsP: Record<string, number> = {};
  for (const p of [-1, -0.5, 0, 0.5, 1]) {
    rhoVsP[String(p)] = new HelixField({ modes: 60, helicity: p, slope: 1.0, seed: 100 + ((10 * p) | 0) }).relativeHelicity(12);
  }

  return { transversality: tmax, fdDivergenceRms, rhoVsP, ellipticityRho, fdDivergenceRmsElliptic };
}

/** Default export: the Helix Noise namespace (`HelixNoise.create(...)`). */
const HelixNoise = { create, createAtoms, selfTest, version };
export default HelixNoise;
