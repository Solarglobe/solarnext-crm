/**
 * ConfirmDialog & ConfirmProvider — Tests unitaires.
 * Vérifie le pattern de confirmation destructive.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "../ConfirmDialog";
import { ConfirmProvider } from "../ConfirmProvider";

describe("ConfirmDialog", () => {
  it("n'affiche rien quand open=false", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Supprimer ?"
        description="Action irréversible."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("affiche le dialog quand open=true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Supprimer ce bloc ?"
        description="Le bloc sera définitivement supprimé."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("⚠️ Action importante")).toBeInTheDocument();
    expect(screen.getByText("Supprimer ce bloc ?")).toBeInTheDocument();
    expect(screen.getByText("Le bloc sera définitivement supprimé.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });

  it("appelle onCancel quand on clique Annuler", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Test"
        description="Desc"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("appelle onConfirm une seule fois quand on clique Confirmer", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Test"
        description="Desc"
        confirmLabel="Confirmer"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("pas de double appel onConfirm (deux clics rapides)", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Test"
        description="Desc"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    const confirmBtn = screen.getByRole("button", { name: "Confirmer" });
    act(() => {
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmProvider", () => {
  beforeEach(() => {
    delete (window as any).requestCalpinageConfirm;
  });

  it("expose window.requestCalpinageConfirm au mount", () => {
    render(
      <ConfirmProvider>
        <span>Child</span>
      </ConfirmProvider>
    );
    expect(typeof (window as any).requestCalpinageConfirm).toBe("function");
  });

  it("Annuler → onConfirm pas appelé", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmProvider>
        <span>Child</span>
      </ConfirmProvider>
    );
    act(() => {
      (window as any).requestCalpinageConfirm({
        title: "Supprimer ?",
        description: "Irréversible.",
        confirmLabel: "Supprimer",
        cancelLabel: "Annuler",
        onConfirm,
      });
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Confirmer → onConfirm appelé une fois", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmProvider>
        <span>Child</span>
      </ConfirmProvider>
    );
    act(() => {
      (window as any).requestCalpinageConfirm({
        title: "Supprimer ?",
        description: "Irréversible.",
        confirmLabel: "Supprimer",
        cancelLabel: "Annuler",
        onConfirm,
      });
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("nettoie window.requestCalpinageConfirm au unmount", () => {
    const { unmount } = render(
      <ConfirmProvider>
        <span>Child</span>
      </ConfirmProvider>
    );
    expect((window as any).requestCalpinageConfirm).toBeDefined();
    unmount();
    expect((window as any).requestCalpinageConfirm).toBeUndefined();
  });
});
