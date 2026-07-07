import * as THREE from "three";
import type { Field } from "helix-noise";
import { helixFieldChunk } from "./core";

export interface HelixFlowMaterialOptions {
  /** Point size in world units (distance-attenuated). Default 0.05. */
  size?: number;
  /** Colour where local helicity u·ω ≥ 0 (right-handed). Default teal. */
  colorPositive?: THREE.ColorRepresentation;
  /** Colour where local helicity < 0 (left-handed). Default amber. */
  colorNegative?: THREE.ColorRepresentation;
  /** Base opacity. Default 0.85. */
  opacity?: number;
}

/**
 * A `THREE.ShaderMaterial` for `THREE.Points` whose colour is the field's local helicity,
 * evaluated **on the GPU** from the injected `field.glsl()` — no per-vertex CPU sampling.
 *
 * This is the layer-2 primitive: it puts the field into a shader so you can colour geometry
 * without hand-writing the mode sum. The emitter is GLSL ES 3.00 (array-constructor constants),
 * so the material is compiled as GLSL3 to host it.
 *
 * The `uTime` uniform is animated by whoever owns the material (drive it from `useFrame`).
 */
export function helixFlowMaterial(
  field: Field,
  opts: HelixFlowMaterialOptions = {},
): THREE.ShaderMaterial {
  const {
    size = 0.05,
    colorPositive = 0x2fd6bf,
    colorNegative = 0xf4a13c,
    opacity = 0.85,
  } = opts;

  const chunk = helixFieldChunk(field, { curl: true });

  // GLSL ES 3.00. `position` / `modelViewMatrix` / `projectionMatrix` are injected by
  // THREE.ShaderMaterial; only custom uniforms/varyings are declared here.
  const vertex = /* glsl */ `
    ${chunk}
    uniform float uTime;
    uniform float uSize;
    out float vHel;
    void main() {
      vec3 p = position;
      vec3 u = helixNoise(p, uTime);
      vec3 w = helixNoiseCurl(p, uTime);
      vHel = dot(u, w);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = uSize * (300.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const fragment = /* glsl */ `
    uniform vec3 uColorPos;
    uniform vec3 uColorNeg;
    uniform float uOpacity;
    in float vHel;
    out vec4 fragColor;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float a = smoothstep(0.5, 0.15, length(d));
      vec3 c = mix(uColorNeg, uColorPos, step(0.0, vHel));
      fragColor = vec4(c, a * uOpacity);
    }
  `;

  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size },
      uColorPos: { value: new THREE.Color(colorPositive) },
      uColorNeg: { value: new THREE.Color(colorNegative) },
      uOpacity: { value: opacity },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
