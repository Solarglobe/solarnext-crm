import { describe, expect, it } from "vitest";
import { makeHorizontalSquarePatch } from "../../canonical3d/__tests__/hardening/hardeningSceneFactories";
import { buildPvPanels3D } from "../../canonical3d/pvPanels/buildPvPanels3D";
import { imagePxToWorldHorizontalM } from "../../canonical3d/builder/worldMapping";
import { mapPanelsToPvPlacementInputs } from "../mapCalpinageToCanonicalNearShading";

function rotatedPanelPx(cx: number, cy: number, width: number, height: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const vx = -Math.sin(rad);
  const vy = Math.cos(rad);
  const hw = width / 2;
  const hh = height / 2;
  return [
    { x: cx - ux * hw - vx * hh, y: cy - uy * hw - vy * hh },
    { x: cx + ux * hw - vx * hh, y: cy + uy * hw - vy * hh },
    { x: cx + ux * hw + vx * hh, y: cy + uy * hw + vy * hh },
    { x: cx - ux * hw + vx * hh, y: cy - uy * hw + vy * hh },
  ];
}

describe("mapPanelsToPvPlacementInputs", () => {
  it("utilise le quad 2D comme source de vérité pour le centre et la rotation", () => {
    const patch = makeHorizontalSquarePatch("pan-a", 40, 0);
    const polygonPx = rotatedPanelPx(12, 11, 4, 2, 30);

    const { inputs } = mapPanelsToPvPlacementInputs(
      [
        {
          id: "pv-a",
          panId: "pan-a",
          center: { x: 999, y: 999 },
          polygonPx,
          moduleWidthM: 4,
          moduleHeightM: 2,
          rotationDeg: 0,
        },
      ],
      [patch],
      1,
      0,
      () => 0,
      1,
      1,
    );

    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.center.mode).toBe("world");
    if (inputs[0]!.center.mode === "world") {
      expect(inputs[0]!.center.position.x).toBeCloseTo(12, 6);
      expect(inputs[0]!.center.position.y).toBeCloseTo(-11, 6);
    }

    const { panels } = buildPvPanels3D({ panels: inputs }, { roofPlanePatches: [patch] });
    const corners = panels[0]!.corners3D;
    const expected = polygonPx.map((p) => imagePxToWorldHorizontalM(p.x, p.y, 1, 0));

    for (const expectedCorner of expected) {
      const found = corners.some(
        (corner) =>
          Math.abs(corner.x - expectedCorner.x) < 1e-6 &&
          Math.abs(corner.y - expectedCorner.y) < 1e-6 &&
          Math.abs(corner.z) < 1e-6,
      );
      expect(found).toBe(true);
    }
  });
});
