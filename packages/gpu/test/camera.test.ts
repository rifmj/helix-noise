import { test } from "node:test";
import assert from "node:assert/strict";
import { perspective, lookAt, multiply, orbitViewProjection, type Mat4 } from "../src/camera.ts";

// Column-major mat·vec (w = 1) → clip, then NDC = clip.xyz / clip.w.
function project(m: Mat4, x: number, y: number, z: number): { ndc: [number, number, number]; w: number } {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return { ndc: [cx / cw, cy / cw, cz / cw], w: cw };
}

test("perspective: canonical entries", () => {
  const fovY = Math.PI / 3, aspect = 16 / 9, near = 0.5, far = 100;
  const m = perspective(fovY, aspect, near, far);
  const f = 1 / Math.tan(fovY / 2);
  assert.ok(Math.abs(m[0] - f / aspect) < 1e-6, "x scale = f/aspect");
  assert.ok(Math.abs(m[5] - f) < 1e-6, "y scale = f");
  assert.equal(m[11], -1, "perspective divide term");
  assert.ok(Math.abs(m[10] - (far + near) / (near - far)) < 1e-6);
  assert.ok(Math.abs(m[14] - (2 * far * near) / (near - far)) < 1e-6);
});

test("multiply: identity · M = M", () => {
  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const M = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual([...multiply(I, M)], [...M]);
});

test("lookAt + perspective: the target projects to the screen centre, in front", () => {
  const vp = multiply(perspective(Math.PI / 4, 1, 0.1, 100), lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0]));
  const c = project(vp, 0, 0, 0);
  assert.ok(Math.abs(c.ndc[0]) < 1e-5 && Math.abs(c.ndc[1]) < 1e-5, "origin at the centre");
  assert.ok(c.w > 0, "in front of the camera");

  // Orientation: +x world lands on the right, +y world lands on top.
  assert.ok(project(vp, 1, 0, 0).ndc[0] > 0, "right is right");
  assert.ok(project(vp, 0, 1, 0).ndc[1] > 0, "up is up");
});

test("orbitViewProjection: keeps the target centred and in front at any yaw/pitch", () => {
  for (const [yaw, pitch] of [[0, 0], [0.3, 0.2], [-1.0, -0.8], [2.5, 1.1]]) {
    const vp = orbitViewProjection({ yaw, pitch, distance: 10, aspect: 1.5 });
    const c = project(vp, 0, 0, 0);
    assert.ok(Math.abs(c.ndc[0]) < 1e-4 && Math.abs(c.ndc[1]) < 1e-4, `centred at yaw=${yaw}`);
    assert.ok(c.w > 0, `in front at yaw=${yaw}, pitch=${pitch}`);
  }
});
