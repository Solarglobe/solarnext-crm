import { describe, expect, it } from "vitest";
import { buildManualInvoiceNewHref } from "../financial/FinancialInvoicesTable";

describe("CRM financial flow links", () => {
  it("keeps invoice creation attached to the client when a converted client exists", () => {
    expect(buildManualInvoiceNewHref("client-1", "lead-1")).toBe("/invoices/new?clientId=client-1");
  });

  it("keeps invoice creation attached to the lead before conversion", () => {
    expect(buildManualInvoiceNewHref(null, "lead-1")).toBe("/invoices/new?leadId=lead-1");
  });
});
