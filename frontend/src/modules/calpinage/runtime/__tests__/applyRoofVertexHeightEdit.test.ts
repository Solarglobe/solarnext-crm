import { describe, it, expect } from "vitest";
import { calpinageStateToLegacyRoofInput } from "../../adapter/calpinageStateToLegacyRoofInput";
import { buildSolarScene3DFromCalpinageRuntime } from "../../canonical3d/buildSolarScene3DFromCalpinageRuntime";
import { minimalCalpinageRuntimeFixture } from "../../canonical3d/dev/minimalCalpinageRuntimeFixture";
import { applyRoofVertexHeightEdit, readCalpinagePanVertexHeightM } from "../applyRoofVertexHeightEdit";

/** Copie JSON profonde — même forme que les fixtures runtime tests 3D. */
function cloneRuntimeFixture() {
  return JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
}

describe("applyRoofVertexHeightEdit", () => {
  it("readCalpinagePanVertexHeightM lit h sur polygonPx", () => {
    const runtime = cloneRuntimeFixture();
    expect(readCalpinagePanVertexHeightM(runtime, "pan-a", 0)).toBe(null);
    (runtime.pans[0]!.polygonPx![0] as { h: number }).h = 4.2;
    expect(readCalpinagePanVertexHeightM(runtime, "pan-a", 0)).toBe(4.2);
    expect(applyRoofVertexHeightEdit(runtime, { panId: "pan-a", vertexIndex: 1, heightM: 6 }).ok).toBe(true);
    expect(readCalpinagePanVertexHeightM(runtime, "pan-a", 1)).toBe(6);
  });

  it("rejette hauteur hors plage", () => {
    const r = applyRoofVertexHeightEdit(cloneRuntimeFixture(), {
      panId: "pan-a",
      vertexIndex: 0,
      heightM: 99,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_HEIGHT_M");
  });

  it("un sommet : state.pans + chaîne legacy (calpinageStateToLegacyRoofInput)", () => {
    const runtime = cloneRuntimeFixture();
    for (const pt of runtime.pans[0]!.polygonPx!) {
      (pt as { h: number }).h = 3;
    }
    expect(applyRoofVertexHeightEdit(runtime, { panId: "pan-a", vertexIndex: 2, heightM: 8.5 }).ok).toBe(true);
    const legacy = calpinageStateToLegacyRoofInput(runtime.roof, null, { warnIfNoRuntime: false }, runtime);
    expect(legacy?.pans?.[0]?.polygonPx?.[2]?.heightM).toBe(8.5);
    expect(legacy?.pans?.[0]?.polygonPx?.[0]?.heightM).toBe(3);
  });

  /**
   * Rebuild complet : le validateur marque PAN_DEGENERATE si un seul sommet diffère (plan brisé).
   * Ici on prouve Z monde après édition **uniforme** (même API, un appel par sommet).
   */
  it("rebuild SolarScene3D : même heightM sur tous les sommets → Z patch alignée", () => {
    const runtime = cloneRuntimeFixture();
    for (let i = 0; i < 4; i++) {
      expect(applyRoofVertexHeightEdit(runtime, { panId: "pan-a", vertexIndex: i, heightM: 0 }).ok).toBe(true);
    }
    const before = buildSolarScene3DFromCalpinageRuntime(runtime);
    expect(before.ok).toBe(true);
    const zBefore = before.scene!.roofModel.roofPlanePatches[0]!.cornersWorld.map((c) => c.z);

    for (let i = 0; i < 4; i++) {
      expect(applyRoofVertexHeightEdit(runtime, { panId: "pan-a", vertexIndex: i, heightM: 7.125 }).ok).toBe(true);
    }
    const after = buildSolarScene3DFromCalpinageRuntime(runtime);
    expect(after.ok).toBe(true);
    const corners = after.scene!.roofModel.roofPlanePatches[0]!.cornersWorld;
    for (let i = 0; i < 4; i++) {
      expect(corners[i]!.z).toBeCloseTo(zBefore[i] ?? 0, 4);
    }
    const legacyAfter = calpinageStateToLegacyRoofInput(runtime.roof, null, { warnIfNoRuntime: false }, runtime);
    for (const pt of legacyAfter!.pans[0]!.polygonPx) {
      expect(pt.heightM).toBeCloseTo(7.125, 4);
    }
    /** Z patch reste normalisée (worldZOriginShiftM) — la cote métier est dans `h` / legacy + base shell. */
    expect(after.scene!.buildingShell).not.toBeNull();
    expect(after.scene!.buildingShell!.baseElevationM).toBeCloseTo(-7.125, 2);
    expect(before.scene!.buildingShell!.baseElevationM).not.toBeCloseTo(
      after.scene!.buildingShell!.baseElevationM,
      1,
    );
  });
});
