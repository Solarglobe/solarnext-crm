/**
 * Prompt 6 — passerelle scène officielle + signatures + cache.
 */

import { afterEach, describe, expect, it } from "vitest";
import { minimalCalpinageRuntimeFixture } from "../../dev/minimalCalpinageRuntimeFixture";
import {
  clearOfficialSolarScene3DCache,
  getOrBuildOfficialSolarScene3DFromCalpinageRuntime,
} from "../officialSolarScene3DGateway";
import { computeRuntimeSceneStructuralSignatures } from "../sceneRuntimeStructuralSignature";
import type { OfficialRuntimeStructuralChangePayload } from "../../../runtime/emitOfficialRuntimeStructuralChange";
import { getCachedOfficialRoofModelForNearShading } from "../../../integration/officialRoofModelNearShadingCache";

describe("officialSolarScene3DGateway (Prompt 6)", () => {
  afterEach(() => {
    clearOfficialSolarScene3DCache();
  });

  it("CAS 1 — deux appels même runtime → même sceneRuntimeSignature, 2e hit cache", () => {
    const a = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    expect(a.ok).toBe(true);
    expect(a.sceneSyncDiagnostics.usedSceneCache).toBe(false);
    expect(a.sceneSyncDiagnostics.rebuildCountForCurrentSignature).toBe(1);

    const b = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
      previouslyDisplayedSceneRuntimeSignature: a.sceneStructuralSignatures.sceneRuntimeSignature,
    });
    expect(b.sceneStructuralSignatures.sceneRuntimeSignature).toBe(a.sceneStructuralSignatures.sceneRuntimeSignature);
    expect(b.sceneSyncDiagnostics.usedSceneCache).toBe(true);
    expect(b.sceneSyncDiagnostics.rebuildCountForCurrentSignature).toBe(1);
  });

  it("CAS 2 — modification géométrique d’un pan → signature différente, nouveau pipeline", () => {
    const r0 = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    const sig0 = r0.sceneStructuralSignatures.sceneRuntimeSignature;

    const mutated = structuredClone(minimalCalpinageRuntimeFixture) as typeof minimalCalpinageRuntimeFixture;
    const pan = mutated.pans[0]!;
    pan.polygonPx = [
      { x: 101, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 101, y: 200 },
    ];

    const r1 = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(mutated);
    expect(r1.sceneStructuralSignatures.sceneRuntimeSignature).not.toBe(sig0);
    expect(r1.sceneSyncDiagnostics.usedSceneCache).toBe(false);
    expect(r1.sceneSyncDiagnostics.rebuildCountForCurrentSignature).toBe(1);
  });

  it("CAS 3 — champ UI hors extrait structurel → signature inchangée", () => {
    const base = { ...minimalCalpinageRuntimeFixture, uiTool: "select" as const };
    const other = { ...minimalCalpinageRuntimeFixture, uiTool: "draw" as const };
    expect(computeRuntimeSceneStructuralSignatures(base).sceneRuntimeSignature).toBe(
      computeRuntimeSceneStructuralSignatures(other).sceneRuntimeSignature,
    );
  });

  it("CAS 4 — panneaux (getAllPanels) → pvSignature change", () => {
    const panelsA = [{ id: "p1", panId: "pan-a", enabled: true, polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }];
    const panelsB = [{ id: "p2", panId: "pan-a", enabled: true, polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }];

    const sa = computeRuntimeSceneStructuralSignatures(minimalCalpinageRuntimeFixture, {
      getAllPanels: () => panelsA,
    });
    const sb = computeRuntimeSceneStructuralSignatures(minimalCalpinageRuntimeFixture, {
      getAllPanels: () => panelsB,
    });
    expect(sa.pvSignature).not.toBe(sb.pvSignature);
    expect(sa.sceneRuntimeSignature).not.toBe(sb.sceneRuntimeSignature);
  });

  it("CAS 5 — trois appels identiques → rebuildCountForCurrentSignature reste 1", () => {
    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    const c = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    expect(c.sceneSyncDiagnostics.rebuildCountForCurrentSignature).toBe(1);
    expect(c.sceneSyncDiagnostics.usedSceneCache).toBe(true);
  });

  it("signature divergente affichée → STALE une fois puis rattrapage", () => {
    const r0 = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    const wrongPrev = "deadbeef";
    const r1 = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
      previouslyDisplayedSceneRuntimeSignature: wrongPrev,
    });
    expect(r1.sceneSyncDiagnostics.sceneSyncStatus).toBe("STALE");
    expect(r1.sceneSyncDiagnostics.sceneSyncWarnings.length).toBeGreaterThan(0);
    expect(r0.sceneStructuralSignatures.sceneRuntimeSignature).toBe(
      r1.sceneStructuralSignatures.sceneRuntimeSignature,
    );
  });

  it("Prompt 7 — event + cache hit → trace event mais rebuildTriggeredByEvent false", () => {
    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    const detail: OfficialRuntimeStructuralChangePayload = {
      reason: "PAN_UPDATED",
      changedDomains: ["pans"],
      timestamp: 42,
    };
    const r1 = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
      structuralChangeEventDetail: detail,
    });
    expect(r1.sceneSyncDiagnostics.usedSceneCache).toBe(true);
    expect(r1.sceneSyncDiagnostics.rebuildTriggeredByEvent).toBe(false);
    expect(r1.sceneSyncDiagnostics.lastStructuralChangeReason).toBe("PAN_UPDATED");
    expect(r1.sceneSyncDiagnostics.lastStructuralChangeDomains).toEqual(["pans"]);
    expect(r1.sceneSyncDiagnostics.lastEventTimestamp).toBe(42);
  });

  it("Prompt 7 — event + rebuild pipeline → rebuildTriggeredByEvent true", () => {
    const detail: OfficialRuntimeStructuralChangePayload = {
      reason: "CONTOUR_EDITED",
      changedDomains: ["contours"],
      timestamp: 99,
    };
    const mutated = structuredClone(minimalCalpinageRuntimeFixture) as typeof minimalCalpinageRuntimeFixture;
    const pan = mutated.pans[0]!;
    pan.polygonPx = [
      { x: 101, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 101, y: 200 },
    ];
    const r = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(mutated, {
      structuralChangeEventDetail: detail,
    });
    expect(r.sceneSyncDiagnostics.usedSceneCache).toBe(false);
    expect(r.sceneSyncDiagnostics.rebuildTriggeredByEvent).toBe(true);
    expect(r.sceneSyncDiagnostics.lastStructuralChangeReason).toBe("CONTOUR_EDITED");
  });

  it("RoofTruth partagé — hit cache scène : getCachedOfficialRoofModel toujours résolu", () => {
    const getAllPanels = () => [] as unknown[];
    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, { getAllPanels });
    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, { getAllPanels });
    const roof = getCachedOfficialRoofModelForNearShading(minimalCalpinageRuntimeFixture, getAllPanels);
    expect(roof).not.toBeNull();
    expect(roof?.model.roofPlanePatches?.length ?? 0).toBeGreaterThan(0);
  });

  it("RoofTruth partagé — deux signatures distinctes conservent deux entrées", () => {
    const getAllPanels = () => [] as unknown[];
    const mutated = structuredClone(minimalCalpinageRuntimeFixture) as typeof minimalCalpinageRuntimeFixture;
    const pan = mutated.pans[0]!;
    pan.polygonPx = [
      { x: 101, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 101, y: 200 },
    ];

    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, { getAllPanels });
    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(mutated, { getAllPanels });

    const roofA = getCachedOfficialRoofModelForNearShading(minimalCalpinageRuntimeFixture, getAllPanels);
    const roofB = getCachedOfficialRoofModelForNearShading(mutated, getAllPanels);
    expect(roofA).not.toBeNull();
    expect(roofB).not.toBeNull();
    expect(roofA).not.toBe(roofB);
  });

  it("CACHE GUARD — scène 0-panneau non mise en cache si getAllPanels() > 0 (bloc actif non figé)", () => {
    // Simule le cas : getAllPanels() retourne des panneaux (pipeline en a reçu)
    // mais la scène produite contient 0 pvPanels (résultat transitoire ou bug pipeline).
    // Le gateway ne doit PAS mettre en cache ce résultat → 2e appel relance le pipeline.
    const getAllPanels = () => [
      { id: "activeBlock_0", panId: "pan-1", enabled: true, polygonPx: null },
    ] as unknown[];

    const r1 = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
      getAllPanels,
    });
    // Le fixture minimal produit 0 pvPanels ; getAllPanels > 0 → guard active → pas de cache
    const hasPvPanels = (r1.scene?.pvPanels?.length ?? 0) > 0;
    if (!hasPvPanels) {
      // Guard attendue : 2e appel doit relancer le pipeline (pas de cache hit)
      const r2 = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
        getAllPanels,
      });
      expect(r2.sceneSyncDiagnostics.usedSceneCache).toBe(false);
      expect(r2.sceneSyncDiagnostics.rebuildCountForCurrentSignature).toBe(2);
    } else {
      // Si le fixture produit des panneaux, la garde ne s'active pas (comportement normal)
      const r2 = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
        getAllPanels,
      });
      expect(r2.sceneSyncDiagnostics.usedSceneCache).toBe(true);
    }
  });

  it("forceStructuralRebuild relance le pipeline et ré-enregistre RoofTruth", () => {
    const getAllPanels = () => [] as unknown[];
    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, { getAllPanels });
    const rForce = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
      getAllPanels,
      forceStructuralRebuild: true,
    });
    expect(rForce.sceneSyncDiagnostics.usedSceneCache).toBe(false);
    expect(rForce.sceneSyncDiagnostics.rebuildCountForCurrentSignature).toBe(2);
    expect(getCachedOfficialRoofModelForNearShading(minimalCalpinageRuntimeFixture, getAllPanels)).not.toBeNull();
  });
});
