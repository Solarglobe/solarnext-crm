/**
 * Phase B6 — après `emitOfficialRuntimeStructuralChange` + flush : miroir `roof.roofPans` et contrat monde
 * alignés sur `state.pans` / `roof.scale` + nord (même chaîne que le build 3D).
 */

import { afterEach, describe, expect, it } from "vitest";
import { minimalCalpinageRuntimeFixture } from "../../canonical3d/dev/minimalCalpinageRuntimeFixture";
import { applyRoofVertexXYEdit } from "../applyRoofVertexXYEdit";
import { applyRoofVertexHeightEdit } from "../applyRoofVertexHeightEdit";
import {
  emitOfficialRuntimeStructuralChange,
  flushOfficialRuntimeStructuralChangeNowForTests,
  resetOfficialRuntimeStructuralChangeDebouncerForTests,
} from "../emitOfficialRuntimeStructuralChange";
import { resetRoofModelingHistoryForTests } from "../roofModelingHistory";

describe("structuralChangeRoofMirrorSync (B6)", () => {
  afterEach(() => {
    resetOfficialRuntimeStructuralChangeDebouncerForTests();
    resetRoofModelingHistoryForTests();
    delete (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE;
  });

  it("mutation XY → emit + flush : roof.roofPans.polygonPx reflète state.pans", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    (window as unknown as { CALPINAGE_STATE: typeof state }).CALPINAGE_STATE = state;

    const r = applyRoofVertexXYEdit(state, {
      panId: "pan-a",
      vertexIndex: 0,
      mode: "imagePx",
      xPx: 103,
      yPx: 101,
    });
    expect(r.ok).toBe(true);

    emitOfficialRuntimeStructuralChange({
      reason: "ROOF_VERTEX_XY_EDIT",
      changedDomains: ["pans"],
    });
    flushOfficialRuntimeStructuralChangeNowForTests();

    const src = state.pans[0]!.polygonPx!;
    const mirror = state.roof.roofPans[0]!.polygonPx as { x: number; y: number }[];
    expect(mirror.length).toBe(src.length);
    for (let i = 0; i < src.length; i++) {
      expect(mirror[i]!.x).toBe(src[i]!.x);
      expect(mirror[i]!.y).toBe(src[i]!.y);
    }
    expect(mirror[0]!.x).toBe(103);
    expect(mirror[0]!.y).toBe(101);
  });

  it("mutation Z → emit + flush : h sur polygonPx miroir aligné state.pans", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    for (const pt of state.pans[0]!.polygonPx!) {
      (pt as { h: number }).h = 2;
    }
    (window as unknown as { CALPINAGE_STATE: typeof state }).CALPINAGE_STATE = state;

    expect(
      applyRoofVertexHeightEdit(state, { panId: "pan-a", vertexIndex: 1, heightM: 6.25 }).ok,
    ).toBe(true);

    emitOfficialRuntimeStructuralChange({
      reason: "ROOF_VERTEX_HEIGHT_EDIT",
      changedDomains: ["pans"],
    });
    flushOfficialRuntimeStructuralChangeNowForTests();

    const src = state.pans[0]!.polygonPx!;
    const mirror = state.roof.roofPans[0]!.polygonPx as { h?: number; heightM?: number }[];
    expect(mirror[1]!.h ?? mirror[1]!.heightM).toBe(6.25);
    expect((src[1] as { h?: number }).h).toBe(6.25);
  });

  it("flush : canonical3DWorldContract recalé si absent (cohérence sauvegarde)", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    delete (state.roof as { canonical3DWorldContract?: unknown }).canonical3DWorldContract;
    (window as unknown as { CALPINAGE_STATE: typeof state }).CALPINAGE_STATE = state;

    emitOfficialRuntimeStructuralChange({ reason: "TEST_SYNC", changedDomains: ["pans"] });
    flushOfficialRuntimeStructuralChangeNowForTests();

    const c = state.roof.canonical3DWorldContract as {
      metersPerPixel: number;
      northAngleDeg: number;
      referenceFrame: string;
    };
    expect(c).toBeDefined();
    expect(c.referenceFrame).toBe("LOCAL_IMAGE_ENU");
    expect(c.metersPerPixel).toBe(0.02);
    expect(c.northAngleDeg).toBe(0);
  });
});
