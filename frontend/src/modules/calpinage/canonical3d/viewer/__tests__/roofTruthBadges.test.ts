import { describe, expect, it } from "vitest";
import { buildDemoSolarScene3D } from "../demoSolarScene3d";
import { resolveRoofTruthBadge } from "../roofTruthBadges";

describe("roofTruthBadges", () => {
  it("traduit la vérité géométrique Phase A en libellés produit par pan", () => {
    const base = buildDemoSolarScene3D();
    const patch = base.roofModel.roofPlanePatches[0]!;
    const panId = String(patch.id);

    const cases = [
      ["TRUTHFUL", "Mesuré"],
      ["PARTIAL", "Déduit"],
      ["FALLBACK", "Générique"],
      ["INCOHERENT", "Incohérent"],
    ] as const;

    for (const [truthClass, label] of cases) {
      const scene = {
        ...base,
        metadata: {
          ...base.metadata,
          roofQualityPhaseA: {
            quality: truthClass,
            topologyWarnings: [],
            panChecks: [{ panId, truthClass, hintFr: `indice ${label}` }],
            stepsFr: [],
          },
        },
      };
      const badge = resolveRoofTruthBadge(scene, patch);
      expect(badge.label).toBe(label);
      expect(badge.truthClass).toBe(truthClass);
      expect(badge.title).toContain(`Pan ${panId}`);
      expect(badge.title).toContain(`indice ${label}`);
    }
  });

  it("dégrade en générique depuis les diagnostics du patch si le metadata Phase A/B est absent", () => {
    const scene = buildDemoSolarScene3D();
    const patch = {
      ...scene.roofModel.roofPlanePatches[0]!,
      quality: {
        confidence: "low" as const,
        diagnostics: [
          {
            code: "HEIGHT_FALLBACK_DEFAULT_ON_CORNERS",
            severity: "warning" as const,
            message: "Hauteur par défaut.",
          },
        ],
      },
    };

    const badge = resolveRoofTruthBadge(scene, patch);
    expect(badge.truthClass).toBe("FALLBACK");
    expect(badge.label).toBe("Générique");
  });
});
