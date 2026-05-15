import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPvPanelFrom3dImagePoint,
  applyPvMoveLiveFrom3d,
  applyPvTransformLiveFrom3d,
  beginPvMoveFrom3d,
  beginPvRotateFrom3d,
  cancelPvMoveFrom3d,
  finalizePvMoveFrom3d,
  getPvLayout3dProductCapabilityReport,
  hitTestPvBlockPanelFromImagePoint,
  readPvLayout3dOverlayState,
  removePvPanelFrom3d,
  removeSelectedPvPanelFrom3d,
  selectPvBlockFrom3d,
} from "../pvPlacement3dProduct";

describe("pvPlacement3dProduct", () => {
  afterEach(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.__calpinageHitTestPvBlockPanelFromImagePoint;
    delete w.__calpinageBeginPhase3PvMoveFrom3d;
    delete w.__calpinageBeginPhase3PvRotateFrom3d;
    delete w.__calpinageApplyPhase3PvMoveLiveFrom3d;
    delete w.__calpinageApplyPhase3PvTransformLiveFrom3d;
    delete w.__calpinageCancelPhase3PvMoveFrom3d;
    delete w.__calpinageFinalizePhase3PvHandleManipulation;
    delete w.__calpinageGetPhase3Pv3dOverlayState;
    delete w.__calpinageSelectPvBlockFrom3d;
    delete w.__calpinageAddPvPanelFrom3dImagePoint;
    delete w.__calpinageRemovePvPanelFrom3d;
    delete w.__calpinageRemoveSelectedPvPanelFrom3d;
    delete w.__calpinageClearPvSelectionFrom3d;
  });

  it("hitTestPvBlockPanelFromImagePoint delegue au legacy", () => {
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

  it("finalizePvMoveFrom3d delegue", () => {
    const fin = vi.fn(() => true);
    (window as unknown as { __calpinageFinalizePhase3PvHandleManipulation: typeof fin }).__calpinageFinalizePhase3PvHandleManipulation =
      fin;
    expect(finalizePvMoveFrom3d({ pointerId: 7 })).toBe(true);
    expect(fin).toHaveBeenCalledWith({ pointerId: 7 });
  });

  it("applyPvMoveLiveFrom3d delegue", () => {
    const live = vi.fn(() => true);
    (window as unknown as { __calpinageApplyPhase3PvMoveLiveFrom3d: typeof live }).__calpinageApplyPhase3PvMoveLiveFrom3d =
      live;
    expect(applyPvMoveLiveFrom3d(3, -2)).toBe(true);
    expect(live).toHaveBeenCalledWith(3, -2);
  });

  it("cancelPvMoveFrom3d delegue", () => {
    const c = vi.fn(() => true);
    (window as unknown as { __calpinageCancelPhase3PvMoveFrom3d: typeof c }).__calpinageCancelPhase3PvMoveFrom3d = c;
    expect(cancelPvMoveFrom3d()).toBe(true);
    expect(c).toHaveBeenCalled();
  });

  it("beginPvRotateFrom3d et applyPvTransformLiveFrom3d deleguent la rotation", () => {
    const begin = vi.fn(() => ({ ok: true, centerImg: { x: 5, y: 6 } }));
    const transform = vi.fn(() => true);
    (window as unknown as { __calpinageBeginPhase3PvRotateFrom3d: typeof begin }).__calpinageBeginPhase3PvRotateFrom3d =
      begin;
    (window as unknown as { __calpinageApplyPhase3PvTransformLiveFrom3d: typeof transform }).__calpinageApplyPhase3PvTransformLiveFrom3d =
      transform;

    expect(beginPvRotateFrom3d("b1", { x: 10, y: 20 }, 9)).toEqual({
      ok: true,
      centerImg: { x: 5, y: 6 },
    });
    expect(begin).toHaveBeenCalledWith("b1", { x: 10, y: 20 }, 9);
    expect(applyPvTransformLiveFrom3d(1, 2, 15)).toBe(true);
    expect(transform).toHaveBeenCalledWith(1, 2, 15);
  });

  it("pose, selection, overlay et suppression deleguent au legacy", () => {
    const add = vi.fn(() => true);
    const select = vi.fn(() => true);
    const overlay = vi.fn(() => ({
      focusBlockId: "b1",
      activeBlockId: "b1",
      selectedPanelId: "p1",
      selectedPanelCount: 1,
      selectedPowerKwc: 0.5,
      handles: null,
      panels: [],
      ghosts: [],
      safeZones: [],
    }));
    const remove = vi.fn(() => true);
    const removeSelected = vi.fn(() => true);
    (window as unknown as { __calpinageAddPvPanelFrom3dImagePoint: typeof add }).__calpinageAddPvPanelFrom3dImagePoint =
      add;
    (window as unknown as { __calpinageSelectPvBlockFrom3d: typeof select }).__calpinageSelectPvBlockFrom3d = select;
    (window as unknown as { __calpinageGetPhase3Pv3dOverlayState: typeof overlay }).__calpinageGetPhase3Pv3dOverlayState =
      overlay;
    (window as unknown as { __calpinageRemovePvPanelFrom3d: typeof remove }).__calpinageRemovePvPanelFrom3d = remove;
    (window as unknown as { __calpinageRemoveSelectedPvPanelFrom3d: typeof removeSelected }).__calpinageRemoveSelectedPvPanelFrom3d =
      removeSelected;

    expect(addPvPanelFrom3dImagePoint({ x: 11, y: 12 })).toBe(true);
    expect(add).toHaveBeenCalledWith({ x: 11, y: 12 });
    expect(selectPvBlockFrom3d("b1", "p1")).toBe(true);
    expect(select).toHaveBeenCalledWith("b1", "p1");
    expect(readPvLayout3dOverlayState()?.selectedPanelId).toBe("p1");
    expect(removePvPanelFrom3d("b1", "p1")).toBe(true);
    expect(remove).toHaveBeenCalledWith("b1", "p1");
    expect(removeSelectedPvPanelFrom3d()).toBe(true);
    expect(removeSelected).toHaveBeenCalled();
  });

  it("capability report exige toutes les actions produit", () => {
    expect(getPvLayout3dProductCapabilityReport().ready).toBe(false);

    const w = window as unknown as Record<string, unknown>;
    w.__calpinageHitTestPvBlockPanelFromImagePoint = vi.fn();
    w.__calpinageBeginPhase3PvMoveFrom3d = vi.fn();
    w.__calpinageBeginPhase3PvRotateFrom3d = vi.fn();
    w.__calpinageApplyPhase3PvMoveLiveFrom3d = vi.fn();
    w.__calpinageApplyPhase3PvTransformLiveFrom3d = vi.fn();
    w.__calpinageCancelPhase3PvMoveFrom3d = vi.fn();
    w.__calpinageFinalizePhase3PvHandleManipulation = vi.fn();
    w.__calpinageGetPhase3Pv3dOverlayState = vi.fn();
    w.__calpinageSelectPvBlockFrom3d = vi.fn();
    w.__calpinageAddPvPanelFrom3dImagePoint = vi.fn();
    w.__calpinageRemovePvPanelFrom3d = vi.fn();
    w.__calpinageRemoveSelectedPvPanelFrom3d = vi.fn();
    w.__calpinageClearPvSelectionFrom3d = vi.fn();

    expect(getPvLayout3dProductCapabilityReport()).toEqual({
      ready: true,
      missing: [],
    });
  });
});
