import type { HelixNoiseOptions } from "./types";

export const TAU = 2 * Math.PI;

export const VERSION = "1.1.0";

/** Default options, filled in for every field (`spectrum` stays optional — no default law object). */
export const DEFAULTS: Required<Omit<HelixNoiseOptions, "spectrum">> & Pick<HelixNoiseOptions, "spectrum"> = {
  modes: 48, // number of helical modes (cost of one sample is O(modes))
  slope: 1.6, // spectral slope s: amplitude ~ |k|^-s  (steep = big swirls)
  helicity: 0.0, // p in [-1, 1]: energy split between +/- helical states
  coherence: 0.0, // lambda in [0, 1]: phases random -> structured (fixed spectrum)
  kmin: 1.0, // smallest wavenumber (largest structures)
  kmax: 6.2, // largest wavenumber (finest detail)
  centers: 3, // focus points the coherent phases organize toward
  amplitude: 1.0, // output scale; normalized to unit RMS speed, then * amplitude
  tileable: false, // snap wavevectors to the integer lattice => exactly 2*PI-periodic
  seed: 1,
  layout: "fibonacci", // mode layout: low-discrepancy directions + stratified spectrum ("random" = i.i.d. ensemble)
  churn: 1.0, // time-evolution rate for sample(x, y, z, t): eddy-turnover phase churn + structure sweep
  decay: 0.0, // viscosity nu >= 0: mode amplitudes decay as e^(-nu k^2 t)
  anisotropy: 0.0, // direction stretch along `axis`: < 0 streaks along it, > 0 layers across it
  axis: [0, 0, 1], // anisotropy axis
};
