import { describe, expect, it } from "vitest";
import { buildRoofModel3DFromLegacyGeometry } from "../../builder/buildRoofModel3DFromLegacyGeometry";
import type { LegacyRoofGeometryInput, LegacyPanInput } from "../../builder/legacyInput";
import { validateRoofCommercialGeometry } from "../roofCommercialGeometryValidation";
import { computePvBindingDiagnostics } from "../../pvPanels/pvBindingDiagnostics";

function pan(
  id: string,
  roofKind: LegacyPanInput["roofKind"],
  heights: readonly (number | undefined)[],
  hints?: { readonly tiltDegHint?: number; readonly azimuthDegHint?: number },
  roofKindProvenance: LegacyPanInput["roofKindProvenance"] = roofKind == null ? "UNRESOLVED" : "EXPLICIT",
): LegacyPanInput {
  const pts = [
    { xPx: 0, yPx: 0 },
    { xPx: 10, yPx: 0 },
    { xPx: 10, yPx: 10 },
    { xPx: 0, yPx: 10 },
  ];
  return {
    id,
    roofKind,
    roofKindProvenance,
    polygonPx: pts.map((p, i) => (heights[i] !== undefined ? { ...p, heightM: heights[i]! } : p)),
    ...hints,
  };
}

function heightDeltaForTiltDeg(tiltDeg: number, runM = 10): number {
  return Math.tan(tiltDeg * Math.PI / 180) * runM;
}

function build(input: LegacyRoofGeometryInput) {
  const roofResult = buildRoofModel3DFromLegacyGeometry(input, { roofGeometryFidelityMode: "hybrid" });
  return {
    roofResult,
    validation: validateRoofCommercialGeometry({ legacyInput: input, roofResult }),
  };
}

