import type { HelixNoiseOptions } from "helix-noise";

/**
 * Named art-direction starting points, distilled from the JS examples of the same name
 * (`packages/js/examples/{cirrus,kelp,nebula,smoke}.html`). These are plain
 * `HelixNoiseOptions` — spread them into `useHelixField` / `<HelixParticles>` and override
 * whatever you like:
 *
 * ```tsx
 * const field = useHelixField({ ...presets.nebula, seed: 42 });
 * ```
 *
 * They add no new knobs; the adapter is a transport, so a preset is only ever a bundle of
 * core options.
 */
export const presets = {
  /** Thin, streaked high-altitude cloud: mild slope, anisotropy streaking along one axis. */
  cirrus: {
    modes: 40,
    slope: 1.4,
    helicity: 0.3,
    coherence: 0.35,
    anisotropy: -0.6,
    axis: [1, 0, 0],
    kmax: 6.2,
  },
  /** Swaying kelp / hair: coherent, gently churning, biased handedness. */
  kelp: {
    modes: 40,
    slope: 1.8,
    helicity: 0.5,
    coherence: 0.6,
    churn: 0.5,
    kmax: 5.5,
  },
  /** Soft volumetric cloud with a few focus points: several centers, broad spectrum. */
  nebula: {
    modes: 48,
    slope: 1.6,
    helicity: 0.2,
    coherence: 0.5,
    centers: 4,
    kmax: 6.0,
  },
  /** Rolling smoke: mid mode-count, moderate coherence, unbiased handedness. */
  smoke: {
    modes: 44,
    slope: 1.7,
    helicity: 0.0,
    coherence: 0.45,
  },
} satisfies Record<string, HelixNoiseOptions>;

export type PresetName = keyof typeof presets;
