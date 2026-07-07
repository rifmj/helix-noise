// Compare two parity fixtures NUMERICALLY (tolerance, not byte-exact).
// Floats differ by ~1 ULP across platforms/libm, so a regenerated oracle is never
// byte-identical to a committed one — but it must stay within the parity tolerance.
// Usage: node compare-fixture.mjs <a.json> <b.json> [absTol] [relTol]
import { readFileSync } from "node:fs";

const [aPath, bPath, absTolArg, relTolArg] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error("usage: node compare-fixture.mjs <a.json> <b.json> [absTol] [relTol]");
  process.exit(2);
}
const ABS = Number(absTolArg ?? 1e-9);
const REL = Number(relTolArg ?? 1e-9);

const a = JSON.parse(readFileSync(aPath, "utf8"));
const b = JSON.parse(readFileSync(bPath, "utf8"));

let maxDiff = 0;
const problems = [];

function walk(x, y, path) {
  if (typeof x === "number" && typeof y === "number") {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const d = Math.abs(x - y);
      const tol = ABS + REL * Math.max(Math.abs(x), Math.abs(y));
      if (d > maxDiff) maxDiff = d;
      if (d > tol) problems.push(`${path}: ${x} vs ${y} (|Δ|=${d.toExponential(3)} > ${tol.toExponential(3)})`);
    } else if (!Object.is(x, y)) {
      problems.push(`${path}: ${x} vs ${y}`);
    }
    return;
  }
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) { problems.push(`${path}: array length ${x.length} vs ${y.length}`); return; }
    for (let i = 0; i < x.length; i++) walk(x[i], y[i], `${path}[${i}]`);
    return;
  }
  if (x && y && typeof x === "object" && typeof y === "object") {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) {
      if (!(k in x) || !(k in y)) { problems.push(`${path}.${k}: present in only one side`); continue; }
      walk(x[k], y[k], `${path}.${k}`);
    }
    return;
  }
  if (x !== y) problems.push(`${path}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
}

walk(a, b, "");

if (problems.length) {
  console.error(`FIXTURE DRIFT — ${problems.length} value(s) exceed tolerance (abs=${ABS}, rel=${REL}):`);
  for (const p of problems.slice(0, 20)) console.error("  " + p);
  if (problems.length > 20) console.error(`  …and ${problems.length - 20} more`);
  process.exit(1);
}
console.log(`fixtures match within tolerance (max |Δ| = ${maxDiff.toExponential(3)}, abs=${ABS}, rel=${REL})`);
