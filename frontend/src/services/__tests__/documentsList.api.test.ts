import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: apiFetchMock,
}));

vi.mock("../../config/crmApiBase", () => ({
  getCrmApiBase: () => "https://crm.test/",
}));

describe("fetchOrganizationDocuments", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ success: true, documents: [], total: 0 }),
    });
  });

  it("transmet les filtres type et rattachement", async () => {
    const { fetchOrganizationDocuments } = await import("../documentsList.api");

    await fetchOrganizationDocuments({
      search: "SGQ-2026",
      type: "quote",
      entity: "lead",
      limit: 25,
      offset: 50,
    });

    expect(apiFetchMock).toHaveBeenCalledWith(
      "https://crm.test/api/documents?search=SGQ-2026&type=quote&entity=lead&limit=25&offset=50"
    );
  });

  it("omet les filtres neutres", async () => {
    const { fetchOrganizationDocuments } = await import("../documentsList.api");

    await fetchOrganizationDocuments({ type: "all", entity: "all", limit: 50, offset: 0 });

    expect(apiFetchMock).toHaveBeenCalledWith("https://crm.test/api/documents?limit=50&offset=0");
  });
});
