import { describe, expect, it } from "vitest";
import { unifiedHitTest } from "../unifiedHitTest.js";

const imageToScreen = (p) => ({ x: p.x, y: p.y });
const screenToImage = (p) => ({ x: p.x, y: p.y });

describe("unifiedHitTest roofExtensions", () => {
  const manualDormer = {
    id: "rx-test",
    type: "roof_extension",
    kind: "dormer",
    visualModel: "manual_outline_gable",
    contour: {
      closed: true,
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
      ],
    },
  };

  it("selectionne le corps d'un chien assis manuel sans dormerModel", () => {
    const hit = unifiedHitTest({
      screenPt: { x: 20, y: 20 },
      screenToImage,
      imageToScreen,
      obstacles: [],
      roofExtensions: [manualDormer],
      shadowVolumes: [],
      context: { vpScale: 1 },
    });

    expect(hit).toMatchObject({ type: "roofExtension", index: 0, subType: "body" });
  });

  it("detecte les poignees de milieu d'arete sans dormerModel", () => {
    const hit = unifiedHitTest({
      screenPt: { x: 20, y: 10 },
      screenToImage,
      imageToScreen,
      obstacles: [],
      roofExtensions: [manualDormer],
      shadowVolumes: [],
      context: { vpScale: 1, selectedRoofExtensionIndex: 0 },
    });

    expect(hit).toMatchObject({ type: "roofExtension", index: 0, subType: "edge-mid" });
    expect(hit.data.edgeIndex).toBe(0);
  });

  it("garde les sommets faciles a attraper apres fermeture du contour", () => {
    const hit = unifiedHitTest({
      screenPt: { x: 43, y: 10 },
      screenToImage,
      imageToScreen,
      obstacles: [],
      roofExtensions: [manualDormer],
      shadowVolumes: [],
      context: { vpScale: 1, selectedRoofExtensionIndex: 0 },
    });

    expect(hit).toMatchObject({ type: "roofExtension", index: 0, subType: "vertex" });
    expect(hit.data.vertexIndex).toBe(1);
  });
});
