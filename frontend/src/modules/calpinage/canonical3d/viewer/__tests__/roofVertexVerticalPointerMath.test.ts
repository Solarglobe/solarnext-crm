import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { worldZFromPointerOnVerticalThroughXY } from "../roofVertexVerticalPointerMath";

describe("worldZFromPointerOnVerticalThroughXY", () => {
  it("retourne un Z cohérent pour une caméra perspective regardant l’origine", () => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    cam.position.set(12, -10, 8);
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const rect = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
    const z = worldZFromPointerOnVerticalThroughXY(cam, 400, 300, rect, 2, -3);
    expect(Number.isFinite(z)).toBe(true);
  });
});
