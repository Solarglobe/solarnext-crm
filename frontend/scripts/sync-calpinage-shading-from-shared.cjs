/**
 * Synchronise shared/shading/* → frontend/calpinage/shading/*.js et public (near).
 * Les .js calpinage shading (solarPosition, horizonMaskSampler, shadingEngine) ne doivent pas être édités à la main.
 * Voir docs/shading-governance.md
 */
const fs = require("fs");
const path = require("path");

const frontendRoot = path.join(__dirname, "..");
const sharedRoot = path.join(frontendRoot, "..", "shared", "shading");
const calpinageShading = path.join(frontendRoot, "calpinage", "shading");
const legacyAssetsShading = path.join(frontendRoot, "..", "backend", "calpinage-legacy-assets", "shading");

/** Préfixe obligatoire des artefacts .js synchronisés (verify le retire avant comparaison à shared). */
const SHADING_SYNC_BANNER =
  "/* === SHADING_SYNC_GENERATED_BEGIN ===\n" +
  " * NE PAS MODIFIER À LA MAIN — source : shared/shading/\n" +
  " * Gouvernance : docs/shading-governance.md\n" +
  " * Régénérer : npm run sync:calpinage-shading-from-shared\n" +
  " * === SHADING_SYNC_GENERATED_END ===\n" +
  " */\n\n";

function shadingEngineSourceForFrontend(coreSrc) {
  return coreSrc
    .replace(/require\("\.\/solarPosition\.cjs"\)/g, 'require("./solarPosition")')
    .replace(/require\("\.\/horizonMaskSampler\.cjs"\)/g, 'require("./horizonMaskSampler")');
}

function writeGeneratedJs(dest, bodyUtf8) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, SHADING_SYNC_BANNER + bodyUtf8, "utf8");
}

function copyExact(src, dest) {
  if (!fs.existsSync(src)) {
    console.error("[sync-calpinage-shading] Manque:", src);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// 1) near (navigateur + Node) → backend legacy + frontend/calpinage (Vite bypass dev)
const nearSrc = path.join(sharedRoot, "nearShadingCore.cjs");
const nearDest = path.join(legacyAssetsShading, "nearShadingCore.cjs");
copyExact(nearSrc, nearDest);
console.log("[sync-calpinage-shading] nearShadingCore.cjs → backend/calpinage-legacy-assets/shading/");
const nearDestFront = path.join(calpinageShading, "nearShadingCore.cjs");
copyExact(nearSrc, nearDestFront);
console.log("[sync-calpinage-shading] nearShadingCore.cjs → calpinage/shading/ (bundle navigateur, pas de stub require)");

// 2) solarPosition (+ bannière « ne pas éditer »)
writeGeneratedJs(
  path.join(calpinageShading, "solarPosition.js"),
  fs.readFileSync(path.join(sharedRoot, "solarPosition.cjs"), "utf8")
);
console.log("[sync-calpinage-shading] solarPosition.cjs → calpinage/shading/solarPosition.js");

// 3) horizonMaskSampler
writeGeneratedJs(
  path.join(calpinageShading, "horizonMaskSampler.js"),
  fs.readFileSync(path.join(sharedRoot, "horizonMaskSampler.cjs"), "utf8")
);
console.log("[sync-calpinage-shading] horizonMaskSampler.cjs → calpinage/shading/horizonMaskSampler.js");

// 4) shadingEngine (transform requires pour résolution Node côté calpinage/)
const engineCorePath = path.join(sharedRoot, "shadingEngineCore.cjs");
const coreSrc = fs.readFileSync(engineCorePath, "utf8");
const frontEngine = shadingEngineSourceForFrontend(coreSrc);
writeGeneratedJs(path.join(calpinageShading, "shadingEngine.js"), frontEngine);
console.log("[sync-calpinage-shading] shadingEngineCore.cjs → calpinage/shading/shadingEngine.js (requires adaptés)");

// 5) copies backend/calpinage-legacy-assets pour scripts legacy (servis avec JWT / renderToken)
copyExact(path.join(calpinageShading, "shadingEngine.js"), path.join(legacyAssetsShading, "shadingEngine.js"));
copyExact(path.join(calpinageShading, "solarPosition.js"), path.join(legacyAssetsShading, "solarPosition.js"));
copyExact(path.join(calpinageShading, "horizonMaskSampler.js"), path.join(legacyAssetsShading, "horizonMaskSampler.js"));
console.log("[sync-calpinage-shading] shadingEngine.js, solarPosition.js, horizonMaskSampler.js → backend/calpinage-legacy-assets/shading/");

console.log("[sync-calpinage-shading] OK");
