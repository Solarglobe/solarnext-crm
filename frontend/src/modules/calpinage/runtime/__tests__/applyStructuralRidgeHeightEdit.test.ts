import { describe, expect, it, vi, afterEach } from "vitest";
import { applyStructuralHeightEdit, applyStructuralRidgeHeightEdit } from "../applyStructuralRidgeHeightEdit";

describe("applyStructuralHeightEdit", () => {
  afterEach(() => {
    const w = window as unknown as {
      __calpinageApplyStructuralHeightSelection?: unknown;
      __calpinageApplyStructuralRidgeHeightSelection?: unknown;
    };
    delete w.__calpinageApplyStructuralHeightSelection;
    delete w.__calpinageApplyStructuralRidgeHeightSelection;
  });

  it("refuse si le legacy n’est pas monté", () => {
    const r = applyStructuralHeightEdit({}, { selection: { type: "ridge", index: 0, pointIndex: 0 }, heightM: 5 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("LEGACY_UNAVAILABLE");
  });

  it("délègue à __calpinageApplyStructuralHeightSelection quand présent", () => {
    const fn = vi.fn().mockReturnValue({ ok: true });
    (window as unknown as { __calpinageApplyStructuralHeightSelection: typeof fn }).__calpinageApplyStructuralHeightSelection =
      fn;
    const r = applyStructuralHeightEdit(
      {},
      { selection: { type: "trait", index: 0, pointIndex: 1 }, heightM: 8 },
    );
    expect(r.ok).toBe(true);
    expect(fn).toHaveBeenCalledWith({ type: "trait", index: 0, pointIndex: 1 }, 8);
  });

  it("refuse hauteur négative (alignement legacy)", () => {
    const r = applyStructuralHeightEdit(
      {},
      { selection: { type: "ridge", index: 0, pointIndex: 0 }, heightM: -1 },
    );
    expect(r.ok).toBe(false);
  });
});

describe("applyStructuralRidgeHeightEdit (alias)", () => {
  afterEach(() => {
    const w = window as unknown as { __calpinageApplyStructuralHeightSelection?: unknown };
    delete w.__calpinageApplyStructuralHeightSelection;
  });

  it("délègue comme applyStructuralHeightEdit", () => {
    const fn = vi.fn().mockReturnValue({ ok: true });
    (window as unknown as { __calpinageApplyStructuralHeightSelection: typeof fn }).__calpinageApplyStructuralHeightSelection =
      fn;
    const r = applyStructuralRidgeHeightEdit(
      {},
      { selection: { type: "ridge", index: 0, pointIndex: 1 }, heightM: 8 },
    );
    expect(r.ok).toBe(true);
    expect(fn).toHaveBeenCalledWith({ type: "ridge", index: 0, pointIndex: 1 }, 8);
  });
});
