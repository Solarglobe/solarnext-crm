/**
 * FRONT DE SÉCURITÉ — Scénarios périmés / ambigus
 * Vérifie : blocage display_blocked/needs_recompute, bandeau "Snapshot périmé — recalcul requis",
 * raison technique, neutralisation des chiffres/comparaison, et badge profil conso brut/piloté.
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ScenariosPage from "../ScenariosPage";

vi.mock("../../../contexts/OrganizationContext", () => ({
  useSuperAdminReadOnly: () => false,
}));

vi.mock("../../../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/api")>();
  return { ...actual, apiFetch: (url: string, opts?: RequestInit) => fetch(url, opts) };
});

const mockStudyId = "study-123";
const mockVersionId = "version-456";

const studyPayload = {
  ok: true,
  json: async () => ({
    study: { id: mockStudyId, study_number: "SGS-2025-0001", title: "Étude test", lead_id: "lead-789", current_version: 1 },
    versions: [{ id: mockVersionId, version_number: 1 }],
  }),
};

function mockFetchRouter(scenariosRes: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/versions/") && url.includes("/scenarios")) {
      return Promise.resolve(scenariosRes as Response);
    }
    if (url.includes(`/api/studies/${mockStudyId}`) && !url.includes("/versions")) {
      return Promise.resolve(studyPayload as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/scenarios`]}>
      <Routes>
        <Route path="/studies/:studyId/versions/:versionId/scenarios" element={<ScenariosPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const baseScenario = (extra: Record<string, unknown> = {}) => ({
  id: "BASE",
  label: "Sans batterie",
  energy: { production_kwh: 6850, consumption_kwh: 6000, autoconsumption_kwh: 3077 },
  finance: { economie_year_1: 1041, roi_years: 11 },
  consumption_source: "ENEDIS_HOURLY",
  scenario_uses_piloted_profile: false,
  ...extra,
});

describe("ScenariosPage — front de sécurité", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    globalThis.URL.createObjectURL = vi.fn(() => "blob:http://test/mock-pdf");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("TEST 1+2 — display_blocked/needs_recompute : bandeau périmé + raison + chiffres neutralisés", async () => {
    mockFetchRouter({
      ok: true,
      json: async () => ({
        ok: true,
        scenarios: [baseScenario()],
        is_locked: false,
        selected_scenario_id: null,
        needs_recompute: true,
        display_blocked: true,
        blocked_reason: "STALE_SNAPSHOT_ENGINE_VERSION",
        snapshot_engine_version: "SmartPitch V-LIGHT V12",
        current_engine_version: "SmartPitch V-LIGHT V13",
      }),
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("scenarios-recompute-banner")).toBeInTheDocument();
    });
    expect(screen.getByText("Snapshot périmé — recalcul requis")).toBeInTheDocument();
    expect(screen.getByTestId("scenarios-blocked-reason")).toHaveTextContent("STALE_SNAPSHOT_ENGINE_VERSION");
    // Chiffres neutralisés : le tableau et le graphe de comparaison sont désactivés (pointer-events none)
    const masked = screen.getByTestId("scenarios-stale");
    expect(masked).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("scenarios-chart-stale")).toBeInTheDocument();
  });

  it("TEST 5 — snapshot bloqué : la zone d'actions (sélection/PDF) est neutralisée", async () => {
    mockFetchRouter({
      ok: true,
      json: async () => ({
        ok: true,
        scenarios: [baseScenario()],
        is_locked: false,
        selected_scenario_id: null,
        display_blocked: true,
        blocked_reason: "STALE_SNAPSHOT_ENGINE_VERSION",
      }),
    });
    renderPage();

    const masked = await screen.findByTestId("scenarios-stale");
    // pointer-events: none empêche tout clic (sélection scénario = génération PDF)
    expect(masked).toHaveStyle({ pointerEvents: "none" });
  });

  it("TEST 3 — scénario non piloté : badge 'Profil brut'", async () => {
    mockFetchRouter({
      ok: true,
      json: async () => ({
        ok: true,
        scenarios: [baseScenario({ scenario_uses_piloted_profile: false })],
        is_locked: false,
        selected_scenario_id: null,
      }),
    });
    renderPage();

    const badge = await screen.findByTestId("scenario-conso-profile-BASE");
    expect(badge).toHaveTextContent("Profil brut");
    expect(badge).toHaveTextContent("Enedis réelle");
  });

  it("TEST 4 — scénario piloté : badge 'Profil piloté'", async () => {
    mockFetchRouter({
      ok: true,
      json: async () => ({
        ok: true,
        scenarios: [baseScenario({ scenario_uses_piloted_profile: true, consumption_source: "MONTHLY_SYNTHETIC" })],
        is_locked: false,
        selected_scenario_id: null,
      }),
    });
    renderPage();

    const badge = await screen.findByTestId("scenario-conso-profile-BASE");
    expect(badge).toHaveTextContent("Profil piloté");
    expect(badge).toHaveTextContent("Synthétique mensuelle");
  });
});
