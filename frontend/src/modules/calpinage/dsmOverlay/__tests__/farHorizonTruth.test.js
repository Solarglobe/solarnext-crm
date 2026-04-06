/**
 * POINT 6E — Libellés badge / vérité terrain (aucun calcul physique).
 */
import { describe, expect, it } from "vitest";
import { formatHorizonConfidenceLineHtml, formatHorizonQualityBadgeText } from "../farHorizonTruth.js";

describe("formatHorizonQualityBadgeText (6E)", () => {
  it("terrain réel + score → relief + pourcentage", () => {
    const h = { meta: { source: "DSM_REAL", qualityScore: 0.85 }, dataCoverage: {} };
    expect(formatHorizonQualityBadgeText(h, h.meta)).toBe("Relief terrain — 85%");
  });

  it("terrain réel sans score → relief seul", () => {
    const h = { meta: { source: "DSM_REAL" }, dataCoverage: {} };
    expect(formatHorizonQualityBadgeText(h, h.meta)).toBe("Relief terrain");
  });

  it("synthétique : pas de pourcentage trompeur", () => {
    const h = { meta: { source: "SYNTHETIC_STUB", qualityScore: 0.85 }, dataCoverage: {} };
    expect(formatHorizonQualityBadgeText(h, h.meta)).toBe("Faible (relief simplifié)");
  });

  it("RELIEF_ONLY : libellé faible", () => {
    const h = { meta: { source: "RELIEF_ONLY", qualityScore: 0.85 }, dataCoverage: {} };
    expect(formatHorizonQualityBadgeText(h, h.meta)).toBe("Faible (relief simplifié)");
  });

  it("autre estimation (ex. surface) : pourcentage plafonné à 30 %", () => {
    const h = { meta: { source: "SURFACE_DSM", qualityScore: 0.85 }, dataCoverage: {} };
    expect(formatHorizonQualityBadgeText(h, h.meta)).toBe("Indicatif (estimation) — 30%");
  });
});

describe("formatHorizonConfidenceLineHtml (transparence produit)", () => {
  it("terrain réel + score → lecture explicite", () => {
    const h = { meta: { source: "DSM_REAL", qualityScore: 0.85 }, dataCoverage: { provider: "IGN_RGE_ALTI" } };
    const html = formatHorizonConfidenceLineHtml(h, 0.85);
    expect(html).toContain("Lecture du site");
    expect(html).toContain("85");
  });

  it("RELIEF_ONLY → prudence lointain", () => {
    const h = { meta: { source: "RELIEF_ONLY" }, dataCoverage: {} };
    const html = formatHorizonConfidenceLineHtml(h, null);
    expect(html).toContain("modèle simplifié");
  });
});
