import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Geometry, history and visual shading regressions with in-memory runtimes.
export default defineConfig({
  envFile: false,
  envDir: fileURLToPath(new URL("./src/modules/calpinage/canonical3d/scene/__tests__", import.meta.url)),
  server: { host: "127.0.0.1", hmr: false, ws: false, watch: null },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      "clipper-lib": fileURLToPath(new URL("./node_modules/clipper-lib", import.meta.url)),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    silent: true,
    setupFiles: ["./src/test-setup.ts"],
    include: [
      "src/modules/calpinage/canonical3d/scene/__tests__/sceneCoherenceG3G7.test.ts",
      "src/modules/calpinage/runtime/__tests__/roofModelingCoherenceG4.test.ts",
      "src/modules/calpinage/smartRoofDrawing/__tests__/drawingUi.test.ts",
    ],
    cache: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
  },
});
