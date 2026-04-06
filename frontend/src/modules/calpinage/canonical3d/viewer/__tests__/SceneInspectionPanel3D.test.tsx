/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SceneInspectionPanel3D } from "../SceneInspectionPanel3D";
import { buildDemoSolarScene3D } from "../demoSolarScene3d";
import { buildSceneInspectionViewModel } from "../inspection/buildSceneInspectionViewModel";

describe("SceneInspectionPanel3D", () => {
  it("sans sélection : texte d’attente", () => {
    render(<SceneInspectionPanel3D model={null} />);
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
});
