/**
 * Contexte création facture : pas de select client en leadId/clientId URL,
 * choix exclusif en mode libre, libellés guidés.
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import InvoiceCreatePage from "../InvoiceCreatePage";

const fetchQuotesListMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve<{ id: string; quote_number: string; status: string }[]>([]))
);

vi.mock("../../services/billingContacts.api", () => ({
  fetchClientsBillingSelect: vi.fn(() =>
    Promise.resolve([
      { id: "c-1", full_name: "Client sans nom — SG-2026-0001", email: null },
    ])
  ),
  fetchLeadsBillingSelect: vi.fn(() =>
    Promise.resolve([{ id: "l-1", full_name: "Lead Test", email: null }])
  ),
}));

vi.mock("../../services/financial.api", async () => {
  const actual = await vi.importActual<typeof import("../../services/financial.api")>(
    "../../services/financial.api"
  );
  return {
    ...actual,
    fetchQuotesList: fetchQuotesListMock,
  };
});

describe("InvoiceCreatePage — contexte client / lead / libre", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "fake-token"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it("avec ?leadId= : pas de champ « Choisir un client », bloc lead", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new?leadId=l-1"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Facture rattachée au lead\s*:/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Choisir un client/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Ou choisir un lead/i)).not.toBeInTheDocument();
  });

  it("avec ?clientId= : pas de champ « Choisir un client », bloc client", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new?clientId=c-1"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Facture rattachée au client\s*:/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Choisir un client/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Ou choisir un lead/i)).not.toBeInTheDocument();
  });

  it("sans params : libellés guidés visibles", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Choisir un client/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Ou choisir un lead/i)).toBeInTheDocument();
  });

  it("sans params : option client affiche le libellé fallback explicite", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Client sans nom — SG-2026-0001/ })).toBeInTheDocument();
    });
  });

  it("sans params : choix client vide le lead", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText(/Ou choisir un lead/i)).toBeInTheDocument());
    const leadSel = screen.getByLabelText(/Ou choisir un lead/i) as HTMLSelectElement;
    const clientSel = screen.getByLabelText(/Choisir un client/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(leadSel, { target: { value: "l-1" } });
    });
    expect(clientSel.value).toBe("");

    await act(async () => {
      fireEvent.change(clientSel, { target: { value: "c-1" } });
    });
    expect(leadSel.value).toBe("");
  });

  it("sans params : choix lead vide le client", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText(/Choisir un client/i)).toBeInTheDocument());
    const leadSel = screen.getByLabelText(/Ou choisir un lead/i) as HTMLSelectElement;
    const clientSel = screen.getByLabelText(/Choisir un client/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(clientSel, { target: { value: "c-1" } });
    });
    expect(leadSel.value).toBe("");

    await act(async () => {
      fireEvent.change(leadSel, { target: { value: "l-1" } });
    });
    expect(clientSel.value).toBe("");
  });

  it("sans params : après choix client, fetchQuotesList avec client_id", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText(/Choisir un client/i)).toBeInTheDocument());
    const clientSel = screen.getByLabelText(/Choisir un client/i);
    fireEvent.change(clientSel, { target: { value: "c-1" } });

    await waitFor(() => {
      expect(fetchQuotesListMock).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: "c-1", limit: 200 })
      );
    });
  });
});
