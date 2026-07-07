# Changelog — helix-noise-gpu

All notable changes to the WebGL2 particle engine. Versions track the `helix-noise` core loosely;
this package adds no field math of its own.

## 0.1.0 — 2026-07-08

First release. Generalises the core's `million.html` transform-feedback demo into a reusable,
framework-agnostic package.

- `createParticleSystem(gl, field, opts)` — one-call engine: a sim + renderer driven by a built-in
  orbit camera and RAF loop, with pointer-drag + wheel-zoom. Returns `start` / `stop` / `dispose` /
  `setField`.
- `HelixParticleSim` — the transform-feedback advection engine. Every particle is stepped through
  the injected `field.glsl()` on the GPU (rasterizer discarded, zero readback), ping-ponging between
  two interleaved VBOs. Exposes `step`, `setField`, `reseed`, and — for a bring-your-own renderer —
  `vao` / `buffer` / `count` / `stride`. Not `GPUComputationRenderer` and not three.js: raw WebGL2,
  so it drops into any framework or none.
- `HelixParticleRenderer` — additive point-splat renderer. Colours by local helicity (amber ↔ teal)
  and glows the fast filaments using the field's measured speed percentiles (`calibrateSpeed`), so
  the look is parameter-stable. Takes any column-major `mat4` view-projection (three.js / gl-matrix /
  built-in).
- Raw parts exported for hand-rolled pipelines: `buildUpdateVertexShader`,
  `buildRenderVertexShader` / `buildRenderFragmentShader`, `initParticles`, `calibrateSpeed`, and a
  dependency-free `mat4` kit (`perspective`, `lookAt`, `multiply`, `orbitViewProjection`).
- Tests (GL-free, wired into CI): update/render shader emission wires the core emitter and the
  transform-feedback varyings correctly; particle init is deterministic and in-bounds; the camera
  math projects known points correctly; speed calibration is positive/ascending/deterministic. The
  WebGL2 runtime is verified in-browser (`example/index.html`): 1 000 000 particles at 120 fps with
  zero GL errors, and a live `setField` helicity swap.
