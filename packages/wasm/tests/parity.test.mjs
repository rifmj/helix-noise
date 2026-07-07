// Parity test for the WASM artifact: load the wasm-pack `web` bundle in Node, rebuild the atom
// and spectral fixture configs, and assert the wasm outputs match the JS reference within 1e-9.
//
//   cd packages/wasm && wasm-pack build --target web --out-dir pkg && node tests/parity.test.mjs
//
// Requires the `pkg/` build (see README). Run from any cwd.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const init = (await import(join(here, "../pkg/helix_noise_wasm.js"))).default;
const wasm = await import(join(here, "../pkg/helix_noise_wasm.js"));

// `web` target: feed the .wasm bytes straight to the initializer.
await init({ module_or_path: readFileSync(join(here, "../pkg/helix_noise_wasm_bg.wasm")) });

const fixture = JSON.parse(readFileSync(join(here, "parity_fixture.json"), "utf8"));

const TOL = 1e-9;
let checks = 0;
const close = (g, e) => Math.abs(g - e) <= TOL + TOL * Math.abs(e);
function eq(g, e, what) {
  assert.ok(close(g, e), `${what}: got ${g}, expected ${e} (diff ${Math.abs(g - e)})`);
  checks++;
}

function checkSamples(label, field, samples) {
  for (let si = 0; si < samples.length; si++) {
    const s = samples[si];
    const uw = field.sampleUW(s.x, s.y, s.z, s.t);
    const ua = field.sampleUA(s.x, s.y, s.z, s.t);
    for (let c = 0; c < 3; c++) {
      eq(uw[c], s.u[c], `${label}[${si}].u[${c}]`);
      eq(uw[c + 3], s.w[c], `${label}[${si}].w[${c}]`);
      eq(ua[c + 3], s.A[c], `${label}[${si}].A[${c}]`);
    }
  }
}

// Spectral engine.
for (const name of ["A_default_small", "B_helical_coherent", "C_random_aniso", "D_decay_time", "E_tileable"]) {
  const entry = fixture[name];
  const f = new wasm.Field(entry.config);
  assert.equal(f.modes(), entry.modes.N, `${name}.modes`);
  checkSamples(name, f, entry.samples);
  eq(f.helicityDensity(1, 2, 3, 0), (() => {
    const uw = f.sampleUW(1, 2, 3, 0);
    return uw[0] * uw[3] + uw[1] * uw[4] + uw[2] * uw[5];
  })(), `${name}.helicityDensity`);
}

// Atom engine.
for (const name of ["G_atoms_default", "H_atoms_helical", "I_atoms_aniso"]) {
  const entry = fixture[name];
  const a = new wasm.Atoms(entry.config);
  checkSamples(name, a, entry.samples);
  eq(a.relativeHelicity(8), entry.relativeHelicity, `${name}.relativeHelicity`);
}

console.log(`WASM parity OK — ${checks} values matched the JS reference within ${TOL}`);
