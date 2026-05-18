import {
  api,
  coherentQuotePayload,
  expect,
  markQuoteAccepted,
  seedLockedFinancialScenario,
  test,
} from "./support/e2eTest";

test.describe("lead to quote and billing critical flow", () => {
  test("lead -> study -> locked scenario -> quote -> invoice -> paid", async ({ seed }) => {
    const ids = await seedLockedFinancialScenario(seed);

    const quote = await api(seed, "POST", "/api/quotes", coherentQuotePayload(ids));
    expect(quote.status, JSON.stringify(quote.data)).toBe(201);
    expect(quote.data.quote.lead_id).toBe(ids.leadId);
    expect(quote.data.quote.study_id).toBe(ids.studyId);
    expect(quote.data.quote.study_version_id).toBe(ids.versionId);

    await markQuoteAccepted(seed, quote.data.quote.id);

    const invoice = await api(seed, "POST", "/api/invoices", {
      lead_id: ids.leadId,
      quote_id: quote.data.quote.id,
      lines: [
        {
          label: "Installation photovoltaique 6 kWc",
          description: "Installation photovoltaique 6 kWc",
          quantity: 1,
          unit_price_ht: 10000,
          vat_rate: 20,
        },
      ],
    });
    expect(invoice.status, JSON.stringify(invoice.data)).toBe(201);
    expect(Number(invoice.data.total_ttc)).toBeCloseTo(12000, 2);

    const issued = await api(seed, "PATCH", `/api/invoices/${invoice.data.id}/status`, {
      status: "ISSUED",
    });
    expect(issued.status, JSON.stringify(issued.data)).toBe(200);
    expect(issued.data.status).toBe("ISSUED");

    const paid = await api(seed, "POST", `/api/invoices/${invoice.data.id}/payments`, {
      amount: 12000,
      payment_date: "2026-05-18",
      payment_method: "BANK_TRANSFER",
      reference: "E2E-PAID",
    });
    expect(paid.status, JSON.stringify(paid.data)).toBe(201);

    const refreshed = await api(seed, "GET", `/api/invoices/${invoice.data.id}`);
    expect(refreshed.status, JSON.stringify(refreshed.data)).toBe(200);
    expect(refreshed.data.status).toBe("PAID");
    expect(Number(refreshed.data.amount_due)).toBe(0);
  });

  test.fixme("quote -> PDF generation stores a downloadable document", async () => {
    // PDF rendering depends on the browser renderer and legal document setup in the target environment.
  });
});
