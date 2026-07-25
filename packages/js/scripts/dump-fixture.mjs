// Dump a canonical parity fixture from the JS reference implementation.
// Consumed by the Python / Rust / shader ports' tests to prove numerical parity.
import { create, createAtoms, abc, shellPeak, rolloff, condensate } from "../dist/helix-noise.js";

// Callable options can't live in JSON, so the fixture stores them as named preset descriptors
// ({"$preset": name, "args": [...]}) that every port maps through its own preset registry.
const PRESETS = { shellPeak, rolloff, condensate };
const resolve = (cfg) => Object.fromEntries(Object.entries(cfg).map(([k, v]) =>
  [k, v && v.$preset ? PRESETS[v.$preset](...v.args) : v]));

const CONFIGS = {
  A_default_small: { modes: 8, seed: 1 },
  B_helical_coherent: { modes: 6, seed: 42, helicity: 0.8, coherence: 0.5, slope: 1.6, centers: 3 },
  C_random_aniso: { modes: 5, seed: 7, layout: "random", anisotropy: -0.5, axis: [0, 0, 1] },
  D_decay_time: { modes: 6, seed: 3, decay: 0.02, churn: 1.0 },
  E_tileable: { modes: 8, seed: 2, tileable: true },
  // Ellipticity (spec 1.1): chi = ellipticity*s. J pins the linear endpoint (sheets, zero
  // helicity), K a mixed chi = ±0.5 field — both exercise the general two-term curl/potential.
  J_elliptic_linear: { modes: 6, seed: 11, ellipticity: 0 },
  K_elliptic_half: { modes: 6, seed: 5, ellipticity: 0.5, helicity: 0.3, coherence: 0.25 },
  // Scale-dependent dials (spec §10.1): the callables are named presets so ports can rebuild them.
  M_coherence_k: { modes: 6, seed: 11, centers: 2, coherence: { $preset: "rolloff", args: [4] } },
  N_helicity_k: { modes: 8, seed: 12, helicity: { $preset: "condensate", args: [3.0, 1, -1] } },
  O_shellpeak: { modes: 8, seed: 13, spectrum: { $preset: "shellPeak", args: [3, 1] } },
  // Grain axis (spec 1.2): the second RNG stream folds a general transverse amplitude into the
  // frame, so this config also pins the cross-product curl/potential path.
  Q_grain: { modes: 6, seed: 9, ellipticity: 0.4, polarizationAxis: [0, 1, 0], polarizationBias: 0.6 },
};

const POINTS = [
  [0, 0, 0],
  [1.0, 2.0, 3.0],
  [-2.5, 0.7, 4.1],
  [6.28318, -1.234, 0.5],
];
const TIMES = [0, 0.5];

const arr = (a) => Array.from(a);

const out = {};
for (const [name, cfg] of Object.entries(CONFIGS)) {
  const f = create(resolve(cfg));
  const modes = {
    N: f.N,
    kx: arr(f.kx), ky: arr(f.ky), kz: arr(f.kz), km: arr(f.km),
    e1x: arr(f.e1x), e1y: arr(f.e1y), e1z: arr(f.e1z),
    e2x: arr(f.e2x), e2y: arr(f.e2y), e2z: arr(f.e2z),
    s: arr(f.s), chi: arr(f.chi), a: arr(f.a), ph: arr(f.ph), om: arr(f.om),
    scale: f._scale, nu: f.nu,
  };
  const samples = [];
  for (const t of TIMES) {
    for (const [x, y, z] of POINTS) {
      const uw = [0, 0, 0, 0, 0, 0];
      f.sampleUW(x, y, z, uw, t);
      const ua = [0, 0, 0, 0, 0, 0];
      f.sampleUA(x, y, z, ua, t);
      samples.push({ x, y, z, t, u: uw.slice(0, 3), w: uw.slice(3, 6), A: ua.slice(3, 6) });
    }
  }
  // bake3D(4) checksum + relativeHelicity as scalar aggregates
  const bake = f.bake3D(4, 0);
  let bsum = 0;
  for (let i = 0; i < bake.data.length; i++) bsum += bake.data[i];
  out[name] = {
    config: cfg,
    modes,
    samples,
    relativeHelicity: f.relativeHelicity(8),
    bake3d4_sum: bsum,
  };
}

