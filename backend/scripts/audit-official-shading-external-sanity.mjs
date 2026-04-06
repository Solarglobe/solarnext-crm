/**
 * Audit reproductible : chaîne officielle (computeCalpinageShading + buildOfficialShadingFromComputeResult)
 * identique à computeOfficialShading, avec masques synthétiques / fixture — sans DSM live.
 *
 * Usage (depuis backend/) : node scripts/audit-official-shading-external-sanity.mjs
 * Ne modifie pas le moteur ; sortie JSON sur stdout.
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { buildOfficialShadingFromComputeResult } from "../services/calpinage/officialShading.service.js";
import { hasPanelsInGeometry } from "../services/shading/shadingStructureBuilder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LAT_PARIS = 48.8566;
const LON_PARIS = 2.3522;

const MINIMAL_PANEL = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

const geometryMinimal = { frozenBlocks: [{ panels: [MINIMAL_PANEL] }] };

const baseDataCoverage = {
  mode: "RELIEF_ONLY",
  available: true,
  coveragePct: 1,
  ratio: 1,
  gridResolutionMeters: 25,
  provider: "RELIEF_ONLY",
};

function buildMaskFlat0() {
  const mask = [];
  for (let i = 0; i < 180; i++) mask.push({ az: i * 2, elev: 0 });
  return {
    mask,
    source: "RELIEF_ONLY",
    radius_m: 500,
    step_deg: 2,
    resolution_m: 25,
    dataCoverage: baseDataCoverage,
  };
}

function buildMaskVilleDense() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    const elev = az >= 90 && az <= 270 ? 18 : 4;
    mask.push({ az, elev });
  }
  return {
    mask,
    source: "SURFACE_DSM",
    radius_m: 500,
    step_deg: 2,
    resolution_m: 10,
    dataCoverage: {
      ...baseDataCoverage,
      mode: "SURFACE_DSM",
      gridResolutionMeters: 10,
      provider: "HTTP_GEOTIFF",
    },
  };
}

function buildMaskImmeubleSud() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    const elev = az >= 150 && az <= 210 ? 45 : 1;
    mask.push({ az, elev });
  }
  return {
    mask,
    source: "SURFACE_DSM",
    radius_m: 500,
    step_deg: 2,
    resolution_m: 5,
    dataCoverage: {
      ...baseDataCoverage,
      mode: "SURFACE_DSM",
      gridResolutionMeters: 5,
      provider: "HTTP_GEOTIFF",
    },
  };
}

function buildMaskArbreEst() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    const elev = az >= 60 && az <= 120 ? 12 : 0;
    mask.push({ az, elev });
  }
  return {
    mask,
    source: "SURFACE_DSM",
    radius_m: 500,
    step_deg: 2,
    resolution_m: 10,
    dataCoverage: {
      ...baseDataCoverage,
      mode: "SURFACE_DSM",
      gridResolutionMeters: 10,
      provider: "HTTP_GEOTIFF",
    },
  };
}

/**
 * Même assemblage que computeOfficialShading + options de test (masque).
 */
async function runOfficialPipeline({ lat, lon, geometry, options = {} }) {
  const shadingResult = await computeCalpinageShading({
    lat,
    lon,
    geometry,
    options: { includePerPanelBreakdown: true, ...options },
  });
  const hasGps =
    lat != null &&
    lon != null &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;
  const hasPanels = hasPanelsInGeometry(geometry);
  return {
    official: buildOfficialShadingFromComputeResult(shadingResult, hasGps, hasPanels),
    raw: {
      farLossPct: shadingResult.farLossPct,
      nearLossPct: shadingResult.nearLossPct,
      totalLossPct: shadingResult.totalLossPct,
    },
  };
}

function slimOfficial(o) {
  if (!o) return null;
  return {
    totalLossPct: o.totalLossPct,
    near: o.near?.totalLossPct,
    far: o.far?.totalLossPct,
    combined: o.combined?.totalLossPct,
    perPanelCount: Array.isArray(o.perPanel) ? o.perPanel.length : 0,
    perPanel0: o.perPanel?.[0]?.lossPct ?? null,
  };
}

(async () => {
  const rows = [];

  const r1 = await runOfficialPipeline({
    lat: LAT_PARIS,
    lon: LON_PARIS,
    geometry: geometryMinimal,
    options: { __testHorizonMaskOverride: buildMaskFlat0() },
  });
  rows.push({ id: "S1", label: "Horizon plat (0°) — campagne", ...slimOfficial(r1.official) });

  const r2 = await runOfficialPipeline({
    lat: LAT_PARIS,
    lon: LON_PARIS,
    geometry: geometryMinimal,
    options: { __testHorizonMaskOverride: buildMaskVilleDense() },
  });
  rows.push({ id: "S2", label: "Synth. ville dense (élévation sud)", ...slimOfficial(r2.official) });

  const r3 = await runOfficialPipeline({
    lat: LAT_PARIS,
    lon: LON_PARIS,
    geometry: geometryMinimal,
    options: { __testHorizonMaskOverride: buildMaskImmeubleSud() },
  });
  rows.push({ id: "S3", label: "Synth. immeuble plein sud (~45°)", ...slimOfficial(r3.official) });

  const r4 = await runOfficialPipeline({
    lat: LAT_PARIS,
    lon: LON_PARIS,
    geometry: geometryMinimal,
    options: { __testHorizonMaskOverride: buildMaskArbreEst() },
  });
  rows.push({ id: "S4", label: "Synth. obstacle à l’est (arbre)", ...slimOfficial(r4.official) });

  const fixturePath = path.join(__dirname, "../tests/fixtures/horizonMasks/ign_like_step1_hd.json");
  const ignFixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const r5 = await runOfficialPipeline({
    lat: ignFixture.lat,
    lon: ignFixture.lon,
    geometry: geometryMinimal,
    options: { __testHorizonMaskOverride: ignFixture.horizonMask },
  });
  rows.push({
    id: "S5",
    label: "Fixture interne relief IGN-like (45°N, step1 HD)",
    ...slimOfficial(r5.official),
  });

  const geometryNear = {
    frozenBlocks: [
      {
        panels: [
          {
            id: "p1",
            polygon: [
              { x: 100, y: 160 },
              { x: 200, y: 160 },
              { x: 200, y: 220 },
              { x: 100, y: 220 },
            ],
          },
        ],
      },
    ],
    roofState: {
      obstacles: [
        {
          id: "obs1",
          points: [
            { x: 100, y: 80 },
            { x: 320, y: 80 },
            { x: 320, y: 130 },
            { x: 100, y: 130 },
          ],
          heightM: 3,
        },
      ],
    },
  };

  const r6 = await runOfficialPipeline({
    lat: LAT_PARIS,
    lon: LON_PARIS,
    geometry: geometryNear,
    options: { __testHorizonMaskOverride: buildMaskFlat0() },
  });
  rows.push({
    id: "S6",
    label: "Obstacle proche (bande au nord) + horizon plat",
    ...slimOfficial(r6.official),
  });

  const out = {
    generatedAt: new Date().toISOString(),
    pipeline: "computeCalpinageShading + buildOfficialShadingFromComputeResult (équivalent computeOfficialShading)",
    note: "Masques synthétiques ou fixture repo — aucun appel DSM réseau.",
    cases: rows,
  };

  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
