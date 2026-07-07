import { TAU } from "./constants";
import { buildRenderFragmentShader, buildRenderVertexShader } from "./shaders";
import { linkProgram } from "./gl";
import type { HelixParticleSim } from "./sim";
import type { Mat4 } from "./camera";

/** Where the camera is, for one {@link HelixParticleRenderer.draw} call. */
export interface Camera {
  /** A column-major `mat4` view-projection (16 floats). From {@link orbitViewProjection}, three.js, gl-matrix, … */
  viewProjection: Mat4 | number[];
  /** World point mapped to the origin before projection. Default the box centre `[L/2, L/2, L/2]`. */
  center?: readonly [number, number, number];
  /** Point-size multiplier — pass your `devicePixelRatio` for crisp sprites. Default 1. */
  pointScale?: number;
  /** Global additive alpha. Default `min(0.8, 220000/count + 0.05)` (denser clouds dim automatically). */
  alpha?: number;
}

/** Options for {@link HelixParticleRenderer}. */
export interface HelixParticleRendererOptions {
  /** Domain size L — sets the default camera centre. Default `2π`. */
  box?: number;
  /** Hue where local helicity < 0 (left-handed). Default amber. */
  colorLow?: readonly [number, number, number];
  /** Hue where local helicity ≥ 0 (right-handed). Default teal. */
  colorHigh?: readonly [number, number, number];
  /** Clear the framebuffer before drawing. Default true. Set false to composite over your scene. */
  clear?: boolean;
  /** Clear colour (RGBA, 0–1). Default deep navy. */
  clearColor?: readonly [number, number, number, number];
}

const AMBER: [number, number, number] = [0.96, 0.55, 0.18];
const TEAL: [number, number, number] = [0.18, 0.86, 0.76];
const NAVY: [number, number, number, number] = [0.027, 0.039, 0.055, 1];

/**
 * A batteries-included additive-splat renderer for a {@link HelixParticleSim}. Colours each
 * particle by its local helicity (amber ↔ teal) and glows the fast filaments, using the sim's
 * measured speed percentiles so the look is parameter-stable. It owns its blend/depth state for
 * the draw. Skip it entirely and read `sim.vao` if you have your own renderer.
 */
export class HelixParticleRenderer {
  /** The WebGL2 context this renderer was built against. */
  readonly gl: WebGL2RenderingContext;

  private prog: WebGLProgram;
  private readonly box: number;
  private readonly colorLow: number[];
  private readonly colorHigh: number[];
  private readonly clear: boolean;
  private readonly clearColor: number[];
  private uViewProj: WebGLUniformLocation | null;
  private uCenter: WebGLUniformLocation | null;
  private uPointScale: WebGLUniformLocation | null;
  private uAlpha: WebGLUniformLocation | null;
  private uSpeed: WebGLUniformLocation | null;
  private uColorLow: WebGLUniformLocation | null;
  private uColorHigh: WebGLUniformLocation | null;
  private disposed = false;

  constructor(gl: WebGL2RenderingContext, opts: HelixParticleRendererOptions = {}) {
    this.gl = gl;
    this.box = opts.box ?? TAU;
    this.colorLow = [...(opts.colorLow ?? AMBER)];
    this.colorHigh = [...(opts.colorHigh ?? TEAL)];
    this.clear = opts.clear ?? true;
    this.clearColor = [...(opts.clearColor ?? NAVY)];

    this.prog = linkProgram(gl, buildRenderVertexShader(), buildRenderFragmentShader());
    const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(this.prog, name);
    this.uViewProj = u("uViewProj");
    this.uCenter = u("uCenter");
    this.uPointScale = u("uPointScale");
    this.uAlpha = u("uAlpha");
    this.uSpeed = u("uSpeed");
    this.uColorLow = u("uColorLow");
    this.uColorHigh = u("uColorHigh");
  }

  /** Draw `sim`'s current particles. Does **not** advance the sim — call `sim.step(dt)` yourself. */
  draw(sim: HelixParticleSim, camera: Camera): void {
    if (this.disposed) return;
    const gl = this.gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    gl.viewport(0, 0, w, h);
    if (this.clear) {
      const [r, g, b, a] = this.clearColor;
      gl.clearColor(r, g, b, a);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uViewProj, false, camera.viewProjection);
    const c = camera.center ?? [this.box * 0.5, this.box * 0.5, this.box * 0.5];
    gl.uniform3f(this.uCenter, c[0], c[1], c[2]);
    gl.uniform1f(this.uPointScale, camera.pointScale ?? 1);
    gl.uniform1f(this.uAlpha, camera.alpha ?? Math.min(0.8, 220000 / sim.count + 0.05));
    gl.uniform3fv(this.uSpeed, sim.speedPercentiles);
    gl.uniform3fv(this.uColorLow, this.colorLow);
    gl.uniform3fv(this.uColorHigh, this.colorHigh);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive: overlapping filaments accumulate light
    gl.bindVertexArray(sim.vao);
    gl.drawArrays(gl.POINTS, 0, sim.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  /** Release the render program. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.deleteProgram(this.prog);
  }
}