describe("validateRoofCommercialGeometry", () => {
  it("accepte une vraie toiture plate volontaire a pente nulle", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("flat", "FLAT", [5, 5, 5, 5])] };
    const { validation, roofResult } = build(input);
    expect(roofResult.model.roofPlanePatches[0]!.tiltDeg).toBeLessThanOrEqual(0.01);
    expect(validation.status).toBe("VALID");
    expect(validation.officialPvPlacementAllowed).toBe(true);
    expect(validation.officialNearShadingAllowed).toBe(true);
  });

  it("accepte une toiture plate explicite avec faible pente de drainage", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("flat-drain", "FLAT", [5, 5, 5.05, 5.05])] };
    const { validation } = build(input);
    expect(validation.status).toBe("VALID");
    expect(validation.panResults[0]!.tiltDeg).toBeGreaterThan(0);
    expect(validation.panResults[0]!.tiltDeg).toBeLessThan(5);
  });

  it("refuse une toiture plate explicite si la hauteur commerciale vient du fallback", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("flat-fallback", "FLAT", [undefined, undefined, undefined, undefined])] };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_FLAT_ROOF_HEIGHT_FALLBACK");
    expect(validation.officialPvPlacementAllowed).toBe(false);
    expect(validation.officialNearShadingAllowed).toBe(false);
  });

  it("accepte une toiture double pente reconstruite avec deux pans inclinés", () => {
    const input: LegacyRoofGeometryInput = {
      metersPerPixel: 1,
      northAngleDeg: 0,
      defaultHeightM: 5,
      pans: [
        {
          id: "north",
          roofKind: "PITCHED",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 5 },
            { xPx: 10, yPx: 0, heightM: 5 },
            { xPx: 10, yPx: 10, heightM: 7 },
            { xPx: 0, yPx: 10, heightM: 7 },
          ],
        },
        {
          id: "south",
          roofKind: "PITCHED",
          polygonPx: [
            { xPx: 0, yPx: 10, heightM: 7 },
            { xPx: 10, yPx: 10, heightM: 7 },
            { xPx: 10, yPx: 20, heightM: 5 },
            { xPx: 0, yPx: 20, heightM: 5 },
          ],
        },
      ],
    };
    const { validation } = build(input);
    expect(validation.status).toBe("VALID");
    expect(validation.panResults).toHaveLength(2);
    expect(validation.panResults.every((p) => p.tiltDeg != null && p.tiltDeg > 0.75)).toBe(true);
  });

  it("accepte une toiture monopente correctement reconstruite", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("mono", "PITCHED", [5, 5, 7, 7])] };
    const { validation } = build(input);
    expect(validation.status).toBe("VALID");
    expect(validation.panResults[0]!.physicalSlopeDeg).toBeGreaterThan(0.75);
  });

  it("bloque UNKNOWN sans typologie fiable même si la scène reste géométriquement construite", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("unknown", null, [5, 5, 7, 7])] };
    const { validation, roofResult } = build(input);
    expect(roofResult.model.roofPlanePatches).toHaveLength(1);
    expect(validation.status).toBe("INVALID");
    expect(validation.officialPvPlacementAllowed).toBe(false);
    expect(validation.officialNearShadingAllowed).toBe(false);
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_ROOF_KIND_UNRESOLVED");
  });

  it("bloque UNKNOWN visuellement plat sans provenance fiable", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("unknown-flat", null, [5, 5, 5, 5])] };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_ROOF_KIND_UNRESOLVED");
  });

  it("bloque UNKNOWN avec hauteurs fallback", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("unknown-fallback", null, [undefined, undefined, undefined, undefined])] };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.officialPvPlacementAllowed).toBe(false);
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_ROOF_KIND_UNRESOLVED");
  });

  it("accepte une typologie résolue par migration déterministe si la géométrie est valide", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("migrated", "PITCHED", [5, 5, 7, 7], undefined, "MIGRATED_DETERMINISTIC")] };
    const { validation } = build(input);
    expect(validation.status).toBe("VALID");
    expect(validation.panResults[0]!.roofKindProvenance).toBe("MIGRATED_DETERMINISTIC");
  });

  it("accepte une typologie inférée haute confiance sans fallback si la géométrie est valide", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("inferred", "PITCHED", [5, 5, 7, 7], undefined, "INFERRED_HIGH_CONFIDENCE")] };
    const { validation } = build(input);
    expect(validation.status).toBe("VALID");
    expect(validation.panResults[0]!.roofKindProvenance).toBe("INFERRED_HIGH_CONFIDENCE");
  });

  it("refuse une toiture inclinée sans hauteur structurante", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("missing", "PITCHED", [undefined, undefined, undefined, undefined])] };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.officialPvPlacementAllowed).toBe(false);
    expect(validation.officialNearShadingAllowed).toBe(false);
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_ROOF_HEIGHT_SIGNAL_MISSING");
  });

  it("refuse une toiture inclinée artificiellement aplatie par fallback", () => {
    const input = {
      metersPerPixel: 1,
      northAngleDeg: 0,
      defaultHeightM: 5,
      pans: [pan("fallback-flat", "PITCHED", [undefined, undefined, undefined, undefined], { tiltDegHint: 30, azimuthDegHint: 0 })],
    };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.officialPvPlacementAllowed).toBe(false);
    expect(validation.officialNearShadingAllowed).toBe(false);
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_ROOF_RECONSTRUCTION_BLOCKING");
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_PITCHED_ROOF_HEIGHT_FALLBACK");
  });

  it("refuse une géométrie dégénérée", () => {
    const input: LegacyRoofGeometryInput = {
      metersPerPixel: 1,
      northAngleDeg: 0,
      defaultHeightM: 5,
      pans: [{ id: "deg", roofKind: "PITCHED", polygonPx: [{ xPx: 0, yPx: 0, heightM: 5 }, { xPx: 0, yPx: 0, heightM: 6 }, { xPx: 0, yPx: 0, heightM: 7 }] }],
    };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.officialNearShadingAllowed).toBe(false);
  });

  it("refuse une toiture FLAT explicite avec pente contradictoire forte", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("flat-contradictory", "FLAT", [5, 5, 7, 7])] };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_FLAT_ROOF_EXCESSIVE_TILT");
  });

  it("refuse les valeurs non finies", () => {
    const input: LegacyRoofGeometryInput = {
      metersPerPixel: 1,
      northAngleDeg: 0,
      defaultHeightM: 5,
      pans: [{ id: "nan", roofKind: "PITCHED", polygonPx: [{ xPx: 0, yPx: 0, heightM: 5 }, { xPx: 10, yPx: 0, heightM: Number.NaN }, { xPx: 10, yPx: 10, heightM: 7 }, { xPx: 0, yPx: 10, heightM: 7 }] }],
    };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
  });

  it("classe PARTIAL exploitable quand la forme physique reste inclinée et finie", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("partial-ok", "PITCHED", [5, 5, 7, 7])] };
    const { roofResult } = build(input);
    const partialRoofResult = {
      ...roofResult,
      roofReconstructionQuality: {
        ...roofResult.roofReconstructionQuality,
        roofReconstructionQuality: "PARTIAL" as const,
        roofTopologyWarnings: ["SECONDARY_TRACE_MISSING"],
      },
    };
    const validation = validateRoofCommercialGeometry({ legacyInput: input, roofResult: partialRoofResult });
    expect(validation.commercialUsable).toBe(true);
    expect(validation.officialPvPlacementAllowed).toBe(true);
    expect(validation.status).toBe("DEGRADED");
    expect(validation.officialNearShadingAllowed).toBe(true);
  });

  it("classe PARTIAL non exploitable quand les données manquantes aplatissent la forme", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("partial-bad", "PITCHED", [5, undefined, undefined, 5])] };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.officialNearShadingAllowed).toBe(false);
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_PITCHED_ROOF_RECONSTRUCTED_FLAT");
  });

  it("ne laisse pas un span Z absolu contourner la pente physique sur grande portée", () => {
    const dz = 0.021;
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("large-low", "PITCHED", [5, 5, 5 + dz, 5 + dz])] };
    const { validation } = build(input);
    expect(validation.panResults[0]!.zSpanM).toBeGreaterThan(0.02);
    expect(validation.panResults[0]!.physicalSlopeDeg).toBeLessThan(0.75);
    expect(validation.status).toBe("INVALID");
  });

  it("teste la limite métier 0.74° / 0.75° / 0.76° sans porte span Z indépendante", () => {
    const under = build({ metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 0, pans: [pan("under", "PITCHED", [0, 0, heightDeltaForTiltDeg(0.74), heightDeltaForTiltDeg(0.74)])] }).validation;
    const exact = build({ metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 0, pans: [pan("exact", "PITCHED", [0, 0, heightDeltaForTiltDeg(0.75), heightDeltaForTiltDeg(0.75)])] }).validation;
    const over = build({ metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 0, pans: [pan("over", "PITCHED", [0, 0, heightDeltaForTiltDeg(0.76), heightDeltaForTiltDeg(0.76)])] }).validation;
    expect(under.status).toBe("INVALID");
    expect(exact.status).toBe("INVALID");
    expect(over.status).toBe("VALID");
  });

  it("normalise les dénivelés négatifs et accepte une pente physique suffisante", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 0, pans: [pan("negative", "PITCHED", [7, 7, 5, 5])] };
    const { validation } = build(input);
    expect(validation.status).toBe("VALID");
    expect(validation.panResults[0]!.zSpanM).toBeCloseTo(2, 8);
    expect(validation.panResults[0]!.physicalSlopeDeg).toBeGreaterThan(0.75);
  });

  it("refuse une incohérence entre pente saisie et normale reconstruite", () => {
    const input = { metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("hint-mismatch", "PITCHED", [5, 5, 7, 7], { tiltDegHint: 1 })] };
    const { validation } = build(input);
    expect(validation.status).toBe("INVALID");
    expect(validation.diagnostics.map((d) => d.code)).toContain("COMMERCIAL_ROOF_SLOPE_INCONSISTENT_WITH_NORMAL");
  });

  it("expose un verdict qui permet de conserver le Last Known Good sans promouvoir la nouvelle scène", () => {
    const good = build({ metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("roof", "PITCHED", [5, 5, 7, 7])] });
    const bad = build({ metersPerPixel: 1, northAngleDeg: 0, defaultHeightM: 5, pans: [pan("roof", "PITCHED", [undefined, undefined, undefined, undefined])] });
    expect(good.validation.status).toBe("VALID");
    expect(bad.validation.status).toBe("INVALID");
    expect(bad.validation.commercialUsable).toBe(false);
    expect(bad.validation.officialNearShadingAllowed).toBe(false);
  });

  it("interdit la géométrie invalide pour le placement PV officiel", () => {
    const roofReconstructionQuality = build({
      metersPerPixel: 1,
      northAngleDeg: 0,
      defaultHeightM: 5,
      pans: [pan("p1", "PITCHED", [undefined, undefined, undefined, undefined])],
    }).roofResult.roofReconstructionQuality;
    const pv = computePvBindingDiagnostics({
      rawEnginePanelCount: 1,
      officialPlacementPanels: [{ id: "pv1", roofPlanePatchId: "p1", center: { mode: "plane_uv", uv: { u: 1, v: 1 } }, widthM: 1, heightM: 1.7, orientation: "portrait", rotationDegInPlane: 0, sampling: { nx: 3, ny: 3 } }],
      panelsSubmittedToPvBuild: [],
      builtPanelIds: new Set(),
      roofReconstructionQuality,
      roofGeometrySource: "REAL_ROOF_PANS",
      officialGeometryUsable: false,
      officialGeometryBlockingCodes: ["COMMERCIAL_PITCHED_ROOF_RECONSTRUCTED_FLAT"],
    });
    expect(pv.pvBindingQuality).toBe("REJECTED");
    expect(pv.perPanel[0]!.warningCodes).toContain("PV_REJECT_COMMERCIAL_GEOMETRY_INVALID");
  });
});
