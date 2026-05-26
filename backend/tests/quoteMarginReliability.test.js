import test from "node:test";
import assert from "node:assert/strict";

import { buildQuoteMarginKpi } from "../services/quoteMarginReliability.service.js";

test("buildQuoteMarginKpi excludes lines without purchase cost or with purchase cost at zero", () => {
  const kpi = buildQuoteMarginKpi([
    {
      is_active: true,
      quantity: 2,
      total_line_ht: 1000,
      purchase_unit_price_ht_cents: 30000,
    },
    {
      is_active: true,
      quantity: 1,
      total_line_ht: 500,
      purchase_unit_price_ht_cents: 0,
    },
    {
      is_active: true,
      quantity: 1,
      total_line_ht: 250,
      purchase_unit_price_ht_cents: null,
    },
  ]);

  assert.equal(kpi.is_margin_reliable, false);
  assert.equal(kpi.active_line_count, 3);
  assert.equal(kpi.lines_missing_purchase_count, 2);
  assert.equal(kpi.purchase_cost_ht, 600);
  assert.equal(kpi.margin_ht, 400);
});

