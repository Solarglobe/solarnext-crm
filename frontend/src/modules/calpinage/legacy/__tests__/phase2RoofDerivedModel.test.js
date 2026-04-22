import { describe, it, expect } from "vitest";
import {
  deriveRoofPlanesFromPans,
  syncRoofPansMirrorFromPans,
  DERIVED_ROOF_TOPOLOGY_SOURCE,
} from "../phase2RoofDerivedModel.js";

describe("phase2RoofDerivedModel", () => {
  it("deriveRoofPlanesFromPans copie les polygones pans", () => {
    var state = {
      pans: [
        {
          id: "pan-1",
          polygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 8 },
          ],
        },
      ],
    };
    deriveRoofPlanesFromPans(state);
    expect(state.planes.length).toBe(1);
    expect(state.planes[0].derivedTopologySource).toBe(DERIVED_ROOF_TOPOLOGY_SOURCE);
    expect(state.planes[0].derivedFromPanId).toBe("pan-1");
    expect(state.planes[0].points.length).toBe(3);
  });

  it("syncRoofPansMirrorFromPans remplit roof.roofPans", () => {
    var state = {
      roof: {},
      pans: [{ id: "p1", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }],
    };
    syncRoofPansMirrorFromPans(state);
    expect(state.roof.roofPans.length).toBe(1);
    expect(state.roof.roofPans[0].polygonPx.length).toBe(3);
  });

  it("deriveRoofPlanesFromPans utilise polygonPx si points absents", () => {
    var state = {
      pans: [
        {
          id: "p-polypx",
          polygonPx: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 8 },
          ],
        },
      ],
    };
    deriveRoofPlanesFromPans(state);
    expect(state.planes.length).toBe(1);
    expect(state.planes[0].points.length).toBe(3);
  });

  it("syncRoofPansMirrorFromPans : polygonPx source officielle si seul polygonPx sur le pan", () => {
    var state = {
      roof: {},
      pans: [
        {
          id: "p1",
          polygonPx: [
            { x: 10, y: 20, h: 3 },
            { x: 30, y: 20 },
            { x: 30, y: 40 },
          ],
        },
      ],
    };
    syncRoofPansMirrorFromPans(state);
    expect(state.roof.roofPans[0].polygonPx.length).toBe(3);
    expect(state.roof.roofPans[0].polygonPx[0].x).toBe(10);
    expect(state.roof.roofPans[0].polygonPx[0].h).toBe(3);
  });
});
