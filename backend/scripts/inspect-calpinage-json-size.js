/**
 * CALPINAGE-DATA-FINAL-LOCK — Inspection taille JSON calpinage_data
 * Mesure: taille en bytes, vérifie < 50KB, absence de tableaux énormes.
 * Usage: node backend/scripts/inspect-calpinage-json-size.js
 */

import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { buildStructuredShading, hasPanelsInGeometry } from "../services/shading/shadingStructureBuilder.js";

const MAX_SIZE_BYTES = 50 * 1024; // 50 KB

function countArrays(obj) {
  let count = 0;
  let maxLen = 0;
  if (Array.isArray(obj)) {
    count = 1;
    maxLen = obj.length;
    for (const v of obj) {
      const r = countArrays(v);
      count += r.count;
      maxLen = Math.max(maxLen, r.maxLen);
    }
    return { count, maxLen };
  }
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) {
      const r = countArrays(v);
      count += r.count;
      maxLen = Math.max(maxLen, r.maxLen);
    }
  }
  return { count, maxLen };
}

const panel = { id: "p1", polygon: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }, { x: 50, y: 60 }] };
const geometry = { frozenBlocks: [{ panels: [panel] }] };

(async () => {
  const shadingResult = await computeCalpinageShading({ lat: 48.8566, lon: 2.3522, geometry });
  const hasPanels = hasPanelsInGeometry(geometry);
  const rawShading = buildStructuredShading(shadingResult, true, hasPanels, {});
  const meta = shadingResult.farMetadata
    ? { step_deg: shadingResult.farMetadata.step_deg, resolution_m: shadingResult.farMetadata.resolution_m, algorithm: shadingResult.farMetadata.meta?.algorithm }
    : {};
  const shading = normalizeCalpinageShading(rawShading, meta);

  const calpinageData = { schemaVersion: "v2", shading };
  const json = JSON.stringify(calpinageData);
  const sizeBytes = Buffer.byteLength(json, "utf8");
  const { count: arrayCount, maxLen } = countArrays(calpinageData);

  console.log("--- CALPINAGE JSON SIZE ---");
  console.log("Taille (bytes):", sizeBytes);
  console.log("Taille (KB):", (sizeBytes / 1024).toFixed(2));
  console.log("Nombre tableaux:", arrayCount);
  console.log("Longueur max tableau:", maxLen);
  console.log("Limite 50 KB:", sizeBytes <= MAX_SIZE_BYTES ? "OK" : "DÉPASSÉE");

  if (sizeBytes > MAX_SIZE_BYTES) {
    console.error("\n❌ Taille > 50 KB interdit");
    process.exit(1);
  }
  if (maxLen > 1000) {
    console.error("\n❌ Tableau énorme détecté (len > 1000)");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
})();
