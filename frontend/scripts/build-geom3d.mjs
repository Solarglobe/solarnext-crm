import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const outdir = resolve("../backend/calpinage-legacy-assets/geometry");
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [resolve("src/modules/calpinage/geometry/index.ts")],
  bundle: true,
  format: "cjs",
  outfile: resolve(outdir, "geoEntity3D.cjs"),
  platform: "node",
  tsconfig: resolve("tsconfig.esbuild.json"),
});

console.log("[build:geom3d] geometry bundle -> backend/calpinage-legacy-assets/geometry/geoEntity3D.cjs");
