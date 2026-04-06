/**
 * E2E critique — persistance calpinage / shading (chemin produit réel sans DB ni navigateur).
 *
 * Reproduit les transformations de :
 * - POST upsert (schemaVersion, adaptLegacyShadingToV2, mergeLayoutSnapshotForUpsert)
 * - GET calpinage (getNormalizedShadingFromGeometry sur geometry_json.shading)
 *
 * Scénarios couverts :
 * 1) Persistance logique multipan : panneaux + shading stables après save/read
 * 2) Shading officiel : combined.totalLossPct + miroir cohérents après round-trip
 * 3) layout_snapshot : non écrasé si absent du payload (comme après validate)
 * 4) Boucle reload : normalisation idempotente (plusieurs lectures GET)
 * 5) Modification géométrique : comptage panneaux cohérent après changement
 * 6) Recalcul moteur : deux computes successifs → structure shading valide
 *
 * Usage: cd backend && node tests/calpinage-persist-shading-critical.e2e.test.js
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { V2_SCHEMA_VERSION } from "../services/calpinage/calpinageShadingNormalizer.js";
import { adaptLegacyShadingToV2, getNormalizedShadingFromGeometry } from "../services/calpinage/calpinageShadingLegacyAdapter.js";
import { mergeLayoutSnapshotForUpsert } from "../services/calpinage/mergeGeometryLayoutSnapshot.js";
import { resolveShadingTotalLossPct } from "../services/shading/resolveShadingTotalLossPct.js";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { buildStructuredShading, hasPanelsInGeometry } from "../services/shading/shadingStructureBuilder.js";
import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "study-multipan-complete.json");

let passed = 0;
let failed = 0;

function ok(label) {
  console.log("  ✅ " + label);
  passed++;
}
function fail(label, msg) {
  console.log("  ❌ " + label + (msg ? ": " + msg : ""));
  failed++;
}
function assert(cond, label, detail) {
  if (cond) ok(label);
  else fail(label, detail || "");
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function countFrozenPanels(geom) {
  const blocks = geom?.frozenBlocks || [];
  return blocks.reduce((s, b) => s + (Array.isArray(b.panels) ? b.panels.length : 0), 0);
}

/** Miroir POST /calpinage (sans transaction ni hash / invalidation snapshot). */
function simulateCalpinagePostSave(geometryJson, existingGeometryJson = null) {
  const toSave = deepClone(geometryJson);
  if (!toSave.schemaVersion) toSave.schemaVersion = V2_SCHEMA_VERSION;
  if (toSave.shading && typeof toSave.shading === "object") {
    toSave.shading = adaptLegacyShadingToV2(toSave.shading, toSave.schemaVersion);
  }
  return mergeLayoutSnapshotForUpsert(toSave, existingGeometryJson);
}

/** Miroir GET /calpinage (normalisation shading à la lecture). */
function simulateCalpinageGet(geometryJson) {
  const gj = deepClone(geometryJson);
  if (gj.shading && typeof gj.shading === "object") {
    const { shading } = getNormalizedShadingFromGeometry(gj);
    return { ...gj, shading };
  }
  return gj;
}

function assertOfficialShadingShape(shading, label) {
  assert(shading && typeof shading === "object", `${label} shading objet`);
  assert(shading.combined && Object.prototype.hasOwnProperty.call(shading.combined, "totalLossPct"), `${label} combined.totalLossPct présent`);
  const c = shading.combined.totalLossPct;
  assert(c == null || (typeof c === "number" && Number.isFinite(c)), `${label} combined.totalLossPct nombre ou null`);
  assert(shading.near && typeof shading.near.totalLossPct === "number", `${label} near.totalLossPct nombre`);
  assert(shading.far && typeof shading.far === "object", `${label} far objet`);
}

