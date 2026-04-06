/**
 * Test final complet "Valider le calpinage" → JSON.
 * Vérifie que les sorties (geometry_json, final_json) respectent le schéma V1,
 * avec fixture multi-pente (2 pans, 6+4 panneaux), shading normalized, et non-régression.
 * Pas de modification des moteurs shading/production ni de l'UX.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildPremiumShadingExport } from "../export/buildShadingExport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "geometry-export-2pans.json");

/** Charge la fixture geometry (sortie buildGeometryForExport-like). */
function loadGeometryFixture() {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw);
}

/**
 * Dérive le "final_json" (ONE TRUE FINAL JSON shape) à partir d'un objet geometry export.
 * Même contrat que buildFinalCalpinageJSON() mais en pur JS à partir de la fixture.
 */
function deriveFinalFromGeometry(geometry) {
  if (!geometry || !geometry.validatedRoofData || !geometry.validatedRoofData.pans) {
    return null;
  }
  const vrd = geometry.validatedRoofData;
  const rawPans = vrd.pans || [];
  const safeNum = (v, fallback) =>
    typeof v === "number" && Number.isFinite(v) && !Number.isNaN(v) ? v : fallback ?? 0;

  const pansOfficial = rawPans.map((p) => ({
    id: p.id,
    azimuth: safeNum(p.azimuth, p.orientationDeg ?? 180),
    tilt: safeNum(p.tilt, p.tiltDeg ?? 0),
    panelCount: Math.max(0, Math.floor(safeNum(p.panelCount, 0))),
    surface: safeNum(p.surface, p.surfaceM2 ?? 0),
    geometryRef: p.geometryRef ?? p.id,
    shadingNearPct: safeNum(p.shadingNearPct, 0),
    shadingFarPct: safeNum(p.shadingFarPct, 0),
    shadingCombinedPct: safeNum(p.shadingCombinedPct, 0),
  }));

  const panels = [];
  (geometry.frozenBlocks || []).forEach((bl) => {
    (bl.panels || []).forEach((p, idx) => {
      panels.push({
        id: `${bl.id}_${idx}`,
        panId: bl.panId ?? null,
        position: p.center && typeof p.center === "object" ? { x: p.center.x, y: p.center.y } : null,
        orientation: bl.orientation ?? null,
        state: p.state ?? null,
      });
    });
  });

  const norm = geometry.shading || null;
  const shadingExport = buildPremiumShadingExport(norm);

  return {
    meta: {
      version: "calpinage_v1_final",
      generatedAt: new Date().toISOString(),
      engine: { shading: "near+far+HD", production: "multi-pan" },
    },
    roof: {
      scale: vrd.scale ?? null,
      north: vrd.north ?? null,
      pans: pansOfficial,
    },
    pans: pansOfficial,
    panels: panels,
    panelSpec: { module: "fixture" },
    shading: shadingExport,
    production: null,
  };
}

const TOLERANCE_PCT = 0.001;

