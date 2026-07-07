# helix-noise-gpu

**A framework-agnostic WebGL2 particle engine for [Helix Noise](https://github.com/rifmj/helix-noise).**
Hand it any `WebGL2RenderingContext` and a `helix-noise` field; it advects millions of particles
**entirely on the GPU** via transform feedback — no three.js, no React, zero per-frame CPU field
calls.

This package is a **transport** over the [`helix-noise`](../js) core, not a re-implementation: the
update shader inlines the emitted `field.glsl()`, so the mode sum lives in one place and numerical
parity with every other port is inherited, not re-established.

> **Status: `0.1.0`.** Generalises the core's `million.html` transform-feedback demo into a
> reusable package. Verified in-browser at 1 000 000 particles / 120 fps, zero GL errors
> (`example/index.html`). GL-free logic (shader emission, camera math, particle init, speed
> calibration) is unit-tested in CI.

## Install

```sh
npm install helix-noise-gpu helix-noise
```

`helix-noise` is a dependency (installed automatically); no framework peers.

## Quick start

```ts
import { create } from "helix-noise";
import { createParticleSystem } from "helix-noise-gpu";

const canvas = document.querySelector("canvas");
const gl = canvas.getContext("webgl2");

// `tileable: true` makes the field 2π-periodic, so particles wrap seamlessly.
const field = create({ helicity: 0.8, coherence: 0.65, tileable: true });

const system = createParticleSystem(gl, field, { count: 1_000_000, speed: 0.55 });
system.start();                      // RAF loop + built-in orbit camera (drag / scroll)

// live re-tune — the cloud morphs, it does not reset:
system.setField(create({ helicity: -0.5, coherence: 0.2, tileable: true }));
```

That is the whole thing: `start()`, `stop()`, `dispose()`, `setField()`.

## The three layers

Use whichever altitude fits — one call, composed objects, or raw parts.

### 1. `createParticleSystem(gl, field, opts)` — batteries included

Builds a sim + renderer, drives them with a built-in orbit camera and a `requestAnimationFrame`
loop, and (by default) wires pointer-drag + wheel-zoom on the canvas. Returns
`{ sim, renderer, start, stop, dispose, setField }`.

### 2. `HelixParticleSim` + `HelixParticleRenderer` — compose it yourself

Own the loop and the camera; keep the engine and the splat.

```ts
import { HelixParticleSim, HelixParticleRenderer, orbitViewProjection } from "helix-noise-gpu";

const sim = new HelixParticleSim(gl, field, { count: 500_000, box: 2 * Math.PI });
const renderer = new HelixParticleRenderer(gl, { colorHigh: [0.2, 0.9, 0.8] });

let yaw = 0;
function frame(dt) {
  sim.step(dt);                                       // GPU transform-feedback advection
  const vp = orbitViewProjection({ yaw: (yaw += 0.003), pitch: 0.2, distance: 11, aspect: W / H });
  renderer.draw(sim, { viewProjection: vp, pointScale: devicePixelRatio });
}
```

### 3. Raw parts — bring your own renderer

The sim exposes its current state directly, so you can render with **your own pipeline** (three.js,
a hand-written program, a compute pass). Advect with the engine, draw with your code:

```ts
const sim = new HelixParticleSim(gl, field, { count: 1_000_000 });
sim.step(dt);

sim.vao;     // a VAO: attrib 0 = vec3 position, attrib 1 = vec2 aux (helicity hue, speed)
sim.buffer;  // the underlying VBO (interleaved, `sim.stride` = 20 bytes/particle)
sim.count;   // particle count
```

Also exported for a fully hand-rolled setup: `buildUpdateVertexShader(field)`,
`buildRenderVertexShader()` / `buildRenderFragmentShader()`, `initParticles(count, box, seed)`,
`calibrateSpeed(field)`, and the `mat4` kit (`perspective`, `lookAt`, `multiply`,
`orbitViewProjection`).

> **Sharing a context with three.js?** three.js caches GL state; after `sim.step()` /
> `renderer.draw()` call `threeRenderer.resetState()` so three re-binds what it expects. Or give
> the sim its own canvas/context.

## Options

`createParticleSystem` accepts the union of the sim and renderer options plus the loop controls.

**Sim** (`HelixParticleSimOptions`)

| option | default | meaning |
|---|---|---|
| `count` | `200000` | particle count (cost/step ≈ O(count × modes)) |
| `box` | `2π` | domain size L; particles wrap in `[0, L)³` (seamless only if the field is `tileable`) |
| `speed` | `1` | advection-speed multiplier |
| `seed` | `1` | initial particle layout seed |
| `precision` | `7` | baked-constant significant digits (compact shader vs. accuracy) |
| `calibrationSamples` | `1200` | probe points for the one-off speed calibration |

**Renderer** (`HelixParticleRendererOptions`)

| option | default | meaning |
|---|---|---|
| `colorLow` | amber | hue where local helicity < 0 (left-handed) |
| `colorHigh` | teal | hue where local helicity ≥ 0 (right-handed) |
| `clear` | `true` | clear before drawing (set `false` to composite over your scene) |
| `clearColor` | deep navy | RGBA clear colour |

**Loop** (`createParticleSystem` only): `controls` (`true`), `autoRotate` (`true`), `fovY`
(`~0.69`), `maxDpr` (`2`).

## How it works

Each particle is one `vec3` position + a `vec2` aux (eased local helicity for hue, live speed for
glow). A transform-feedback vertex shader takes one explicit Euler step of the injected
`field.glsl()` velocity and writes the result into the other of two ping-ponged VBOs; the rasterizer
is discarded, so there is **no fragment work and no readback**. The render pass then point-splats the
freshly written buffer additively. The field is divergence-free, so the cloud neither clumps nor
tears — it advects like a real incompressible fluid.

## Notes

- **Seamless wrap needs `tileable: true`** on the field (integer-lattice wavevectors). Without it,
  the `mod(p, box)` wrap shows a discontinuity at the box face.
- **`precision: 7`** (default) bakes a compact shader; the truncation vs. `field.sample()` is
  ≤1e-5 (rendering-grade). Raise it for tighter agreement at the cost of shader size.
- Requires **WebGL2** (transform feedback). Check `canvas.getContext("webgl2")` and fall back to the
  CPU API (`field.sampleUW`) or the [r3f adapter](../r3f)'s `mode="auto"` where you need one.

## License

MIT © Rifat Jumagulov. See [LICENSE](LICENSE).
