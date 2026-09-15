import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LeadMeterModal from "../LeadMeterModal";
import { apiFetch } from "@/services/api";

vi.mock("@/services/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../MonthlyConsumptionChart", () => ({ default: () => null }));
const api = vi.mocked(apiFetch);
const profile = {
  contract: { pdl: "11111111111111", tariff_type: "hp_hc", plage_hc: "HC (22H30-6H30)",
    off_peak_periods: [{ start: "22:30", end: "06:30" }], puissance_souscrite_kva: 18 },
  engine: { annual_kwh: 8760, hourly: Array(8760).fill(1), period_start: "2025-01-01", period_end: "2025-12-31",
    timezone: "Europe/Paris", provenance: { source: "C68_R65" }, monthly_kwh_ref: [744, 672],
    contract_summary: "HP/HC (22H30-6H30) — 18 kVA — 230/400 V" },
  hourly: [{ timestamp: "2025-01-01T00:00:00+01:00", power_w: 1234 }],
  import_debug: { imported_files: ["c68.json", "r65.json", "loadcurve.csv"] },
};
const meter = { id: "meter-a", name: "Maison", consumption_mode: "PDL", energy_profile: profile,
  tariff_type: "hp_hc", hp_hc: true, meter_power_kva: 18,
  electricity_annual_bill_ttc: 2000, electricity_subscription_ttc_month: 15 };
const props = { open: true, mode: "edit" as const, meterId: "meter-a", leadId: "lead-1", apiBase: "",
  nextMeterOrdinal: 2, onClose: vi.fn(), onSaveSuccess: vi.fn() };
const jsonResponse = (value: unknown) => ({ ok: true, json: async () => value }) as Response;

beforeEach(() => {
  vi.clearAllMocks();
  api.mockImplementation(async (_url, options) => options?.method === "PATCH"
    ? jsonResponse({ id: "meter-a" }) : jsonResponse({ meter, consumption_monthly: [] }));
});
afterEach(cleanup);

function changeAmount(label: string, value: string) {
  const input = screen.getByText(label).parentElement?.querySelector("input");
  expect(input).toBeTruthy();
  fireEvent.change(input!, { target: { value } });
}

async function savedPayload() {
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  await waitFor(() => expect(api.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(true));
  return JSON.parse(String(api.mock.calls.find(([, options]) => options?.method === "PATCH")![1]!.body));
}

describe("meter modal profile round-trip", () => {
  it("keeps the complete imported C68 profile after editing the annual invoice and subscription", async () => {
    render(<LeadMeterModal {...props} />);
    await screen.findByDisplayValue("Maison");
    changeAmount("Facture annuelle électricité TTC (€)", "2400");
    changeAmount("Abonnement électricité TTC (€/mois)", "20");
    const saved = await savedPayload();
    expect(saved.electricity_annual_bill_ttc).toBe(2400);
    expect(saved.electricity_subscription_ttc_month).toBe(20);
    expect(saved.energy_profile).toEqual(profile);
    expect(api.mock.calls.find(([, options]) => options?.method === "PATCH")![0]).toBe("/api/leads/lead-1/meters/meter-a");
  });

  it("does not carry another meter’s C68 contract when selecting an engine-only meter", async () => {
    const view = render(<LeadMeterModal {...props} />);
    await screen.findByDisplayValue("Maison");
    const otherProfile = { engine: { annual_kwh: 8760, hourly: Array(8760).fill(1) }, import_debug: { meter: "B" } };
    api.mockImplementation(async (_url, options) => options?.method === "PATCH"
      ? jsonResponse({ id: "meter-b" })
      : jsonResponse({ meter: { ...meter, id: "meter-b", name: "Atelier", energy_profile: otherProfile }, consumption_monthly: [] }));
    view.rerender(<LeadMeterModal {...props} meterId="meter-b" />);
    await screen.findByDisplayValue("Atelier");
    const saved = await savedPayload();
    expect(saved.energy_profile).toEqual(otherProfile);
    expect(saved.energy_profile).not.toHaveProperty("contract");
    expect(api.mock.calls.find(([, options]) => options?.method === "PATCH")![0]).toBe("/api/leads/lead-1/meters/meter-b");
  });

  it("does not replace a complete stored hourly series with the 8760-point display projection", async () => {
    const completeProfile = { ...profile, engine: { ...profile.engine, annual_kwh: 8784, hourly: Array(8784).fill(1) } };
    api.mockImplementation(async (_url, options) => options?.method === "PATCH"
      ? jsonResponse({ id: "meter-a" }) : jsonResponse({ meter: { ...meter, energy_profile: completeProfile }, consumption_monthly: [] }));
    render(<LeadMeterModal {...props} />);
    await screen.findByDisplayValue("Maison");
    changeAmount("Facture annuelle électricité TTC (€)", "2500");
    const saved = await savedPayload();
    expect(saved.energy_profile.engine.hourly).toHaveLength(8784);
    expect(saved.energy_profile).toEqual(completeProfile);
  });

  it("still saves an explicit profile deletion", async () => {
    render(<LeadMeterModal {...props} />);
    await screen.findByDisplayValue("Maison");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer le profil énergie" }));
    expect((await savedPayload()).energy_profile).toBeNull();
  });
});
