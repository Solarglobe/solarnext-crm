const fs = require("fs");
const path = require("path");

const root = process.cwd();
const sourceRoot = path.join(root, "calpinage");
const targetRoot = path.join(root, "..", "backend", "calpinage-legacy-assets");

const requiredAssets = [
  ["canvas-bundle.js"],
  ["map-selector-bundle.js"],
  ["pans-bundle.js"],
  ["panelProjection.js"],
  ["state", "activePlacementBlock.js"],
  ["engine", "pvPlacementEngine.js"],
];

const removedLegacyAssets = [
  ["phase3", "phase3Viewer.js"],
];

function copyAsset(parts) {
  const source = path.join(sourceRoot, ...parts);
  const target = path.join(targetRoot, ...parts);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`[sync-calpinage-legacy-assets] ${parts.join("/")} -> backend/calpinage-legacy-assets/`);
}

for (const asset of requiredAssets) {
  copyAsset(asset);
}

for (const asset of removedLegacyAssets) {
  const source = path.join(sourceRoot, ...asset);
  if (fs.existsSync(source)) {
    copyAsset(asset);
  } else {
    console.log(`[sync-calpinage-legacy-assets] skip removed legacy asset: ${asset.join("/")}`);
  }
}

console.log("[sync-calpinage-legacy-assets] OK");
