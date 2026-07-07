import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "helix-noise";
import {
  buildUpdateVertexShader,
  buildRenderVertexShader,
  buildRenderFragmentShader,
  UPDATE_FRAGMENT_SHADER,
  UPDATE_VARYINGS,
  glslFloat,
} from "../src/shaders.ts";

// GL-free: assert the emitted shader *text* wires the core emitter into a transform-feedback
// program correctly. The numeric field↔sample() parity is the core's contract (and the r3f
// glsl-parity suite); here we only prove the transport around it.

const field = create({ modes: 40, helicity: 0.8, coherence: 0.5, seed: 7, tileable: true });

test("update shader inlines the core emitter and captures the right varyings", () => {
  const vs = buildUpdateVertexShader(field, { box: 6.283185307179586 });
  assert.match(vs, /#version 300 es/, "GLSL ES 3.00");
  assert.match(vs, /vec3 hx\(vec3 p, float t\)/, "field sampler is injected");
  assert.match(vs, /vec3 hxCurl\(/, "curl is injected (helicity hue needs it)");
  assert.match(vs, /p \+= u \* \(uSpeed \* uDt\)/, "explicit Euler advection");
  assert.match(vs, /v_pos = mod\(p,/, "wrap into the box");
  assert.match(vs, /out vec3 v_pos;/, "position varying");
  assert.match(vs, /out vec2 v_aux;/, "aux varying");
  assert.deepEqual([...UPDATE_VARYINGS], ["v_pos", "v_aux"], "capture order matches the VBO layout");
  assert.match(vs, /layout\(location = 0\) in vec3 a_pos;/, "pinned position location");
  assert.match(vs, /layout\(location = 1\) in vec2 a_aux;/, "pinned aux location");
});

test("the domain box is baked as a GLSL float literal", () => {
  assert.match(buildUpdateVertexShader(field, { box: 10 }), /mod\(p, 10\.0\)/, "integer box gains a decimal");
  assert.equal(glslFloat(10), "10.0");
  assert.equal(glslFloat(6.283185307179586), "6.283185307179586");
  assert.equal(glslFloat(1e-6), "0.000001");
});

test("precision is forwarded to the core emitter", () => {
  const lo = buildUpdateVertexShader(field, { precision: 3 });
  const hi = buildUpdateVertexShader(field, { precision: 17 });
  assert.ok(hi.length > lo.length, "higher precision → longer baked mode arrays");
});

test("render shaders are well-formed and expose the documented uniforms", () => {
  const vs = buildRenderVertexShader();
  const fs = buildRenderFragmentShader();
  assert.match(vs, /#version 300 es/);
  assert.match(vs, /uniform mat4 uViewProj;/, "standard mat4 camera — BYO camera interoperates");
  assert.match(vs, /uniform vec3 uCenter;/);
  assert.match(vs, /gl_PointSize = clamp/, "depth-attenuated point size");
  assert.match(vs, /layout\(location = 0\) in vec3 a_pos;/, "same VAO layout as the update shader");
  assert.match(fs, /#version 300 es/);
  assert.match(fs, /uniform vec3 uSpeed;/, "speed-percentile glow thresholds");
  assert.match(fs, /out vec4 outColor;/);
});

test("the update fragment is a no-op (paired with RASTERIZER_DISCARD)", () => {
  assert.match(UPDATE_FRAGMENT_SHADER, /void main\(\)\s*\{\s*\}/);
});
