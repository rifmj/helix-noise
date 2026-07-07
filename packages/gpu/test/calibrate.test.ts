import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "helix-noise";
import { calibrateSpeed } from "../src/calibrate.ts";

const BOX = 6.283185307179586;

test("percentiles are positive and ascending", () => {
  const field = create({ modes: 48, helicity: 0.6, coherence: 0.4, seed: 3 });
  const [p62, p97, p995] = calibrateSpeed(field);
  assert.ok(p62 > 0, "p62 > 0");
  assert.ok(p97 >= p62, "p97 ≥ p62");
  assert.ok(p995 >= p97, "p99.5 ≥ p97");
});

test("deterministic for a given field + sample count", () => {
  const field = create({ modes: 40, helicity: 0.2, seed: 9 });
  assert.deepEqual(calibrateSpeed(field, BOX, 800), calibrateSpeed(field, BOX, 800));
});

test("tiny sample counts are clamped, not crashed", () => {
  const field = create({ modes: 20, seed: 1 });
  const r = calibrateSpeed(field, BOX, 1); // coerced to ≥ 16
  assert.equal(r.length, 3);
  assert.ok(r.every((v) => Number.isFinite(v) && v >= 0));
});
