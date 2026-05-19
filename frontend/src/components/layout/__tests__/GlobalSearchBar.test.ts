import { describe, expect, it } from "vitest";
import { getGlobalSearchDestination } from "../GlobalSearchBar";
import type { GlobalSearchHit } from "../../../services/search.service";

function hit(overrides: Partial<GlobalSearchHit>): GlobalSearchHit {
  return {
    id: "abc-123",
    type: "lead",
    full_name: "Jean Test",
    email: null,
    phone: null,
    status: "LEAD",
    ...overrides,
  };
}

describe("GlobalSearchBar destinations", () => {
  it("opens leads and converted clients on understandable CRM destinations", () => {
    expect(getGlobalSearchDestination(hit({ type: "lead" }))).toBe("/leads/abc-123");
    expect(getGlobalSearchDestination(hit({ type: "client" }))).toBe("/leads/abc-123?context=client");
  });

  it("opens finance and document result types on their modules", () => {
    expect(getGlobalSearchDestination(hit({ type: "quote" }))).toBe("/quotes/abc-123");
    expect(getGlobalSearchDestination(hit({ type: "invoice" }))).toBe("/invoices/abc-123");
    expect(getGlobalSearchDestination(hit({ type: "document", full_name: "Facture 2026.pdf" }))).toBe(
      "/documents?search=Facture%202026.pdf"
    );
  });

  it("uses the backend route when present", () => {
    expect(getGlobalSearchDestination(hit({ type: "document", route: "/documents?search=PV" }))).toBe(
      "/documents?search=PV"
    );
  });
});
