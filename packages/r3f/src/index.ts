/**
 * helix-noise-r3f — react-three-fiber components for Helix Noise.
 *
 * A transport over the `helix-noise` core: the CPU path calls `field.sampleUW`, the GPU path
 * inlines `field.glsl()`. The mode sum is never re-implemented here, so parity with the core
 * (and every other port) is inherited.
 */

// Layer 1 — the primitive hook and the plumbing under it.
export { useHelixField } from "./useHelixField";
export { buildField, fieldKey, helixFieldChunk } from "./core";

// Layer 2 — the field, in a shader.
export { helixFlowMaterial } from "./helixFlowMaterial";
export type { HelixFlowMaterialOptions } from "./helixFlowMaterial";

// Layer 3 — the declarative particle system.
export { HelixParticles } from "./HelixParticles";
export type { HelixParticlesProps, ColorBy, ParticleMode } from "./HelixParticles";

// Art-direction starting points.
export { presets } from "./presets";
export type { PresetName } from "./presets";

// Re-export the core option/field types so consumers need only this package.
export type { Field, HelixNoiseOptions, Vec3 } from "helix-noise";
