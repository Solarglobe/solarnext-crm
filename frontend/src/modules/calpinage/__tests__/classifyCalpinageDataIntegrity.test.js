/**
 * Tests officiels — stratégie intégrité dossiers anciens / partiels
 *
 * Couvre les 10 cas obligatoires définis dans la stratégie :
 *  1. Dossier complet moderne
 *  2. Dossier legacy sans calpinage_meta
 *  3. Dossier sans GPS
 *  4. Dossier avec GPS invalide
 *  5. Dossier sans shading
 *  6. Dossier shading partiel
 *  7. Dossier avec géométrie partielle
 *  8. Dossier avec panneaux partiels
 *  9. Dossier quasi vide mais non crashant
 * 10. Dossier incohérent mais toléré en lecture
 *
 * Règles vérifiées :
 * - Jamais de crash sur entrée nulle / malformée
 * - Jamais de valeur GPS inventée
 * - Jamais de shading classifié OK si GPS absent
 * - Pas de mutation des données en entrée
 */

import { describe, it, expect } from "vitest";
import { classifyCalpinageDataIntegrity } from "../integrity/classifyCalpinageDataIntegrity.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function freshRoofState() {
  return {
    map: { centerLatLng: { lat: 48.85, lng: 2.35 }, zoom: 19 },
    scale: { metersPerPixel: 0.05 },
    roof: null,
    gps: { lat: 48.85, lon: 2.35 },
    contoursBati: [
      { id: "c1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }], roofRole: "main" },
    ],
    traits: [
      { id: "t1", a: { x: 50, y: 0 }, b: { x: 50, y: 80 }, roofRole: "main" },
    ],
    ridges: [
      { id: "r1", a: { x: 50, y: 0 }, b: { x: 50, y: 80 }, roofRole: "main" },
    ],
    mesures: [],
    planes: null,
    obstacles: [],
    image: { dataUrl: "data:image/png;base64," + "A".repeat(100), width: 800, height: 600 },
  };
}

function freshFrozenBlocks() {
  return [
    {
      id: "block-1",
      panId: "pan-1",
      panels: [
        { center: { x: 10, y: 20 }, state: null, enabled: true, localRotationDeg: 0 },
        { center: { x: 30, y: 20 }, state: null, enabled: true, localRotationDeg: 0 },
      ],
      rotation: 0,
      orientation: "PORTRAIT",
      useScreenAxes: false,
    },
  ];
}

function freshShading() {
  return {
    computedAt: "2026-04-01T12:00:00.000Z",
    totalLossPct: 5.2,
    near: { totalLossPct: 2.1 },
    far: { totalLossPct: 3.5, source: "horizon_mask" },
    combined: { totalLossPct: 5.2 },
    perPanel: [
      { panelId: "p1", lossPct: 4.8 },
      { panelId: "p2", lossPct: 5.6 },
    ],
  };
}

function freshMeta(roofState, frozenBlocks, shading) {
  return {
    version: "CALPINAGE_V1",
    savedAt: "2026-04-01T12:00:00.000Z",
    geometryHash: "aaaaaaaa",
    panelsHash: "bbbbbbbb",
    shadingHash: "cccccccc",
    shadingComputedAt: shading ? shading.computedAt : null,
    shadingSource: shading ? "recomputed" : "none",
    shadingValid: !!shading,
  };
}

