import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { CanonicalHouseDocument } from "../../model/canonicalHouse3DModel";
import { bindRoofToBuilding } from "../../builders/bindRoofToBuilding";
import { buildBuildingShell3D } from "../../builders/buildBuildingShell3D";
import { buildRoofTopology } from "../../builders/buildRoofTopology";
import { computeRoofPlaneIntersections } from "../../builders/computeRoofPlaneIntersections";
import { solveRoofPlanes } from "../../builders/solveRoofPlanes";
import { attachRoofAnnexesLayerToCanonicalDocument } from "../../builders/buildCanonicalRoofAnnexesLayer3D";
import { validateCanonicalHouse3DGeometry } from "../validateCanonicalHouse3DGeometry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const devDir = join(__dirname, "../../builders/dev");

function loadFixture(name: string): CanonicalHouseDocument {
  const raw = readFileSync(join(devDir, name), "utf-8");
  return JSON.parse(raw) as CanonicalHouseDocument;
}

function fullValidation(doc: CanonicalHouseDocument) {
  const shellResult = buildBuildingShell3D({ document: doc });
  const { graph } = buildRoofTopology(doc);
  const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
  const { intersectionSet } = computeRoofPlaneIntersections({ document: doc, topologyGraph: graph, solutionSet });
  if (!shellResult.shell) {
    throw new Error("shell null unexpected in fixture");
  }
  const { binding } = bindRoofToBuilding({
    shell: shellResult.shell,
    topologyGraph: graph,
    solutionSet,
    intersectionSet,
  });
  return validateCanonicalHouse3DGeometry({
    document: doc,
    shellResult,
    topologyGraph: graph,
    solutionSet,
    intersectionSet,
    bindingResult: binding,
  });
}

