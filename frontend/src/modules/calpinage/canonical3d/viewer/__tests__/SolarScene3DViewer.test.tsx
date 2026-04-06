/**
 * Stabilité montage / démontage + absence de throw (jsdom sans GPU).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { SolarScene3DViewer } from "../SolarScene3DViewer";
import { buildDemoSolarScene3D } from "../demoSolarScene3d";
import { computeViewerFraming } from "../viewerFraming";
import { computeSolarSceneBoundingBox } from "../solarSceneBounds";

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
        getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
        createBuffer: () => ({}),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        viewport: vi.fn(),
        clearColor: vi.fn(),
        clear: vi.fn(),
        depthFunc: vi.fn(),
        blendEquation: vi.fn(),
        blendFuncSeparate: vi.fn(),
        blendFunc: vi.fn(),
        cullFace: vi.fn(),
        frontFace: vi.fn(),
        scissor: vi.fn(),
        pixelStorei: vi.fn(),
        createTexture: () => ({}),
        bindTexture: vi.fn(),
        texParameteri: vi.fn(),
        texImage2D: vi.fn(),
        createProgram: () => ({}),
        createShader: () => ({}),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: () => true,
        useProgram: vi.fn(),
        getAttribLocation: () => 0,
        getUniformLocation: () => ({}),
        uniform1f: vi.fn(),
        uniform2f: vi.fn(),
        uniform3f: vi.fn(),
        uniform4f: vi.fn(),
        uniformMatrix4fv: vi.fn(),
        vertexAttribPointer: vi.fn(),
        enableVertexAttribArray: vi.fn(),
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

describe("SolarScene3DViewer", () => {
  it("monte et démonte sans erreur", async () => {
    const scene = buildDemoSolarScene3D();
    const { unmount } = render(<SolarScene3DViewer scene={scene} height={200} showSun={false} />);
    await vi.waitFor(
      () => {
        expect(document.querySelector("canvas")).toBeTruthy();
      },
      { timeout: 4000 },
    );
    unmount();
    cleanup();
  });

  it("bounding + framing cohérents pour la scène démo", () => {
    const scene = buildDemoSolarScene3D();
    const box = computeSolarSceneBoundingBox(scene);
    expect(box.isEmpty()).toBe(false);
    const f = computeViewerFraming(box, 1);
    expect(f.position.length()).toBeGreaterThan(0);
  });

  it("légende shading affichée (mode actif) quand snapshot near présent", async () => {
    const scene = buildDemoSolarScene3D();
    const { unmount } = render(<SolarScene3DViewer scene={scene} height={200} showSun={false} />);
    await vi.waitFor(
      () => {
        expect(screen.getByTestId("shading-legend-3d")).toBeTruthy();
      },
      { timeout: 4000 },
    );
    expect(screen.getByText(/Très favorable/i)).toBeTruthy();
    unmount();
    cleanup();
  });

  it("inspectMode affiche le panneau d’inspection (sans sélection initiale)", async () => {
    const scene = buildDemoSolarScene3D();
    const { unmount } = render(
      <SolarScene3DViewer scene={scene} height={200} showSun={false} inspectMode />,
    );
    await vi.waitFor(
      () => {
        expect(document.querySelector("canvas")).toBeTruthy();
      },
      { timeout: 4000 },
    );
    expect(screen.getByTestId("scene-inspection-panel-3d")).toBeTruthy();
    expect(screen.getByText(/Aucune sélection/i)).toBeTruthy();
    unmount();
    cleanup();
  });

  it("légende indisponible si aucune donnée shading sur la scène", async () => {
    const base = buildDemoSolarScene3D();
    const scene = {
      ...base,
      nearShadingSnapshot: undefined,
      panelVisualShadingByPanelId: undefined,
    };
    const { unmount } = render(<SolarScene3DViewer scene={scene} height={200} showSun={false} />);
    await vi.waitFor(
      () => {
        expect(screen.getByTestId("shading-legend-3d")).toBeTruthy();
      },
      { timeout: 4000 },
    );
    expect(screen.getByText(/Lecture shading non disponible/i)).toBeTruthy();
    unmount();
    cleanup();
  });
});
