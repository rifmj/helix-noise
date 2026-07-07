---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Helix Noise"
  text: "Divergence-free flow fields you can art-direct"
  tagline: "Give anything flowing, liquid-like motion — smoke, water, particles, wind. One function call, no FFT, no grid, no simulation."
  actions:
    - theme: brand
      text: API Reference
      link: /API
    - theme: alt
      text: Getting started
      link: /API#getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/rifatjumagulov/helix-noise

features:
  - icon: 🌀
    title: Divergence-free by construction
    details: The velocity always moves like a real, incompressible fluid — nothing piles up, nothing vanishes. Tracers never clump.
  - icon: 🎛️
    title: Three artist dials
    details: Spectral slope (size of the swirls), helicity (which way they spin), and phase coherence (calm noise → organized eddies).
  - icon: ⏱️
    title: Alive over time
    details: Pass a time t and the field churns — small eddies flicker fast, big structures drift instead of dissolving.
  - icon: 📦
    title: Zero dependencies
    details: Ships as ESM, CommonJS, and a script global, with TypeScript types included. ~11 kB, no runtime deps.
  - icon: 🧱
    title: Boundaries & GPU
    details: Slide flow around any SDF obstacle, bake to a texture, or emit self-contained GLSL — all still divergence-free.
  - icon: ♾️
    title: Two engines
    details: A global spectral field for coherent, tileable structures, and a sparse-atom field for infinite, broadband, regionally art-directed flow.
---

## Install

```bash
npm install helix-noise
```

```js
import { create } from "helix-noise";

const field = create({ helicity: 0.8, coherence: 0.5 });

const [u, v, w] = field.sample(x, y, z);       // divergence-free velocity, anywhere
const [u2, v2, w2] = field.sample(x, y, z, t); // …the same field, churning in time
```

Head to the **[API Reference](/API)** for every function, option, and method in plain language.
