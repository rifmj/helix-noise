// Dump a canonical parity fixture from the JS reference implementation.
// Consumed by the Python / Rust / shader ports' tests to prove numerical parity.
import { create, createAtoms } from "../dist/helix-noise.js";

const CONFIGS = {
  A_default_small: { modes: 8, seed: 1 },
  B_helical_coherent: { modes: 6, seed: 42, helicity: 0.8, coherence: 0.5, slope: 1.6, centers: 3 },
  C_random_aniso: { modes: 5, seed: 7, layout: "random", anisotropy: -0.5, axis: [0, 0, 1] },
  D_decay_time: { modes: 6, seed: 3, decay: 0.02, churn: 1.0 },
  E_tileable: { modes: 8, seed: 2, tileable: true },
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
  const f = create(cfg);
  const modes = {
    N: f.N,
    kx: arr(f.kx), ky: arr(f.ky), kz: arr(f.kz), km: arr(f.km),
    e1x: arr(f.e1x), e1y: arr(f.e1y), e1z: arr(f.e1z),
    e2x: arr(f.e2x), e2y: arr(f.e2y), e2z: arr(f.e2z),
    s: arr(f.s), a: arr(f.a), ph: arr(f.ph), om: arr(f.om),
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