// The abc() factory: a closed-form, RNG-free 3-mode field (spec §10.2).
{
  const f = abc(1.5, 1.0, 0.5);
  const samples = [];
  for (const t of TIMES) {
    for (const [x, y, z] of POINTS) {
      const uw = [0, 0, 0, 0, 0, 0];
      f.sampleUW(x, y, z, uw, t);
      const ua = [0, 0, 0, 0, 0, 0];
      f.sampleUA(x, y, z, ua, t);
      samples.push({ x, y, z, t, u: uw.slice(0, 3), w: uw.slice(3, 6), A: ua.slice(3, 6) });
    }
  }
  const bake = f.bake3D(4, 0);
  let bsum = 0;
  for (let i = 0; i < bake.data.length; i++) bsum += bake.data[i];
  out.P_abc = {
    factory: { $factory: "abc", args: [1.5, 1.0, 0.5] },
    modes: {
      N: f.N,
      kx: arr(f.kx), ky: arr(f.ky), kz: arr(f.kz), km: arr(f.km),
      e1x: arr(f.e1x), e1y: arr(f.e1y), e1z: arr(f.e1z),
      e2x: arr(f.e2x), e2y: arr(f.e2y), e2z: arr(f.e2z),
      s: arr(f.s), chi: arr(f.chi), a: arr(f.a), ph: arr(f.ph), om: arr(f.om),
      scale: f._scale, nu: f.nu,
    },
    samples,
    relativeHelicity: f.relativeHelicity(8),
    bake3d4_sum: bsum,
  };
}

// Boundary parity: base config B, sphere SDF, no analytic gradient (central-diff path).
{
  const base = create({ modes: 6, seed: 42, helicity: 0.8, coherence: 0.5, slope: 1.6, centers: 3 });
  const sphere = (x, y, z) => Math.hypot(x - 3, y - 3, z - 3) - 1.2;
  const bnd = base.withBoundary(sphere, { thickness: 0.9, fdStep: 1e-3 });
  const bpts = [
    [3, 3, 3],       // inside → zero
    [3, 3, 1.5],     // near wall, in the band
    [3, 3, 0.5],     // in the band
    [6, 6, 6],       // far outside → base field
    [4.0, 3.2, 2.6], // band, off-axis
  ];
  const bsamples = [];
  for (const [x, y, z] of bpts) {
    const uw = [0, 0, 0, 0, 0, 0];
    bnd.sampleUW(x, y, z, uw, 0);
    const pot = bnd.potential(x, y, z, 0);
    bsamples.push({ x, y, z, u: uw.slice(0, 3), w: uw.slice(3, 6), pot });
  }
  out.boundary_F = { base_config: { modes: 6, seed: 42, helicity: 0.8, coherence: 0.5, slope: 1.6, centers: 3 }, thickness: 0.9, fdStep: 1e-3, samples: bsamples };
}

// Boundary parity with elliptic modes: the wrapper consumes the base field's analytic potential,
// which stays exact for every chi — same sphere/thickness as boundary_F, base config K.
{
  const baseCfg = { modes: 6, seed: 5, ellipticity: 0.5, helicity: 0.3, coherence: 0.25 };
  const base = create(baseCfg);
  const sphere = (x, y, z) => Math.hypot(x - 3, y - 3, z - 3) - 1.2;
  const bnd = base.withBoundary(sphere, { thickness: 0.9, fdStep: 1e-3 });
  const bsamples = [];
  for (const [x, y, z] of [[3, 3, 3], [3, 3, 1.5], [3, 3, 0.5], [6, 6, 6], [4.0, 3.2, 2.6]]) {
    const uw = [0, 0, 0, 0, 0, 0];
    bnd.sampleUW(x, y, z, uw, 0);
    const pot = bnd.potential(x, y, z, 0);
    bsamples.push({ x, y, z, u: uw.slice(0, 3), w: uw.slice(3, 6), pot });
  }
  out.boundary_L_elliptic = { base_config: baseCfg, thickness: 0.9, fdStep: 1e-3, samples: bsamples };
}

// Atom-engine parity: the sparse-wavelet engine. Constant-parameter configs only (no callback
// fields) so every port can reproduce them from options alone.
{
  const ATOM_CONFIGS = {
    G_atoms_default: {},
    H_atoms_helical: { octaves: 2, atomsPerCell: 4, helicity: 0.7, seed: 42, churn: 1 },
    I_atoms_aniso: { octaves: 2, atomsPerCell: 3, anisotropy: -0.5, axis: [0, 0, 1], slope: 1.6, seed: 7 },
  };
  for (const [name, cfg] of Object.entries(ATOM_CONFIGS)) {
    const f = createAtoms(cfg);
    const samples = [];
    for (const t of TIMES) {
      for (const [x, y, z] of POINTS) {
        const uw = [0, 0, 0, 0, 0, 0];
        f.sampleUW(x, y, z, uw, t);
        const ua = [0, 0, 0, 0, 0, 0];
        f.sampleUA(x, y, z, ua, t);
        samples.push({ x, y, z, t, u: uw.slice(0, 3), w: uw.slice(3, 6), A: ua.slice(3, 6) });
      }
    }
    const bake = f.bake3D(4, 0);
    let bsum = 0;
    for (let i = 0; i < bake.data.length; i++) bsum += bake.data[i];
    out[name] = {
      config: cfg,
      scale: f._scale,
      kBase: f._kBase,
      samples,
      relativeHelicity: f.relativeHelicity(8),
      bake3d4_sum: bsum,
    };
  }
}

process.stdout.write(JSON.stringify(out, null, 2));
