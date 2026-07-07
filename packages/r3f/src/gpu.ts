import * as THREE from "three";
import type { Field } from "helix-noise";
import { helixFieldChunk } from "./core";
import type { ColorBy } from "./HelixParticles";

// A self-contained GPGPU particle engine. Positions live in a float texture; a fullscreen
// pass advects every particle on-device by the *injected* `field.glsl()` (verbatim — the mode
// sum is never re-implemented here), ping-ponging between two float render targets. A
// THREE.Points object reads the current position texture in its vertex shader and colours by
// helicity, also from the injected chunk.
//
// GLSL ES 3.00 throughout (the emitter's array-constructor syntax needs it), so this is a
// hand-rolled ping-pong rather than three's GPUComputationRenderer, whose compute shaders are
// GLSL ES 1.00 and cannot host the emitted chunk.

export interface GpuSimOptions {
  count: number;
  bounds: [number, number, number];
  speed: number;
  pointSize: number;
  colorBy: ColorBy;
  lifespan: [number, number];
  /** GLSL snippet defining `float helixSdf(vec3 p)` (> 0 outside). Enables a GPU-native boundary. */
  obstacleGlsl?: string;
  /** Obstacle influence-band width (maps to the core `thickness`). Default 1. */
  thickness?: number;
}

const rtOptions: THREE.RenderTargetOptions = {
  type: THREE.FloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

function colorModeId(colorBy: ColorBy): number {
  return colorBy === "helicity" ? 0 : colorBy === "speed" ? 1 : 2;
}

/** One GPGPU particle system bound to a renderer and a field. Owns its GL resources. */
export class GpuParticleSim {
  readonly points: THREE.Points;
  private readonly renderer: THREE.WebGLRenderer;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private readonly simMat: THREE.RawShaderMaterial;
  private readonly renderMat: THREE.RawShaderMaterial;
  private readonly simScene: THREE.Scene;
  private readonly simCamera: THREE.OrthographicCamera;
  private readonly quad: THREE.Mesh;
  private elapsed = 0;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, field: Field, opts: GpuSimOptions) {
    this.renderer = renderer;
    const { count, bounds, speed, pointSize, colorBy, lifespan, obstacleGlsl, thickness = 1 } = opts;

    // Texture large enough to hold `count` particles (one texel each).
    const width = Math.ceil(Math.sqrt(count));
    const height = Math.ceil(count / width);
    const texCount = width * height;

    // The vector potential A is only needed for the boundary (u_b = r'·∇d×A + r·u).
    const chunk = helixFieldChunk(field, { curl: true, potential: !!obstacleGlsl });
    const boundsVec = new THREE.Vector3(...bounds);

    // --- initial state: random positions in [0, bounds), random remaining life ---
    const init = new Float32Array(texCount * 4);
    const [lmin, lmax] = lifespan;
    for (let i = 0; i < texCount; i++) {
      init[i * 4] = Math.random() * bounds[0];
      init[i * 4 + 1] = Math.random() * bounds[1];
      init[i * 4 + 2] = Math.random() * bounds[2];
      init[i * 4 + 3] = lmin + Math.random() * (lmax - lmin);
    }
    const initTex = new THREE.DataTexture(init, width, height, THREE.RGBAFormat, THREE.FloatType);
    initTex.needsUpdate = true;

    this.rtA = new THREE.WebGLRenderTarget(width, height, rtOptions);
    this.rtB = new THREE.WebGLRenderTarget(width, height, rtOptions);

    // --- simulation pass (fullscreen) ---
    this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.simScene = new THREE.Scene();
    this.simMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uParticles: { value: initTex },
        uTime: { value: 0 },
        uDt: { value: 0 },
        uSpeed: { value: speed },
        uBounds: { value: boundsVec },
        uSeed: { value: Math.random() * 1000 },
        uLife: { value: new THREE.Vector2(lmin, lmax) },
        uThickness: { value: Math.max(thickness, 1e-9) },
        uSdfEps: { value: 1e-3 },
      },
      vertexShader: SIM_VERT,
      fragmentShader: simFragment(chunk, obstacleGlsl),
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMat);
    this.quad.frustumCulled = false;
    this.simScene.add(this.quad);

    // Prime rtA with the initial state so the first step reads a real target, then release the
    // upload texture (its data now lives in rtA).
    this.blit(initTex, this.rtA);
    this.simMat.uniforms.uParticles.value = this.rtA.texture;
    initTex.dispose();

    // --- render pass (THREE.Points) ---
    const geo = new THREE.BufferGeometry();
    const ref = new Float32Array(texCount * 2);
    for (let i = 0; i < texCount; i++) {
      ref[i * 2] = (i % width) / width + 0.5 / width;
      ref[i * 2 + 1] = Math.floor(i / width) / height + 0.5 / height;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(texCount * 3), 3));
    geo.setAttribute("aRef", new THREE.BufferAttribute(ref, 2));

    const fixed = colorBy === "helicity" || colorBy === "speed" ? new THREE.Color(0xffffff) : new THREE.Color(colorBy as THREE.ColorRepresentation);
    this.renderMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uParticles: { value: this.rtA.texture },
        uTime: { value: 0 },
        uBounds: { value: boundsVec },
        uPointSize: { value: pointSize * 620 },
        uColorPos: { value: new THREE.Color(0x2fd6bf) },
        uColorNeg: { value: new THREE.Color(0xf4a13c) },
        uFixed: { value: fixed },
        uColorMode: { value: colorModeId(colorBy) },
        uOpacity: { value: 0.85 },
      },
      vertexShader: renderVertex(chunk),
      fragmentShader: RENDER_FRAG,
    });
    this.points = new THREE.Points(geo, this.renderMat);
    this.points.frustumCulled = false;
  }

  /** Copy a texture into a render target through the fullscreen quad. */
  private blit(src: THREE.Texture, dst: THREE.WebGLRenderTarget): void {
    const prev = this.simMat.uniforms.uParticles.value;
    const prevDt = this.simMat.uniforms.uDt.value;
    this.simMat.uniforms.uParticles.value = src;
    this.simMat.uniforms.uDt.value = -1; // sentinel: pass-through (see simFragment)
    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(dst);
    this.renderer.render(this.simScene, this.simCamera);
    this.renderer.setRenderTarget(target);
    this.simMat.uniforms.uParticles.value = prev;
    this.simMat.uniforms.uDt.value = prevDt;
  }

  /** Advance the simulation by dt seconds and point the renderer at the fresh texture. */
  step(dt: number, elapsed?: number): void {
    if (this.disposed) return;
    this.elapsed = elapsed ?? this.elapsed + dt;
    this.simMat.uniforms.uParticles.value = this.rtA.texture;
    this.simMat.uniforms.uTime.value = this.elapsed;
    this.simMat.uniforms.uDt.value = dt;

    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rtB);
    this.renderer.render(this.simScene, this.simCamera);
    this.renderer.setRenderTarget(target);

    // swap
    const tmp = this.rtA;
    this.rtA = this.rtB;
    this.rtB = tmp;

    this.renderMat.uniforms.uParticles.value = this.rtA.texture;
    this.renderMat.uniforms.uTime.value = this.elapsed;
  }

  dispose(): void {
    this.disposed = true;
    this.rtA.dispose();
    this.rtB.dispose();
    this.simMat.dispose();
    this.renderMat.dispose();
    this.quad.geometry.dispose();
    this.points.geometry.dispose();
  }
}