describe("Calpinage final JSON — Validate → JSON (E2E schema)", () => {
  it("1) FINAL_JSON.meta.version === calpinage_v1_final", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    expect(finalJson).not.toBeNull();
    expect(finalJson.meta).toBeDefined();
    expect(finalJson.meta.version).toBe("calpinage_v1_final");
  });

  it("2) FINAL_JSON.pans.length === 2 (multi-pente)", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    expect(finalJson.pans.length).toBe(2);
    expect(finalJson.roof.pans.length).toBe(2);
  });

  it("3) panelCount total === 10 (6+4)", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    const total = finalJson.pans.reduce((s, p) => s + (p.panelCount || 0), 0);
    expect(total).toBe(10);
    expect(finalJson.panels.length).toBe(10);
  });

  it("4) shading.combined.totalLossPct présent et numérique", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    expect(finalJson.shading).toBeDefined();
    expect(finalJson.shading.combined).toBeDefined();
    const val = finalJson.shading.combined.totalLossPct;
    expect(typeof val).toBe("number");
    expect(Number.isNaN(val)).toBe(false);
  });

  it("5) shading.far.totalLossPct présent et numérique", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    expect(finalJson.shading.far).toBeDefined();
    const val = finalJson.shading.far.totalLossPct;
    expect(typeof val).toBe("number");
    expect(Number.isNaN(val)).toBe(false);
  });

  it("6) far source/coverage/confidence exposés si présents (export premium)", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    expect(finalJson.shading.source).toBeDefined();
    expect(finalJson.shading.confidence).toBeDefined();
    expect(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).toContain(finalJson.shading.confidence);
  });

  it("7) production: null en frontend (enrichi backend ensuite)", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    expect(finalJson.production).toBeNull();
  });

  it("8) perPanel lossPct au moins 10 entrées (fixture)", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    const perPanel = finalJson.shading?.perPanel;
    expect(Array.isArray(perPanel)).toBe(true);
    expect(perPanel.length).toBeGreaterThanOrEqual(10);
  });

  it("9) Non-régression mono-pan — 1 pan même structure", () => {
    const monoGeometry = {
      meta: loadGeometryFixture().meta,
      roofState: loadGeometryFixture().roofState,
      validatedRoofData: {
        scale: { metersPerPixel: 0.05 },
        north: 0,
        pans: [
          {
            id: "pan-1",
            geometryRef: "pan-1",
            azimuth: 180,
            tilt: 30,
            panelCount: 4,
            surface: 10,
            shadingNearPct: 2,
            shadingFarPct: 6,
            shadingCombinedPct: 4,
          },
        ],
      },
      shading: {
        near: { totalLossPct: 2 },
        far: { totalLossPct: 6, source: "RELIEF_ONLY" },
        combined: { totalLossPct: 4 },
        totalLossPct: 4,
        computedAt: new Date().toISOString(),
      },
      frozenBlocks: [
        {
          id: "block-1",
          panId: "pan-1",
          panels: [
            { center: { x: 0, y: 0 }, state: null },
            { center: { x: 1, y: 0 }, state: null },
            { center: { x: 0, y: 1 }, state: null },
            { center: { x: 1, y: 1 }, state: null },
          ],
          orientation: "PORTRAIT",
        },
      ],
    };
    const finalJson = deriveFinalFromGeometry(monoGeometry);
    expect(finalJson).not.toBeNull();
    expect(finalJson.pans.length).toBe(1);
    expect(finalJson.pans[0].panelCount).toBe(4);
    expect(finalJson.shading.combined.totalLossPct).toBe(4);
    const drift = Math.abs(finalJson.pans[0].shadingCombinedPct - 4) / 4;
    expect(drift).toBeLessThanOrEqual(TOLERANCE_PCT);
  });

  it("10) Pas de NaN ni undefined sur les clés officielles", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    const str = JSON.stringify(finalJson);
    const reloaded = JSON.parse(str);
    reloaded.pans.forEach((p) => {
      expect(Number.isNaN(p.azimuth)).toBe(false);
      expect(Number.isNaN(p.tilt)).toBe(false);
      expect(Number.isNaN(p.panelCount)).toBe(false);
      expect(Number.isNaN(p.surface)).toBe(false);
      expect(Number.isNaN(p.shadingCombinedPct)).toBe(false);
      expect(p.id).toBeDefined();
      expect(p.geometryRef).toBeDefined();
    });
    expect(reloaded.meta.version).toBe("calpinage_v1_final");
    expect(reloaded.shading.computedAt).toBeDefined();
  });

  it("11) Round-trip geometry → final → stringify → parse sans perte", () => {
    const geometry = loadGeometryFixture();
    const finalJson = deriveFinalFromGeometry(geometry);
    const str = JSON.stringify(finalJson);
    const back = JSON.parse(str);
    expect(back.pans.length).toBe(finalJson.pans.length);
    expect(back.panels.length).toBe(finalJson.panels.length);
    expect(back.meta.version).toBe(finalJson.meta.version);
  });
});
