# Changelog — helix-noise-r3f

All notable changes to the r3f adapter. Versions track the `helix-noise` core loosely; this
package adds no field math of its own.

## 0.1.0 — unreleased

First release (roadmap M0–M2).

- `useHelixField(options)` — memoised core `Field` hook.
- `helixFlowMaterial(field, opts?)` — `THREE.ShaderMaterial` colouring points by helicity via
  the injected `field.glsl()`.
- `<HelixParticles>` — declarative particle system with two engines behind one component:
  - **CPU** (`field.sampleUW`) — runs everywhere, `≲50k` particles.
  - **GPU** — a self-contained GLSL ES 3.00 float-texture ping-pong that advects on-device
    from the injected `field.glsl()` (not `GPUComputationRenderer`, whose GLSL ES 1.00 compute
    shaders cannot host the emitter's array-constructor syntax). Scales to ~10⁶ particles.
  - `mode="auto"` picks GPU for large counts when WebGL2 float render targets are available and
    falls back to CPU otherwise (and on any GPU-init failure) with a one-time console notice.
- `presets` — `cirrus` / `kelp` / `nebula` / `smoke` option bundles.
- Tests: transport faithfulness, GLSL emission shape, and a numeric GLSL↔`sample()` parity
  harness (`≤1e-9` at precision 17; documents the `≤1e-5` default-precision ship tradeoff).
  Wired into CI. GPU path additionally verified in-browser (`examples/r3f`).
