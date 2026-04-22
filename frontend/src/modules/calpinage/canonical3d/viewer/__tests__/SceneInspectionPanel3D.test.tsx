/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneInspectionPanel3D } from "../SceneInspectionPanel3D";
import { buildDemoSolarScene3D } from "../demoSolarScene3d";
import { buildSceneInspectionViewModel } from "../inspection/buildSceneInspectionViewModel";

describe("SceneInspectionPanel3D", () => {
  it("sans sélection : texte d’attente", () => {
    render(<SceneInspectionPanel3D model={null} showInspectionEmptyPlaceholder />);
    expect(screen.getByTestId("scene-inspection-panel-3d")).toBeTruthy();
    expect(screen.getByText(/Aucune sélection/i)).toBeTruthy();
  });

  it("avec modèle pan : affiche le type", () => {
    const scene = buildDemoSolarScene3D();
    const model = buildSceneInspectionViewModel(scene, { kind: "PAN", id: "roof-h" });
    render(<SceneInspectionPanel3D model={model} onDismiss={() => {}} />);
    expect(screen.getByText(/Inspection — pan/i)).toBeTruthy();
    expect(screen.getByText(/Pan de toiture/i)).toBeTruthy();
  });

  it("édition Z sommet : le curseur enregistre tout de suite (sans bouton Appliquer)", async () => {
    const onApply = vi.fn();
    render(
      <SceneInspectionPanel3D
        model={null}
        showPanSelectionEmptyPlaceholder
        roofVertexHeightEdit={{
          panId: "pan-a",
          vertexIndex: 2,
          referenceHeightM: 5,
          heightMinM: -2,
          heightMaxM: 30,
          onApplyHeightM: onApply,
        }}
      />,
    );
    const slider = screen.getByTestId("roof-vertex-z-slider") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(slider, { target: { value: "7.5" } });
    });
    expect(onApply).toHaveBeenCalledWith(7.5);
  });

  it("édition Z : valeur hors plage saisie ne déclenche pas le callback", async () => {
    const onApply = vi.fn();
    render(
      <SceneInspectionPanel3D
        model={null}
        showPanSelectionEmptyPlaceholder
        roofVertexHeightEdit={{
          panId: "pan-a",
          vertexIndex: 0,
          referenceHeightM: 5,
          heightMinM: -2,
          heightMaxM: 30,
          onApplyHeightM: onApply,
        }}
      />,
    );
    const num = screen.getByTestId("roof-vertex-z-number") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(num, { target: { value: "40" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("roof-vertex-z-apply"));
    });
    expect(screen.getByTestId("roof-vertex-z-input-error")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("édition Z : saisie non numérique ne déclenche pas le callback", async () => {
    const onApply = vi.fn();
    render(
      <SceneInspectionPanel3D
        model={null}
        showPanSelectionEmptyPlaceholder
        roofVertexHeightEdit={{
          panId: "pan-a",
          vertexIndex: 0,
          referenceHeightM: 5,
          heightMinM: -2,
          heightMaxM: 30,
          onApplyHeightM: onApply,
        }}
      />,
    );
    const num = screen.getByTestId("roof-vertex-z-number") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(num, { target: { value: "abc" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("roof-vertex-z-apply"));
    });
    expect(screen.getByTestId("roof-vertex-z-input-error")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("édition XY sommet : Appliquer Δ monde appelle le callback", async () => {
    const onDelta = vi.fn();
    const onPx = vi.fn();
    render(
      <SceneInspectionPanel3D
        model={null}
        showPanSelectionEmptyPlaceholder
        roofVertexXYEdit={{
          panId: "pan-a",
          vertexIndex: 0,
          referenceXPx: 100,
          referenceYPx: 200,
          maxDisplacementPx: 64,
          onApplyDeltaWorldM: onDelta,
          onApplyImagePx: onPx,
        }}
      />,
    );
    const dXm = screen.getByTestId("roof-vertex-xy-dxm") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(dXm, { target: { value: "0.1" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("roof-vertex-xy-apply-world"));
    });
    expect(onDelta).toHaveBeenCalledWith(0.1, 0);
    expect(onPx).not.toHaveBeenCalled();
  });
});