(async () => {
  console.log("\n=== E2E critique calpinage / shading (pipeline save → read) ===\n");

  const fixtureFile = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  const geometryJson = fixtureFile.geometry_json;
  const initialPanels = countFrozenPanels(geometryJson);
  const initialCombined = geometryJson.shading?.combined?.totalLossPct;

  console.log("--- Scénario 1 — Persistance multipan (fixture réelle) ---");
  assert(initialPanels === 10, "fixture : 10 panneaux frozenBlocks");
  const savedOnce = simulateCalpinagePostSave(geometryJson, null);
  assert(countFrozenPanels(savedOnce) === initialPanels, "post-save : même nombre de panneaux");
  const afterRead = simulateCalpinageGet(savedOnce);
  assert(countFrozenPanels(afterRead) === initialPanels, "get : même nombre de panneaux");
  assert(Array.isArray(afterRead.frozenBlocks) && afterRead.frozenBlocks.length === 2, "frozenBlocks toujours 2 blocs");

  console.log("\n--- Scénario 2 — Shading officiel stable (combined + resolve) ---");
  assertOfficialShadingShape(afterRead.shading, "après 1× post + 1× get");
  const resolved = resolveShadingTotalLossPct(afterRead.shading, {});
  assert(
    resolved != null && Math.abs(resolved - Number(initialCombined)) < 0.001,
    "resolve === combined fixture initial (pas de dérive round-trip)",
    `obtenu resolve=${resolved} vs combined initial=${initialCombined}`
  );
  if (afterRead.shading.totalLossPct != null && afterRead.shading.combined?.totalLossPct != null) {
    assert(
      Math.abs(Number(afterRead.shading.totalLossPct) - Number(afterRead.shading.combined.totalLossPct)) < 0.02,
      "miroir totalLossPct racine ≈ combined après normalisation"
    );
  }

  console.log("\n--- Scénario 3 — layout_snapshot préservé (flux save / validate) ---");
  const snap = "data:image/png;base64,CRITICAL_E2E_STUB";
  const existingWithSnap = { ...savedOnce, layout_snapshot: snap };
  const incomingNoSnap = deepClone(savedOnce);
  delete incomingNoSnap.layout_snapshot;
  const mergedSnap = mergeLayoutSnapshotForUpsert(incomingNoSnap, existingWithSnap);
  assert(mergedSnap.layout_snapshot === snap, "snapshot existant recopié si payload sans snapshot");

  console.log("\n--- Scénario 4 — Reload idempotent (3× lecture GET) ---");
  let g = afterRead;
  for (let i = 0; i < 3; i++) {
    g = simulateCalpinageGet(g);
  }
  assert(countFrozenPanels(g) === initialPanels, "panneaux stables après 3 GET");
  assert(
    Math.abs(Number(g.shading.combined.totalLossPct) - Number(initialCombined)) < 0.001,
    "combined.totalLossPct stable après 3 GET"
  );

  console.log("\n--- Scénario 5 — Modification géométrique (retrait 1 panneau) ---");
  const modified = deepClone(savedOnce);
  modified.frozenBlocks[0].panels.pop();
  assert(countFrozenPanels(modified) === 9, "9 panneaux après retrait");
  const savedMod = simulateCalpinagePostSave(modified, null);
  const readMod = simulateCalpinageGet(savedMod);
  assert(countFrozenPanels(readMod) === 9, "reload reflète 9 panneaux");
  assertOfficialShadingShape(readMod.shading, "shading structurelle encore valide (valeurs peuvent être obsolètes métier)");

  console.log("\n--- Scénario 6 — Recalcul shading moteur (2 passes, géométrie simple) ---");
  const square = [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ];
  const baseGeom = {
    roofState: {
      scale: { metersPerPixel: 0.1 },
      gps: { lat: 48.8566, lon: 2.3522 },
      obstacles: [],
    },
    frozenBlocks: [
      {
        id: "blk1",
        panId: "pan1",
        panels: [{ id: "p1", polygonPx: square }],
      },
    ],
  };

  const runCompute = async (geom) => {
    const r = await computeCalpinageShading({ lat: 48.8566, lon: 2.3522, geometry: geom });
    const hasP = hasPanelsInGeometry(geom);
    const raw = buildStructuredShading(r, true, hasP, {});
    const meta = r.farMetadata
      ? {
          step_deg: r.farMetadata.step_deg,
          resolution_m: r.farMetadata.resolution_m,
          algorithm: r.farMetadata.meta?.algorithm,
        }
      : {};
    return normalizeCalpinageShading(raw, meta);
  };

  const norm1 = await runCompute(deepClone(baseGeom));
  assertOfficialShadingShape(norm1, "compute #1");
  assert(
    typeof norm1.combined.totalLossPct === "number" && norm1.combined.totalLossPct >= 0 && norm1.combined.totalLossPct <= 100,
    "compute #1 combined dans [0,100]"
  );

  const geom2 = deepClone(baseGeom);
  geom2.roofState.obstacles = [
    {
      id: "obs1",
      points: [
        { x: 55, y: 55 },
        { x: 58, y: 55 },
        { x: 58, y: 58 },
        { x: 55, y: 58 },
      ],
      heightM: 2,
    },
  ];
  const norm2 = await runCompute(geom2);
  assertOfficialShadingShape(norm2, "compute #2 avec obstacle");
  assert(
    typeof norm2.combined.totalLossPct === "number" && norm2.combined.totalLossPct >= 0 && norm2.combined.totalLossPct <= 100,
    "compute #2 combined dans [0,100]"
  );

  console.log("\n--- Scénario 7 — far.horizonMeta + source HTTP_GEOTIFF conservés POST → GET ---");
  const geomTrace = deepClone(savedOnce);
  const prevFar = geomTrace.shading?.far && typeof geomTrace.shading.far === "object" ? geomTrace.shading.far : {};
  geomTrace.shading = {
    ...geomTrace.shading,
    far: {
      ...prevFar,
      source: "HTTP_GEOTIFF",
      farHorizonKind: "REAL_TERRAIN",
      totalLossPct: typeof prevFar.totalLossPct === "number" ? prevFar.totalLossPct : 2,
      dataCoverage: {
        provider: "HTTP_GEOTIFF",
        gridResolutionMeters: 10,
        effectiveRadiusMeters: 500,
        ratio: 1,
      },
      horizonMeta: { requestedSurfaceProvider: "HTTP_GEOTIFF", fallbackReason: null },
    },
    shadingQuality: {
      ...(geomTrace.shading?.shadingQuality && typeof geomTrace.shading.shadingQuality === "object"
        ? geomTrace.shading.shadingQuality
        : {}),
      provider: "HTTP_GEOTIFF",
      farHorizonKind: "REAL_TERRAIN",
      modelType: "DSM",
    },
  };
  const savedTrace = simulateCalpinagePostSave(geomTrace, null);
  const readTrace = simulateCalpinageGet(savedTrace);
  assert(readTrace.shading?.far?.source === "HTTP_GEOTIFF", "round-trip far.source HTTP_GEOTIFF");
  assert(
    readTrace.shading?.far?.horizonMeta?.requestedSurfaceProvider === "HTTP_GEOTIFF",
    "round-trip far.horizonMeta.requestedSurfaceProvider"
  );
  assert(
    readTrace.shading?.far?.dataCoverage?.provider === "HTTP_GEOTIFF",
    "round-trip far.dataCoverage.provider"
  );

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) {
    console.log("\n❌ E2E critique FAIL\n");
    process.exit(1);
  }
  console.log("\n✅ E2E critique PASS\n");
  process.exit(0);
})();
