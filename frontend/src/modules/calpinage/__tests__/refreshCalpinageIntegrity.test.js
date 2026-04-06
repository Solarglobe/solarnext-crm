/**
 * Tests factuel — Verrouillage runtime de l'intégrité
 *
 * Vérifie que classifyCalpinageDataIntegrity + applyReloadDiagnosticCoherence
 * produisent la bonne intégrité à chaque moment important du cycle de vie :
 *
 * - Load initial (complet / legacy)
 * - Après changement panneaux (PARTIAL → COMPLETE, COMPLETE → PARTIAL)
 * - Après changement géométrie
 * - Après changement shading (OK → STALE, MISSING → OK)
 * - Après save (meta frais → COMPLETE)
 * - Cohérence reload_diagnostic.shadingStale
 *
 * Ces tests couvrent la logique que refreshCalpinageIntegrity() exécute,
 * exprimée sur des fonctions pures testables.
 */

import { describe, it, expect } from "vitest";
import {
  classifyCalpinageDataIntegrity,
  applyReloadDiagnosticCoherence,
} from "../integrity/classifyCalpinageDataIntegrity.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRoofState(overrides) {
  return Object.assign({
    gps: { lat: 48.85, lon: 2.35 },
    scale: { metersPerPixel: 0.05 },
    image: { dataUrl: "data:image/png;base64," + "A".repeat(100), width: 800, height: 600 },
    contoursBati: [
      { id: "c1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }], roofRole: "main" },
    ],
    traits: [{ id: "t1", a: { x: 50, y: 0 }, b: { x: 50, y: 80 } }],
    ridges: [],
    planes: null,
  }, overrides || {});
}

function makeBlock(id, panId, panels) {
  return {
    id: id,
    panId: panId,
    panels: panels || [{ center: { x: 10, y: 20 } }],
    rotation: 0,
    orientation: "PORTRAIT",
  };
}

function makeShading(overrides) {
  return Object.assign({
    computedAt: "2026-04-01T12:00:00.000Z",
    totalLossPct: 5.2,
    near: { totalLossPct: 2.1 },
    far: { totalLossPct: 3.5, source: "horizon_mask" },
    combined: { totalLossPct: 5.2 },
    perPanel: [],
  }, overrides || {});
}

function makeMeta(overrides) {
  return Object.assign({
    version: "CALPINAGE_V1",
    savedAt: "2026-04-01T12:00:00.000Z",
    geometryHash: "aaaaaaaa",
    panelsHash: "bbbbbbbb",
    shadingHash: "cccccccc",
    shadingComputedAt: "2026-04-01T12:00:00.000Z",
    shadingSource: "recomputed",
    shadingValid: true,
  }, overrides || {});
}

