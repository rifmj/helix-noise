import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The example consumes the built package (helix-noise-r3f → dist). Force-include its deps so
// Vite pre-bundles them from the nested install.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1" },
  // The package is a symlink (file:../../packages/r3f) with react/three as externalised peers,
  // so they exist in two node_modules trees. Dedupe to a single copy or React hooks / three
  // break at runtime.
  resolve: { dedupe: ["react", "react-dom", "three", "@react-three/fiber"] },
  optimizeDeps: { include: ["three", "@react-three/fiber", "react", "react-dom"] },
});
