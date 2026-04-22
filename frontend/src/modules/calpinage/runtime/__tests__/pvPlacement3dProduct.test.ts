import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPvMoveLiveFrom3d,
  beginPvMoveFrom3d,
  cancelPvMoveFrom3d,
  finalizePvMoveFrom3d,
  hitTestPvBlockPanelFromImagePoint,
} from "../pvPlacement3dProduct";

describe("pvPlacement3dProduct", () => {
  afterEach(() => {
    const w = window as unknown as {
      __calpinageHitTestPvBlockPanelFromImagePoint?: unknown;
      __calpinageBeginPhase3PvMoveFrom3d?: unknown;
      __calpinageApplyPhase3PvMoveLiveFrom3d?: unknown;
      __calpinageCancelPhase3PvMoveFrom3d?: unknown;
      __calpinageFinalizePhase3PvHandleManipulation?: unknown;
    };
    delete w.__calpinageHitTestPvBlockPanelFromImagePoint;
    delete w.__calpinageBeginPhase3PvMoveFrom3d;
    delete w.__calpinageApplyPhase3PvMoveLiveFrom3d;
    delete w.__calpinageCancelPhase3PvMoveFrom3d;
    delete w.__calpinageFinalizePhase3PvHandleManipulation;
  });

  it("hitTestPvBlockPanelFromImagePoint délègue au legacy", () => {
    const fn = vi.fn(() => ({ blockId: "b1", panelId: "p1" }));
    (window as unknown as { __calpinageHitTestPvBlockPanelFromImagePoint: typeof fn }).__calpinageHitTestPvBlockPanelFromImagePoint =
      fn;
    expect(hitTestPvBlockPanelFromImagePoint({ x: 10, y: 20 })).toEqual({ blockId: "b1", panelId: "p1" });
    expect(fn).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("beginPvMoveFrom3d refuse si legacy absent", () => {
    const r = beginPvMoveFrom3d("b1", { x: 1, y: 2 }, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LEGACY_UNAVAILABLE");
  });

  it("beginPvMoveFrom3d propage le refus legacy", () => {
    (window as unknown as { __calpinageBeginPhase3PvMoveFrom3d: (a: string, b: { x: number; y: number }, c: number) => unknown }).__calpinageBeginPhase3PvMoveFrom3d =
      () => ({ ok: false, code: "ALREADY_MANIPULATING", message: "x" });
    const r = beginPvMoveFrom3d("b1", { x: 0, y: 0 }, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_MANIPULATING");
  });

  it("finalizePvMoveFrom3d délègue", () => {
    const fin = vi.fn(() => true);
    (window as unknown as { __calpinageFinalizePhase3PvHandleManipulation: typeof fin }).__calpinageFinalizePhase3PvHandleManipulation =
      fin;
    expect(finalizePvMoveFrom3d({ pointerId: 7 })).toBe(true);
    expect(fin).toHaveBeenCalledWith({ pointerId: 7 });
  });

  it("applyPvMoveLiveFrom3d délègue", () => {
    const live = vi.fn(() => true);
    (window as unknown as { __calpinageApplyPhase3PvMoveLiveFrom3d: typeof live }).__calpinageApplyPhase3PvMoveLiveFrom3d =
      live;
    expect(applyPvMoveLiveFrom3d(3, -2)).toBe(true);
    expect(live).toHaveBeenCalledWith(3, -2);
  });

  it("cancelPvMoveFrom3d délègue", () => {
    const c = vi.fn(() => true);
    (window as unknown as { __calpinageCancelPhase3PvMoveFrom3d: typeof c }).__calpinageCancelPhase3PvMoveFrom3d = c;
    expect(cancelPvMoveFrom3d()).toBe(true);
    expect(c).toHaveBeenCalled();
  });
});
