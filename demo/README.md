# demo/ — interactive field explorers

Two self-contained, zero-build pages that drive the **shipped** packages live, so what you
see is exactly the paper's field — not a re-implementation.

| Page | Engine | Role |
|---|---|---|
| **`hero.html`** | `helix-noise-gpu` (WebGL2 transform feedback) | the **flagship** — curved streaklets, an **exactly div-free solid obstacle** the flow parts around (analytic `∇×(ramp·A)`, fresnel bubble), live helicity, scene grades (Helix/Frost/Ember), ACES post, and a one-click **canvas recorder** (→ webm) for the trailer |
| `interactive-gpu.html` | `helix-noise-gpu` | dense point-cloud + bloom variant — 1M particles, orbit |
| `interactive.html` | `helix-noise` (CPU sample, Canvas2D) | the **instrumented proof** — vs-baseline split + solid-obstacle (free-slip, ∇·u≈0) |

Both carry the live "receipts": frozen `E(k)`, relative helicity ρ, and an `∇·u` meter.
These pages are the source we capture the supplementary trailer from.

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

1. **CPU-sampled 2D skeleton** (`interactive.html`) — correct-by-construction, all controls + receipts. ✅
2. **GPU upgrade** (`interactive-gpu.html`) — advection on the `packages/gpu` WebGL2 engine
   (transform feedback, up to 1M particles) + a bright-pass→blur→tonemap **bloom** post-fx, same
   UI and instruments. ✅
3. **Art-directed hero + GPU obstacle** (`hero.html`) — curved streaklets, scene grades, and a
   solid obstacle the flow parts around. The obstacle is the **analytic** div-free boundary
   `u = ramp(d)·u + ramp′(d)·(n × A)` (= `curl(ramp·A)`) evaluated in the update shader from the
   emitted vector potential `hxPot` — exact, no 3D-texture bake needed for an analytic SDF. ✅
4. **Deterministic capture** (`capture/`) — headless Chrome drives `hero.html?capture=1` through
   a scripted beat sheet (intro → helicity sweep → obstacle grows → scene grades → outro) at
   fixed `dt`; frames → `ffmpeg` → H.264 MP4 with in-frame typographic lower-thirds and live
   receipts. Reproducible. `node demo/capture/record.mjs`; see [capture/README.md](capture/README.md). ✅

## Notes

- Colour = local handedness (teal = right, amber = left) via `u·ω`; in obstacle mode particles
  are coloured by speed (bounded-field vorticity is finite-difference, so we skip it there).
- Particle count scales with viewport; a real full window gives ~2–3× the headless default.
