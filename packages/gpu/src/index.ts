// helix-noise-gpu — a framework-agnostic WebGL2 particle engine for Helix Noise.
//
// Three altitudes:
//   1. createParticleSystem(gl, field, opts)  — one call: sim + renderer + orbit + RAF loop.
//   2. HelixParticleSim / HelixParticleRenderer — compose the advection and the splat yourself.
//   3. buildUpdateVertexShader / initParticles / calibrateSpeed / camera math — raw parts for a
//      bring-your-own-renderer pipeline (three.js, a custom program, …).
//
// The mode sum is never re-implemented here: the update shader inlines the core `field.glsl()`,
// so parity with every other Helix Noise port is inherited, not re-established.

export { HelixParticleSim } from "./sim";
export type { HelixParticleSimOptions } from "./sim";

export { HelixParticleRenderer } from "./renderer";
export type { HelixParticleRendererOptions, Camera } from "./renderer";

export { createParticleSystem } from "./system";
export type { ParticleSystem, ParticleSystemOptions } from "./system";

// Raw parts (bring-your-own-renderer).
export {
  buildUpdateVertexShader,
  buildRenderVertexShader,
  buildRenderFragmentShader,
  glslFloat,
  UPDATE_FRAGMENT_SHADER,
  UPDATE_VARYINGS,
} from "./shaders";
export type { UpdateShaderOptions, RenderShaderOptions } from "./shaders";

export { initParticles } from "./particles";
export { calibrateSpeed } from "./calibrate";
export type { SpeedPercentiles } from "./calibrate";

export { perspective, lookAt, multiply, orbitViewProjection } from "./camera";
export type { Mat4, Vec3, OrbitOptions } from "./camera";

export { compileShader, linkProgram } from "./gl";

export {
  TAU,
  PARTICLE_STRIDE_FLOATS,
  PARTICLE_STRIDE_BYTES,
  ATTRIB_POS,
  ATTRIB_AUX,
} from "./constants";

/** Library version. */
export const version = "0.1.0";
