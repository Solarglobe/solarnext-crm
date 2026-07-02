/**
 * Tests unitaires — flatRoofMountingSystems.js (catalogue matériel de pose LOT A).
 */
import { describe, it, expect } from "vitest";
import {
  FLAT_ROOF_MOUNTING_SYSTEMS,
  MOUNTING_ARRANGEMENTS,
  getMountingSystemById,
  resolveSlopeStatusForSystem,
  checkPanelCompatibility,
  buildMountingSystemSnapshot,
} from "../flatRoofMountingSystems.js";

describe("catalogue — invariants", () => {
  it("contient les 6 systèmes du périmètre V1", () => {
    const ids = FLAT_ROOF_MOUNTING_SYSTEMS.map((s) => s.id);
    expect(ids).toEqual([
      "K2_S_DOME_6",
      "K2_S_DOME_6_15",
      "K2_TILTUP_VENTO",
      "ESDEC_FLATFIX_FUSION_SUD",
      "K2_D_DOME_6_EO",
      "ESDEC_FLATFIX_FUSION_EO",
    ]);
  });

  it("les systèmes est-ouest sont présents mais DÉSACTIVÉS avec motif", () => {
    for (const s of FLAT_ROOF_MOUNTING_SYSTEMS) {
      if (s.arrangement === MOUNTING_ARRANGEMENTS.EAST_WEST_DUAL) {
        expect(s.enabled).toBe(false);
        expect(String(s.unavailableReason)).toContain("azimut");
      } else {
        expect(s.enabled).toBe(true);
      }
    }
  });

  it("chaque système : defaultTiltDeg ∈ tiltOptionsDeg, defaultOrientation ∈ orientationOptions", () => {
    for (const s of FLAT_ROOF_MOUNTING_SYSTEMS) {
      expect(s.tiltOptionsDeg).toContain(s.defaultTiltDeg);
      expect(s.orientationOptions).toContain(s.defaultOrientation);
      expect(s.defaultRowSpacingCm).toBeGreaterThan(0);
      expect(s.calculatorUrl).toMatch(/^https:\/\//);
      expect(s.ballastNote.toLowerCase()).toContain("lestage");
    }
  });

  it("aucun système ne propose 5° (réservé au mode générique legacy)", () => {
    for (const s of FLAT_ROOF_MOUNTING_SYSTEMS) {
      expect(s.tiltOptionsDeg).not.toContain(5);
    }
  });
});

describe("getMountingSystemById", () => {
  it("retrouve un système, null sinon", () => {
    expect(getMountingSystemById("K2_S_DOME_6")?.brand).toBe("K2 Systems");
    expect(getMountingSystemById("NOPE")).toBe(null);
    expect(getMountingSystemById(null)).toBe(null);
    expect(getMountingSystemById(42)).toBe(null);
  });
});

describe("resolveSlopeStatusForSystem — règle pente Fusion (≤3 OK / 3-7 alerte / >7 bloquant)", () => {
  const fusion = getMountingSystemById("ESDEC_FLATFIX_FUSION_SUD");

  it("pente inconnue → unknown avec consigne", () => {
    const r = resolveSlopeStatusForSystem(fusion, null);
    expect(r.level).toBe("unknown");
    expect(r.message).toContain("3°");
  });

  it("2° → ok", () => {
    expect(resolveSlopeStatusForSystem(fusion, 2).level).toBe("ok");
  });

  it("3° → ok (borne incluse)", () => {
    expect(resolveSlopeStatusForSystem(fusion, 3).level).toBe("ok");
  });

  it("5° → warning (collage / validation technique)", () => {
    const r = resolveSlopeStatusForSystem(fusion, 5);
    expect(r.level).toBe("warning");
    expect(r.message.toLowerCase()).toContain("collage");
  });

  it("8° → blocking", () => {
    const r = resolveSlopeStatusForSystem(fusion, 8);
    expect(r.level).toBe("blocking");
    expect(r.message.toLowerCase()).toContain("bloquant");
  });

  it("K2 S-Dome 6 : 5° → warning FixPro, 12° → blocking", () => {
    const dome = getMountingSystemById("K2_S_DOME_6");
    expect(resolveSlopeStatusForSystem(dome, 5).level).toBe("warning");
    expect(resolveSlopeStatusForSystem(dome, 5).message).toContain("FixPro");
    expect(resolveSlopeStatusForSystem(dome, 12).level).toBe("blocking");
  });
});

describe("checkPanelCompatibility", () => {
  const fusion = getMountingSystemById("ESDEC_FLATFIX_FUSION_SUD");

  it("module dans le gabarit → ok", () => {
    expect(checkPanelCompatibility(fusion, { lengthMm: 1950, widthMm: 1134 }).ok).toBe(true);
  });

  it("module trop large (1200 > 1150) → ko avec message", () => {
    const r = checkPanelCompatibility(fusion, { lengthMm: 1950, widthMm: 1200 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("1150");
  });

  it("système sans limites (TiltUp) → toujours ok", () => {
    const tiltup = getMountingSystemById("K2_TILTUP_VENTO");
    expect(checkPanelCompatibility(tiltup, { lengthMm: 2500, widthMm: 1400 }).ok).toBe(true);
  });
});

describe("buildMountingSystemSnapshot", () => {
  it("fige id/marque/tilt/lien calculateur pour le devis/PDF", () => {
    const s = getMountingSystemById("K2_S_DOME_6_15");
    const snap = buildMountingSystemSnapshot(s, 15);
    expect(snap.id).toBe("K2_S_DOME_6_15");
    expect(snap.brand).toBe("K2 Systems");
    expect(snap.tiltDeg).toBe(15);
    expect(snap.rowSpacingCm).toBe(70);
    expect(snap.calculatorUrl).toContain("k2-systems");
  });
});
