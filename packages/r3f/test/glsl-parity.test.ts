import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "helix-noise";
import { helixFieldChunk } from "../src/core.ts";
import { parseChunk, evalVelocity, evalCurl } from "./glsl-eval.ts";

// The numeric parity contract the GPU render path relies on: the GLSL we inject into the GPU,
// evaluated on its own terms, reproduces field.sample(). This is the same bar every other port
// asserts against spec/parity_fixture.json (≤1e-9), lifted to the emitted shader text.

const PTS: [number, number, number][] = [
  [0.1, 0.2, 0.3],
  [1.0, 2.0, 3.0],
  [4.2, 5.5, 0.7],
  [6.0, 6.1, 6.2],
  [-2.3, 3.14, 5.0],
];

const maxErr = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i])));

test("velocity: emitted GLSL == field.sample() at t=0 (≤1e-9, precision 17)", () => {
  const field = create({ modes: 44, slope: 1.6, helicity: 0.8, coherence: 0.5, seed: 7 });
  const f = parseChunk(helixFieldChunk(field, { precision: 17 }));
  let worst = 0;
  for (const p of PTS) worst = Math.max(worst, maxErr(evalVelocity(f, p), field.sample(...p)));
  assert.ok(worst < 1e-9, `worst velocity error ${worst}`);
});

test("velocity: time term matches at t≠0 (churn on, ≤1e-9)", () => {
  const field = create({ modes: 40, helicity: 0.4, coherence: 0.3, churn: 1, seed: 3 });
  const f = parseChunk(helixFieldChunk(field, { precision: 17 }));
  const t = 0.8;
  let worst = 0;
  for (const p of PTS) worst = Math.max(worst, maxErr(evalVelocity(f, p, t), field.sample(p[0], p[1], p[2], t)));
  assert.ok(worst < 1e-9, `worst velocity error at t=${t}: ${worst}`);
});

test("velocity: viscous decay term matches at t≠0 (decay on, ≤1e-9)", () => {
  const field = create({ modes: 36, helicity: 0.2, decay: 0.05, churn: 0.5, seed: 11 });
  const f = parseChunk(helixFieldChunk(field, { precision: 17 }));
  assert.notEqual(f.NU, null, "NU should be baked when decay > 0");
  const t = 1.3;
  let worst = 0;
  for (const p of PTS) worst = Math.max(worst, maxErr(evalVelocity(f, p, t), field.sample(p[0], p[1], p[2], t)));
  assert.ok(worst < 1e-9, `worst decayed velocity error at t=${t}: ${worst}`);
});

test("curl: emitted GLSL curl == field.vorticity() (≤1e-9)", () => {
  const field = create({ modes: 44, helicity: 0.8, coherence: 0.5, seed: 7 });
  const f = parseChunk(helixFieldChunk(field, { precision: 17 }));
  let worst = 0;
  for (const p of PTS) worst = Math.max(worst, maxErr(evalCurl(f, p), field.vorticity(...p)));
  assert.ok(worst < 1e-9, `worst curl error ${worst}`);
});

test("default precision (7) is rendering-grade (≤1e-5) — the shipped GPU tradeoff", () => {
  // The GPU path bakes at precision 7 for compact shaders; that truncation, not the formula,
  // is the only gap vs sample(). Documented so a regression in the formula (which would blow
  // past 1e-5) is caught even at ship precision.
  const field = create({ modes: 44, helicity: 0.8, coherence: 0.5, seed: 7 });
  const f = parseChunk(helixFieldChunk(field)); // default precision
  let worst = 0;
  for (const p of PTS) worst = Math.max(worst, maxErr(evalVelocity(f, p), field.sample(...p)));
  assert.ok(worst < 1e-5, `worst velocity error at default precision ${worst}`);
});