const SIM_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function simFragment(chunk: string, obstacleGlsl?: string): string {
  const hasObstacle = !!obstacleGlsl;

  // Bounded velocity, computed exactly as the core boundary.ts:
  //   u_b = ramp'(q)·(∇d × A) + ramp(q)·u,  q = d/thickness  (Bridson free-slip quintic)
  // A = helixNoisePot, u = helixNoise, ∇d by central differences of helixSdf. Zero inside,
  // base field beyond the band, divergence-free by the ∇×(ramp·A) identity.
  const boundary = hasObstacle
    ? /* glsl */ `
${obstacleGlsl}
uniform float uThickness;
uniform float uSdfEps;
float helixRamp(float x)  { if (x <= 0.0) return 0.0; if (x >= 1.0) return 1.0; float x2 = x*x; return x*(15.0 - 10.0*x2 + 3.0*x2*x2)/8.0; }
float helixDRamp(float x) { if (x < 0.0 || x >= 1.0) return 0.0; float w = 1.0 - x*x; return (15.0/8.0)*w*w; }
vec3 boundedVel(vec3 p, float t) {
  float d = helixSdf(p);
  if (d <= 0.0) return vec3(0.0);
  vec3 u = helixNoise(p, t);
  float q = d / uThickness;
  if (q >= 1.0) return u;
  vec3 A = helixNoisePot(p, t);
  float e = uSdfEps;
  vec3 g = vec3(
    helixSdf(p + vec3(e,0,0)) - helixSdf(p - vec3(e,0,0)),
    helixSdf(p + vec3(0,e,0)) - helixSdf(p - vec3(0,e,0)),
    helixSdf(p + vec3(0,0,e)) - helixSdf(p - vec3(0,0,e))) / (2.0*e);
  return helixDRamp(q) / uThickness * cross(g, A) + helixRamp(q) * u;
}
#define HELIX_VEL(p, t) boundedVel(p, t)
#define HELIX_INSIDE(p) (helixSdf(p) < 0.0)
`
    : /* glsl */ `
#define HELIX_VEL(p, t) helixNoise(p, t)
#define HELIX_INSIDE(p) false
`;

  return /* glsl */ `precision highp float;
${chunk}
uniform sampler2D uParticles;
uniform float uTime;
uniform float uDt;
uniform float uSpeed;
uniform vec3 uBounds;
uniform float uSeed;
uniform vec2 uLife;
in vec2 vUv;
out vec4 outColor;
${boundary}
float hash11(float n) { return fract(sin(n) * 43758.5453123); }
vec3 spawnPos(vec2 uv) {
  float n = dot(uv, vec2(127.1, 311.7)) + uSeed + uTime;
  return vec3(hash11(n), hash11(n + 1.7), hash11(n + 3.3)) * uBounds;
}

void main() {
  vec4 s = texture(uParticles, vUv);
  if (uDt < 0.0) { outColor = s; return; } // prime/blit pass-through
  float life = s.w - uDt;
  // Respawn on death, or when the particle is inside the obstacle (keeps the void clear).
  if (life <= 0.0 || HELIX_INSIDE(s.xyz)) {
    vec3 sp = spawnPos(vUv);
    float r = hash11(dot(vUv, vec2(269.5, 183.3)) + uSeed);
    outColor = vec4(sp, mix(uLife.x, uLife.y, r));
    return;
  }
  vec3 pos = s.xyz;
  vec3 v = HELIX_VEL(pos, uTime);
  pos += v * (uSpeed * uDt);
  pos = mod(pos, uBounds); // wrap into [0, bounds)
  outColor = vec4(pos, life);
}
`;
}

