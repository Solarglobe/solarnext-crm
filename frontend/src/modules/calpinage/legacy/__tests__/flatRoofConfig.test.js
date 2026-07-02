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

// ── LOT A — Matériel de pose (mountingSystemId) ───────────────────────────────

describe("normalizeFlatRoofConfig — matériel de pose (LOT A)", () => {
  it("sans mountingSystemId : mountingSystemId=null, mountingSystem=null (rétrocompat)", () => {
    const r = normalizeFlatRoofConfig({ supportTiltDeg: 5 });
    expect(r.mountingSystemId).toBe(null);
    expect(r.mountingSystem).toBe(null);
    expect(r.supportTiltDeg).toBe(5); // le 5° legacy reste accepté SANS système
    expect(r.rowSpacingCm).toBe(55);
  });

  it("mountingSystemId inconnu → branche legacy inchangée", () => {
    const r = normalizeFlatRoofConfig({ mountingSystemId: "SYSTEME_FANTOME", supportTiltDeg: 15 });
    expect(r.mountingSystemId).toBe(null);
    expect(r.supportTiltDeg).toBe(15);
    expect(r.rowSpacingCm).toBe(55);
  });

  it("K2 S-Dome 6 : tilt imposé 10°, paysage imposé, snapshot persisté", () => {
    const r = normalizeFlatRoofConfig({ mountingSystemId: "K2_S_DOME_6", supportTiltDeg: 5, layoutOrientation: "portrait" });
    expect(r.mountingSystemId).toBe("K2_S_DOME_6");
    expect(r.supportTiltDeg).toBe(10); // 5° refusé : imposé par le système
    expect(r.layoutOrientation).toBe("landscape"); // portrait refusé : imposé paysage
    expect(r.rowSpacingCm).toBe(55);
    expect(r.rowSpacingMm).toBe(550);
    expect(r.mountingSystem).toBeTruthy();
    expect(r.mountingSystem.brand).toBe("K2 Systems");
    expect(r.mountingSystem.calculatorLabel).toBe("K2 Base");
  });

  it("K2 S-Dome 6.15 : tilt 15°, inter-rangées 70 cm", () => {
    const r = normalizeFlatRoofConfig({ mountingSystemId: "K2_S_DOME_6_15" });
    expect(r.supportTiltDeg).toBe(15);
    expect(r.rowSpacingCm).toBe(70);
    expect(r.rowSpacingMm).toBe(700);
  });

  it("ESDEC FlatFix Fusion sud : tilt 13° (nouvelle valeur hors 5/10/15)", () => {
    const r = normalizeFlatRoofConfig({ mountingSystemId: "ESDEC_FLATFIX_FUSION_SUD" });
    expect(r.supportTiltDeg).toBe(13);
    expect(r.layoutOrientation).toBe("landscape");
  });

  it("K2 TiltUp Vento : options 20/25/30, choix 25 respecté, orientation libre", () => {
    const r = normalizeFlatRoofConfig({
      mountingSystemId: "K2_TILTUP_VENTO",
      supportTiltDeg: 25,
      layoutOrientation: "portrait",
    });
    expect(r.supportTiltDeg).toBe(25);
    expect(r.layoutOrientation).toBe("portrait");
    expect(r.rowSpacingCm).toBe(110);
  });

  it("TiltUp : tilt hors options (13) → défaut système 20", () => {
    expect(normalizeFlatRoofConfig({ mountingSystemId: "K2_TILTUP_VENTO", supportTiltDeg: 13 }).supportTiltDeg).toBe(20);
  });

  it("systèmes est-ouest désactivés → REFUSÉS (branche legacy, jamais appliqués au moteur)", () => {
    for (const id of ["K2_D_DOME_6_EO", "ESDEC_FLATFIX_FUSION_EO"]) {
      const r = normalizeFlatRoofConfig({ mountingSystemId: id });
      expect(r.mountingSystemId).toBe(null);
      expect(r.supportTiltDeg).toBe(10);
      expect(r.rowSpacingCm).toBe(55);
    }
  });

  it("anti-contournement : snapshot E-O injecté dans l'état persisté → purgé à la normalisation", () => {
    // Simule une étude sauvegardée (ou un état manipulé) qui porterait un système E-O complet.
    const r = normalizeFlatRoofConfig({
      mountingSystemId: "K2_D_DOME_6_EO",
      mountingSystem: { id: "K2_D_DOME_6_EO", brand: "K2 Systems", arrangement: "EAST_WEST_DUAL", tiltDeg: 10 },
      supportTiltDeg: 10,
      rowSpacingCm: 30,
    });
    expect(r.mountingSystemId).toBe(null);
    expect(r.mountingSystem).toBe(null); // le snapshot ne survit pas — rien n'atteint le moteur ni le devis
    expect(r.rowSpacingCm).toBe(55); // espacement E-O (30) écarté, retour au legacy
  });

  it("marges : défaut système, surcharge utilisateur respectée", () => {
    expect(normalizeFlatRoofConfig({ mountingSystemId: "K2_S_DOME_6" }).setbackRoofEdgeCm).toBe(60);
    expect(
      normalizeFlatRoofConfig({ mountingSystemId: "K2_S_DOME_6", setbackRoofEdgeCm: 100 }).setbackRoofEdgeCm,
    ).toBe(100);
  });

  it("rowSpacingCm passé est ignoré quand un système est actif (imposé V1)", () => {
    expect(
      normalizeFlatRoofConfig({ mountingSystemId: "K2_S_DOME_6_15", rowSpacingCm: 99 }).rowSpacingCm,
    ).toBe(70);
  });

  it("re-normalisation stable (sortie → entrée → même sortie)", () => {
    const a = normalizeFlatRoofConfig({ mountingSystemId: "ESDEC_FLATFIX_FUSION_SUD" });
    const b = normalizeFlatRoofConfig(a);
    expect(b).toEqual(a);
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
