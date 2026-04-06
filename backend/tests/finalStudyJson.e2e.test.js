/**
 * final_study_json — E2E validation industrielle
 * Vérifie que final_study_json contient 100% des infos, sans dérive, sans perte.
 * Usage: node tests/finalStudyJson.e2e.test.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildFinalStudyJson } from "../services/finalStudyJson.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "study-multipan-complete.json");
const SNAPSHOT_PATH = join(__dirname, "__snapshots__", "finalStudyJson.e2e.snap.json");

let passed = 0;
let failed = 0;
function ok(label) {
  console.log("✅ " + label);
  passed++;
}
function fail(label, msg) {
  console.log("❌ " + label + ": " + msg);
  failed++;
}
function assert(cond, label, msg) {
  if (cond) ok(label);
  else fail(label, msg || "assertion failed");
}

function loadFixture() {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw);
}

/** Normalise les champs ISO/date pour comparaison snapshot. */
function normalizeForSnapshot(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const o = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const k of Object.keys(o)) {
    if (k === "generatedAt" || k === "computed_at" || k === "computedAt") {
      if (typeof o[k] === "string") o[k] = "<ISO>";
    } else if (o[k] != null && typeof o[k] === "object") {
      o[k] = normalizeForSnapshot(o[k]);
    }
  }
  return o;
}

function hasUndefined(obj, path = "root") {
  if (obj === undefined) return [path];
  if (obj === null || typeof obj !== "object") return [];
  const out = [];
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) out.push(path + "." + k);
    else if (obj[k] != null && typeof obj[k] === "object" && !Array.isArray(obj[k])) {
      out.push(...hasUndefined(obj[k], path + "." + k));
    } else if (Array.isArray(obj[k])) {
      obj[k].forEach((item, i) => {
        if (item != null && typeof item === "object") out.push(...hasUndefined(item, path + "." + k + "[" + i + "]"));
      });
    }
  }
  return out;
}

function hasNaN(obj, path = "root") {
  if (typeof obj === "number" && Number.isNaN(obj)) return [path];
  if (obj === null || typeof obj !== "object") return [];
  const out = [];
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === "number" && Number.isNaN(obj[k])) out.push(path + "." + k);
    else if (obj[k] != null && typeof obj[k] === "object") out.push(...hasNaN(obj[k], path + "." + k));
    else if (Array.isArray(obj[k])) obj[k].forEach((item, i) => out.push(...hasNaN(item, path + "." + k + "[" + i + "]")));
  }
  return out;
}

