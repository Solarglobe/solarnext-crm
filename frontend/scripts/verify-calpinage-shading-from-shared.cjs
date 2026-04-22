/**
 * Échoue si les artefacts calpinage shading ne sont pas alignés sur shared/shading (octets ou transform).
 * Doit rester aligné avec sync-calpinage-shading-from-shared.cjs (bannière SHADING_SYNC_*).
 */
const fs = require("fs");
const path = require("path");

const frontendRoot = path.join(__dirname, "..");
const sharedRoot = path.join(frontendRoot, "..", "shared", "shading");
const calpinageShading = path.join(frontendRoot, "calpinage", "shading");
const legacyAssetsShading = path.join(frontendRoot, "..", "backend", "calpinage-legacy-assets", "shading");

// Bannière sync : du début du commentaire bloc jusqu’au premier fermant (inclus).
const BANNER_RE = /^\/\* === SHADING_SYNC_GENERATED_BEGIN ===[\s\S]*?\*\/\s*/;

function stripShadingSyncBanner(s) {
  return String(s).replace(BANNER_RE, "");
}

function shadingEngineSourceForFrontend(coreSrc) {
  return coreSrc
    .replace(/require\("\.\/solarPosition\.cjs"\)/g, 'require("./solarPosition")')
    .replace(/require\("\.\/horizonMaskSampler\.cjs"\)/g, 'require("./horizonMaskSampler")');
}

function mustEqualBytes(label, aPath, bPath) {
  if (!fs.existsSync(aPath)) {
    console.error("[verify-calpinage-shading] Manque:", aPath);
    process.exit(1);
  }
  if (!fs.existsSync(bPath)) {
    console.error("[verify-calpinage-shading] Manque:", bPath, "→ npm run sync:calpinage-shading-from-shared");
    process.exit(1);
  }
  const a = fs.readFileSync(aPath);
  const b = fs.readFileSync(bPath);
  if (a.length !== b.length || Buffer.compare(a, b) !== 0) {
    console.error("[verify-calpinage-shading] DIVERGENCE:", label);
    process.exit(1);
  }
  console.log("[verify-calpinage-shading] OK", label, "(" + a.length, "octets)");
}

const corePath = path.join(sharedRoot, "shadingEngineCore.cjs");
const expectedFront = shadingEngineSourceForFrontend(fs.readFileSync(corePath, "utf8"));
const actualFront = stripShadingSyncBanner(fs.readFileSync(path.join(calpinageShading, "shadingEngine.js"), "utf8"));
if (expectedFront !== actualFront) {
  console.error("[verify-calpinage-shading] DIVERGENCE: shadingEngine.js ≠ transform(shadingEngineCore.cjs)");
  process.exit(1);
}
console.log("[verify-calpinage-shading] OK shadingEngine (transform)");

function mustEqualUtf8(label, expectedUtf8, actualPath) {
  if (!fs.existsSync(actualPath)) {
    console.error("[verify-calpinage-shading] Manque:", actualPath);
    process.exit(1);
  }
  const actual = stripShadingSyncBanner(fs.readFileSync(actualPath, "utf8"));
  if (actual !== expectedUtf8) {
    console.error("[verify-calpinage-shading] DIVERGENCE:", label);
    process.exit(1);
  }
  console.log("[verify-calpinage-shading] OK", label, "(" + Buffer.byteLength(actual, "utf8"), "octets contenu)");
}

mustEqualUtf8("solarPosition", fs.readFileSync(path.join(sharedRoot, "solarPosition.cjs"), "utf8"), path.join(calpinageShading, "solarPosition.js"));
mustEqualUtf8("horizonMaskSampler", fs.readFileSync(path.join(sharedRoot, "horizonMaskSampler.cjs"), "utf8"), path.join(calpinageShading, "horizonMaskSampler.js"));
mustEqualBytes("nearShadingCore legacy-assets", path.join(sharedRoot, "nearShadingCore.cjs"), path.join(legacyAssetsShading, "nearShadingCore.cjs"));

mustEqualBytes("shadingEngine legacy-assets", path.join(calpinageShading, "shadingEngine.js"), path.join(legacyAssetsShading, "shadingEngine.js"));
mustEqualBytes("solarPosition legacy-assets", path.join(calpinageShading, "solarPosition.js"), path.join(legacyAssetsShading, "solarPosition.js"));
mustEqualBytes("horizonMaskSampler legacy-assets", path.join(calpinageShading, "horizonMaskSampler.js"), path.join(legacyAssetsShading, "horizonMaskSampler.js"));

console.log("[verify-calpinage-shading] Tout aligné.");
