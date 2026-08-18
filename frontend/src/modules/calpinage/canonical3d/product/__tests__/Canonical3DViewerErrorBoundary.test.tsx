/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Canonical3DViewerErrorBoundary } from "../Canonical3DProductMount";

function ThrowingViewer() {
  throw new Error("render failed");
}

describe("Canonical3DViewerErrorBoundary", () => {
  it("F — affiche un etat de panne au lieu de rendre null", () => {
    render(
      <Canonical3DViewerErrorBoundary>
        <ThrowingViewer />
      </Canonical3DViewerErrorBoundary>,
    );

    expect(screen.getByTestId("canonical-3d-render-error")).toBeTruthy();
    expect(screen.getByText(/vue 3D n'a pas pu/i)).toBeTruthy();
  });
});
