/**
 * ToastProvider — Tests unitaires.
 * Vérifie que le toast s'affiche et que window.calpinageToast est exposé.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "../ToastProvider";

function TestConsumer() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success("Succès")}>Success</button>
      <button onClick={() => toast.error("Erreur")}>Error</button>
      <button onClick={() => toast.warning("Attention")}>Warning</button>
    </div>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    delete (window as any).calpinageToast;
    delete (window as any).showToast;
  });

  it("expose window.calpinageToast au mount", () => {
    render(
      <ToastProvider>
        <span>Child</span>
      </ToastProvider>
    );
    expect(typeof (window as any).calpinageToast).toBe("object");
    expect(typeof (window as any).calpinageToast.success).toBe("function");
    expect(typeof (window as any).calpinageToast.error).toBe("function");
    expect(typeof (window as any).calpinageToast.warning).toBe("function");
    expect(typeof (window as any).calpinageToast.info).toBe("function");
  });

  it("expose window.showToast pour compatibilité legacy", () => {
    render(
      <ToastProvider>
        <span>Child</span>
      </ToastProvider>
    );
    expect(typeof (window as any).showToast).toBe("function");
  });

  it("affiche un toast au clic", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText("Error").click();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Erreur");
  });

  it("useToast retourne une API valide", () => {
    let api: ReturnType<typeof useToast> | null = null;
    function Capture() {
      api = useToast();
      return null;
    }
    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>
    );
    expect(api).not.toBeNull();
    expect(typeof api!.success).toBe("function");
    expect(typeof api!.error).toBe("function");
  });
});
