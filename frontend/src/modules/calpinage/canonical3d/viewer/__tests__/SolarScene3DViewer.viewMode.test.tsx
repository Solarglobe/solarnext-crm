/**
 * Prompt 34 — toggle Plan / Vue 3D : même scène, pas de legacy, pas de crash.
 */

import { useState, useMemo } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SolarScene3DViewer } from "../SolarScene3DViewer";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { createEmptyRoofModel3D } from "../../utils/factories";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import type { CameraViewMode } from "../cameraViewMode";

const origGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      const canvas = this;
      return {
        canvas,
        drawingBufferWidth: canvas.width || 300,
        drawingBufferHeight: canvas.height || 150,
        getParameter: () => 0,
        getExtension: () => null,
        createBuffer: () => ({}),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        viewport: vi.fn(),
        clear: vi.fn(),
        useProgram: vi.fn(),
        drawArrays: vi.fn(),
        drawElements: vi.fn(),
      } as unknown as WebGLRenderingContext;
    }
    return (origGetContext as (t: string, ...a: unknown[]) => unknown).call(this, type, ...rest) as
      | WebGLRenderingContext
      | null;
  };
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

function minimalScene() {
  const patch = makeHorizontalSquarePatch("pan-a", 12, 1);
  const roof = { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] };
  return buildSolarScene3D({
    worldConfig: { metersPerPixel: 0.02, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
    roofModel: roof,
    obstacleVolumes: [],
    extensionVolumes: [],
    volumesQuality: roof.globalQuality,
    pvPanels: [],
  });
}

describe("SolarScene3DViewer — cameraViewMode (Prompt 34)", () => {
  it("A — même scène : data-canonical-scene-key inchangé après toggle", () => {
    const scene = minimalScene();
    const key = `${scene.metadata.schemaVersion}|${scene.metadata.createdAtIso}|${scene.metadata.integrationNotes ?? ""}`;
    render(
      <SolarScene3DViewer scene={scene} height={180} showCameraViewModeToggle showSun={false} showShadingLegend={false} />,
    );
    const root = screen.getByTestId("solar-scene-3d-viewer-root");
    expect(root.getAttribute("data-canonical-scene-key")).toBe(key);
    fireEvent.click(screen.getByTestId("calpinage-viewer-mode-plan"));
    expect(root.getAttribute("data-canonical-scene-key")).toBe(key);
    fireEvent.click(screen.getByTestId("calpinage-viewer-mode-3d"));
    expect(root.getAttribute("data-canonical-scene-key")).toBe(key);
    cleanup();
  });

  it("B — le mode caméra change (attribut data), pas les métadonnées scène", () => {
    const scene = minimalScene();
    render(
      <SolarScene3DViewer scene={scene} height={180} showCameraViewModeToggle showSun={false} showShadingLegend={false} />,
    );
    const root = screen.getByTestId("solar-scene-3d-viewer-root");
    expect(root.getAttribute("data-camera-view-mode")).toBe("SCENE_3D");
    fireEvent.click(screen.getByTestId("calpinage-viewer-mode-plan"));
    expect(root.getAttribute("data-camera-view-mode")).toBe("PLAN_2D");
    expect(scene.metadata.createdAtIso).toBeDefined();
    cleanup();
  });

  it("C — switch sans crash (deux allers-retours)", () => {
    const scene = minimalScene();
    render(
      <SolarScene3DViewer scene={scene} height={160} showCameraViewModeToggle showSun={false} showShadingLegend={false} />,
    );
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByTestId("calpinage-viewer-mode-plan"));
      fireEvent.click(screen.getByTestId("calpinage-viewer-mode-3d"));
    }
    expect(document.querySelector("canvas")).toBeTruthy();
    cleanup();
  });

  it("D — maison (toit) : au moins un canvas présent dans les deux modes", () => {
    const scene = minimalScene();
    const { unmount } = render(
      <SolarScene3DViewer scene={scene} height={160} showCameraViewModeToggle showSun={false} showShadingLegend={false} />,
    );
    expect(document.querySelector("canvas")).toBeTruthy();
    fireEvent.click(screen.getByTestId("calpinage-viewer-mode-plan"));
    expect(document.querySelector("canvas")).toBeTruthy();
    unmount();
  });

  it("E — pas de branchement legacy phase3 dans l’arbre React du viewer", () => {
    const scene = minimalScene();
    render(
      <SolarScene3DViewer scene={scene} height={140} showCameraViewModeToggle showSun={false} showShadingLegend={false} />,
    );
    expect(document.querySelector("[data-phase3-legacy-preview]")).toBeNull();
    cleanup();
  });

  it("mode contrôlé : clic met à jour l’affichage sans changer la scène", () => {
    function Wrap() {
      const scene = useMemo(() => minimalScene(), []);
      const [mode, setMode] = useState<CameraViewMode>("SCENE_3D");
      return (
        <SolarScene3DViewer
          scene={scene}
          height={140}
          cameraViewMode={mode}
          onCameraViewModeChange={setMode}
          showCameraViewModeToggle
          showSun={false}
          showShadingLegend={false}
        />
      );
    }
    render(<Wrap />);
    const root = screen.getByTestId("solar-scene-3d-viewer-root");
    const key0 = root.getAttribute("data-canonical-scene-key");
    fireEvent.click(screen.getByTestId("calpinage-viewer-mode-plan"));
    expect(root.getAttribute("data-camera-view-mode")).toBe("PLAN_2D");
    expect(root.getAttribute("data-canonical-scene-key")).toBe(key0);
    cleanup();
  });
});
