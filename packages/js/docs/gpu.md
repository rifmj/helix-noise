---
title: Helix Noise — WebGL2 GPU particles
description: helix-noise-gpu — a framework-agnostic WebGL2 particle engine. Advect millions of particles on the GPU via transform feedback, driven by the injected field.glsl(). No three.js, no React.
---

# Helix Noise — WebGL2 GPU particles

[`helix-noise-gpu`](https://github.com/rifmj/helix-noise/tree/main/packages/gpu) advects **millions
of particles entirely on the GPU**. Hand it any `WebGL2RenderingContext` and a [Helix Noise](/API)
field; a transform-feedback pass steps every particle through the field with **zero per-frame CPU
work** — no three.js, no React, no readback.

It is a **transport** over the [JavaScript core](/API), never a re-implementation: the update shader
inlines the emitted `field.glsl()`. The mode sum lives in one place, so numerical parity with every
other port is inherited — the emitted GLSL reproduces `field.sample()` to ≤1e-9 (≤1e-5 at the default
ship precision).

**Ports:** [JavaScript](/API) · [Python](/python) · [Rust](/rust) · [Shaders](/shaders) ·
[React / r3f](/r3f) · WebGL2 (this page) · [Project home](/)

**Registry & source:** npm `helix-noise-gpu` ·
[GitHub source](https://github.com/rifmj/helix-noise/tree/main/packages/gpu)

## Install

```sh
npm install helix-noise-gpu helix-noise
```

`helix-noise` is a dependency; there are no framework peers.

## Quick start

```ts
import { create } from "helix-noise";
import { createParticleSystem } from "helix-noise-gpu";

const gl = document.querySelector("canvas").getContext("webgl2");

// `tileable: true` → 2π-periodic field → particles wrap seamlessly.
const field = create({ helicity: 0.8, coherence: 0.65, tileable: true });

const system = createParticleSystem(gl, field, { count: 1_000_000, speed: 0.55 });
system.start();                     // RAF loop + built-in orbit camera (drag / scroll)

system.setField(create({ helicity: -0.5, tileable: true })); // live re-tune; the cloud morphs
```

## The three layers

The package is a small stack, batteries-included → raw. Use whichever layer fits.

### `createParticleSystem(gl, field, opts)`

One call: a simulation + a renderer, driven by a built-in orbit camera and a
`requestAnimationFrame` loop, with pointer-drag + wheel-zoom wired on the canvas. Returns
`{ sim, renderer, start, stop, dispose, setField }`.

| option | default | meaning |
|---|---|---|
| `count` | `200000` | particle count (cost/step ≈ O(count × modes)) |
| `box` | `2π` | domain size L; wrap in `[0, L)³` (seamless only if the field is `tileable`) |
| `speed` | `1` | advection-speed multiplier |
| `seed` | `1` | initial particle layout seed |
| `precision` | `7` | baked-constant significant digits (shader size vs. accuracy) |
| `colorLow` / `colorHigh` | amber / teal | hues for left- / right-handed local helicity |
| `clear` / `clearColor` | `true` / navy | clear the framebuffer before drawing |
| `controls` / `autoRotate` | `true` / `true` | pointer orbit + zoom; idle rotation |
| `fovY` / `maxDpr` | `~0.69` / `2` | vertical FOV (rad); point-size DPR clamp |

### `HelixParticleSim` + `HelixParticleRenderer`

Own the loop and camera; keep the engine and the additive splat.

```ts
import { HelixParticleSim, HelixParticleRenderer, orbitViewProjection } from "helix-noise-gpu";

const sim = new HelixParticleSim(gl, field, { count: 500_000 });
const renderer = new HelixParticleRenderer(gl);

function frame(dt, yaw) {
  sim.step(dt);                                    // GPU transform-feedback advection
  const vp = orbitViewProjection({ yaw, pitch: 0.2, distance: 11, aspect: W / H });
  renderer.draw(sim, { viewProjection: vp, pointScale: devicePixelRatio });
}
```

`HelixParticleSim` exposes `step(dt, t?)`, `speed`, `speedPercentiles`, `setField(field)`,
`reseed(seed)`, `dispose()`, and — for a bring-your-own renderer — `vao`, `buffer`, `count`,
`stride`. `HelixParticleRenderer.draw(sim, camera)` takes any column-major `mat4` `viewProjection`
(three.js, gl-matrix, or the built-in `orbitViewProjection`).

### Raw parts — bring your own renderer

Advect with the engine, render with your own three.js `Points` / custom program by reading
`sim.vao` (attrib 0 = `vec3` position, attrib 1 = `vec2` aux = hue, speed) or `sim.buffer`. Also
exported: `buildUpdateVertexShader`, `buildRenderVertexShader` / `buildRenderFragmentShader`,
`initParticles`, `calibrateSpeed`, and the `mat4` kit (`perspective`, `lookAt`, `multiply`,
`orbitViewProjection`).

::: tip Sharing a context with three.js
three.js caches GL state; after `sim.step()` / `renderer.draw()`, call `threeRenderer.resetState()`
so three re-binds what it expects — or give the sim its own context.
:::

## Notes

- **Seamless wrap needs `tileable: true`** on the field; otherwise the `mod(p, box)` wrap shows a
  seam at the box face.
- **`precision: 7`** (default) bakes a compact shader (≤1e-5 vs. `sample()`); raise it for tighter
  agreement at the cost of shader size.
- Requires **WebGL2** (transform feedback). Where you need a fallback, use the CPU API
  (`field.sampleUW`) or the [r3f adapter](/r3f)'s `mode="auto"`.
