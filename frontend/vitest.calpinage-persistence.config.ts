import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Keep persistence regression tests independent of Vite's asset-copy/build hooks.
export default defineConfig({
  envFile: false,
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
    setupFiles: ["./src/test-setup.ts"],
    include: [
      "src/components/__tests__/CalpinageOverlay.persistence.test.tsx",
      "src/modules/calpinage/legacy/__tests__/calpinagePersistenceLoad.test.ts",
      "src/modules/calpinage/__tests__/calpinageLoadPolicy.test.ts",
      "src/modules/calpinage/__tests__/calpinagePersistenceCoordinator.test.ts",
    ],
    cache: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
  },
});
