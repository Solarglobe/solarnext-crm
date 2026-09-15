import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import VirtualBatterySettings from "../VirtualBatterySettings";
import { adminGetOrgSettings, adminPostOrgSettings } from "../../../services/admin.api";
import { getVirtualBatteryTariffs2026 } from "../../../data/virtualBatteryTariffs2026";

vi.mock("../../../services/admin.api", () => ({ adminGetOrgSettings: vi.fn(), adminPostOrgSettings: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  const providers = getVirtualBatteryTariffs2026().providers;
  vi.mocked(adminGetOrgSettings).mockResolvedValue({ pv: { virtual_battery: { providers: { MYLIGHT_MYBATTERY: providers.MYLIGHT_MYBATTERY } } } } as never);
  vi.mocked(adminPostOrgSettings).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[role="alert"]').forEach((element) => element.remove());
});

test("saves BASE purchases and supplier subscription in TTC fields without changing restitution", async () => {
  render(<VirtualBatterySettings />);
  const price = await screen.findByLabelText("Achat BASE TTC 9 kVA MYLIGHT_MYBATTERY PARTICULIER_BASE");
  fireEvent.change(price, { target: { value: "0.18" } });
  fireEvent.change(screen.getByLabelText("Abonnement fournisseur TTC 9 kVA MYLIGHT_MYBATTERY PARTICULIER_BASE"), { target: { value: "21" } });
  fireEvent.change(screen.getByLabelText("Date d’effet de la grille fournisseur"), { target: { value: "2026-09-14" } });
  fireEvent.change(screen.getByLabelText("Référence de la grille fournisseur"), { target: { value: "Grille contractuelle vérifiée" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer", exact: true }));
  await waitFor(() => expect(adminPostOrgSettings).toHaveBeenCalledTimes(1));
  const provider = (vi.mocked(adminPostOrgSettings).mock.calls[0][0] as any).pv.virtual_battery.providers.MYLIGHT_MYBATTERY;
  const row = provider.segments.PARTICULIER_BASE.rowsByKva["9"];
  expect(row.electricity_base_ttc_per_kwh).toBe(0.18);
  expect(row.abonnement_fixed_month_ttc).toBe(21);
  expect(row.restitution_energy_eur_per_kwh).toBe(0.07925);
  expect(row.reseau_eur_per_kwh).toBe(0.0484);
  expect(provider.effectiveDate).toBe("2026-09-14");
  expect(provider.sourceLabel).toBe("Grille contractuelle vérifiée");
});

test("saves independent HP and HC purchase prices", async () => {
  render(<VirtualBatterySettings />);
  fireEvent.click(await screen.findByRole("button", { name: /Particulier HP\/HC/ }));
  fireEvent.change(screen.getByLabelText("Achat HP TTC 9 kVA MYLIGHT_MYBATTERY PARTICULIER_HPHC"), { target: { value: "0.30" } });
  fireEvent.change(screen.getByLabelText("Achat HC TTC 9 kVA MYLIGHT_MYBATTERY PARTICULIER_HPHC"), { target: { value: "0.13" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer", exact: true }));
  await waitFor(() => expect(adminPostOrgSettings).toHaveBeenCalledTimes(1));
  const row = (vi.mocked(adminPostOrgSettings).mock.calls[0][0] as any).pv.virtual_battery.providers.MYLIGHT_MYBATTERY.segments.PARTICULIER_HPHC.rowsByKva["9"];
  expect(row.electricity_hp_ttc_per_kwh).toBe(0.30);
  expect(row.electricity_hc_ttc_per_kwh).toBe(0.13);
  expect(row.restitution_hp_eur_per_kwh).toBe(0.1606);
  expect(row.restitution_hc_eur_per_kwh).toBe(0.0856);
});

test("clearing an override removes it instead of making electricity free", async () => {
  render(<VirtualBatterySettings />);
  const price = await screen.findByLabelText("Achat BASE TTC 9 kVA MYLIGHT_MYBATTERY PARTICULIER_BASE");
  fireEvent.change(price, { target: { value: "0.18" } });
  fireEvent.change(price, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer", exact: true }));
  await waitFor(() => expect(adminPostOrgSettings).toHaveBeenCalledTimes(1));
  const row = (vi.mocked(adminPostOrgSettings).mock.calls[0][0] as any).pv.virtual_battery.providers.MYLIGHT_MYBATTERY.segments.PARTICULIER_BASE.rowsByKva["9"];
  expect(Object.prototype.hasOwnProperty.call(row, "electricity_base_ttc_per_kwh")).toBe(false);
});
