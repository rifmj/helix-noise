# capture/ — deterministic trailer render

Renders `demo/hero.html` into an MP4 by driving its **capture mode** (`?capture=1`) one
frame at a time in headless Chrome — fixed `dt`, no wall clock, so the same inputs always
produce the same video. Each frame is a full-page screenshot (the GL streaklets **and** the
DOM captions/receipts), assembled with ffmpeg.

## How it works

- `hero.html?capture=1` disables the real-time loop and exposes `window.__cap`:
  - `TOTAL` — number of frames (`dur × fps`),
  - `frame(i)` — apply the beat sheet at `t = i/fps`, step the sim by one fixed `dt`, render.
  It also creates the WebGL context with `preserveDrawingBuffer:true` so screenshots are exact.
  Capture defaults to **cinema mode** (2.39:1 letterbox, film grain, controls hidden, receipts
  kept); `&cine=0` disables the letterbox, `&clean` hides the receipts too.
- The **beat sheet** lives in `hero.html` (the `beat(t)` function): a 33 s script — snow open →
  a solid **flies through** the storm (bullet-time slow-mo, camera push-in) → rain pass, the same
  ball crossing back → it parks for the receipts beat (∇·u ≈ 0) and the **helicity flip**
  (ρ +0.87 → −0.88 on the meter) → rising embers → dim to the product card. One camera shot per
  beat with hard cuts between; a lower-third caption per segment (the reviewer's "tell the viewer
  what they're looking at"). Edit `beat(t)`/`shot(t)`/`ballPath(t)` to change the story.
- `record.mjs` serves the repo, launches headless Chrome, loops `frame(i)` + screenshot, then
  runs `ffmpeg` → H.264 MP4 (`yuv420p`, `+faststart`) for maximum compatibility.

## Run

```sh
# full trailer: 1080p, 400k streaklets, 33 s @ 60 fps
node demo/capture/record.mjs

# options
node demo/capture/record.mjs --w 1920 --h 1080 --n 400000 --dur 33 --fps 60 \
     --out out/trailer.mp4 --clean   # --clean hides the receipts too (pure cinematic)
     # --keep keeps the frames; CHROME_PATH=/path/to/chrome to pick the browser
```

Quick check: `--w 960 --h 540 --n 80000 --dur 4 --fps 30` (a few seconds).

## Performance — use the real GPU

By default the driver runs headless Chrome on the **real GPU** (ANGLE Metal on macOS / desktop
GL elsewhere) — the demo is GPU-native, so this matters enormously: **~30 ms/frame on an M4 Max
vs ~9 s/frame on SwiftShader (~260×)**. The screenshot encode (JPEG by default) is then the
bottleneck. The full 33 s / 60 fps / 1080p trailer renders in ~2 minutes.

- `--sw` forces the SwiftShader software path (deterministic on any machine, no GPU — but ~1000×
  slower; only for CI boxes without a usable GPU).
- `--png` writes lossless PNG frames instead of quality-95 JPEG (slower, larger; the H.264 encode
  makes the difference invisible for a trailer — reach for it only for a ProRes master).

## Requirements

- **ffmpeg** on PATH.
- **puppeteer** — local (`npm i -D puppeteer`) or global; the script finds either.
- **Chrome/Chromium** — auto-detected (macOS/Linux paths), or set `CHROME_PATH`.

## Notes

- Output is frame-locked: raise `--n` for density and `--w/--h` for resolution without changing
  timing. Render time is dominated by the per-frame screenshot, not the sim.
- For the highest-quality master, add `-c:v prores_ks -profile:v 3` in `record.mjs` instead of
  libx264, then transcode to H.264 for distribution.
- `hero.html?capture=1` also works interactively in a normal browser (it just won't advance on
  its own) — open the console and call `__cap.frame(i)` to scrub.