function renderVertex(chunk: string): string {
  // `precision highp int` in BOTH stages is mandatory: int uniforms default to highp in the
  // vertex stage but mediump in the fragment stage, and a mismatch fails program validation
  // (uColorMode is shared). Keep it in sync with RENDER_FRAG.
  return /* glsl */ `precision highp float;
precision highp int;
${chunk}
uniform sampler2D uParticles;
uniform float uTime;
uniform vec3 uBounds;
uniform float uPointSize;
uniform int uColorMode;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec2 aRef;
out float vShade;
void main() {
  vec3 pos = texture(uParticles, aRef).xyz;
  vec3 centered = pos - uBounds * 0.5;
  vec3 u = helixNoise(pos, uTime);
  if (uColorMode == 1) {
    vShade = length(u);                 // speed
  } else {
    vec3 w = helixNoiseCurl(pos, uTime);
    vShade = dot(u, w);                 // helicity (sign)
  }
  vec4 mv = modelViewMatrix * vec4(centered, 1.0);
  gl_PointSize = uPointSize / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
}

const RENDER_FRAG = /* glsl */ `precision highp float;
precision highp int;
uniform vec3 uColorPos;
uniform vec3 uColorNeg;
uniform vec3 uFixed;
uniform int uColorMode;
uniform float uOpacity;
in float vShade;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(d));
  vec3 c;
  if (uColorMode == 2) c = uFixed;
  else if (uColorMode == 1) c = mix(uColorPos, uColorNeg, clamp(vShade / 2.0, 0.0, 1.0));
  else c = mix(uColorNeg, uColorPos, step(0.0, vShade));
  outColor = vec4(c, a * uOpacity);
}
`;
