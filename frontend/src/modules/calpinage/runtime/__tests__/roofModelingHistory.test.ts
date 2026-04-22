/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { minimalCalpinageRuntimeFixture } from "../../canonical3d/dev/minimalCalpinageRuntimeFixture";
import {
  resetOfficialRuntimeStructuralChangeDebouncerForTests,
  flushOfficialRuntimeStructuralChangeNowForTests,
} from "../emitOfficialRuntimeStructuralChange";
import {
  ROOF_MODELING_HISTORY_MAX_STEPS,
  canRedoRoofModeling,
  canUndoRoofModeling,
  pushRoofModelingPastSnapshot,
  redoRoofModeling,
  resetRoofModelingHistoryForTests,
  undoRoofModeling,
} from "../roofModelingHistory";

describe("roofModelingHistory (B7)", () => {
  beforeEach(() => {
    resetRoofModelingHistoryForTests();
    resetOfficialRuntimeStructuralChangeDebouncerForTests();
  });

  afterEach(() => {
    resetRoofModelingHistoryForTests();
    resetOfficialRuntimeStructuralChangeDebouncerForTests();
    delete (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE;
  });

  it("undo restaure state.pans puis resynchronise roof.roofPans", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    (window as unknown as { CALPINAGE_STATE: typeof state }).CALPINAGE_STATE = state;

    pushRoofModelingPastSnapshot(JSON.parse(JSON.stringify(state.pans)));
    (state.pans[0]!.polygonPx![0] as { x: number }).x = 777;

    expect(undoRoofModeling(state as unknown as Record<string, unknown>)).toBe(true);
    expect((state.pans[0]!.polygonPx![0] as { x: number }).x).toBe(100);
    expect((state.roof.roofPans![0]!.polygonPx![0] as { x: number }).x).toBe(100);
    expect(canRedoRoofModeling()).toBe(true);
    flushOfficialRuntimeStructuralChangeNowForTests();
  });

  it("redo réapplique le pas annulé", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    (window as unknown as { CALPINAGE_STATE: typeof state }).CALPINAGE_STATE = state;

    pushRoofModelingPastSnapshot(JSON.parse(JSON.stringify(state.pans)));
    (state.pans[0]!.polygonPx![0] as { x: number }).x = 888;

    expect(undoRoofModeling(state as unknown as Record<string, unknown>)).toBe(true);
    expect(redoRoofModeling(state as unknown as Record<string, unknown>)).toBe(true);
    expect((state.pans[0]!.polygonPx![0] as { x: number }).x).toBe(888);
    expect(canUndoRoofModeling()).toBe(true);
  });

  it("trim : au-delà de MAX_STEPS les plus anciens pas sont oubliés", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    (window as unknown as { CALPINAGE_STATE: typeof state }).CALPINAGE_STATE = state;
    (state.pans[0]!.polygonPx![0] as { x: number }).x = 100;
    for (let i = 0; i < 20; i++) {
      pushRoofModelingPastSnapshot(JSON.parse(JSON.stringify(state.pans)));
      (state.pans[0]!.polygonPx![0] as { x: number }).x += 1;
    }
    expect((state.pans[0]!.polygonPx![0] as { x: number }).x).toBe(120);
    for (let u = 0; u < ROOF_MODELING_HISTORY_MAX_STEPS; u++) {
      expect(undoRoofModeling(state as unknown as Record<string, unknown>)).toBe(true);
    }
    expect((state.pans[0]!.polygonPx![0] as { x: number }).x).toBe(105);
    expect(canUndoRoofModeling()).toBe(false);
  });
});
