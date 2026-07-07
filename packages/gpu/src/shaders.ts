import type { Field } from "helix-noise";
import { ATTRIB_AUX, ATTRIB_POS, TAU } from "./constants";

/**
 * GLSL float literal — always carries a decimal point so it is unambiguously a `float`
 * (mirrors the core emitter's `fl`, minus the significant-digit rounding: box/period are exact).
 */
export function glslFloat(x: number): string {
  const s = String(x);
  return /[.eE]/.test(s) ? s : s + ".0";
}

export interface UpdateShaderOptions {
  /**
   * Domain size L: advected particles wrap into `[0, L)³` via `mod`. The wrap is *seamless* only
   * when the field is `tileable` (integer-lattice wavevectors, 2π-periodic) — otherwise there is
   * a visible discontinuity at the box face. Default `2π`.
   */
  box?: number;
  /** Significant digits for the baked mode constants (passed to `field.glsl`). Default 7 (rendering-grade). */
  precision?: number;
}

/**
 * The transform-feedback **update** vertex shader. It advects every particle one Euler step by
 * the *injected* `field.glsl()` — the mode sum is the core emitter verbatim, never re-derived
 * here — and captures the new position + a colour aux (eased local helicity, live speed) into the
 * next ping-pong buffer. The rasterizer is discarded, so there is no fragment work.
 *
 * Attribute locations are pinned (`layout(location=…)`) so one VAO layout feeds both this shader
 * and the render shader.
 */
export function buildUpdateVertexShader(field: Field, opts: UpdateShaderOptions = {}): string {
  const box = opts.box ?? TAU;
  const chunk = field.glsl({ name: "hx", curl: true, precision: opts.precision ?? 7 });
  return `#version 300 es
precision highp float;
${chunk}
layout(location = ${ATTRIB_POS}) in vec3 a_pos;
layout(location = ${ATTRIB_AUX}) in vec2 a_aux;   // x = eased helicity hue, y = speed
out vec3 v_pos;
out vec2 v_aux;
uniform float uDt;
uniform float uT;
uniform float uSpeed;
void main() {
  vec3 p = a_pos;
  vec3 u = hx(p, uT);
  vec3 w = hxCurl(p, uT);
  float sp = length(u);
  float h = dot(u, w) / (sp * length(w) + 1e-6);      // local relative helicity in [-1, 1]
  p += u * (uSpeed * uDt);                             // one explicit Euler step
  v_pos = mod(p, ${glslFloat(box)});                  // wrap into [0, box)
  v_aux = vec2(mix(a_aux.x, h, 0.06), sp);            // ease the hue, carry the live speed
  gl_Position = vec4(0.0);
}`;
}

/** No-op fragment shader for the update pass (paired with `RASTERIZER_DISCARD`). */
export const UPDATE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
void main() {}`;

/** Transform-feedback varyings, in interleaved capture order. Matches `PARTICLE_STRIDE_FLOATS`. */
export const UPDATE_VARYINGS: readonly string[] = ["v_pos", "v_aux"];

export interface RenderShaderOptions {
  /** Reserved for future render variants; currently unused. */
  reserved?: never;
}

/**
 * The **render** vertex shader: projects each particle with a standard `mat4` view-projection
 * (bring your own — three.js `projectionMatrix · matrixWorldInverse`, gl-matrix, or the built-in
 * {@link orbitViewProjection}), centres the cloud at `uCenter`, and attenuates point size by
 * clip-space depth. Additive point sprites; particles behind the camera are culled.
 */
export function buildRenderVertexShader(_opts: RenderShaderOptions = {}): string {
  return `#version 300 es
precision highp float;
layout(location = ${ATTRIB_POS}) in vec3 a_pos;
layout(location = ${ATTRIB_AUX}) in vec2 a_aux;
out vec2 f_aux;
out float f_depth;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform float uPointScale;
void main() {
  vec4 clip = uViewProj * vec4(a_pos - uCenter, 1.0);
  if (clip.w <= 0.02) {                 // behind / on the camera plane → cull
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    f_aux = vec2(0.0);
    f_depth = 1.0;
    return;
  }
  gl_Position = clip;
  gl_PointSize = clamp(uPointScale * 13.0 / clip.w, 1.4, 5.0);
  f_aux = a_aux;
  f_depth = clip.w;
}`;
}

/**
 * The **render** fragment shader: a soft round splat whose hue is the eased local helicity
 * (amber left-handed ↔ teal right-handed) and whose brightness rises with local speed, so only
 * the fast filaments glow and the hottest cores whiten. Speed thresholds come from the field's
 * measured percentiles (see {@link calibrateSpeed}), keeping the look stable across parameters.
 */
export function buildRenderFragmentShader(): string {
  return `#version 300 es
precision mediump float;
in vec2 f_aux;
in float f_depth;
out vec4 outColor;
uniform float uAlpha;
uniform vec3 uSpeed;        // measured speed percentiles: p62, p97, p99.5
uniform vec3 uColorLow;     // left-handed hue
uniform vec3 uColorHigh;    // right-handed hue
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float t = clamp(f_aux.x * 0.8 + 0.5, 0.0, 1.0);
  vec3 c = mix(uColorLow, uColorHigh, t);
  c += vec3(0.85, 0.88, 0.9) * smoothstep(uSpeed.y, uSpeed.z, f_aux.y) * 0.22;  // hot cores whiten
  float bright = 0.035 + 2.0 * smoothstep(uSpeed.x, uSpeed.y, f_aux.y);          // fast filaments glow
  float fade = clamp(6.0 / f_depth, 0.5, 1.5);
  outColor = vec4(c * uAlpha * bright * fade * (1.0 - r2), 1.0);
}`;
}
