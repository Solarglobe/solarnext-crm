import {
  api,
  coherentQuotePayload,
  expect,
  lockQuoteForImmutability,
  seedLockedFinancialScenario,
  test,
} from "./support/e2eTest";

test.describe("financial scenario and quote coherence", () => {
  test("generating a quote from a locked scenario enforces production, power and cost coherence", async ({ seed }) => {
    const ids = await seedLockedFinancialScenario(seed);

    const ok = await api(seed, "POST", "/api/quotes", coherentQuotePayload(ids));
    expect(ok.status, JSON.stringify(ok.data)).toBe(201);
    expect(Number(ok.data.quote.total_ttc)).toBeCloseTo(12000, 2);

    const incoherentPayload = coherentQuotePayload(ids);
    incoherentPayload.items[0].unit_price_ht = 11000;
    const blocked = await api(seed, "POST", "/api/quotes", incoherentPayload);
    expect(blocked.status, JSON.stringify(blocked.data)).toBe(409);
    expect(blocked.data.code).toBe("SCENARIO_QUOTE_COHERENCE_BLOCKED");
    expect(blocked.data.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "capexTtcEur" }),
      ])
    );
  });

  test("a locked quote rejects silent modification with 409", async ({ seed }) => {
    const ids = await seedLockedFinancialScenario(seed);
    const created = await api(seed, "POST", "/api/quotes", coherentQuotePayload(ids));
    expect(created.status, JSON.stringify(created.data)).toBe(201);

    await lockQuoteForImmutability(seed, created.data.quote.id);
    const blocked = await api(seed, "PATCH", `/api/quotes/${created.data.quote.id}`, {
      notes: "Modification apres verrouillage",
    });

    expect(blocked.status, JSON.stringify(blocked.data)).toBe(409);
    expect(blocked.data.code).toBe("DOCUMENT_LOCKED");
  });
});
