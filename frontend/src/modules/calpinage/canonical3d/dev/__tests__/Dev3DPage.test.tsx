/**
 * Sandbox /dev/3d : montage sans crash, scène démo valide.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Dev3DPage from "../Dev3DPage";

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

describe("Dev3DPage", () => {
  it("monte en mode demo avec header et canvas (import.meta.env.DEV)", async () => {
    if (!import.meta.env.DEV) {
      return;
    }
    render(
      <MemoryRouter initialEntries={["/dev/3d?mode=demo"]}>
        <Routes>
          <Route path="/dev/3d" element={<Dev3DPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/dev\/3d/i)).toBeTruthy();
    expect(screen.getByText(/mode=demo/i)).toBeTruthy();

    await vi.waitFor(
      () => {
        expect(document.querySelector("canvas")).toBeTruthy();
      },
      { timeout: 5000 },
    );

    cleanup();
  });

  it("n’explose pas en mode runtime (fixture)", async () => {
    if (!import.meta.env.DEV) {
      return;
    }
    render(
      <MemoryRouter initialEntries={["/dev/3d?mode=runtime"]}>
        <Routes>
          <Route path="/dev/3d" element={<Dev3DPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await vi.waitFor(
      () => {
        expect(document.querySelector("canvas")).toBeTruthy();
      },
      { timeout: 5000 },
    );

    cleanup();
  });

  it("affiche le JSON de parité avec parity=1 + fixture runtime", async () => {
    if (!import.meta.env.DEV) {
      return;
    }
    render(
      <MemoryRouter initialEntries={["/dev/3d?mode=runtime&fixture=simple_gable_clean&parity=1"]}>
        <Routes>
          <Route path="/dev/3d" element={<Dev3DPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await vi.waitFor(
      () => {
        expect(screen.getByTestId("dev-3d-parity-report")).toBeTruthy();
      },
      { timeout: 6000 },
    );
    const pre = screen.getByTestId("dev-3d-parity-report");
    expect(pre.textContent).toMatch(/"overall"/);
    expect(pre.textContent).toMatch(/simple_gable_clean/);

    cleanup();
  });
});
