import { describe, expect, it } from "vitest";
import { roofPatchGeometry } from "../../viewer/solarSceneThreeGeometry";
import { auditExtremeGeometryScene, auditPatchTriangulation, geometryToMeshAudit } from "./extremeGeometryDiagnostics";
import { makeExtremeGeometryFixtures } from "./extremeGeometryFixtures";

const statusRank = { VALID: 0, DEGRADED: 1, INVALID: 2 } as const;

function summarizeDiagnostics(audit: ReturnType<typeof auditExtremeGeometryScene>): string {
  return audit.patchAudits
    .flatMap((p) => p.diagnostics)
    .concat(audit.orphanPvPanelIds.map((id) => `${id} changed roof association/orphaned`))
    .concat(audit.orphanObstacleIds.map((id) => `${id} obstacle association/orphaned`))
    .join("\n");
}

describe("extremeGeometry / invariants 2D-canonical-mesh-PV", () => {
  for (const fixture of makeExtremeGeometryFixtures()) {
    it(`${fixture.id}: ${fixture.description}`, () => {
      const audit = auditExtremeGeometryScene(fixture.id, fixture.scene);
      expect(fixture.scene.metadata.geometryTruthStatus).toBe(audit.status);
      expect(statusRank[audit.status], summarizeDiagnostics(audit)).toBeGreaterThanOrEqual(
        statusRank[fixture.expectedMinStatus],
      );
      expect(audit.orphanPvPanelIds, summarizeDiagnostics(audit)).toHaveLength(0);
      expect(audit.orphanObstacleIds, summarizeDiagnostics(audit)).toHaveLength(0);

      for (const patch of fixture.scene.roofModel.roofPlanePatches) {
        const patchAudit = auditPatchTriangulation(patch);
        const geometry = roofPatchGeometry(patch);
        const meshAudit = geometryToMeshAudit(geometry);
        expect(meshAudit.vertexCount).toBe(patchAudit.vertexCount);
        expect(meshAudit.triangleCount).toBe(patchAudit.triangleCount);
        expect(Number.isFinite(patchAudit.polygonAreaM2)).toBe(true);
        expect(Number.isFinite(patchAudit.meshAreaM2)).toBe(true);
        geometry.dispose();
      }
    });
  }

  it("classe explicitement les degradations de triangulation au lieu de les rendre silencieuses", () => {
    const audits = makeExtremeGeometryFixtures()
      .flatMap((fixture) => fixture.scene.roofModel.roofPlanePatches.map((patch) => auditPatchTriangulation(patch)))
      .map((audit) => [audit.patchId, audit.method, audit.status, audit.areaDeltaM2] as const);

    expect(
      audits.some(
        ([id, method, status]) =>
          id === "bowtie-uv-but-world-rect" &&
          method === "TRIANGULATION_INVALID" &&
          status === "INVALID",
      ),
    ).toBe(true);
    expect(
      audits.some(
        ([id, method, status]) =>
          id === "fan-fallback-collinear" &&
          method === "TRIANGULATION_INVALID" &&
          status === "INVALID",
      ),
    ).toBe(true);
  });
});
