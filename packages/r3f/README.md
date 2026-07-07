# helix-noise-r3f

**[react-three-fiber](https://github.com/pmndrs/react-three-fiber) components for [Helix Noise](https://github.com/rifmj/helix-noise).**
Declarative, divergence-free flow fields — drop a particle cloud into a `<Canvas>` and it moves
like a real, incompressible fluid.

This package is a **transport** over the [`helix-noise`](../js) core, not a re-implementation:
the CPU path calls `field.sampleUW`, the GPU path inlines `field.glsl()`. The mode sum lives in
one place, so numerical parity with every other port is inherited, not re-established.

> **Status: `0.1.0`, pre-release.** Both engines work: the CPU path (`field.sampleUW`) and the
> GPU path (a GLSL ES 3.00 float-texture ping-pong that advects on-device from the injected
> `field.glsl()`, ~10⁶ particles). `mode="auto"` uses GPU when WebGL2 float render targets are
> available and falls back to CPU otherwise. Obstacles (free-slip SDF boundaries) run on the CPU
> engine. A GPU-native boundary is the remaining item. See `examples/r3f` for a live
> CPU/GPU/material/obstacle demo, and the [docs page](https://rifmj.github.io/helix-noise/docs/r3f).

## Install

```bash
npm install helix-noise-r3f three @react-three/fiber react
```

`three`, `@react-three/fiber` and `react` are peer dependencies (bring your own).

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

## API — three layers

**1. `useHelixField(options)`** — the primitive. A memoised core `Field`; rebuilds only when
options change. Full escape hatch (`sample`, `vorticity`, `withBoundary`, `bake3D`, …).

```tsx
const field = useHelixField({ helicity: 0.8, coherence: 0.5, seed: 7 });
const [u, v, w] = field.sample(x, y, z);
```

**2. `helixFlowMaterial(field, opts?)`** — a `THREE.ShaderMaterial` for `THREE.Points` that
colours by local helicity on the GPU (via the injected `field.glsl()`). Drive its `uTime`
uniform from `useFrame`.

**3. `<HelixParticles>`** — the declarative particle system. Props are the core
`HelixNoiseOptions` plus rendering controls:

| prop | default | meaning |
|---|---|---|
| `count` | `16000` | particle count |
| `bounds` | `[τ, τ, τ]` | sampling-domain box; particles wrap within it |
| `speed` | `1` | advection speed multiplier |
| `pointSize` | `0.045` | point size (world units) |
| `colorBy` | `"helicity"` | `"helicity"` \| `"speed"` \| a fixed colour |
| `mode` | `"auto"` | `"cpu"` \| `"gpu"` \| `"auto"` |
| `lifespan` | `[1, 3]` | particle lifetime range (seconds) |
| `obstacle` | — | free-slip SDF obstacle (`> 0` outside); forces the CPU engine |
| `boundaryThickness` | `1` | obstacle influence-band width |
| `field` | — | use a prebuilt field instead of the option props |
| `onField` | — | callback with the resolved field (escape hatch) |

**Obstacles** — pass a signed-distance function; the flow slides along the wall, is zero
inside, and stays divergence-free (via the core's `withBoundary`). Runs on the CPU engine.

```tsx
const sphere = (x, y, z) => Math.hypot(x - Math.PI, y - Math.PI, z - Math.PI) - 1.2;
<HelixParticles {...presets.nebula} count={60000} obstacle={sphere} />
```

**Presets** — `import { presets } from "helix-noise-r3f"`: `cirrus`, `kelp`, `nebula`, `smoke`
are plain `HelixNoiseOptions` bundles, distilled from the JS examples of the same name.

```tsx
<HelixParticles {...presets.nebula} seed={42} count={80000} />
```

## Develop

```bash
npm install       # links the local core via file:../js
npm run check     # typecheck + parity-smoke tests
npm run build     # dist/ (ESM + CJS + d.ts)
```

`test/parity-smoke.test.ts` asserts the adapter forwards the core field faithfully and emits
the expected GLSL surface; `test/glsl-parity.test.ts` transpiles the emitted GLSL and checks it
reproduces `field.sample()`/`vorticity()` to ≤1e-9 (precision 17), the same bar as
`spec/parity_fixture.json`, and documents the ≤1e-5 default-precision GPU tradeoff.

Run the live CPU/GPU demo with `npm --prefix ../../examples/r3f install && npm --prefix ../../examples/r3f run dev`.

> **Note for publishing:** the `helix-noise` dependency is `file:../js` for local monorepo
> development. Bump it to the published range (`^1.x`) before `npm publish`.

## License

MIT © Rifat Jumagulov. See [LICENSE](LICENSE).
