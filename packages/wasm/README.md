# helix-noise-wasm

**WebAssembly build of [helix-noise](https://github.com/rifmj/helix-noise), compiled from the
Rust core with `wasm-bindgen`.** Divergence-free helical (Beltrami) flow-field noise — sample a
smooth, incompressible 3-D velocity field at any point in space and time, with vorticity and
vector potential in closed form. No FFT, no grid, no simulation.

Same algorithm and same seeds as every other port: the wasm output matches the JS reference to
`1e-9` (`tests/parity.test.mjs`). Both engines are exposed:

- **`Field`** — the spectral engine (a sum of helical modes; `O(modes)` per sample).
- **`Atoms`** — the sparse-atom engine (compactly-supported helical wavelets on a spatial hash;
  infinite, grid-free, amortized `O(1)` per sample).

## Build

The `.wasm` and its JS glue are a build artifact (`pkg/`), produced by
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/):

```bash
# once: rustup target add wasm32-unknown-unknown  &&  cargo install wasm-pack
cd packages/wasm
wasm-pack build --target web --out-dir pkg      # or --target bundler / nodejs
node tests/parity.test.mjs                       # numerical parity vs the JS reference
```

`--target web` emits an ES module you initialize with a `.wasm` URL; use `--target bundler` for
webpack/Vite or `--target nodejs` for CommonJS `require`.

## Use (web target)

```js
import init, { Field, Atoms, version } from "./pkg/helix_noise_wasm.js";

await init();                         // fetches the .wasm alongside the JS glue

const f = new Field({ modes: 48, helicity: 0.8, coherence: 0.5, seed: 42 });
const [u, v, w] = f.sample(1.0, 2.0, 3.0);        // velocity → Float64Array(3)
const uw = f.sampleUW(1, 2, 3, 0.5);              // [u,v,w, wx,wy,wz]
const tex = f.bake3d(32, 0);                      // Float32Array, RGBA volume (rgb=vel, a=helicity)

const a = new Atoms({ octaves: 4, helicity: 0.7, seed: 7 });
const vel = a.sampleMany(new Float64Array([x0, y0, z0, x1, y1, z1]), 0); // batch → [u,v,w, ...]
```

### API surface

`Field` and `Atoms` share the sampling API: `sample`, `sampleT`, `sampleUW` (velocity +
vorticity), `sampleUA` (velocity + potential), `vorticity`, `helicityDensity`, `potential`,
`sampleMany`, `bake3d`, `bake2d`. `Field` adds `modes()` and `glsl(name?, potential?)`; `Atoms`
adds `relativeHelicity(ng)`. Options are a plain JS object — see the
[reference docs](https://rifmj.github.io/helix-noise/docs/) for every field.

The Rust-native callback options (`spectrum`, `helicityField`, `gainField`) are **not** exposed
across the wasm boundary; use the [Rust crate](../rust) directly if you need them.

## License

MIT © Rifat Jumagulov.
