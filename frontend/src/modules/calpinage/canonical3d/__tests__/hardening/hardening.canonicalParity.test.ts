/**
 * Parité / déterminisme : le backend Node ne réimplémente pas encore le raycast 3D canonical.
 * On garantit ici idempotence et stabilité numérique côté frontend pur.
 */
import { describe, expect, it } from "vitest";
import { runNearShadingSeries } from "../../nearShading3d/nearShadingEngine";
import { buildZenithOcclusionScene, SUN_ZENITH } from "./hardeningSceneFactories";

describe("hardening — parité / déterminisme (canonical engine)", () => {
  it("deux appels identiques → même agrégat", () => {
    const scene = buildZenithOcclusionScene(1);
    const a = runNearShadingSeries(scene, [SUN_ZENITH]);
    const b = runNearShadingSeries(scene, [SUN_ZENITH]);
    expect(a.annual.meanShadedFraction).toBe(b.annual.meanShadedFraction);
    expect(a.annual.nearShadingLossProxy).toBe(b.annual.nearShadingLossProxy);
  });
});
