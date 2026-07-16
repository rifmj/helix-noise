# demo/ — interactive field explorer

`interactive.html` is a self-contained, zero-build page that drives the **shipped
`helix-noise`** library live (it imports `../packages/js/dist/helix-noise.js`), so what
you see is exactly the paper's field — not a re-implementation.

It's the **wow / supplementary** surface and the source we capture the trailer from.

## What it shows (the "receipts")

- **Three controls** — spectral slope, helicity (left ◀ / right ▶ chirality), phase coherence.
- **vs baseline** — split screen at a *fixed spectrum*: left = random phases (a curl-noise-like
  haze), right = our coherence (organized vortices, identical energy).
- **obstacle** — drops a sphere; flow slides around it (free-slip, no penetration) via the
  potential-ramp boundary, with the divergence meter staying ≈0. This directly answers the
  reviewer's "not clear the flow respects obstacles without violating div-free".
- **Live instruments** — `E(k)` bars (re-weighted by slope only, **frozen** as you move
  coherence), relative helicity ρ, and an `∇·u` meter (exact; the residual is FD truncation).

## Run

Serve the repo root over HTTP (ES-module imports need a server, not `file://`):

```sh
cd packages/js && python3 -m http.server 8097     # then open http://localhost:8097/../../demo/interactive.html
# or from the repo root:
python3 -m http.server 8097                        # then open http://localhost:8097/demo/interactive.html
```

## Roadmap (to the trailer)

1. **[this file]** CPU-sampled 2D skeleton — correct-by-construction, all controls + receipts. ✅
2. **GPU upgrade** — move advection to the `packages/gpu` WebGL2 engine (or WebGPU) for
   millions of particles + bloom/DOF, keeping the same UI and instruments.
3. **Art-directed hero scene** — map the field to swirling snow / smoke around a character.
4. **Deterministic capture** — Playwright drives the page through a scripted beat sheet
   (helicity −1→+1, coherence 0→1, obstacle drop) at fixed `dt`; frames → `ffmpeg` → MP4
   with typographic lower-thirds. This becomes the paper's supplementary video.

## Notes

- Colour = local handedness (teal = right, amber = left) via `u·ω`; in obstacle mode particles
  are coloured by speed (bounded-field vorticity is finite-difference, so we skip it there).
- Particle count scales with viewport; a real full window gives ~2–3× the headless default.
