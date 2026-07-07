import { test } from "node:test";
import assert from "node:assert/strict";
import { initParticles } from "../src/particles.ts";
import { PARTICLE_STRIDE_FLOATS } from "../src/constants.ts";

const BOX = 6.283185307179586;

test("length = count × stride", () => {
  assert.equal(initParticles(1000, BOX, 1).length, 1000 * PARTICLE_STRIDE_FLOATS);
});

test("positions land in [0, box); aux is seeded neutral", () => {
  const p = initParticles(5000, BOX, 42);
  for (let i = 0; i < 5000; i++) {
    const o = i * PARTICLE_STRIDE_FLOATS;
    for (let k = 0; k < 3; k++) {
      assert.ok(p[o + k] >= 0 && p[o + k] < BOX, `axis ${k} within [0, box)`);
    }
    assert.equal(p[o + 3], 0, "hue starts neutral");
    assert.equal(p[o + 4], 1, "speed starts at the placeholder");
  }
});

test("deterministic per seed, distinct across seeds", () => {
  const a = initParticles(256, 1, 7);
  const b = initParticles(256, 1, 7);
  const c = initParticles(256, 1, 8);
  assert.deepEqual([...a], [...b], "same seed → identical cloud");
  assert.notDeepEqual([...a], [...c], "different seed → different cloud");
});

test("count is coerced to a non-negative integer", () => {
  assert.equal(initParticles(0, 1, 1).length, 0);
  assert.equal(initParticles(3.9, 1, 1).length, 3 * PARTICLE_STRIDE_FLOATS);
  assert.equal(initParticles(-5, 1, 1).length, 0);
});

test("box scales the spawn extent", () => {
  const big = initParticles(2000, 100, 5);
  let max = 0;
  for (let i = 0; i < 2000; i++) max = Math.max(max, big[i * PARTICLE_STRIDE_FLOATS]);
  assert.ok(max > 50, "with box=100 some x should exceed 50");
});
