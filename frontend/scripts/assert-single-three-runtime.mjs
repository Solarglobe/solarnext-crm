import fs from "node:fs";
import path from "node:path";

const lockPath = path.resolve("package-lock.json");
const pkgPath = path.resolve("package.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

const packages = lock.packages ?? {};
const threeEntries = Object.entries(packages)
  .filter(([key]) => key.endsWith("node_modules/three"))
  .map(([key, value]) => ({ key, version: value?.version }));

const versions = new Set(threeEntries.map((entry) => entry.version));
const nested = threeEntries.filter((entry) => entry.key !== "node_modules/three");
const statsGlOverride = pkg.overrides?.["stats-gl"]?.three;

if (versions.size !== 1 || !versions.has("0.183.2")) {
  throw new Error(`Three.js runtime non unique: ${JSON.stringify(threeEntries)}`);
}

if (nested.length > 0) {
  throw new Error(`Three.js imbrique detecte: ${JSON.stringify(nested)}`);
}

if (statsGlOverride !== "$three") {
  throw new Error("Override stats-gl -> $three manquant");
}

console.log("OK single Three.js runtime: three@0.183.2");
