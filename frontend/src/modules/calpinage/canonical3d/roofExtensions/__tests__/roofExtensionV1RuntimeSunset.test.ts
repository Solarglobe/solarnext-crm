import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("RoofExtensionV1 runtime sunset guards", () => {
  it("le viewer produit ne peut plus importer l'ancien renderer dormer legacy", () => {
    const viewer = readRepoFile("frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx");

    expect(viewer).toContain("scene.extensionVolumes");
    expect(viewer).not.toContain("buildDormerMesh");
    expect(viewer).not.toContain("canonicalDormerGeometry");
    expect(viewer).not.toContain("dormerModel");
  });

  it("safe-zone et export geometrique priorisent canonicalV1.footprintPx avant contour.points", () => {
    const safeZone = readRepoFile("frontend/calpinage/engine/safeZoneAdapter.js");
    const geoEntity = readRepoFile("frontend/src/modules/calpinage/geometry/geoEntity3D.ts");

    expect(safeZone.indexOf("canonical?.footprintPx")).toBeGreaterThan(-1);
    expect(safeZone.indexOf("canonical?.footprintPx")).toBeLessThan(safeZone.indexOf("rx.contour?.points"));

    expect(geoEntity.indexOf("canonicalV1.footprintPx")).toBeGreaterThan(-1);
    expect(geoEntity.indexOf("const canonicalV1")).toBeLessThan(geoEntity.indexOf("const contour ="));
  });
});
