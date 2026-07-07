import type { Field } from "helix-noise";
import { HelixParticleSim, type HelixParticleSimOptions } from "./sim";
import { HelixParticleRenderer, type HelixParticleRendererOptions } from "./renderer";
import { orbitViewProjection } from "./camera";

/** Options for {@link createParticleSystem} — a superset of the sim + renderer options. */
export interface ParticleSystemOptions extends HelixParticleSimOptions, HelixParticleRendererOptions {
  /** Attach pointer-drag (orbit) + wheel (zoom) controls to the canvas. Default true. */
  controls?: boolean;
  /** Idle auto-rotation when not dragging. Default true. */
  autoRotate?: boolean;
  /** Vertical field of view (radians). Default ~0.69. */
  fovY?: number;
  /** Clamp `devicePixelRatio` for point-size scaling. Default 2. */
  maxDpr?: number;
}

/** A running particle system: a sim, a renderer, and a `requestAnimationFrame` loop over them. */
export interface ParticleSystem {
  /** The underlying simulation (advance manually if you drive your own loop). */
  readonly sim: HelixParticleSim;
  /** The underlying renderer. */
  readonly renderer: HelixParticleRenderer;
  /** Start (or resume) the animation loop. */
  start(): void;
  /** Pause the animation loop. */
  stop(): void;
  /** Stop, detach controls, and release all GL resources. */
  dispose(): void;
  /** Swap in a re-tuned field without resetting the cloud. */
  setField(field: Field): void;
}

function currentDpr(maxDpr: number): number {
  const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
  return Math.min(maxDpr, dpr || 1);
}

/**
 * The one-call entry point: build a sim + renderer over an existing WebGL2 context and drive them
 * with a built-in orbit camera and RAF loop. Returns handles to `start` / `stop` / `dispose` and
 * the underlying `sim` / `renderer` if you want finer control.
 *
 * ```ts
 * const gl = canvas.getContext("webgl2")!;
 * const field = create({ helicity: 0.8, coherence: 0.65, tileable: true });
 * const system = createParticleSystem(gl, field, { count: 1_000_000 });
 * system.start();
 * ```
 */
export function createParticleSystem(
  gl: WebGL2RenderingContext,
  field: Field,
  opts: ParticleSystemOptions = {},
): ParticleSystem {
  const sim = new HelixParticleSim(gl, field, opts);
  const renderer = new HelixParticleRenderer(gl, opts);
  const box = sim.box;
  const fovY = opts.fovY ?? 0.69;
  const maxDpr = opts.maxDpr ?? 2;
  const autoRotate = opts.autoRotate ?? true;

  let yaw = 0.55, pitch = 0.2, zoom = 1;
  let running = false, raf = 0, last = 0;
  let dragging = false, lx = 0, ly = 0;

  const canvas = gl.canvas as HTMLCanvasElement | OffscreenCanvas;
  const el = canvas as unknown as HTMLElement;
  const interactive = (opts.controls ?? true) && typeof (el as { addEventListener?: unknown }).addEventListener === "function";

  function frame(now: number): void {
    const dt = last ? Math.min(0.05, (now - last) * 0.001) : 0.016;
    last = now;
    if (autoRotate && !dragging) yaw += 0.0014;

    sim.step(dt);

    const w = gl.drawingBufferWidth, h = Math.max(1, gl.drawingBufferHeight);
    const viewProjection = orbitViewProjection({
      yaw, pitch, distance: (box * 1.7) / zoom, aspect: w / h, fovY,
    });
    renderer.draw(sim, { viewProjection, pointScale: currentDpr(maxDpr) });

    if (running) raf = requestAnimationFrame(frame);
  }

  const onDown = (e: PointerEvent): void => {
    dragging = true; lx = e.clientX; ly = e.clientY;
    (el as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    yaw += (e.clientX - lx) * 0.006;
    pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - ly) * 0.006));
    lx = e.clientX; ly = e.clientY;
  };
  const onUp = (): void => { dragging = false; };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    zoom = Math.max(0.5, Math.min(3, zoom * Math.exp(-e.deltaY * 0.0012)));
  };

  if (interactive) {
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
  }

  return {
    sim,
    renderer,
    start(): void {
      if (running) return;
      running = true; last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop(): void {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    dispose(): void {
      this.stop();
      if (interactive) {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        el.removeEventListener("wheel", onWheel);
      }
      sim.dispose();
      renderer.dispose();
    },
    setField(f: Field): void {
      sim.setField(f);
    },
  };
}
