import { defineConfig } from "tsup";

// Builds src/index.ts into dist/ as:
//   index.js    ESM  (import / bundlers)
//   index.cjs   CommonJS (require)
//   index.d.ts  TypeScript declarations
// No IIFE bundle: this is a React library, consumed by bundlers, not a <script> tag.
// three / @react-three/fiber / react stay external (peer deps).
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  target: "es2020",
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  external: ["react", "react/jsx-runtime", "three", "@react-three/fiber"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
});
