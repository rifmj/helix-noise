---
title: Helix Noise — react-three-fiber
description: helix-noise-r3f — declarative react-three-fiber components for the divergence-free helical flow field. Drop a particle cloud into a Canvas; CPU and GPU engines behind one component.
---

# Helix Noise — react-three-fiber

[`helix-noise-r3f`](https://github.com/rifmj/helix-noise/tree/main/packages/r3f) puts the
[Helix Noise](/API) field into a [react-three-fiber](https://github.com/pmndrs/react-three-fiber)
scene as declarative components. Drop a **divergence-free** particle cloud into a `<Canvas>` and
it moves like a real, incompressible fluid — no clumping, no sources or sinks.

It is a **transport** over the [JavaScript core](/API), never a re-implementation: the CPU path
calls `field.sampleUW`, the GPU path inlines the emitted `field.glsl()`. The mode sum lives in
one place, so numerical parity with every other port is inherited — the emitted GLSL is checked
to reproduce `field.sample()` to ≤1e-9.

**Ports:** [JavaScript](/API) · [Python](/python) · [Rust](/rust) · [Shaders](/shaders) ·
React / r3f (this page) · [Project home](/)

**Registry & source:** npm `helix-noise-r3f` ·
[GitHub source](https://github.com/rifmj/helix-noise/tree/main/packages/r3f)

## Install

```sh
npm install helix-noise-r3f three @react-three/fiber react
```

`three`, `@react-three/fiber`, and `react` are peer dependencies — bring your own.

## Quick start

```tsx
import { Canvas } from "@react-three/fiber";
import { HelixParticles } from "helix-noise-r3f";

export default function App() {
  return (
    <Canvas camera={{ position: [0, 0, 9] }}>
      <HelixParticles count={40000} helicity={0.8} coherence={0.5} colorBy="helicity" />
    </Canvas>
  );
}
```

## The three layers

The package is a small stack, primitive → batteries-included. Use whichever layer fits.

### `useHelixField(options)`

The primitive: a memoised core [`Field`](/API#createoptions-the-spectral-field). Rebuilt only
when `options` change (keyed by a stable digest), so an inline object literal is safe. The
return value is the live field — the full escape hatch (`sample`, `vorticity`, `withBoundary`,
`bake3D`, …). `options` is exactly the core `HelixNoiseOptions`; the adapter adds no knobs.

```tsx
const field = useHelixField({ helicity: 0.8, coherence: 0.5, seed: 7 });
const [u, v, w] = field.sample(x, y, z);
```

### `helixFlowMaterial(field, opts?)`

A `THREE.ShaderMaterial` for `THREE.Points` whose colour is the field's local helicity,
evaluated **on the GPU** from the injected `field.glsl()` (no per-vertex CPU sampling). Drive
its `uTime` uniform from `useFrame`. Compiled as GLSL ES 3.00 to host the emitter.

```tsx
const field = useHelixField({ ...presets.kelp });
const material = useMemo(() => helixFlowMaterial(field, { size: 0.06 }), [field]);
useFrame((s) => { material.uniforms.uTime.value = s.clock.elapsedTime; });
return <points geometry={cloud} material={material} />;
```

| option | default | meaning |
|---|---|---|
| `size` | `0.05` | point size in world units (distance-attenuated) |
| `colorPositive` | teal | colour where u·ω ≥ 0 |
| `colorNegative` | amber | colour where u·ω < 0 |
| `opacity` | `0.85` | base opacity |

### `<HelixParticles>` — the declarative particle system

Props are the core `HelixNoiseOptions` (spread directly) plus rendering controls:

```tsx
<HelixParticles
  count={200000}
  helicity={0.8} coherence={0.5} slope={1.6} seed={7}
  speed={0.6} colorBy="helicity" mode="auto"
/>
```

| prop | default | meaning |
|---|---|---|
| `count` | `16000` | particle count |
| `bounds` | `[τ, τ, τ]` | sampling-domain box; particles wrap within it |
| `speed` | `1` | advection speed multiplier |
| `pointSize` | `0.045` | point size (world units) |
| `colorBy` | `"helicity"` | `"helicity"` \| `"speed"` \| a fixed colour |
| `mode` | `"auto"` | `"cpu"` \| `"gpu"` \| `"auto"` |
| `lifespan` | `[1, 3]` | particle lifetime range (seconds) |
| `obstacle` | — | SDF obstacle; forces the CPU engine (see below) |
| `boundaryThickness` | `1` | obstacle influence-band width |
| `field` | — | use a prebuilt field instead of the option props |
| `onField` | — | callback with the resolved field (escape hatch) |

**Two engines, one component.** `mode` selects the renderer:

- **CPU** (`field.sampleUW`) — runs everywhere; comfortable up to ~50k particles.
- **GPU** — a self-contained GLSL ES 3.00 float-texture ping-pong that advects on-device from
  the injected `field.glsl()`; scales to ~10⁶ particles. Needs WebGL2 float render targets.

`"auto"` uses GPU for large counts when float render targets are available, and falls back to
CPU otherwise (and on any GPU-init failure) with a one-time console notice — never silently.

## Obstacles

Pass an `obstacle` — a signed-distance function (`> 0` outside, `< 0` inside). The flow slides
along the wall (free-slip), is zero inside, and stays exactly divergence-free. This uses the
core's `withBoundary` and currently runs on the **CPU** engine (setting `obstacle` with
`mode="gpu"` falls back to CPU with a notice; a GPU-native boundary is planned).

```tsx
const sphere = (x, y, z) => Math.hypot(x - Math.PI, y - Math.PI, z - Math.PI) - 1.2;

<HelixParticles {...presets.nebula} count={60000} obstacle={sphere} boundaryThickness={1.2} />
```

## Presets

`cirrus`, `kelp`, `nebula`, `smoke` — plain `HelixNoiseOptions` bundles distilled from the JS
examples of the same name. Spread and override:

```tsx
import { presets } from "helix-noise-r3f";

<HelixParticles {...presets.nebula} seed={42} count={80000} />
```

## Live example

A CPU/GPU/material demo lives in
[`examples/r3f`](https://github.com/rifmj/helix-noise/tree/main/examples/r3f) — toggle the
engine, particle count, colouring, and the sphere obstacle at runtime.
