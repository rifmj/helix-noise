import { defineConfig } from "tsup";

// Builds src/index.ts into dist/ as:
//   helix-noise.js        ESM  (import / bundlers)
//   helix-noise.cjs       CommonJS (require)
//   helix-noise.global.js IIFE, global `HelixNoise` (<script> tag / CDN)
//   helix-noise.d.ts      TypeScript declarations
export default defineConfig({
  entry: { "helix-noise": "src/index.ts" },
  format: ["esm", "cjs", "iife"],
  globalName: "HelixNoise",
  target: "es2020",
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : format === "cjs" ? ".cjs" : ".global.js" };
  },
});
