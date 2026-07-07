import type { Field } from "helix-noise";
import { ATTRIB_AUX, ATTRIB_POS, PARTICLE_STRIDE_BYTES, TAU } from "./constants";
import { buildUpdateVertexShader, UPDATE_FRAGMENT_SHADER, UPDATE_VARYINGS } from "./shaders";
import { initParticles } from "./particles";
import { calibrateSpeed, type SpeedPercentiles } from "./calibrate";
import { linkProgram } from "./gl";

/** Options for {@link HelixParticleSim}. */
export interface HelixParticleSimOptions {
  /** Particle count. Cost per step is O(count × modes) on the GPU. Default 200 000. */
  count?: number;
  /** Domain size L: particles wrap in `[0, L)³`. Seamless only if the field is `tileable`. Default `2π`. */
  box?: number;
  /** Advection speed multiplier applied to the field velocity. Default 1. */
  speed?: number;
  /** Seed for the initial particle layout. Default 1. */
  seed?: number;
  /** Significant digits for the baked mode constants (compact shader vs. accuracy). Default 7. */
  precision?: number;
  /** Probe points for the one-off speed calibration. Default 1200. */
  calibrationSamples?: number;
}

/**
 * A framework-agnostic GPGPU particle engine. Every particle is advected **entirely on the GPU**
 * by a transform-feedback vertex shader that inlines the field's `glsl()` — the same
 * divergence-free velocities as the CPU API, zero JS field calls and zero per-frame uploads. State
 * ping-pongs between two interleaved VBOs (`vec3 position`, `vec2 aux = hue, speed`).
 *
 * This class owns only the *simulation*. Read {@link HelixParticleSim.vao} / {@link buffer} to
 * render the particles with your own pipeline (three.js, a custom program, …), or pair it with
 * {@link HelixParticleRenderer} for a batteries-included additive splat.
 */
export class HelixParticleSim {
  /** The WebGL2 context this sim was built against. */
  readonly gl: WebGL2RenderingContext;
  /** Particle count. */
  readonly count: number;
  /** Domain size L (wrap box edge). */
  readonly box: number;
  /** Bytes between consecutive particles in the VBO (`= PARTICLE_STRIDE_BYTES`). */
  readonly stride: number = PARTICLE_STRIDE_BYTES;
  /** Advection speed multiplier (mutable — tweak live). */
  speed: number;
  /** Measured `[p62, p97, p99.5]` field-speed percentiles; the renderer's glow thresholds. */
  speedPercentiles: SpeedPercentiles;

  private field: Field;
  private precision: number;
  private calibrationSamples: number;
  private prog: WebGLProgram;
  private uDt: WebGLUniformLocation | null;
  private uT: WebGLUniformLocation | null;
  private uSpeed: WebGLUniformLocation | null;
  private bufA: WebGLBuffer;
  private bufB: WebGLBuffer;
  private vaoA: WebGLVertexArrayObject;
  private vaoB: WebGLVertexArrayObject;
  private cur: 0 | 1 = 0;
  private elapsed = 0;
  private disposed = false;

  constructor(gl: WebGL2RenderingContext, field: Field, opts: HelixParticleSimOptions = {}) {
    this.gl = gl;
    this.field = field;
    this.count = Math.max(1, (opts.count ?? 200_000) | 0);
    this.box = opts.box ?? TAU;
    this.speed = opts.speed ?? 1;
    this.precision = opts.precision ?? 7;
    this.calibrationSamples = opts.calibrationSamples ?? 1200;

    this.prog = this.buildProgram();
    this.uDt = gl.getUniformLocation(this.prog, "uDt");
    this.uT = gl.getUniformLocation(this.prog, "uT");
    this.uSpeed = gl.getUniformLocation(this.prog, "uSpeed");
    this.speedPercentiles = calibrateSpeed(field, this.box, this.calibrationSamples);

    const init = initParticles(this.count, this.box, opts.seed ?? 1);
    this.bufA = this.makeBuffer(init);
    this.bufB = this.makeBuffer(init);
    this.vaoA = this.makeVao(this.bufA);
    this.vaoB = this.makeVao(this.bufB);
  }

