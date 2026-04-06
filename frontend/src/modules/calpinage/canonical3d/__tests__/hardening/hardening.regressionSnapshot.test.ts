/**
 * Snapshots Vitest sur métriques clés — alerte si dérive involontaire du moteur.
 */
import { describe, expect, it } from "vitest";
import { runNearShadingSeries } from "../../nearShading3d/nearShadingEngine";
import { buildClearZenithScene, buildZenithOcclusionScene, SUN_ZENITH } from "./hardeningSceneFactories";

describe("hardening — régression (snapshots)", () => {
  it("métriques de référence zénith", () => {
    const clear = runNearShadingSeries(buildClearZenithScene(1), [SUN_ZENITH]);
    const occ = runNearShadingSeries(buildZenithOcclusionScene(1), [SUN_ZENITH]);
    expect({
      clearMean: clear.annual.meanShadedFraction,
      occMean: occ.annual.meanShadedFraction,
      occMin: occ.annual.minShadedFraction,
      occMax: occ.annual.maxShadedFraction,
    }).toMatchSnapshot();
  });
});
