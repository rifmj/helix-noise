import { defineConfig } from "tsup";

// Builds src/index.ts into dist/ as:
//   index.js    ESM  (import / bundlers)
//   index.cjs   CommonJS (require)
//   index.d.ts  TypeScript declarations
// The core (`helix-noise`) stays external — the consumer's installed copy is used rather than
// bundled in. No framework peers: this package touches only the raw WebGL2 API.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  target: "es2020",
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  external: ["helix-noise"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
});
