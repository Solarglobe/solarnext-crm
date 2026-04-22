/**
 * Rapport de parité sur plusieurs fixtures batterie (ne plante pas, signaux attendus).
 */

import { describe, it, expect } from "vitest";
import { compareLegacyAndCanonical3D } from "../compareLegacyAndCanonical3D";
import {
  RUNTIME_3D_FIXTURE_BATTERY,
  RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS,
} from "../runtime3DFixtureBattery";

describe("runtime3DFixtureParity — intégration", () => {
  it.each([...RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS])(
    "fixture officielle %s : rapport complet + canonical OK",
    (fixtureId) => {
      const b = RUNTIME_3D_FIXTURE_BATTERY[fixtureId]!;
      const r = compareLegacyAndCanonical3D({
        sceneId: b.id,
        runtime: b.runtime,
        getAllPanels: () => b.panels,
      });
      expect(r.sceneId).toBe(b.id);
      expect(r.meta.canonicalBuildOk).toBe(true);
      expect(r.meta.canonical3DEligible).toBe(true);
      expect(r.pans.legacyCount).toBe(r.pans.canonicalCount);
      expect(r.panels.legacyCount).toBe(r.panels.canonicalCount);
      expect(r.obstacles.legacyObstacleCount).toBe(r.obstacles.canonicalObstacleVolumeCount);
    },
  );

  it("partial-missing-world-contract : contrat matérialisé au build, canonical OK", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY["partial-missing-world-contract"]!;
    const r = compareLegacyAndCanonical3D({
      sceneId: b.id,
      runtime: b.runtime,
      getAllPanels: () => b.panels,
    });
    expect(r.meta.canonicalBuildOk).toBe(true);
    expect(r.meta.canonical3DEligible).toBe(true);
    expect(r.sceneGlobal.canonicalScenePresent).toBe(true);
  });
});
