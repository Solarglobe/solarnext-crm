import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KeepoutZone3D } from "../KeepoutZone3D";
import type { RoofObstacleVolume3D } from "../../types/roof-obstacle-volume";

function makeVolume(visualRole: string): RoofObstacleVolume3D {
  return {
    id: "keepout-test",
    sourceObstacleId: "keepout-test",
    visualRole,
    footprintWorld: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    vertices: [
      { id: "b0", position: { x: 0, y: 0, z: 0 } },
      { id: "b1", position: { x: 1, y: 0, z: 0 } },
      { id: "b2", position: { x: 1, y: 1, z: 0 } },
      { id: "b3", position: { x: 0, y: 1, z: 0 } },
      { id: "t0", position: { x: 0, y: 0, z: 0.2 } },
      { id: "t1", position: { x: 1, y: 0, z: 0.2 } },
      { id: "t2", position: { x: 1, y: 1, z: 0.2 } },
      { id: "t3", position: { x: 0, y: 1, z: 0.2 } },
    ],
    faces: [],
    heightM: 0.2,
  } as RoofObstacleVolume3D;
}

afterEach(() => cleanup());

describe("KeepoutZone3D", () => {
  it("garde un ordre de hooks stable sous StrictMode quand les donnees changent", () => {
    const invalid = makeVolume("obstacle");
    const valid = makeVolume("keepout_surface");
    const { rerender, container } = render(
      <StrictMode>
        <KeepoutZone3D vol={invalid} />
      </StrictMode>,
    );
    expect(container.querySelector("mesh")).toBeNull();

    rerender(
      <StrictMode>
        <KeepoutZone3D vol={valid} />
      </StrictMode>,
    );
    expect(container.querySelectorAll("mesh").length).toBe(5);

    rerender(
      <StrictMode>
        <KeepoutZone3D vol={invalid} />
      </StrictMode>,
    );
    expect(container.querySelector("mesh")).toBeNull();
  });
});
