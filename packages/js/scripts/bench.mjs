// Benchmark: per-point sampleUW loop vs the batch samplers, plus the atom engine. Run: npm run bench
import { create, createAtoms } from "../dist/helix-noise.js";

const MODES = 48, N = 20000, REPS = 7;
const field = create({ modes: MODES, seed: 1, churn: 1 });

const pos = new Float64Array(3 * N);
for (let i = 0; i < pos.length; i++) pos[i] = Math.sin(i * 12.9898) * 6;
const out3 = new Float64Array(3 * N);
const out6 = new Float64Array(6 * N);
const uw = [0, 0, 0, 0, 0, 0];

function time(fn) {
  fn(); fn(); // warm up
  let best = Infinity;
  for (let r = 0; r < REPS; r++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

const tNaive = time(() => { // what integration code usually does: allocating sample() per particle
  for (let i = 0; i < N; i++) {
    const u = field.sample(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
    out3[3 * i] = u[0]; out3[3 * i + 1] = u[1]; out3[3 * i + 2] = u[2];
  }
});
const tLoop = time(() => { // the optimal per-point loop: zero-alloc sampleUW
  for (let i = 0; i < N; i++) {
    field.sampleUW(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], uw);
    out6[6 * i] = uw[0]; out6[6 * i + 1] = uw[1]; out6[6 * i + 2] = uw[2];
    out6[6 * i + 3] = uw[3]; out6[6 * i + 4] = uw[4]; out6[6 * i + 5] = uw[5];
  }
});
field._noWasm = true;
const tMany = time(() => field.sampleMany(pos, out3));
const tManyUW = time(() => field.sampleManyUW(pos, out6));
field._noWasm = false;
const tWasm = time(() => field.sampleMany(pos, out3));
const tWasmUW = time(() => field.sampleManyUW(pos, out6));

const ns = (ms) => ((ms * 1e6) / N).toFixed(0);
console.log(`helix-noise batch bench — ${MODES} modes, ${N} points, best of ${REPS}`);
console.log(`  sample() loop   : ${tNaive.toFixed(2)} ms  (${ns(tNaive)} ns/pt)`);
console.log(`  sampleUW loop   : ${tLoop.toFixed(2)} ms  (${ns(tLoop)} ns/pt)  ${(tNaive / tLoop).toFixed(2)}x vs sample()`);
console.log(`  sampleMany (js) : ${tMany.toFixed(2)} ms  (${ns(tMany)} ns/pt)  ${(tNaive / tMany).toFixed(2)}x vs sample(), ${(tLoop / tMany).toFixed(2)}x vs sampleUW`);
console.log(`  sampleManyUW(js): ${tManyUW.toFixed(2)} ms  (${ns(tManyUW)} ns/pt)  ${(tLoop / tManyUW).toFixed(2)}x vs sampleUW`);
console.log(`  sampleMany wasm : ${tWasm.toFixed(2)} ms  (${ns(tWasm)} ns/pt)  ${(tLoop / tWasm).toFixed(2)}x vs sampleUW, ${(tMany / tWasm).toFixed(2)}x vs js batch`);
console.log(`  sampleManyUW wsm: ${tWasmUW.toFixed(2)} ms  (${ns(tWasmUW)} ns/pt)  ${(tLoop / tWasmUW).toFixed(2)}x vs sampleUW`);

// Atom engine — positions confined to a box so the cell cache stays warm (the particle-cloud case).
const atoms = createAtoms({ octaves: 3 });
const posA = new Float64Array(3 * N);
for (let i = 0; i < posA.length; i++) posA[i] = ((Math.sin(i * 12.9898) + 1) / 2) * 12;
const tAtomU = time(() => {
  for (let i = 0; i < N; i++) {
    const u = atoms.sample(posA[3 * i], posA[3 * i + 1], posA[3 * i + 2]);
    out3[3 * i] = u[0]; out3[3 * i + 1] = u[1]; out3[3 * i + 2] = u[2];
  }
});
const tAtomUW = time(() => {
  for (let i = 0; i < N; i++) atoms.sampleUW(posA[3 * i], posA[3 * i + 1], posA[3 * i + 2], uw);
});
console.log(`atom engine — 3 octaves, 8 atoms/cell (broadband; compare with the 48-mode sum above)`);
console.log(`  sample loop     : ${tAtomU.toFixed(2)} ms  (${ns(tAtomU)} ns/pt)`);
console.log(`  sampleUW loop   : ${tAtomUW.toFixed(2)} ms  (${ns(tAtomUW)} ns/pt, analytic vorticity)`);
