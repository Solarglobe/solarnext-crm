import { describe, expect, it } from "vitest";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { createDefaultQualityBlock } from "../../utils/factories";
import { roofPatchGeometry } from "../../viewer/solarSceneThreeGeometry";
import { makeExtremeGeometryFixtures } from "./extremeGeometryFixtures";
import { auditExtremeGeometryScene, stableSceneGeometrySignature } from "./extremeGeometryDiagnostics";

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

describe("extremeGeometry / stress performance logique", () => {
  it("mesure une scene 20 pans + 15 obstacles + 60 PV sans inventer de FPS", () => {
    const fixture = makeExtremeGeometryFixtures().find((f) => f.id === "twenty-pans-heavy")!;
    expect(fixture.scene.roofModel.roofPlanePatches).toHaveLength(20);
    expect(fixture.scene.obstacleVolumes).toHaveLength(15);
    expect(fixture.scene.pvPanels).toHaveLength(60);

    const t0 = nowMs();
    const rebuilt = buildSolarScene3D({
      roofModel: fixture.scene.roofModel,
      obstacleVolumes: fixture.scene.obstacleVolumes,
      extensionVolumes: fixture.scene.extensionVolumes,
      volumesQuality: createDefaultQualityBlock(),
      pvPanels: fixture.scene.pvPanels,
      studyRef: "twenty-pans-heavy-rebuild",
    });
    const rebuildMs = nowMs() - t0;

    const t1 = nowMs();
    const geometries = rebuilt.roofModel.roofPlanePatches.map((patch) => roofPatchGeometry(patch));
    const meshMs = nowMs() - t1;
    const triangleCount = geometries.reduce((sum, geometry) => sum + (geometry.getIndex()?.count ?? 0) / 3, 0);
    geometries.forEach((geometry) => geometry.dispose());

    const t2 = nowMs();
    const audits = auditExtremeGeometryScene("twenty-pans-heavy", rebuilt);
    const auditMs = nowMs() - t2;

    const signatures = new Set<string>();
    for (let i = 0; i < 5; i++) {
      signatures.add(
        stableSceneGeometrySignature(
          buildSolarScene3D({
            roofModel: fixture.scene.roofModel,
            obstacleVolumes: fixture.scene.obstacleVolumes,
            extensionVolumes: fixture.scene.extensionVolumes,
            volumesQuality: createDefaultQualityBlock(),
            pvPanels: fixture.scene.pvPanels,
            studyRef: "twenty-pans-heavy-rebuild",
          }),
        ),
      );
    }

    const metrics = {
      rebuildMs: Number(rebuildMs.toFixed(3)),
      meshMs: Number(meshMs.toFixed(3)),
      auditMs: Number(auditMs.toFixed(3)),
      roofPans: rebuilt.roofModel.roofPlanePatches.length,
      obstacles: rebuilt.obstacleVolumes.length,
      pvPanels: rebuilt.pvPanels.length,
      triangles: triangleCount,
      redundantLogicalRebuildsForFiveIdenticalInputs: signatures.size,
    };
    console.info("[extremeGeometry:stress]", metrics);

    expect(audits.status).toBe("VALID");
    expect(signatures.size).toBe(1);
    expect(rebuildMs).toBeLessThan(250);
    expect(meshMs).toBeLessThan(250);
    expect(auditMs).toBeLessThan(250);
  });
});