function completeDossier() {
  return {
    roofState: makeRoofState(),
    frozenBlocks: [makeBlock("b1", "pan-1")],
    shading: makeShading(),
    calpinage_meta: makeMeta(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Load initial
// ─────────────────────────────────────────────────────────────────────────────

describe("Load initial", () => {
  it("dossier complet au load → COMPLETE, tous OK", () => {
    const r = classifyCalpinageDataIntegrity(completeDossier());
    expect(r.dataLevel).toBe("COMPLETE");
    expect(r.geometryStatus).toBe("OK");
    expect(r.panelsStatus).toBe("OK");
    expect(r.gpsStatus).toBe("OK");
    expect(r.shadingStatus).toBe("OK");
    expect(r.canTrustForDisplay).toBe(true);
    expect(r.canTrustForShading).toBe(true);
    expect(r.canTrustForValidation).toBe(true);
  });

  it("dossier legacy sans meta → LEGACY, canTrustForDisplay=true", () => {
    const data = { roofState: makeRoofState(), frozenBlocks: [makeBlock("b1", "pan-1")], shading: makeShading() };
    const r = classifyCalpinageDataIntegrity(data);
    expect(r.dataLevel).toBe("LEGACY");
    expect(r.canTrustForDisplay).toBe(true);
    expect(r.reason).toContain("no_calpinage_meta");
  });

  it("load dossier sans shading → PARTIAL, canTrustForShading=false", () => {
    const data = { ...completeDossier(), shading: null };
    data.calpinage_meta = makeMeta({ shadingComputedAt: null, shadingValid: false, shadingHash: "x" });
    const r = classifyCalpinageDataIntegrity(data);
    expect(r.shadingStatus).toBe("MISSING");
    expect(r.canTrustForShading).toBe(false);
    expect(r.dataLevel).toBe("PARTIAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Changement panneaux
// ─────────────────────────────────────────────────────────────────────────────

describe("Changement panneaux — PARTIAL → COMPLETE et inverse", () => {
  it("PARTIAL → COMPLETE : ajout panneaux valides complète le dossier", () => {
    // Avant : dossier sans panneaux
    const before = {
      roofState: makeRoofState(),
      frozenBlocks: [],
      shading: makeShading(),
      calpinage_meta: makeMeta(),
    };
    const rBefore = classifyCalpinageDataIntegrity(before);
    expect(rBefore.panelsStatus).toBe("MISSING");
    expect(rBefore.dataLevel).not.toBe("COMPLETE");

    // Après : panneaux ajoutés
    const after = {
      ...before,
      frozenBlocks: [makeBlock("b1", "pan-1")],
    };
    const rAfter = classifyCalpinageDataIntegrity(after);
    expect(rAfter.panelsStatus).toBe("OK");
    expect(rAfter.dataLevel).toBe("COMPLETE");
  });

  it("COMPLETE → PARTIAL : suppression panneaux dégrade le dossier", () => {
    const before = completeDossier();
    const rBefore = classifyCalpinageDataIntegrity(before);
    expect(rBefore.dataLevel).toBe("COMPLETE");

    const after = { ...before, frozenBlocks: [] };
    const rAfter = classifyCalpinageDataIntegrity(after);
    expect(rAfter.panelsStatus).toBe("MISSING");
    expect(rAfter.dataLevel).not.toBe("COMPLETE");
  });

  it("panneaux partiels (blocs avec coords NaN) → PARTIAL détecté", () => {
    const data = {
      ...completeDossier(),
      frozenBlocks: [
        makeBlock("b1", "pan-1", [{ center: { x: 10, y: 20 } }]),           // valide
        makeBlock("b2", "pan-2", [{ center: { x: NaN, y: NaN } }]),          // invalide
      ],
    };
    const r = classifyCalpinageDataIntegrity(data);
    expect(r.panelsStatus).toBe("PARTIAL");
    expect(r.dataLevel).toBe("PARTIAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Changement géométrie
// ─────────────────────────────────────────────────────────────────────────────

describe("Changement géométrie", () => {
  it("scale supprimé → geometryStatus=PARTIAL, canTrustForValidation=false", () => {
    const roofState = { ...makeRoofState() };
    delete roofState.scale;
    const data = { ...completeDossier(), roofState };
    const r = classifyCalpinageDataIntegrity(data);
    expect(r.geometryStatus).toBe("PARTIAL");
    expect(r.canTrustForValidation).toBe(false);
    expect(r.dataLevel).toBe("PARTIAL");
  });

  it("contours supprimés mais image présente → géométrie PARTIAL (scale présent)", () => {
    const roofState = { ...makeRoofState(), contoursBati: [], traits: [] };
    const data = { ...completeDossier(), roofState };
    const r = classifyCalpinageDataIntegrity(data);
    // Scale présent mais pas de contours ni traits → PARTIAL
    expect(r.geometryStatus).toBe("PARTIAL");
  });

  it("ancien format contourBati (singulier) → LEGACY_FORMAT, dataLevel=LEGACY", () => {
    const roofState = { ...makeRoofState() };
    delete roofState.contoursBati;
    roofState.contourBati = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }];
    const data = { ...completeDossier(), roofState };
    const r = classifyCalpinageDataIntegrity(data);
    expect(r.geometryStatus).toBe("LEGACY_FORMAT");
    expect(r.dataLevel).toBe("LEGACY");
    expect(r.canTrustForDisplay).toBe(true);
  });

  it("geometryStatus OK → canTrustForDisplay=true", () => {
    const r = classifyCalpinageDataIntegrity(completeDossier());
    expect(r.geometryStatus).toBe("OK");
    expect(r.canTrustForDisplay).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Changement shading — transitions
// ─────────────────────────────────────────────────────────────────────────────

describe("Changement shading — transitions", () => {
  it("shading OK → STALE : computedAt absent dans shading ET dans meta", () => {
    const rOk = classifyCalpinageDataIntegrity(completeDossier());
    expect(rOk.shadingStatus).toBe("OK");

    // Les deux sources de computedAt doivent être absentes pour déclencher STALE
    const staleDossier = {
      ...completeDossier(),
      shading: { ...makeShading(), computedAt: undefined },
      calpinage_meta: makeMeta({ shadingComputedAt: null }),
    };
    const rStale = classifyCalpinageDataIntegrity(staleDossier);
    expect(rStale.shadingStatus).toBe("STALE");
    expect(rStale.canTrustForShading).toBe(false);
  });

  it("shading OK → STALE : meta.shadingValid=false (invalidé explicitement)", () => {
    const rOk = classifyCalpinageDataIntegrity(completeDossier());
    expect(rOk.shadingStatus).toBe("OK");

    const staleDossier = {
      ...completeDossier(),
      calpinage_meta: makeMeta({ shadingValid: false }),
    };
    const rStale = classifyCalpinageDataIntegrity(staleDossier);
    expect(rStale.shadingStatus).toBe("STALE");
    expect(rStale.canTrustForShading).toBe(false);
  });

  it("shading MISSING → OK : shading ajouté avec computedAt et GPS valide", () => {
    const noShading = { ...completeDossier(), shading: null };
    const rBefore = classifyCalpinageDataIntegrity(noShading);
    expect(rBefore.shadingStatus).toBe("MISSING");

    const withShading = { ...noShading, shading: makeShading() };
    const rAfter = classifyCalpinageDataIntegrity(withShading);
    expect(rAfter.shadingStatus).toBe("OK");
    expect(rAfter.canTrustForShading).toBe(true);
  });

  it("shading OK → UNTRUSTED : GPS supprimé", () => {
    const rOk = classifyCalpinageDataIntegrity(completeDossier());
    expect(rOk.shadingStatus).toBe("OK");

    const noGps = {
      ...completeDossier(),
      roofState: { ...makeRoofState(), gps: null },
    };
    const rUntrusted = classifyCalpinageDataIntegrity(noGps);
    expect(rUntrusted.shadingStatus).toBe("UNTRUSTED");
    expect(rUntrusted.canTrustForShading).toBe(false);
  });

  it("shading OK → UNTRUSTED : far.source=UNAVAILABLE_NO_GPS dans les données shading", () => {
    const data = {
      ...completeDossier(),
      shading: { ...makeShading(), far: { totalLossPct: null, source: "UNAVAILABLE_NO_GPS" } },
    };
    const r = classifyCalpinageDataIntegrity(data);
    expect(r.shadingStatus).toBe("UNTRUSTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Après save (meta fraîche)
// ─────────────────────────────────────────────────────────────────────────────

describe("Après save — meta fraîche", () => {
  it("dossier avec meta fraîche → COMPLETE si tout est OK", () => {
    const saved = {
      roofState: makeRoofState(),
      frozenBlocks: [makeBlock("b1", "pan-1")],
      shading: makeShading(),
      calpinage_meta: makeMeta({ savedAt: new Date().toISOString() }),
    };
    const r = classifyCalpinageDataIntegrity(saved);
    expect(r.dataLevel).toBe("COMPLETE");
    expect(r.canTrustForShading).toBe(true);
    expect(r.canTrustForValidation).toBe(true);
  });

  it("save sans shading (nouveau dossier) → PARTIAL, shadingStatus=MISSING", () => {
    const saved = {
      roofState: makeRoofState(),
      frozenBlocks: [makeBlock("b1", "pan-1")],
      shading: null,
      calpinage_meta: makeMeta({ shadingComputedAt: null, shadingValid: false }),
    };
    const r = classifyCalpinageDataIntegrity(saved);
    expect(r.shadingStatus).toBe("MISSING");
    expect(r.dataLevel).toBe("PARTIAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Cohérence reload_diagnostic.shadingStale
// ─────────────────────────────────────────────────────────────────────────────

describe("Cohérence reload_diagnostic.shadingStale", () => {
  it("shadingStale=true + shading non recalculé → shadingStatus downgrade OK → STALE", () => {
    const integrity = classifyCalpinageDataIntegrity(completeDossier());
    expect(integrity.shadingStatus).toBe("OK");

    const reloadDiag = { shadingStale: true };
    const shadingRecomputedThisSession = false;

    const fixed = applyReloadDiagnosticCoherence(integrity, reloadDiag, shadingRecomputedThisSession);
    expect(fixed.shadingStatus).toBe("STALE");
    expect(fixed.canTrustForShading).toBe(false);
    expect(fixed.dataLevel).toBe("PARTIAL");
    expect(fixed.reason).toContain("shading_stale");
  });

  it("shadingStale=true + shading recalculé cette session → pas de downgrade", () => {
    const integrity = classifyCalpinageDataIntegrity(completeDossier());
    expect(integrity.shadingStatus).toBe("OK");

    const reloadDiag = { shadingStale: true };
    const shadingRecomputedThisSession = true; // shading recalculé → OK reste OK

    const fixed = applyReloadDiagnosticCoherence(integrity, reloadDiag, shadingRecomputedThisSession);
    expect(fixed.shadingStatus).toBe("OK");
    expect(fixed.canTrustForShading).toBe(true);
    expect(fixed.dataLevel).toBe("COMPLETE");
  });

  it("shadingStale=false → pas de downgrade même sans recalcul", () => {
    const integrity = classifyCalpinageDataIntegrity(completeDossier());
    const reloadDiag = { shadingStale: false };

    const fixed = applyReloadDiagnosticCoherence(integrity, reloadDiag, false);
    expect(fixed.shadingStatus).toBe("OK");
  });

  it("reloadDiag=null → pas de downgrade (pas de diagnostic)", () => {
    const integrity = classifyCalpinageDataIntegrity(completeDossier());

    const fixed = applyReloadDiagnosticCoherence(integrity, null, false);
    expect(fixed.shadingStatus).toBe("OK");
  });

  it("shadingStatus déjà STALE → cohérence n'ajoute pas de doublon dans reason", () => {
    // computedAt absent dans shading ET meta.shadingComputedAt null → STALE
    const data = {
      ...completeDossier(),
      shading: { ...makeShading(), computedAt: undefined },
      calpinage_meta: makeMeta({ shadingComputedAt: null }),
    };
    const integrity = classifyCalpinageDataIntegrity(data);
    expect(integrity.shadingStatus).toBe("STALE");

    const reloadDiag = { shadingStale: true };
    const fixed = applyReloadDiagnosticCoherence(integrity, reloadDiag, false);
    // shadingStatus déjà STALE → cohérence ne change rien (condition integrity.shadingStatus !== "OK")
    expect(fixed.shadingStatus).toBe("STALE");
    // reason ne doit pas contenir deux fois "shading_stale"
    const count = (fixed.reason.match(/shading_stale/g) || []).length;
    expect(count).toBeLessThanOrEqual(1);
  });

  it("downgrade COMPLETE → PARTIAL quand shading stale détecté", () => {
    const integrity = classifyCalpinageDataIntegrity(completeDossier());
    expect(integrity.dataLevel).toBe("COMPLETE");

    const fixed = applyReloadDiagnosticCoherence(integrity, { shadingStale: true }, false);
    expect(fixed.dataLevel).toBe("PARTIAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Transitions de cycle de vie complet
// ─────────────────────────────────────────────────────────────────────────────

describe("Cycle de vie complet — séquences de transitions", () => {
  it("Load legacy → ajout panneaux → save → COMPLETE", () => {
    // Étape 1 : load legacy (pas de meta)
    const loadedLegacy = { roofState: makeRoofState(), frozenBlocks: [makeBlock("b1", "pan-1")], shading: makeShading() };
    const r1 = classifyCalpinageDataIntegrity(loadedLegacy);
    expect(r1.dataLevel).toBe("LEGACY");

    // Étape 2 : après save (meta générée)
    const afterSave = { ...loadedLegacy, calpinage_meta: makeMeta() };
    const r2 = classifyCalpinageDataIntegrity(afterSave);
    expect(r2.dataLevel).toBe("COMPLETE");
  });

  it("COMPLETE → GPS retiré → shadingStatus=UNTRUSTED, dataLevel=PARTIAL", () => {
    const r1 = classifyCalpinageDataIntegrity(completeDossier());
    expect(r1.dataLevel).toBe("COMPLETE");

    const noGps = { ...completeDossier(), roofState: { ...makeRoofState(), gps: null } };
    const r2 = classifyCalpinageDataIntegrity(noGps);
    expect(r2.gpsStatus).toBe("MISSING");
    expect(r2.shadingStatus).toBe("UNTRUSTED");
    expect(r2.dataLevel).toBe("PARTIAL");
    expect(r2.canTrustForShading).toBe(false);
    expect(r2.canTrustForValidation).toBe(false);
  });

  it("PARTIAL (no shading) → shading recalculé → COMPLETE", () => {
    // Avant : pas de shading
    const partial = {
      roofState: makeRoofState(),
      frozenBlocks: [makeBlock("b1", "pan-1")],
      shading: null,
      calpinage_meta: makeMeta({ shadingComputedAt: null, shadingValid: false }),
    };
    const r1 = classifyCalpinageDataIntegrity(partial);
    expect(r1.shadingStatus).toBe("MISSING");
    expect(r1.dataLevel).toBe("PARTIAL");

    // Après : shading recalculé + save avec meta mise à jour
    const complete = {
      ...partial,
      shading: makeShading(),
      calpinage_meta: makeMeta(),
    };
    const r2 = classifyCalpinageDataIntegrity(complete);
    expect(r2.shadingStatus).toBe("OK");
    expect(r2.dataLevel).toBe("COMPLETE");
  });

  it("snapshot thin sans meta → LEGACY (cohérent : meta absente jusqu'au prochain save)", () => {
    // Simule ce que buildMinimalCalpinageSnapshotForIntegrity retourne
    // quand calpinage_meta n'a jamais été sauvé
    const thinSnapshot = {
      roofState: makeRoofState(),
      frozenBlocks: [makeBlock("b1", "pan-1")],
      shading: makeShading(),
      calpinage_meta: null,  // pas encore persisté
    };
    const r = classifyCalpinageDataIntegrity(thinSnapshot);
    expect(r.dataLevel).toBe("LEGACY");
    expect(r.canTrustForDisplay).toBe(true);
    expect(r.canTrustForShading).toBe(true); // GPS OK + shading OK → on peut afficher
  });

  it("résultat toujours complet (toutes clés présentes) après chaque transition", () => {
    const transitions = [
      completeDossier(),
      { ...completeDossier(), shading: null },
      { ...completeDossier(), frozenBlocks: [] },
      { ...completeDossier(), roofState: { ...makeRoofState(), gps: null } },
      { roofState: makeRoofState(), frozenBlocks: [makeBlock("b1", "pan-1")], shading: makeShading() },
    ];
    const keys = ["dataLevel", "geometryStatus", "panelsStatus", "gpsStatus", "shadingStatus",
      "canTrustForDisplay", "canTrustForShading", "canTrustForValidation", "reason"];
    for (const data of transitions) {
      const r = classifyCalpinageDataIntegrity(data);
      for (const key of keys) {
        expect(r, `Clé ${key} manquante`).toHaveProperty(key);
      }
    }
  });
});
