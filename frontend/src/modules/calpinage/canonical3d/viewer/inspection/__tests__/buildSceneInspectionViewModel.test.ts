import { describe, it, expect } from "vitest";
import { buildDemoSolarScene3D } from "../../demoSolarScene3d";
import { buildSceneInspectionViewModel } from "../buildSceneInspectionViewModel";

describe("buildSceneInspectionViewModel", () => {
  const scene = buildDemoSolarScene3D();

  it("résout un pan", () => {
    const m = buildSceneInspectionViewModel(scene, { kind: "PAN", id: "roof-h" });
    expect(m.title).toContain("pan");
    expect(m.rows.some((r) => r.label === "Type" && r.value.includes("Pan"))).toBe(true);
    expect(m.rows.some((r) => r.label === "ID")).toBe(true);
  });

  it("résout un panneau PV", () => {
    const m = buildSceneInspectionViewModel(scene, { kind: "PV_PANEL", id: "pv-1" });
    expect(m.rows.some((r) => r.value === "Panneau PV" || r.value.includes("Panneau"))).toBe(true);
    expect(m.rows.some((r) => r.label === "Pan associé")).toBe(true);
  });

  it("résout un obstacle", () => {
    const m = buildSceneInspectionViewModel(scene, { kind: "OBSTACLE", id: "obs-block" });
    expect(m.hero?.eyebrow).toBe("Inspection obstacle 3D");
    expect(m.rows.some((r) => r.label === "Sous-type")).toBe(true);
    expect(m.rows.some((r) => r.label === "Hauteur")).toBe(true);
    expect(m.rows.some((r) => r.label === "Role shading")).toBe(true);
    expect(m.rows.some((r) => r.label === "Role keepout")).toBe(true);
    expect(m.rows.some((r) => r.label === "Surface impactee")).toBe(true);
  });

  it("panneau inexistant → message clair", () => {
    const m = buildSceneInspectionViewModel(scene, { kind: "PV_PANEL", id: "nope" });
    expect(m.title).toContain("introuvable");
  });

  it("enveloppe sans buildingShell → introuvable", () => {
    const m = buildSceneInspectionViewModel(scene, {
      kind: "SHELL",
      id: "calpinage-building-shell",
    });
    expect(m.title).toContain("introuvable");
  });

  it("pan avec index sommet affiche une ligne dédiée", () => {
    const m = buildSceneInspectionViewModel(scene, {
      kind: "PAN",
      id: "roof-h",
      roofVertexIndexInPatch: 0,
    });
    expect(m.rows.some((r) => r.label === "Sommet (index patch)" && r.value === "0")).toBe(true);
  });
});
