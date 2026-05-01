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
const createInvoiceDraftMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ id: "inv-draft-1" }))
);
const createInvoiceFromQuoteMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ id: "inv-quote-1" }))
);
const getQuoteDocumentViewModelMock = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      mode: "official",
      organizationId: "org-1",
      payload: {
        lines: [
          {
            label: "Materiel",
            description: "Panneaux",
            quantity: 1,
            unit_price_ht: 1000,
            vat_rate: 20,
            total_line_ht: 1000,
            total_line_vat: 200,
            total_line_ttc: 1200,
          },
          {
            label: "Pose",
            description: "Installation",
            quantity: 1,
            unit_price_ht: 500,
            vat_rate: 20,
            total_line_ht: 500,
            total_line_vat: 100,
            total_line_ttc: 600,
          },
        ],
      },
    })
  )
);
const fetchQuoteInvoiceBillingContextMock = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      quote_id: "q-locked",
      quote_number: "SG-LOCKED",
      quote_status: "ACCEPTED",
      client_id: "c-1",
      lead_id: null,
      quote_total_ttc: 1800,
      billing_total_ttc: 1800,
      billing_total_ht: 1500,
      billing_total_vat: 300,
      billing_locked_at: "2026-05-01T10:00:00.000Z",
      billing_is_locked: true,
      invoiced_ttc: 0,
      remaining_ttc: 1800,
      has_structured_deposit: false,
      deposit_ttc: null,
      deposit_structure: null,
      has_deposit_invoice: false,
      has_balance_invoice: false,
      can_create_deposit: true,
      can_create_balance: true,
      can_create_standard_full: true,
    })
  )
);

vi.mock("../../services/billingContacts.api", () => ({
  fetchClientsBillingSelect: vi.fn(() =>
    Promise.resolve([
      { id: "c-1", full_name: "Client — SG-2026-0001", email: null },
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
    createInvoiceDraft: createInvoiceDraftMock,
    createInvoiceFromQuote: createInvoiceFromQuoteMock,
    getQuoteDocumentViewModel: getQuoteDocumentViewModelMock,
    fetchQuoteInvoiceBillingContext: fetchQuoteInvoiceBillingContextMock,
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
      expect(screen.getByRole("option", { name: /Client — SG-2026-0001/ })).toBeInTheDocument();
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

  it("sans params : libellé devis optionnel inclut le nom client (API client_name)", async () => {
    fetchQuotesListMock.mockResolvedValueOnce([
      {
        id: "q-1",
        quote_number: "SG-2026-0029",
        status: "ACCEPTED",
        client_id: "c-1",
        lead_id: null,
        client_name: "KIM GIRARD",
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/invoices/new"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText(/Choisir un client/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Choisir un client/i), { target: { value: "c-1" } });

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "SG-2026-0029 — ACCEPTED — KIM GIRARD" })
      ).toBeInTheDocument();
    });
  });

  it("avec optionalQuoteId : ouvre la preparation depuis devis (pas createInvoiceDraft)", async () => {
    fetchQuotesListMock.mockResolvedValueOnce([
      {
        id: "q-1",
        quote_number: "SG-2026-0031",
        status: "ACCEPTED",
        client_id: "c-1",
      },
    ]);
    render(
      <MemoryRouter initialEntries={["/invoices/new"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
          <Route path="/invoices/:id" element={<div>Invoice detail</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText(/Choisir un client/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Choisir un client/i), { target: { value: "c-1" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /SG-2026-0031/i })).toBeInTheDocument()
    );
    fireEvent.change(screen.getByDisplayValue("— Aucun —"), { target: { value: "q-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer la facture/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Préparation de la facture/i })).toBeInTheDocument();
    });
    expect(createInvoiceFromQuoteMock).not.toHaveBeenCalled();
    expect(createInvoiceDraftMock).not.toHaveBeenCalled();
  });

  it("sans optionalQuoteId : conserve createInvoiceDraft", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
          <Route path="/invoices/:id" element={<div>Invoice detail</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText(/Choisir un client/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Choisir un client/i), { target: { value: "c-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer la facture/i }));

    await waitFor(() => {
      expect(createInvoiceDraftMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: "c-1",
          lead_id: null,
          lines: [],
        })
      );
    });
    expect(createInvoiceFromQuoteMock).not.toHaveBeenCalled();
  });

  it("preparation depuis devis verrouille : la croix supprime quand meme la ligne locale", async () => {
    render(
      <MemoryRouter initialEntries={["/invoices/new?fromQuote=q-locked&billingRole=DEPOSIT"]}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Materiel")).toBeInTheDocument();
      expect(screen.getByText("Pose")).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole("button", { name: "Supprimer la ligne" });
    expect(removeButtons[0]).toBeEnabled();

    fireEvent.click(removeButtons[0]);

    expect(screen.queryByText("Materiel")).not.toBeInTheDocument();
    expect(screen.getByText("Pose")).toBeInTheDocument();
  });
});