describe("validateCanonicalHouse3DGeometry (Prompt 9)", () => {
  it("maison simple valide : globalValidity, flags constructibilité", () => {
    const doc = loadFixture("binding-simple-aligned.json");
    const report = fullValidation(doc);
    expect(report.globalValidity).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(["clean", "acceptable", "partial"]).toContain(report.globalQualityLevel);
    expect(report.isBuildableForViewer).toBe(true);
    expect(report.isBuildableForPremium3D).toBe(true);
    expect(report.buildingValidation.errorCount).toBe(0);
    expect(report.roofTopologyValidation.errorCount).toBe(0);
    expect(report.roofAnnexesValidation.status).toBe("skipped");
    expect(report.roofAnnexesValidation.diagnostics.some((d) => d.code === "ANNEX_LAYER_MISSING_OPTIONAL")).toBe(
      true,
    );
  });

  it("shell bâtiment invalide : footprint vide", () => {
    const base = loadFixture("binding-simple-aligned.json");
    const badDoc: CanonicalHouseDocument = {
      ...base,
      building: {
        ...base.building,
        buildingFootprint: [],
        buildingOuterContour: [],
      },
    };
    const shellResult = buildBuildingShell3D({ document: badDoc });
    expect(shellResult.shell).toBeNull();
    const { graph } = buildRoofTopology(badDoc);
    const { solutionSet } = solveRoofPlanes({ document: badDoc, topologyGraph: graph });
    const { intersectionSet } = computeRoofPlaneIntersections({
      document: badDoc,
      topologyGraph: graph,
      solutionSet,
    });
    const goodDoc = loadFixture("binding-simple-aligned.json");
    const shellGood = buildBuildingShell3D({ document: goodDoc });
    const { binding } = bindRoofToBuilding({
      shell: shellGood.shell!,
      topologyGraph: graph,
      solutionSet,
      intersectionSet,
    });
    const report = validateCanonicalHouse3DGeometry({
      document: badDoc,
      shellResult,
      topologyGraph: graph,
      solutionSet,
      intersectionSet,
      bindingResult: binding,
    });
    expect(report.globalValidity).toBe(false);
    expect(report.buildingValidation.diagnostics.some((d) => d.code === "BUILDING_SHELL_MISSING")).toBe(true);
    expect(report.isBuildableForViewer).toBe(false);
  });

  it("eave flottante / toit non attaché : misaligned Z", () => {
    const doc = loadFixture("binding-misaligned-z.json");
    const report = fullValidation(doc);
    expect(report.globalValidity).toBe(false);
    expect(report.roofBuildingBindingValidation.diagnostics.some((d) => d.code === "ROOF_EAVE_MISALIGNED")).toBe(
      true,
    );
    expect(report.roofBuildingBindingValidation.diagnostics.some((d) => d.code === "ROOF_NOT_ATTACHED_TO_BUILDING")).toBe(
      true,
    );
    expect(report.isBuildableForPremium3D).toBe(false);
  });

  it("couture avec gap : warning ROOF_INTERSECTION_GAP_TOO_HIGH (résumé diagnostics)", () => {
    const doc = loadFixture("binding-simple-aligned.json");
    const shellResult = buildBuildingShell3D({ document: doc });
    const { graph } = buildRoofTopology(doc);
    const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
    const { intersectionSet } = computeRoofPlaneIntersections({ document: doc, topologyGraph: graph, solutionSet });
    const patched = {
      ...intersectionSet,
      diagnostics: {
        ...intersectionSet.diagnostics,
        gapCount: Math.max(1, intersectionSet.diagnostics.gapCount),
      },
    };
    const { binding } = bindRoofToBuilding({
      shell: shellResult.shell!,
      topologyGraph: graph,
      solutionSet,
      intersectionSet: patched,
    });
    const report = validateCanonicalHouse3DGeometry({
      document: doc,
      shellResult,
      topologyGraph: graph,
      solutionSet,
      intersectionSet: patched,
      bindingResult: binding,
    });
    expect(report.roofIntersectionsValidation.diagnostics.some((d) => d.code === "ROOF_INTERSECTION_GAP_TOO_HIGH")).toBe(
      true,
    );
    expect(report.warningCount).toBeGreaterThan(0);
  });

  it("extension / split topologique : diagnostics annexes", () => {
    const base = loadFixture("binding-simple-aligned.json");
    const docWithAnnex: CanonicalHouseDocument = {
      ...base,
      annexes: [
        {
          annexId: "annex-rx-test",
          family: "roof_extension",
          attachedRoofPatchIds: [],
          dataStatus: "primary",
          geometry: {
            kind: "footprint_extrusion",
            footprint: [
              { x: 2, y: 2 },
              { x: 4, y: 2 },
              { x: 4, y: 4 },
              { x: 2, y: 4 },
            ],
            zBottomId: base.heightModel.zBase.id,
            zTopId: "hq-rx-top",
          },
        },
      ],
      heightModel: {
        ...base.heightModel,
        quantities: [
          ...base.heightModel.quantities,
          {
            id: "hq-rx-top",
            role: "custom",
            valueM: 8,
            provenance: "user_input",
            sourceRef: "rx",
            derivationRuleId: "test",
          },
        ],
      },
    };
    const shellResult = buildBuildingShell3D({ document: docWithAnnex });
    const { graph } = buildRoofTopology(docWithAnnex);
    const { solutionSet } = solveRoofPlanes({ document: docWithAnnex, topologyGraph: graph });
    const { intersectionSet } = computeRoofPlaneIntersections({
      document: docWithAnnex,
      topologyGraph: graph,
      solutionSet,
    });
    const { binding } = bindRoofToBuilding({
      shell: shellResult.shell!,
      topologyGraph: graph,
      solutionSet,
      intersectionSet,
    });
    const docAug = attachRoofAnnexesLayerToCanonicalDocument(docWithAnnex, graph, solutionSet);
    const report = validateCanonicalHouse3DGeometry({
      document: docAug,
      shellResult,
      topologyGraph: graph,
      solutionSet,
      intersectionSet,
      bindingResult: binding,
    });
    expect(report.roofAnnexesValidation.status).not.toBe("skipped");
    expect(
      report.roofAnnexesValidation.diagnostics.some((d) => d.code === "ANNEX_NEEDS_TOPOLOGY_SPLIT"),
    ).toBe(true);
  });

  it("plan sous-contraint : partial / warnings plans", () => {
    const base = loadFixture("binding-simple-aligned.json");
    /** Une seule hauteur primaire sur 4 sommets → sous-contraint si pas de secours. */
    const topo2 = {
      ...base.roof.topology,
      vertices: base.roof.topology.vertices.map((v, i) =>
        i === 0 ? { ...v, heightQuantityId: "hPartial" } : { ...v, heightQuantityId: undefined },
      ),
    };
    const doc2: CanonicalHouseDocument = {
      ...base,
      roof: { ...base.roof, topology: topo2 },
      heightModel: {
        quantities: [
          {
            id: "hPartial",
            role: "custom",
            valueM: 3,
            provenance: "user_input",
            derivationRuleId: "underconstrained-test",
          },
        ],
        zBase: base.heightModel.zBase,
        conventions: base.heightModel.conventions,
      },
    };
    const shellResult = buildBuildingShell3D({ document: doc2 });
    const { graph } = buildRoofTopology(doc2);
    const { solutionSet } = solveRoofPlanes({
      document: doc2,
      topologyGraph: graph,
      allowSecondaryHeightProvenance: false,
    });
    const { intersectionSet } = computeRoofPlaneIntersections({ document: doc2, topologyGraph: graph, solutionSet });
    const { binding } = bindRoofToBuilding({
      shell: shellResult.shell!,
      topologyGraph: graph,
      solutionSet,
      intersectionSet,
    });
    const report = validateCanonicalHouse3DGeometry({
      document: doc2,
      shellResult,
      topologyGraph: graph,
      solutionSet,
      intersectionSet,
      bindingResult: binding,
    });
    const planeCodes = report.roofPlanesValidation.diagnostics.map((d) => d.code);
    expect(
      planeCodes.includes("ROOF_PLANE_UNDERCONSTRAINED") ||
        planeCodes.includes("ROOF_PLANE_MISSING") ||
        solutionSet.solutions[0]?.resolutionMethod.startsWith("unresolved"),
    ).toBe(true);
    expect(["partial", "ambiguous", "acceptable", "invalid"]).toContain(report.globalQualityLevel);
  });
});
