/**
 * Prompt 23 — resolvePanVertexZ + règles de hauteur explicite.
 */

import { describe, expect, it } from "vitest";
import { resolveHeightAtXY, type HeightResolverContext } from "../../../core/heightResolver";
import { resolvePanVertexZ } from "../resolvePanVertexZ";

describe("resolvePanVertexZ — vérité géométrique", () => {
  it("h explicite valide court-circuite le plan : Z = h exact", () => {
    const ctx: HeightResolverContext = {
      state: {},
      getHeightAtXY: () => 999,
    };
    const r = resolvePanVertexZ({
      xPx: 0,
      yPx: 0,
      explicitPanVertexH: 6.3,
      panId: "p",
      context: ctx,
    });
    expect(r.ok).toBe(true);
    expect(r.heightM).toBe(6.3);
    expect(r.source).toBe("explicit_pan_vertex_h");
    expect(r.heightM).not.toBe(999);
  });

  it("h hors plage résidentielle : ignoré, chaîne heightResolver", () => {
    const ctx: HeightResolverContext = {
      state: {},
      getHeightAtXY: () => 4,
    };
    const r = resolvePanVertexZ({
      xPx: 1,
      yPx: 1,
      explicitPanVertexH: 5000,
      panId: "p",
      context: ctx,
      options: { defaultHeightM: 0 },
    });
    expect(r.heightM).toBe(4);
    expect(r.source).not.toBe("explicit_pan_vertex_h");
  });

  it("h explicite = 0 (cote réelle) est conservée", () => {
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY: () => 9 };
    const r = resolvePanVertexZ({
      xPx: 0,
      yPx: 0,
      explicitPanVertexH: 0,
      panId: "p",
      context: ctx,
    });
    expect(r.ok).toBe(true);
    expect(r.heightM).toBe(0);
    expect(r.source).toBe("explicit_pan_vertex_h");
  });

  it("sans h explicite : cohérent avec resolveHeightAtXY", () => {
    const ctx: HeightResolverContext = {
      state: {},
      getHeightAtXY: (_pid, x) => 2 + x * 0.001,
    };
    const a = resolvePanVertexZ({ xPx: 100, yPx: 0, panId: "p", context: ctx });
    const b = resolveHeightAtXY(100, 0, ctx, { panId: "p" });
    expect(a.heightM).toBe(b.heightM);
    expect(a.source).toBe(b.source);
    expect(a.ok).toBe(b.ok);
  });
});
