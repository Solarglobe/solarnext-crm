import { describe, expect, it, vi } from "vitest";
import {
  QUOTE_SIGNATURE_PAD_LOGICAL_H,
  QUOTE_SIGNATURE_PAD_LOGICAL_W,
  quoteSignaturePadLogicalPoint,
} from "../quoteSignaturePadCoords";

describe("quoteSignaturePadLogicalPoint", () => {
  it("mappe le centre d’un canvas affiché à moitié vers le centre logique", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: QUOTE_SIGNATURE_PAD_LOGICAL_W / 2,
      height: QUOTE_SIGNATURE_PAD_LOGICAL_H / 2,
      right: 0,
      bottom: 0,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);

    const cx = 10 + QUOTE_SIGNATURE_PAD_LOGICAL_W / 4;
    const cy = 20 + QUOTE_SIGNATURE_PAD_LOGICAL_H / 4;
    expect(quoteSignaturePadLogicalPoint(canvas, cx, cy)).toEqual({
      x: QUOTE_SIGNATURE_PAD_LOGICAL_W / 2,
      y: QUOTE_SIGNATURE_PAD_LOGICAL_H / 2,
    });
  });

  it("retourne (0,0) si le rect est vide", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    expect(quoteSignaturePadLogicalPoint(canvas, 50, 50)).toEqual({ x: 0, y: 0 });
  });
});
