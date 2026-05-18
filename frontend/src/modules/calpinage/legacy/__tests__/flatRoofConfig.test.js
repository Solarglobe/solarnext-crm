/**
 * Tests unitaires — flatRoofConfig.js
 *
 * Avantage clé de l'extraction : ces fonctions pures peuvent maintenant être
 * testées directement, sans monter le module calpinage complet.
 */
import { describe, it, expect } from "vitest";
import {
  FLAT_ROOF_ROW_SPACING_CM,
  FLAT_ROOF_ROW_SPACING_MM,
  normalizeFlatRoofConfig,
  getAutoRowSpacingCmFromTilt,
} from "../flatRoofConfig.js";

// ── Constantes ─────────────────────────────────────────────────────────────────

describe("FLAT_ROOF_ROW_SPACING_CM", () => {
  it("vaut 55", () => {
    expect(FLAT_ROOF_ROW_SPACING_CM).toBe(55);
  });
});

describe("FLAT_ROOF_ROW_SPACING_MM", () => {
  it("vaut 550 (= CM × 10)", () => {
    expect(FLAT_ROOF_ROW_SPACING_MM).toBe(FLAT_ROOF_ROW_SPACING_CM * 10);
  });
});

// ── normalizeFlatRoofConfig ────────────────────────────────────────────────────

describe("normalizeFlatRoofConfig", () => {
  it("retourne les defaults sur null", () => {
    const r = normalizeFlatRoofConfig(null);
    expect(r.supportTiltDeg).toBe(10);
    expect(r.layoutOrientation).toBe("portrait");
    expect(r.setbackRoofEdgeCm).toBe(60);
    expect(r.setbackObstacleCm).toBe(60);
    expect(r.rowSpacingCm).toBe(55);
    expect(r.rowSpacingMm).toBe(550);
    expect(r.colSpacingCm).toBe(2);
    expect(r.rowSpacingManual).toBe(false);
  });

  it("retourne les defaults sur undefined", () => {
    const r = normalizeFlatRoofConfig(undefined);
    expect(r.supportTiltDeg).toBe(10);
    expect(r.layoutOrientation).toBe("portrait");
  });

  it("retourne les defaults sur objet vide", () => {
    const r = normalizeFlatRoofConfig({});
    expect(r.supportTiltDeg).toBe(10);
    expect(r.layoutOrientation).toBe("portrait");
  });

  it("accepte supportTiltDeg=5", () => {
    expect(normalizeFlatRoofConfig({ supportTiltDeg: 5 }).supportTiltDeg).toBe(5);
  });

  it("accepte supportTiltDeg=10", () => {
    expect(normalizeFlatRoofConfig({ supportTiltDeg: 10 }).supportTiltDeg).toBe(10);
  });

  it("accepte supportTiltDeg=15", () => {
    expect(normalizeFlatRoofConfig({ supportTiltDeg: 15 }).supportTiltDeg).toBe(15);
  });

  it("rejette supportTiltDeg=7 → default 10", () => {
    expect(normalizeFlatRoofConfig({ supportTiltDeg: 7 }).supportTiltDeg).toBe(10);
  });

  it("rejette supportTiltDeg négatif → default 10", () => {
    expect(normalizeFlatRoofConfig({ supportTiltDeg: -5 }).supportTiltDeg).toBe(10);
  });

  it("layoutOrientation landscape reconnu", () => {
    expect(normalizeFlatRoofConfig({ layoutOrientation: "landscape" }).layoutOrientation).toBe("landscape");
  });

  it("layoutOrientation paysage reconnu (alias FR)", () => {
    expect(normalizeFlatRoofConfig({ layoutOrientation: "paysage" }).layoutOrientation).toBe("landscape");
  });

  it("layoutOrientation LANDSCAPE (majuscule) → landscape", () => {
    expect(normalizeFlatRoofConfig({ layoutOrientation: "LANDSCAPE" }).layoutOrientation).toBe("landscape");
  });

  it("layoutOrientation invalide → portrait", () => {
    expect(normalizeFlatRoofConfig({ layoutOrientation: "diagonal" }).layoutOrientation).toBe("portrait");
  });

  it("setbackRoofEdgeCm personnalisé", () => {
    expect(normalizeFlatRoofConfig({ setbackRoofEdgeCm: 80 }).setbackRoofEdgeCm).toBe(80);
  });

  it("setbackObstacleCm=0 accepté", () => {
    expect(normalizeFlatRoofConfig({ setbackObstacleCm: 0 }).setbackObstacleCm).toBe(0);
  });

  it("setbackRoofEdgeCm négatif → default 60", () => {
    expect(normalizeFlatRoofConfig({ setbackRoofEdgeCm: -10 }).setbackRoofEdgeCm).toBe(60);
  });

  it("rowSpacingCm toujours = FLAT_ROOF_ROW_SPACING_CM (ignoré si passé)", () => {
    // rowSpacingCm est figé — la valeur passée est ignorée
    expect(normalizeFlatRoofConfig({ rowSpacingCm: 99 }).rowSpacingCm).toBe(FLAT_ROOF_ROW_SPACING_CM);
  });

  it("rowSpacingMm toujours = FLAT_ROOF_ROW_SPACING_MM", () => {
    expect(normalizeFlatRoofConfig({}).rowSpacingMm).toBe(FLAT_ROOF_ROW_SPACING_MM);
  });

  it("rowSpacingManual=true préservé", () => {
    expect(normalizeFlatRoofConfig({ rowSpacingManual: true }).rowSpacingManual).toBe(true);
  });

  it("rowSpacingManual=false (valeur truthy non-boolean) → false", () => {
    expect(normalizeFlatRoofConfig({ rowSpacingManual: 1 }).rowSpacingManual).toBe(false);
  });

  it("retourne un nouvel objet (pas de mutation)", () => {
    const input = { supportTiltDeg: 5 };
    const out = normalizeFlatRoofConfig(input);
    expect(out).not.toBe(input);
  });

  it("colSpacingCm personnalisé", () => {
    expect(normalizeFlatRoofConfig({ colSpacingCm: 5 }).colSpacingCm).toBe(5);
  });
});

// ── getAutoRowSpacingCmFromTilt ────────────────────────────────────────────────

describe("getAutoRowSpacingCmFromTilt", () => {
  it("retourne FLAT_ROOF_ROW_SPACING_CM quel que soit l'angle", () => {
    expect(getAutoRowSpacingCmFromTilt(0)).toBe(FLAT_ROOF_ROW_SPACING_CM);
    expect(getAutoRowSpacingCmFromTilt(5)).toBe(FLAT_ROOF_ROW_SPACING_CM);
    expect(getAutoRowSpacingCmFromTilt(10)).toBe(FLAT_ROOF_ROW_SPACING_CM);
    expect(getAutoRowSpacingCmFromTilt(45)).toBe(FLAT_ROOF_ROW_SPACING_CM);
    expect(getAutoRowSpacingCmFromTilt(90)).toBe(FLAT_ROOF_ROW_SPACING_CM);
  });
});
