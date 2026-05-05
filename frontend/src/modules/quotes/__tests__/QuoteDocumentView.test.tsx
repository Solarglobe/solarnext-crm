import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuoteDocumentView } from "../QuoteDocumentView";
import type { QuotePdfPayload } from "../quoteDocumentTypes";
import { QUOTE_PDF_WORK_NUMBER_LABEL } from "../quoteUiStatus";

const basePayload: QuotePdfPayload = {
  number: "DEV-TEST-001",
  currency: "EUR",
  sent_at: "2026-01-15T12:00:00.000Z",
  valid_until: "2026-02-15",
  issuer: { display_name: "SolarNext Test" },
  recipient: { company_name: "Client SAS", first_name: "Jean", last_name: "Dupont" },
  lines: [
    {
      label: "Kit solaire",
      description: "Pose comprise",
      quantity: 1,
      unit_price_ht: 10000,
      vat_rate: 0.2,
      total_line_ht: 10000,
      total_line_ttc: 12000,
    },
  ],
  totals: { total_ht: 10000, total_vat: 2000, total_ttc: 12000, discount_ht: 0 },
  pdf_display: { show_line_pricing: true },
};

describe("QuoteDocumentView", () => {
  it("n’affiche pas le numéro officiel en présentation (showOfficialQuoteNumber false)", () => {
    render(
      <QuoteDocumentView
        payload={basePayload}
        variant="pdf"
        legalMode="draft"
        showOfficialQuoteNumber={false}
        brandColor="#6366F1"
        logoSrc={null}
        issuerFallbackName="SolarNext Test"
      />
    );
    expect(screen.queryByText("DEV-TEST-001")).not.toBeInTheDocument();
    expect(screen.getByText(QUOTE_PDF_WORK_NUMBER_LABEL)).toBeInTheDocument();
  });

  it("affiche le titre DEVIS et la référence", () => {
    const { container } = render(
      <QuoteDocumentView
        payload={basePayload}
        variant="present"
        legalMode="official"
        brandColor="#6366F1"
        logoSrc={null}
        issuerFallbackName="SolarNext Test"
      />
    );
    expect(screen.getByRole("heading", { name: /devis/i })).toBeInTheDocument();
    expect(screen.getByText("DEV-TEST-001")).toBeInTheDocument();
    expect(container.querySelector(".fq-devis-pricing-signature-bundle")).toBeTruthy();
    expect(container.querySelector(".fq-devis-dochead-block")).toBeTruthy();
  });

  it("colonne Total TTC présente en mode détaillé", () => {
    render(
      <QuoteDocumentView
        payload={basePayload}
        variant="present"
        legalMode="official"
        brandColor="#6366F1"
        logoSrc={null}
        issuerFallbackName="X"
      />
    );
    expect(screen.getByText(/Total TTC/)).toBeInTheDocument();
  });

  it("zones signature interactives ouvrent le pad (bouton dédié)", () => {
    const onClient = vi.fn();
    render(
      <QuoteDocumentView
        payload={basePayload}
        variant="present"
        legalMode="official"
        brandColor="#6366F1"
        logoSrc={null}
        issuerFallbackName="X"
        interactiveSignatures
        onSignatureClientClick={onClient}
      />
    );
    const btn = screen.getByRole("button", { name: /zone de signature agrandie.*client/i });
    fireEvent.click(btn);
    expect(onClient).toHaveBeenCalledTimes(1);
  });

  it("affiche Bon pour accord, case à cocher et date JJ/MM/AAAA (officiel)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T12:00:00.000Z"));
    try {
      const onApprove = vi.fn();
      render(
        <QuoteDocumentView
          payload={basePayload}
          variant="present"
          legalMode="official"
          brandColor="#6366F1"
          logoSrc={null}
          issuerFallbackName="X"
          clientReadApproved={false}
          onClientReadApprovedChange={onApprove}
        />
      );
      expect(screen.getByRole("checkbox", { name: /bon pour accord/i })).toBeInTheDocument();
      expect(screen.getByText(/\d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox", { name: /bon pour accord/i }));
      expect(onApprove).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("affiche la description longue avec retours à la ligne (bloc fq-line-desc-body)", () => {
    const payload: QuotePdfPayload = {
      ...basePayload,
      lines: [
        {
          ...basePayload.lines[0],
          description: "Ligne 1\n\nLigne 2 après saut",
        },
      ],
    };
    const { container } = render(
      <QuoteDocumentView
        payload={payload}
        variant="present"
        legalMode="official"
        brandColor="#6366F1"
        logoSrc={null}
        issuerFallbackName="X"
      />
    );
    const body = container.querySelector(".fq-line-desc-body");
    expect(body).toBeTruthy();
    expect(body?.textContent).toContain("Ligne 1");
    expect(body?.textContent).toContain("Ligne 2");
  });

  it("affiche aussi Bon pour accord en page Présenter brouillon", () => {
    const onApprove = vi.fn();
    render(
      <QuoteDocumentView
        payload={basePayload}
        variant="present"
        legalMode="draft"
        brandColor="#6366F1"
        logoSrc={null}
        issuerFallbackName="X"
        clientReadApproved={false}
        onClientReadApprovedChange={onApprove}
      />
    );
    expect(screen.getByRole("checkbox", { name: /bon pour accord/i })).toBeInTheDocument();
    expect(document.querySelector(".fq-approval-draft-hint")).toBeTruthy();
  });

  it("affiche le bloc CGV HTML lorsque legal_cgv.mode est html", () => {
    const { container } = render(
      <QuoteDocumentView
        payload={{
          ...basePayload,
          legal_cgv: { mode: "html", html: "<p>Clause test</p>" },
        }}
        variant="pdf"
        legalMode="official"
        brandColor="#6366F1"
        logoSrc={null}
        issuerFallbackName="X"
      />
    );
    expect(screen.getByRole("region", { name: /conditions générales de vente/i })).toBeInTheDocument();
    expect(container.querySelector(".pdf-cgv__html")?.innerHTML).toContain("Clause test");
  });

  it("n’affiche pas de bloc CGV lorsque mode pdf (fusion serveur)", () => {
    const { container } = render(
      <QuoteDocumentView
        payload={{ ...basePayload, legal_cgv: { mode: "pdf" } }}
        variant="pdf"
        legalMode="official"
        brandColor="#6366F1"
        logoSrc={null}
        issuerFallbackName="X"
      />
    );
    expect(container.querySelector(".pdf-cgv")).toBeNull();
  });
});
