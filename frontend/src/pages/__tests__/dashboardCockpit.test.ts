import { describe, expect, it } from "vitest";
import { buildCockpitActions } from "../DashboardPage";
import type { DashboardOverview } from "../../services/dashboard.service";

const overview = {
  global_kpis: {
    quotes_stock_total: 7,
    quotes_stock_accepted_count: 3,
  },
  pipeline: {
    leads_by_stage: [
      {
        stage_id: "contact",
        stage_name: "Contact",
        position: 1,
        is_closed: false,
        leads_count: 2,
        total_potential_revenue: 0,
      },
      {
        stage_id: "relance",
        stage_name: "Relance",
        position: 2,
        is_closed: false,
        leads_count: 5,
        total_potential_revenue: 0,
      },
    ],
  },
  forecast: {
    overdue_invoices_amount: 1200,
  },
} as DashboardOverview;

describe("dashboard cockpit actions", () => {
  it("prioritizes real action links without inventing a planning count", () => {
    const actions = buildCockpitActions(overview, {
      canQuote: true,
      canInvoice: true,
      canPlanning: true,
    });

    expect(actions.map((action) => action.id)).toEqual([
      "follow-up-leads",
      "quotes-no-answer",
      "overdue-invoices",
      "today-planning",
    ]);
    expect(actions[0]).toMatchObject({
      value: "5",
      to: "/leads?stage=relance",
      tone: "warn",
    });
    expect(actions.find((action) => action.id === "today-planning")?.value).toBe("Planning");
  });

  it("hides finance actions when permissions are missing", () => {
    const actions = buildCockpitActions(overview, {
      canQuote: false,
      canInvoice: false,
      canPlanning: true,
    });

    expect(actions.map((action) => action.id)).toEqual(["follow-up-leads", "today-planning"]);
  });
});
