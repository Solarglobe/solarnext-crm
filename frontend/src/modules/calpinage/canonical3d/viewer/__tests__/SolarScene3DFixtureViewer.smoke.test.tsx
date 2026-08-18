/**
 * Smoke : `SolarScene3DViewer` monte pour chaque fixture officielle (jsdom, WebGL stub).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { buildSolarScene3DFromCalpinageRuntime } from "../../buildSolarScene3DFromCalpinageRuntime";
import {
  RUNTIME_3D_FIXTURE_BATTERY,
  RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS,
  runtimeFixtureWithStrictRootPans,
} from "../../dev/runtime3DFixtureBattery";
import { SolarScene3DViewer } from "../SolarScene3DViewer";

const origGetContext = HTMLCanvasElement.prototype.getContext;
const INCLINED_MIN_TILT_DEG = 0.75;
const INCLINED_MIN_Z_SPAN_M = 0.02;

function expectFinitePositiveRoofGeometry(scene: NonNullable<ReturnType<typeof buildSolarScene3DFromCalpinageRuntime>["scene"]>) {
  for (const patch of scene.roofModel.roofPlanePatches) {
    expect(Number.isFinite(patch.surface.areaM2)).toBe(true);
    expect(patch.surface.areaM2).toBeGreaterThan(0);
    expect(patch.cornersWorld.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true);
    expect(Number.isFinite(patch.normal.x) && Number.isFinite(patch.normal.y) && Number.isFinite(patch.normal.z)).toBe(true);
    expect(Number.isFinite(patch.tiltDeg ?? Number.NaN)).toBe(true);
  }
}

function expectFixtureBusinessGeometry(fixtureId: string, scene: NonNullable<ReturnType<typeof buildSolarScene3DFromCalpinageRuntime>["scene"]>) {
  expectFinitePositiveRoofGeometry(scene);
  if (fixtureId !== "simple_gable_clean") return;

  expect(scene.metadata.geometryTruthStatus).toBe("VALID");
  expect(scene.metadata.roofQualityPhaseA?.quality).toBe("TRUTHFUL");
  expect(scene.roofModel.roofPlanePatches).toHaveLength(2);
  for (const patch of scene.roofModel.roofPlanePatches) {
    const zs = patch.cornersWorld.map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(INCLINED_MIN_Z_SPAN_M);
    expect(patch.tiltDeg).toBeGreaterThan(INCLINED_MIN_TILT_DEG);
    expect(patch.geometryTruthStatus).toBe("VALID");
  }
}

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

describe("SolarScene3DViewer — smoke fixtures officielles", () => {
  it.each([...RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS])(
    "monte avec inspectMode + shading pour fixture %s",
    async (fixtureId) => {
      const bundle = RUNTIME_3D_FIXTURE_BATTERY[fixtureId]!;
      const res = buildSolarScene3DFromCalpinageRuntime(
        runtimeFixtureWithStrictRootPans(bundle.runtime as Record<string, unknown>),
        {
          getAllPanels: () => bundle.panels,
        },
      );
      expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
      expect(res.scene).not.toBeNull();
      const scene = res.scene!;
      expectFixtureBusinessGeometry(fixtureId, scene);

      const { unmount } = render(
        <SolarScene3DViewer scene={scene} height={220} showSun={false} inspectMode />,
      );
      await vi.waitFor(
        () => {
          expect(document.querySelector("canvas")).toBeTruthy();
        },
        { timeout: 5000 },
      );
      const inspection = document.querySelector('[data-testid="scene-inspection-panel-3d"]');
      expect(inspection).toBeTruthy();
      unmount();
      cleanup();
    },
    10_000,
  );
});
