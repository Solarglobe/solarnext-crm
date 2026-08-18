import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildViewerRenderInvalidationKey,
  ViewerRenderInvalidator,
  type ViewerRenderInvalidationInput,
} from "../viewerRenderInvalidation";

const fiberMocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) =>
    selector({ invalidate: fiberMocks.invalidate }),
}));

const baseInput: ViewerRenderInvalidationInput = {
  sceneKey: "solar-scene-3d-v1|2026-08-18T00:00:00.000Z|official",
  cameraViewMode: "SCENE_3D",
  qualityTier: "LOW",
  frameloop: "demand",
  reliability: {
    kind: "ready",
    generation: 4,
    renderedGeneration: 4,
    source: "OFFICIAL",
    geometryTruthStatus: "VALID",
    issueCodes: [],
  },
  patchCount: 2,
  pvPanelCount: 8,
  obstacleCount: 1,
  extensionCount: 0,
  pvOverlayEpoch: 3,
};

afterEach(() => {
  cleanup();
  fiberMocks.invalidate.mockReset();
  delete (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_RENDER_INVALIDATION__"];
  vi.restoreAllMocks();
});

describe("viewer render invalidation", () => {
  it("produit une signature qui change quand une génération de scène/PV change", () => {
    const k1 = buildViewerRenderInvalidationKey(baseInput);
    const k2 = buildViewerRenderInvalidationKey({
      ...baseInput,
      reliability: { ...baseInput.reliability, generation: 5, renderedGeneration: 5 },
      pvPanelCount: 9,
      pvOverlayEpoch: 4,
    });

    expect(k1).not.toBe(k2);
    expect(k2).toContain("gen=5");
    expect(k2).toContain("pv=9");
    expect(k2).toContain("pvOverlay=4");
  });

  it("LOW + demand : publication initiale puis nouvelle scène demandent une frame sans boucle", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { rerender } = render(<ViewerRenderInvalidator {...baseInput} />);
    expect(fiberMocks.invalidate).toHaveBeenCalledTimes(2);

    rerender(<ViewerRenderInvalidator {...baseInput} />);
    expect(fiberMocks.invalidate).toHaveBeenCalledTimes(2);

    rerender(
      <ViewerRenderInvalidator
        {...baseInput}
        sceneKey="solar-scene-3d-v1|2026-08-18T00:00:01.000Z|official"
      />,
    );
    expect(fiberMocks.invalidate).toHaveBeenCalledTimes(4);

    const snapshot = (window as unknown as Record<string, any>)["__CALPINAGE_3D_RENDER_INVALIDATION__"];
    expect(snapshot.count).toBe(4);
    expect(snapshot.lastReason).toBe("demand-scene-publication:raf");
  });

  it("HIGH/always invalide aussi au changement de caméra pour éviter un swap muet", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { rerender } = render(
      <ViewerRenderInvalidator {...baseInput} qualityTier="HIGH" frameloop="always" />,
    );
    expect(fiberMocks.invalidate).toHaveBeenCalledTimes(2);

    rerender(
      <ViewerRenderInvalidator
        {...baseInput}
        qualityTier="HIGH"
        frameloop="always"
        cameraViewMode="PLAN_2D"
      />,
    );
    expect(fiberMocks.invalidate).toHaveBeenCalledTimes(4);
  });
});
