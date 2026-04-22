/**
 * Prompt 5 — diagnostics binding PV ↔ toiture officielle.
 */

import { describe, expect, it } from "vitest";
import type { PvPanelPlacementInput } from "../pvPanelInput";
import type { RoofReconstructionQualityDiagnostics } from "../../builder/roofReconstructionQuality";
import {
  computePvBindingDiagnostics,
  emptyPvBindingDiagnostics,
  filterPvPlacementInputsForOfficialBinding,
} from "../pvBindingDiagnostics";

function roofQ(partial: Partial<RoofReconstructionQualityDiagnostics>): RoofReconstructionQualityDiagnostics {
  return {
    roofReconstructionQuality: "TRUTHFUL",
    panCount: 1,
    solvedPanCount: 1,
    partiallySolvedPanCount: 0,
    fallbackPanCount: 0,
    sharedEdgeResolvedCount: 0,
    sharedEdgeConflictCount: 0,
    structuralConstraintCount: 0,
    roofTopologyWarnings: [],
    perPanTruth: [{ panId: "pan-a", truthClass: "TRUTHFUL" }],
    ...partial,
  };
}

const panelOnPanA = (id: string): PvPanelPlacementInput => ({
  id,
  roofPlanePatchId: "pan-a",
  center: { mode: "world", position: { x: 1, y: 1, z: 0 } },
  widthM: 1,
  heightM: 1.7,
  orientation: "portrait",
  rotationDegInPlane: 0,
  sampling: { nx: 2, ny: 2 },
});

describe("pvBindingDiagnostics (Prompt 5)", () => {
  it("CAS 1 — toiture TRUTHFUL + panneaux valides → pvBindingQuality OK", () => {
    const q = roofQ({});
    const p1 = panelOnPanA("p1");
    const p2 = panelOnPanA("p2");
    const filtered = filterPvPlacementInputsForOfficialBinding([p1, p2], q);
    expect(filtered.length).toBe(2);
    const d = computePvBindingDiagnostics({
      rawEnginePanelCount: 2,
      officialPlacementPanels: [p1, p2],
      panelsSubmittedToPvBuild: filtered,
      builtPanelIds: new Set(["p1", "p2"]),
      roofReconstructionQuality: q,
      roofGeometrySource: "REAL_ROOF_PANS",
    });
    expect(d.pvBindingQuality).toBe("OK");
    expect(d.boundPanelCount).toBe(2);
    expect(d.orphanPanelCount).toBe(0);
    expect(d.rejectedPanelCount).toBe(0);
    expect(d.usedOfficialRoofModel).toBe(true);
    expect(d.perPanel.every((r) => r.bindingStatus === "OK")).toBe(true);
  });

  it("CAS 2 — reconstruction PARTIAL → binding PARTIAL même si géométrie produite", () => {
    const q = roofQ({
      roofReconstructionQuality: "PARTIAL",
      perPanTruth: [{ panId: "pan-a", truthClass: "TRUTHFUL" }],
    });
    const p = panelOnPanA("p1");
    const d = computePvBindingDiagnostics({
      rawEnginePanelCount: 1,
      officialPlacementPanels: [p],
      panelsSubmittedToPvBuild: [p],
      builtPanelIds: new Set(["p1"]),
      roofReconstructionQuality: q,
      roofGeometrySource: "REAL_ROOF_PANS",
    });
    expect(d.pvBindingQuality).toBe("PARTIAL");
    expect(d.perPanel[0]?.bindingStatus).toBe("PARTIAL");
    expect(d.perPanel[0]?.warningCodes.some((c) => c.startsWith("PV_SUPPORT_ROOF_QUALITY"))).toBe(true);
  });

  it("CAS 3 — panId / patch divergent (non replacé) → orphan diagnostiqué", () => {
    const q = roofQ({});
    const p = panelOnPanA("p1");
    const d = computePvBindingDiagnostics({
      rawEnginePanelCount: 2,
      officialPlacementPanels: [p],
      panelsSubmittedToPvBuild: [p],
      builtPanelIds: new Set(["p1"]),
      roofReconstructionQuality: q,
      roofGeometrySource: "REAL_ROOF_PANS",
    });
    expect(d.orphanPanelCount).toBe(1);
    expect(d.pvBindingWarnings.some((w) => w.startsWith("PV_ORPHAN_ENGINE_PANELS"))).toBe(true);
  });

  it("CAS 4 — toiture fallback contour → aucun panneau OK plein", () => {
    const q = roofQ({
      perPanTruth: [{ panId: "pan-a", truthClass: "TRUTHFUL" }],
    });
    const p = panelOnPanA("p1");
    const d = computePvBindingDiagnostics({
      rawEnginePanelCount: 1,
      officialPlacementPanels: [p],
      panelsSubmittedToPvBuild: [p],
      builtPanelIds: new Set(["p1"]),
      roofReconstructionQuality: q,
      roofGeometrySource: "FALLBACK_BUILDING_CONTOUR",
    });
    expect(d.pvBindingQuality).toBe("PARTIAL");
    expect(d.perPanel[0]?.bindingStatus).toBe("PARTIAL");
    expect(d.perPanel[0]?.warningCodes).toContain("PV_SUPPORT_ROOF_FALLBACK_CONTOUR");
  });

  it("support patch INCOHERENT → filtré avant build, REJECTED au diagnostic", () => {
    const q = roofQ({
      roofReconstructionQuality: "INCOHERENT",
      perPanTruth: [{ panId: "pan-a", truthClass: "INCOHERENT" }],
    });
    const p = panelOnPanA("p1");
    const filtered = filterPvPlacementInputsForOfficialBinding([p], q);
    expect(filtered.length).toBe(0);
    const d = computePvBindingDiagnostics({
      rawEnginePanelCount: 1,
      officialPlacementPanels: [p],
      panelsSubmittedToPvBuild: filtered,
      builtPanelIds: new Set(),
      roofReconstructionQuality: q,
      roofGeometrySource: "REAL_ROOF_PANS",
    });
    expect(d.rejectedPanelCount).toBeGreaterThanOrEqual(1);
    expect(d.perPanel[0]?.bindingStatus).toBe("REJECTED");
  });

  it("emptyPvBindingDiagnostics — forme stable", () => {
    const e = emptyPvBindingDiagnostics();
    expect(e.usedOfficialRoofModel).toBe(true);
    expect(e.totalPanelCount).toBe(0);
    expect(e.pvBindingQuality).toBe("OK");
  });
});
