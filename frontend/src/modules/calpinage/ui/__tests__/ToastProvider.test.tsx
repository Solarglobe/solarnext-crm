/**
 * ToastProvider — Tests unitaires.
 *
 * Couvre :
 *   - exposition window.calpinageToast / window.showToast
 *   - affichage et contenu du toast
 *   - bouton × (fermeture manuelle)
 *   - swipe-to-dismiss gauche (seuil 80 px via Pointer Events)
 *   - reset si swipe < 80 px
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider, useToast } from "../ToastProvider";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** Fire une séquence de pointer events simulant un swipe horizontal. */
function fireSwipe(element: Element, startX: number, endX: number) {
  fireEvent.pointerDown(element, { clientX: startX, pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: endX, pointerId: 1 });
  fireEvent.pointerUp(element, { clientX: endX, pointerId: 1 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ToastProvider", () => {
  beforeEach(() => {
    delete (window as any).calpinageToast;
    delete (window as any).showToast;
  });

  // ── Exposition globale ────────────────────────────────────────────────────

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

  // ── Affichage ─────────────────────────────────────────────────────────────

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

  // ── Bouton × (fermeture manuelle) ─────────────────────────────────────────

  it("rend un bouton × avec aria-label='Fermer' dans chaque toast", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText("Success").click();
    });
    // Le bouton existe dans le DOM (affiché ou masqué par CSS — jsdom ignore display:none media)
    const closeBtn = screen.getByRole("button", { name: "Fermer" });
    expect(closeBtn).toBeTruthy();
  });

  it("cliquer × supprime le toast", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText("Error").click();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "Fermer" }).click();
    });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("cliquer × supprime uniquement le toast ciblé si plusieurs toasts", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText("Success").click();
      screen.getByText("Error").click();
    });
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);

    // Fermer le premier × uniquement
    const closeBtns = screen.getAllByRole("button", { name: "Fermer" });
    act(() => {
      closeBtns[0]!.click();
    });
    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    });
  });

  // ── Swipe-to-dismiss ──────────────────────────────────────────────────────

  it("swipe gauche > 80 px → dismiss le toast", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText("Warning").click();
    });
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();

    act(() => {
      fireSwipe(alert, 300, 300 - 90); // deltaX = -90 px > seuil 80 px
    });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("swipe gauche < 80 px → ne dismiss pas (reset)", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText("Success").click();
    });
    const alert = screen.getByRole("alert");

    act(() => {
      fireSwipe(alert, 300, 300 - 40); // deltaX = -40 px < seuil 80 px
    });
    // Le toast reste visible après le reset
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("swipe droite (deltaX > 0) n'applique pas de translation", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText("Success").click();
    });
    const alert = screen.getByRole("alert");

    act(() => {
      fireSwipe(alert, 100, 200); // swipe droite — ignoré
    });
    // Toast toujours présent, pas de transform négatif
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect((alert as HTMLElement).style.transform).toBeFalsy();
  });

  it("pointerCancel reset la translation sans dismiss", async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText("Error").click();
    });
    const alert = screen.getByRole("alert");

    act(() => {
      fireEvent.pointerDown(alert, { clientX: 300, pointerId: 1 });
      fireEvent.pointerMove(alert, { clientX: 200, pointerId: 1 }); // -100px en cours
      fireEvent.pointerCancel(alert, { pointerId: 1 }); // interruption
    });
    // Toast toujours présent après cancel
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