function completeModernDossier() {
  const roofState = freshRoofState();
  const frozenBlocks = freshFrozenBlocks();
  const shading = freshShading();
  return {
    roofState,
    frozenBlocks,
    shading,
    calpinage_meta: freshMeta(roofState, frozenBlocks, shading),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cas 1 — Dossier complet moderne
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 1 — Dossier complet moderne", () => {
  it("dataLevel=COMPLETE, tous statuts OK", () => {
    const data = completeModernDossier();
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.dataLevel).toBe("COMPLETE");
    expect(result.geometryStatus).toBe("OK");
    expect(result.panelsStatus).toBe("OK");
    expect(result.gpsStatus).toBe("OK");
    expect(result.shadingStatus).toBe("OK");
    expect(result.canTrustForDisplay).toBe(true);
    expect(result.canTrustForShading).toBe(true);
    expect(result.canTrustForValidation).toBe(true);
    expect(result.reason).toBe("OK");
  });

  it("ne mute pas les données en entrée", () => {
    const data = completeModernDossier();
    const originalGps = { ...data.roofState.gps };
    classifyCalpinageDataIntegrity(data);
    expect(data.roofState.gps).toEqual(originalGps);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 2 — Dossier legacy sans calpinage_meta
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 2 — Dossier legacy sans calpinage_meta", () => {
  it("dataLevel=LEGACY si calpinage_meta absent", () => {
    const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading: freshShading() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.dataLevel).toBe("LEGACY");
    expect(result.reason).toContain("no_calpinage_meta");
    expect(result.canTrustForDisplay).toBe(true);
  });

  it("dataLevel=LEGACY si calpinage_meta version incorrecte", () => {
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: freshFrozenBlocks(),
      shading: freshShading(),
      calpinage_meta: { version: "V0_LEGACY", savedAt: "2024-01-01" },
    };
    const result = classifyCalpinageDataIntegrity(data);
    expect(result.dataLevel).toBe("LEGACY");
  });

  it("pas de crash, résultat cohérent", () => {
    const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);
    expect(result).toBeDefined();
    expect(typeof result.dataLevel).toBe("string");
    expect(typeof result.canTrustForDisplay).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 3 — Dossier sans GPS
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 3 — Dossier sans GPS", () => {
  it("gpsStatus=MISSING si roofState.gps absent", () => {
    const roofState = { ...freshRoofState() };
    delete roofState.gps;
    const data = { roofState, frozenBlocks: freshFrozenBlocks(), shading: freshShading(), calpinage_meta: freshMeta(roofState, freshFrozenBlocks(), freshShading()) };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.gpsStatus).toBe("MISSING");
    expect(result.canTrustForShading).toBe(false);
    expect(result.shadingStatus).toBe("UNTRUSTED");
  });

  it("map.centerLatLng présent mais gps absent → GPS toujours MISSING (pas de fallback arbitraire)", () => {
    const roofState = { ...freshRoofState() };
    delete roofState.gps;
    // centerLatLng existe mais n'est PAS un GPS confirmé du bâtiment
    roofState.map = { centerLatLng: { lat: 48.85, lng: 2.35 }, zoom: 19 };
    const data = { roofState, frozenBlocks: freshFrozenBlocks(), shading: freshShading() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.gpsStatus).toBe("MISSING");
    expect(result.canTrustForShading).toBe(false);
  });

  it("shading ne peut pas être OK si GPS absent", () => {
    const roofState = { ...freshRoofState() };
    delete roofState.gps;
    const shading = freshShading();
    const meta = freshMeta(roofState, freshFrozenBlocks(), shading);
    const data = { roofState, frozenBlocks: freshFrozenBlocks(), shading, calpinage_meta: meta };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.shadingStatus).not.toBe("OK");
    expect(result.canTrustForShading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 4 — Dossier avec GPS invalide
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 4 — Dossier avec GPS invalide", () => {
  it("gpsStatus=INVALID si lat=NaN", () => {
    const roofState = { ...freshRoofState(), gps: { lat: NaN, lon: 2.35 } };
    const data = { roofState, frozenBlocks: freshFrozenBlocks(), shading: freshShading() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.gpsStatus).toBe("INVALID");
    expect(result.canTrustForShading).toBe(false);
  });

  it("gpsStatus=INVALID si coordonnées hors plage (lat > 90)", () => {
    const roofState = { ...freshRoofState(), gps: { lat: 999, lon: 2.35 } };
    const data = { roofState, frozenBlocks: freshFrozenBlocks(), shading: freshShading() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.gpsStatus).toBe("INVALID");
    expect(result.shadingStatus).toBe("UNTRUSTED");
  });

  it("gpsStatus=INVALID si lat=null", () => {
    const roofState = { ...freshRoofState(), gps: { lat: null, lon: 2.35 } };
    const data = { roofState, frozenBlocks: freshFrozenBlocks(), shading: freshShading() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.gpsStatus).toBe("INVALID");
  });

  it("gpsStatus=INVALID si objet gps vide {}", () => {
    const roofState = { ...freshRoofState(), gps: {} };
    const data = { roofState, frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.gpsStatus).toBe("INVALID");
    expect(result.canTrustForShading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 5 — Dossier sans shading
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 5 — Dossier sans shading", () => {
  it("shadingStatus=MISSING si shading=null", () => {
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: freshFrozenBlocks(),
      shading: null,
      calpinage_meta: freshMeta(freshRoofState(), freshFrozenBlocks(), null),
    };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.shadingStatus).toBe("MISSING");
    expect(result.canTrustForShading).toBe(false);
    expect(result.dataLevel).not.toBe("COMPLETE");
  });

  it("shadingStatus=MISSING si shading absent du dossier", () => {
    const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.shadingStatus).toBe("MISSING");
    expect(result.canTrustForShading).toBe(false);
  });

  it("canTrustForDisplay toujours possible si géométrie OK, même sans shading", () => {
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: freshFrozenBlocks(),
      shading: null,
      calpinage_meta: freshMeta(freshRoofState(), freshFrozenBlocks(), null),
    };
    const result = classifyCalpinageDataIntegrity(data);
    expect(result.canTrustForDisplay).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 6 — Dossier shading partiel
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 6 — Dossier shading partiel", () => {
  it("shadingStatus=PARTIAL si structure shading incomplète (ni combined, ni near+far, ni totalLossPct)", () => {
    const shading = { computedAt: "2026-04-01T12:00:00.000Z", perPanel: [] };
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: freshFrozenBlocks(),
      shading,
      calpinage_meta: freshMeta(freshRoofState(), freshFrozenBlocks(), shading),
    };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.shadingStatus).toBe("PARTIAL");
    expect(result.canTrustForShading).toBe(false);
  });

  it("shadingStatus=STALE si computedAt absent (structure sinon valide)", () => {
    const shading = { near: { totalLossPct: 2.1 }, far: { totalLossPct: 3.5 }, combined: { totalLossPct: 5.2 } };
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: freshFrozenBlocks(),
      shading,
      calpinage_meta: freshMeta(freshRoofState(), freshFrozenBlocks(), shading),
    };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.shadingStatus).toBe("STALE");
    expect(result.canTrustForShading).toBe(false);
    expect(result.reason).toContain("shading_stale");
  });

  it("shadingStatus=STALE si meta.shadingValid=false", () => {
    const shading = freshShading();
    const meta = { ...freshMeta(freshRoofState(), freshFrozenBlocks(), shading), shadingValid: false };
    const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading, calpinage_meta: meta };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.shadingStatus).toBe("STALE");
    expect(result.canTrustForShading).toBe(false);
  });

  it("shadingStatus=UNTRUSTED si far.source=UNAVAILABLE_NO_GPS (marker runtime dans données)", () => {
    const shading = {
      ...freshShading(),
      far: { totalLossPct: null, source: "UNAVAILABLE_NO_GPS" },
    };
    const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.shadingStatus).toBe("UNTRUSTED");
    expect(result.canTrustForShading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 7 — Dossier avec géométrie partielle
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 7 — Dossier avec géométrie partielle", () => {
  it("geometryStatus=PARTIAL si image présente mais scale absent", () => {
    const roofState = { ...freshRoofState() };
    delete roofState.scale;
    const data = { roofState, frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.geometryStatus).toBe("PARTIAL");
    expect(result.canTrustForDisplay).toBe(true);
    expect(result.canTrustForValidation).toBe(false);
  });

  it("geometryStatus=PARTIAL si contours présents mais scale absent", () => {
    const roofState = { ...freshRoofState() };
    delete roofState.scale;
    delete roofState.image;
    const data = { roofState, frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.geometryStatus).toBe("PARTIAL");
  });

  it("geometryStatus=LEGACY_FORMAT si champ legacy contourBati (singulier)", () => {
    const roofState = {
      ...freshRoofState(),
      contourBati: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }],
    };
    delete roofState.contoursBati;
    const data = { roofState, frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.geometryStatus).toBe("LEGACY_FORMAT");
    expect(result.dataLevel).toBe("LEGACY");
  });

  it("geometryStatus=MISSING si roofState vide", () => {
    const data = { roofState: {}, frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.geometryStatus).toBe("MISSING");
    expect(result.canTrustForValidation).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 8 — Dossier avec panneaux partiels
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 8 — Dossier avec panneaux partiels", () => {
  it("panelsStatus=PARTIAL si certains blocs ont des coordonnées invalides", () => {
    const frozenBlocks = [
      {
        id: "block-1",
        panId: "pan-1",
        panels: [
          { center: { x: 10, y: 20 } },        // valide
          { center: { x: NaN, y: 20 } },        // invalide
          { center: null },                       // invalide
        ],
      },
      {
        id: "block-2",
        panId: "pan-2",
        panels: [{ center: { x: 50, y: 80 } }], // valide
      },
    ];
    const data = { roofState: freshRoofState(), frozenBlocks };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.panelsStatus).toBe("PARTIAL");
    expect(result.canTrustForDisplay).toBe(true);
    expect(result.canTrustForValidation).toBe(false);
  });

  it("panelsStatus=PARTIAL si bloc sans panId", () => {
    const frozenBlocks = [
      {
        id: "block-orphan",
        panId: null,        // panId manquant → orphelin
        panels: [{ center: { x: 10, y: 20 } }],
      },
      {
        id: "block-valid",
        panId: "pan-1",
        panels: [{ center: { x: 30, y: 40 } }],
      },
    ];
    const data = { roofState: freshRoofState(), frozenBlocks };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.panelsStatus).toBe("PARTIAL");
  });

  it("panelsStatus=MISSING si frozenBlocks vide", () => {
    const data = { roofState: freshRoofState(), frozenBlocks: [] };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.panelsStatus).toBe("MISSING");
  });

  it("panelsStatus=MISSING si tous les blocs n'ont aucun panneau valide", () => {
    const frozenBlocks = [
      { id: "block-1", panId: "pan-1", panels: [{ center: { x: NaN, y: NaN } }] },
      { id: "block-2", panId: "pan-2", panels: [{ center: null }] },
    ];
    const data = { roofState: freshRoofState(), frozenBlocks };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.panelsStatus).toBe("MISSING");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 9 — Dossier quasi vide mais non crashant
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 9 — Dossier quasi vide mais non crashant", () => {
  it("null → INVALID, pas de crash", () => {
    const result = classifyCalpinageDataIntegrity(null);
    expect(result.dataLevel).toBe("INVALID");
    expect(result.canTrustForDisplay).toBe(false);
    expect(result.reason).toBe("data_null_or_invalid");
  });

  it("undefined → INVALID, pas de crash", () => {
    const result = classifyCalpinageDataIntegrity(undefined);
    expect(result.dataLevel).toBe("INVALID");
  });

  it("objet vide {} → INVALID, pas de crash", () => {
    const result = classifyCalpinageDataIntegrity({});
    expect(result.dataLevel).toBe("INVALID");
    expect(result.geometryStatus).toBe("MISSING");
    expect(result.panelsStatus).toBe("MISSING");
  });

  it("{ roofState: null } → INVALID, pas de crash", () => {
    const result = classifyCalpinageDataIntegrity({ roofState: null });
    expect(result.dataLevel).toBe("INVALID");
    expect(result.gpsStatus).toBe("MISSING");
  });

  it("types incohérents (shading=42, frozenBlocks='foo') → pas de crash", () => {
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: "foo",
      shading: 42,
    };
    const result = classifyCalpinageDataIntegrity(data);
    expect(result).toBeDefined();
    expect(typeof result.dataLevel).toBe("string");
    expect(typeof result.canTrustForDisplay).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 10 — Dossier incohérent mais toléré en lecture
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 10 — Dossier incohérent mais toléré en lecture", () => {
  it("calpinage_meta présent mais hashes incohérents → toujours lisible, pas INVALID", () => {
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: freshFrozenBlocks(),
      shading: freshShading(),
      calpinage_meta: {
        version: "CALPINAGE_V1",
        savedAt: "2026-04-01T12:00:00.000Z",
        geometryHash: "00000000",   // hash délibérément faux
        panelsHash: "00000000",
        shadingHash: "00000000",
        shadingComputedAt: "2026-04-01T12:00:00.000Z",
        shadingValid: true,
      },
    };
    const result = classifyCalpinageDataIntegrity(data);
    // La classification ne recalcule pas les hashes — elle fait confiance aux données présentes
    // Le shading a computedAt, structure valide, GPS OK → OK
    expect(result.shadingStatus).toBe("OK");
    expect(result.canTrustForDisplay).toBe(true);
    expect(result.dataLevel).toBe("COMPLETE");
  });

  it("roofState avec données mixtes valides/invalides → exploitable en lecture", () => {
    const roofState = {
      ...freshRoofState(),
      obstacles: [
        null,                          // obstacle null → ignoré défensivement
        { id: "o1", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        { id: "o2", points: "broken" }, // points invalides → ignoré
      ],
    };
    const data = { roofState, frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);
    // Malgré les obstacles invalides, la géométrie de base (contours + scale) reste OK
    expect(result.geometryStatus).toBe("OK");
    expect(result.canTrustForDisplay).toBe(true);
  });

  it("panneaux avec champs supplémentaires inconnus → ignorés, pas de crash", () => {
    const frozenBlocks = [
      {
        id: "block-1",
        panId: "pan-1",
        unknownField: { deeply: { nested: 999 } },
        panels: [
          { center: { x: 10, y: 20 }, __legacyProp: "ignored", state: null },
        ],
      },
    ];
    const data = { roofState: freshRoofState(), frozenBlocks };
    const result = classifyCalpinageDataIntegrity(data);
    expect(result.panelsStatus).toBe("OK");
    expect(result.canTrustForDisplay).toBe(true);
  });

  it("shading avec champs null/undefined mélangés → classifié PARTIAL pas crash", () => {
    const shading = {
      computedAt: "2026-04-01T12:00:00.000Z",
      near: null,
      far: undefined,
      combined: null,
      totalLossPct: undefined,
    };
    const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading };
    const result = classifyCalpinageDataIntegrity(data);
    expect(result.shadingStatus).toBe("PARTIAL");
    expect(result.canTrustForShading).toBe(false);
    expect(result.canTrustForDisplay).toBe(true);
  });

  it("GPS lon=0 (équateur / méridien de Greenwich) → valide, pas rejeté", () => {
    const roofState = { ...freshRoofState(), gps: { lat: 0, lon: 0 } };
    const data = { roofState, frozenBlocks: freshFrozenBlocks() };
    const result = classifyCalpinageDataIntegrity(data);
    expect(result.gpsStatus).toBe("OK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 11 — CALPINAGE_V2 (régression couverte par fix hasMeta + hasValidMeta)
// ─────────────────────────────────────────────────────────────────────────────

describe("Cas 11 — CALPINAGE_V2", () => {
  /** Fixture V2 : même structure que V1, version bumped. */
  function freshMetaV2(shading) {
    return {
      version: "CALPINAGE_V2",
      savedAt: "2026-05-01T10:00:00.000Z",
      geometryHash: "aaaaaaaa",
      panelsHash: "bbbbbbbb",
      shadingHash: "cccccccc",
      shadingComputedAt: shading ? shading.computedAt : null,
      shadingSource: shading ? "recomputed" : "none",
      shadingValid: !!shading,
    };
  }

  it("document V2 valide → dataLevel !== LEGACY", () => {
    // Avant le fix, hasMeta était false pour V2 → dataLevel forcé à LEGACY.
    const shading = freshShading();
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: freshFrozenBlocks(),
      shading,
      calpinage_meta: freshMetaV2(shading),
    };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.dataLevel).not.toBe("LEGACY");
    expect(result.dataLevel).toBe("COMPLETE");
    expect(result.shadingStatus).toBe("OK");
    expect(result.canTrustForDisplay).toBe(true);
    expect(result.canTrustForShading).toBe(true);
    expect(result.reason).toBe("OK");
  });

  it("document V2 avec shadingValid=false → shadingStatus STALE détecté", () => {
    // Avant le fix, hasValidMeta était false pour V2 → shadingValid=false ignoré
    // → shadingStatus restait OK malgré un shading invalidé → shading_stale non signalé.
    const shading = freshShading();
    const meta = { ...freshMetaV2(shading), shadingValid: false };
    const data = {
      roofState: freshRoofState(),
      frozenBlocks: freshFrozenBlocks(),
      shading,
      calpinage_meta: meta,
    };
    const result = classifyCalpinageDataIntegrity(data);

    expect(result.shadingStatus).toBe("STALE");
    expect(result.canTrustForShading).toBe(false);
    expect(result.reason).toContain("shading_stale");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Règles fondamentales transversales
// ─────────────────────────────────────────────────────────────────────────────

describe("Règles fondamentales — GPS et shading", () => {
  it("GPS absent → canTrustForShading=false dans tous les cas", () => {
    const casesWithoutGps = [
      { roofState: { ...freshRoofState(), gps: undefined }, frozenBlocks: freshFrozenBlocks(), shading: freshShading() },
      { roofState: { ...freshRoofState(), gps: null }, frozenBlocks: freshFrozenBlocks(), shading: freshShading() },
      { roofState: { ...freshRoofState(), gps: {} }, frozenBlocks: freshFrozenBlocks(), shading: freshShading() },
    ];
    for (const data of casesWithoutGps) {
      const result = classifyCalpinageDataIntegrity(data);
      expect(result.canTrustForShading).toBe(false);
      expect(result.shadingStatus).not.toBe("OK");
    }
  });

  it("shadingStatus OK implique toujours gpsStatus OK", () => {
    const data = completeModernDossier();
    const result = classifyCalpinageDataIntegrity(data);
    if (result.shadingStatus === "OK") {
      expect(result.gpsStatus).toBe("OK");
    }
  });

  it("dataLevel COMPLETE implique tous les statuts OK", () => {
    const data = completeModernDossier();
    const result = classifyCalpinageDataIntegrity(data);
    if (result.dataLevel === "COMPLETE") {
      expect(result.geometryStatus).toBe("OK");
      expect(result.panelsStatus).toBe("OK");
      expect(result.gpsStatus).toBe("OK");
      expect(result.shadingStatus).toBe("OK");
    }
  });

  it("retour always complet (toutes les clés présentes)", () => {
    const requiredKeys = [
      "dataLevel", "geometryStatus", "panelsStatus", "gpsStatus",
      "shadingStatus", "canTrustForDisplay", "canTrustForShading",
      "canTrustForValidation", "reason",
    ];
    const cases = [
      null,
      {},
      completeModernDossier(),
      { roofState: freshRoofState() },
    ];
    for (const data of cases) {
      const result = classifyCalpinageDataIntegrity(data);
      for (const key of requiredKeys) {
        expect(result).toHaveProperty(key);
      }
    }
  });
});
