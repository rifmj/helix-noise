# helix-noise-r3f — live example

A Vite + React app showing `<HelixParticles>` with both engines (toggle CPU ⇄ GPU and the
particle count at runtime). Used to verify the GPU render path in a real WebGL2 context.

```bash
# 1) build the package once (the example imports its dist/ over a file: link)
npm --prefix ../../packages/r3f install
npm --prefix ../../packages/r3f run build

# 2) run the example
npm install
npm run dev   # http://127.0.0.1:5178
```

Re-run the package build after editing `packages/r3f/src` (or point the Vite alias at
`packages/r3f/src/index.ts` for hot reload during package development).

The default engine is `gpu` (falls back to CPU if WebGL2 float render targets are
unavailable). Expect ~120k particles coloured teal/amber by local helicity.