  private buildProgram(): WebGLProgram {
    return linkProgram(
      this.gl,
      buildUpdateVertexShader(this.field, { box: this.box, precision: this.precision }),
      UPDATE_FRAGMENT_SHADER,
      UPDATE_VARYINGS,
    );
  }

  private makeBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer();
    if (!buf) throw new Error("helix-noise-gpu: gl.createBuffer returned null");
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return buf;
  }

  private makeVao(buf: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("helix-noise-gpu: gl.createVertexArray returned null");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(ATTRIB_POS);
    gl.vertexAttribPointer(ATTRIB_POS, 3, gl.FLOAT, false, PARTICLE_STRIDE_BYTES, 0);
    gl.enableVertexAttribArray(ATTRIB_AUX);
    gl.vertexAttribPointer(ATTRIB_AUX, 2, gl.FLOAT, false, PARTICLE_STRIDE_BYTES, 12);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vao;
  }

  /** The VBO holding the **current** particle state — read this to render with your own pipeline. */
  get buffer(): WebGLBuffer {
    return this.cur === 0 ? this.bufA : this.bufB;
  }

  /** A VAO bound to {@link buffer} with attrib 0 = position (`vec3`), attrib 1 = aux (`vec2`). */
  get vao(): WebGLVertexArrayObject {
    return this.cur === 0 ? this.vaoA : this.vaoB;
  }

  /** Field time reached so far (seconds). */
  get time(): number {
    return this.elapsed;
  }

  /**
   * Advance every particle one step of `dt` seconds on the GPU. Pass `t` to set the field's
   * evolution time explicitly (defaults to accumulating `dt`); freeze the field with a constant
   * `t`, or a field built with `churn: 0`.
   */
  step(dt: number, t?: number): void {
    if (this.disposed) return;
    const gl = this.gl;
    this.elapsed = t ?? this.elapsed + dt;
    const srcVao = this.cur === 0 ? this.vaoA : this.vaoB;
    const dstBuf = this.cur === 0 ? this.bufB : this.bufA;

    gl.useProgram(this.prog);
    gl.uniform1f(this.uDt, dt);
    gl.uniform1f(this.uT, this.elapsed);
    gl.uniform1f(this.uSpeed, this.speed);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.bindVertexArray(srcVao);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dstBuf);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindVertexArray(null);
    gl.disable(gl.RASTERIZER_DISCARD);

    this.cur = this.cur === 0 ? 1 : 0;
  }

  /**
   * Swap in a re-tuned field (rebuilds the update program and re-runs speed calibration). The
   * particle buffers are kept, so the cloud morphs into the new flow rather than resetting.
   */
  setField(field: Field): void {
    this.field = field;
    const gl = this.gl;
    gl.deleteProgram(this.prog);
    this.prog = this.buildProgram();
    this.uDt = gl.getUniformLocation(this.prog, "uDt");
    this.uT = gl.getUniformLocation(this.prog, "uT");
    this.uSpeed = gl.getUniformLocation(this.prog, "uSpeed");
    this.speedPercentiles = calibrateSpeed(field, this.box, this.calibrationSamples);
  }

  /** Reset the particle layout from `seed` and restart field time at 0. */
  reseed(seed: number): void {
    const gl = this.gl;
    const init = initParticles(this.count, this.box, seed);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufA);
    gl.bufferData(gl.ARRAY_BUFFER, init, gl.DYNAMIC_COPY);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufB);
    gl.bufferData(gl.ARRAY_BUFFER, init, gl.DYNAMIC_COPY);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.cur = 0;
    this.elapsed = 0;
  }

  /** Release all GL resources (programs, buffers, VAOs). Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteProgram(this.prog);
    gl.deleteBuffer(this.bufA);
    gl.deleteBuffer(this.bufB);
    gl.deleteVertexArray(this.vaoA);
    gl.deleteVertexArray(this.vaoB);
  }
}