(async () => {
  console.log("\n--- 1) Construction multi-pan (fixture complète) ---\n");
  const fixture = loadFixture();
  const calcResult = {
    summary: fixture.calc_result.summary,
    computed_at: fixture.calc_result.computed_at,
  };
  const finalStudyJson = buildFinalStudyJson({
    geometryJson: fixture.geometry_json,
    calcResult,
    production: fixture.production,
  });

  assert(finalStudyJson != null, "buildFinalStudyJson retourne un objet");
  if (!finalStudyJson) {
    console.log("Passed: " + passed + ", Failed: " + failed);
    process.exit(1);
  }

  assert(finalStudyJson.meta?.version === "study_v1_final", "meta.version === study_v1_final");
  assert(Array.isArray(finalStudyJson.geometry?.pans) && finalStudyJson.geometry.pans.length === 2, "geometry.pans.length === 2");
  assert(Array.isArray(finalStudyJson.production?.byPan) && finalStudyJson.production.byPan.length === 2, "production.byPan.length === 2");

  const sumByPan = (finalStudyJson.production.byPan || []).reduce((s, p) => s + (p.annualKwh || 0), 0);
  const annualKwh = finalStudyJson.production?.annualKwh;
  assert(typeof annualKwh === "number" && Math.abs(annualKwh - sumByPan) < 0.02, "production.annualKwh === somme(byPan[].annualKwh)");

  assert(finalStudyJson.shading?.combined?.totalLossPct != null && typeof finalStudyJson.shading.combined.totalLossPct === "number", "shading.combined.totalLossPct présent");
  assert(finalStudyJson.shading?.far?.source === "IGN_RGE_ALTI", "shading.far.source === IGN_RGE_ALTI");
  assert(finalStudyJson.shading?.confidence === "HIGH", "shading.confidence === HIGH");
  assert(Array.isArray(finalStudyJson.shading?.perPanel) && finalStudyJson.shading.perPanel.length === 10, "perPanel.length === 10");

  const undef = hasUndefined(finalStudyJson);
  assert(undef.length === 0, "aucun champ undefined", undef.join(", "));
  const nanPaths = hasNaN(finalStudyJson);
  assert(nanPaths.length === 0, "aucun NaN", nanPaths.join(", "));

  assert(finalStudyJson.hardware != null && typeof finalStudyJson.hardware === "object", "hardware présent");
  assert(finalStudyJson.electrical != null && typeof finalStudyJson.electrical === "object", "electrical présent");
  assert(finalStudyJson.electrical.totalPanels === 10, "electrical.totalPanels === 10");
  assert(!Number.isNaN(finalStudyJson.electrical.totalDcKw), "electrical.totalDcKw pas NaN");
  const hwUndef = hasUndefined(finalStudyJson.hardware);
  assert(hwUndef.length === 0, "hardware sans undefined", hwUndef.join(", "));
  const elUndef = hasUndefined(finalStudyJson.electrical);
  assert(elUndef.length === 0, "electrical sans undefined", elUndef.join(", "));

  console.log("\n--- 2) Non-régression mono-pan (1 pan) ---\n");
  const monoGeometry = {
    ...fixture.geometry_json,
    validatedRoofData: {
      scale: fixture.geometry_json.validatedRoofData.scale,
      north: 0,
      pans: [fixture.geometry_json.validatedRoofData.pans[0]],
    },
    frozenBlocks: [fixture.geometry_json.frozenBlocks[0]],
    shading: {
      ...fixture.geometry_json.shading,
      perPanel: fixture.geometry_json.shading.perPanel.slice(0, 6),
    },
  };
  const monoProduction = {
    byPan: [fixture.production.byPan[0]],
    annualKwh: fixture.production.byPan[0].annualKwh,
    monthlyKwh: fixture.production.byPan[0].monthlyKwh,
  };
  const finalMono = buildFinalStudyJson({
    geometryJson: monoGeometry,
    calcResult: { summary: fixture.calc_result.summary, computed_at: fixture.calc_result.computed_at },
    production: monoProduction,
  });
  assert(finalMono != null, "mono-pan build non null");
  assert(finalMono?.production?.byPan?.length === 1, "byPan.length === 1 (mono)");
  assert(finalMono?.geometry?.pans?.length === 1, "geometry.pans.length === 1 (mono)");
  const monoAnnual = finalMono?.production?.annualKwh ?? 0;
  const expectedMono = monoProduction.annualKwh;
  const tolerancePct = 0.001;
  const drift = Math.abs(monoAnnual - expectedMono) / (expectedMono || 1);
  assert(drift <= tolerancePct, "mono-pan annualKwh stable (tolérance 0.1%)");

  console.log("\n--- 3) Cohérence interne ---\n");
  const totalPanelCount = (finalStudyJson.geometry?.pans || []).reduce((s, p) => s + (p.panelCount || 0), 0);
  assert(totalPanelCount === 10, "somme panelCount === 10");
  assert((finalStudyJson.production?.monthlyKwh || []).length === 12, "monthlyKwh.length === 12");
  const monthly = finalStudyJson.production?.monthlyKwh || [];
  assert(monthly.every((v) => typeof v === "number" && v >= 0), "monthlyKwh[i] >= 0");
  const nearPct = finalStudyJson.shading?.near?.totalLossPct ?? 0;
  const farPct = finalStudyJson.shading?.far?.totalLossPct ?? 0;
  const combinedPct = finalStudyJson.shading?.combined?.totalLossPct ?? 0;
  assert(combinedPct >= 0 && combinedPct <= 100, "shadingCombinedPct dans [0,100]");
  assert(Math.min(nearPct, farPct) - 2 <= combinedPct && combinedPct <= Math.max(nearPct, farPct) + 2, "shadingCombinedPct cohérent avec near/far (marge 2%)");
  assert(finalStudyJson.geometry?.meta?.version === "calpinage_v1_final", "geometry.meta.version === calpinage_v1_final");

  console.log("\n--- 4) Snapshot final ---\n");
  const normalized = normalizeForSnapshot(JSON.parse(JSON.stringify(finalStudyJson)));
  if (existsSync(SNAPSHOT_PATH)) {
    const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
    const snapStr = JSON.stringify(snap, null, 2);
    const currentStr = JSON.stringify(normalized, null, 2);
    assert(snapStr === currentStr, "structure figée (snapshot inchangée)");
  } else {
    const dir = dirname(SNAPSHOT_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(normalized, null, 2), "utf-8");
    ok("snapshot écrite: " + SNAPSHOT_PATH);
  }

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
})();
