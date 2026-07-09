/**
 * PDF V2 — Tests ScenariosPage (flux generate-pdf-from-scenario → téléchargement PDF auth → rechargement)
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ScenariosPage from "../ScenariosPage";

// La page utilise useSuperAdminReadOnly (OrganizationProvider). On le neutralise pour le test.
vi.mock("../../../contexts/OrganizationContext", () => ({
  useSuperAdminReadOnly: () => false,
}));

// apiFetch délègue directement au fetch mocké (évite le flux auth/refresh non mockable ici).
vi.mock("../../../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/api")>();
  return { ...actual, apiFetch: (url: string, opts?: RequestInit) => fetch(url, opts) };
});

describe("ScenariosPage", () => {
  const mockStudyId = "study-123";
  const mockVersionId = "version-456";
  const mockLeadId = "lead-789";

  const studyPayload = {
    ok: true,
    json: async () => ({
      study: {
        id: mockStudyId,
        study_number: "SGS-2025-0001",
        title: "Étude test",
        lead_id: mockLeadId,
        current_version: 1,
      },
      versions: [{ id: mockVersionId, version_number: 1 }],
    }),
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(window, "open").mockImplementation(() => null);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:http://test/mock-pdf");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  function mockFetchRouter(scenariosRes: unknown, pdfFromScenarioRes?: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (pdfFromScenarioRes && url.includes("generate-pdf-from-scenario")) {
        return Promise.resolve(pdfFromScenarioRes as Response);
      }
      if (url.includes("/documents/") && url.includes("/download")) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }),
          text: async () => "",
        } as Response);
      }
      if (url.includes("/versions/") && url.includes("/scenarios") && !url.includes("generate-pdf-from-scenario")) {
        return Promise.resolve(scenariosRes as Response);
      }
      if (url.includes(`/api/studies/${mockStudyId}`) && !url.includes("/versions")) {
        return Promise.resolve(studyPayload as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
  }

  it("TEST 6 — generate-pdf-from-scenario success → téléchargement + rechargement scénarios", async () => {
    const scenariosRes = {
      ok: true,
      json: async () => ({
        ok: true,
        scenarios: [{ id: "BASE", label: "Sans batterie", energy: {}, finance: {} }],
        is_locked: false,
        selected_scenario_id: null,
      }),
    };
    const pdfFromScenarioRes = {
      ok: true,
      json: async () => ({
        success: true,
        documentId: "doc-1",
        downloadUrl: "/api/documents/doc-1/download",
        fileName: "Etude_Solaire_Client.pdf",
      }),
    };
    mockFetchRouter(scenariosRes, pdfFromScenarioRes);

    render(
      <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/scenarios`]} initialIndex={0}>
        <Routes>
          <Route path="/studies/:studyId/versions/:versionId/scenarios" element={<ScenariosPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Choisir sans stockage")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Choisir sans stockage"));

    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const genCall = calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("generate-pdf-from-scenario"));
      expect(genCall).toBeDefined();
      const downloadCall = calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("/documents/doc-1/download"));
      expect(downloadCall).toBeDefined();
      expect(screen.getByText("Comparaison des solutions")).toBeInTheDocument();
    });
  });

  it("affiche Comparaison des solutions après chargement", async () => {
    const scenariosRes = {
      ok: true,
      json: async () => ({
        ok: true,
        scenarios: [{ id: "BASE", label: "Sans batterie", energy: {}, finance: {} }],
        is_locked: false,
        selected_scenario_id: null,
      }),
    };
    mockFetchRouter(scenariosRes);

    render(
      <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/scenarios`]}>
        <Routes>
          <Route path="/studies/:studyId/versions/:versionId/scenarios" element={<ScenariosPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Comparaison des solutions")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Étude test")).toBeInTheDocument();
    });
  });

  it("version verrouillée + BASE sélectionné → Télécharger à nouveau visible", async () => {
    const scenariosRes = {
      ok: true,
      json: async () => ({
        ok: true,
        scenarios: [{ id: "BASE", label: "Sans batterie", energy: { production_kwh: 1 }, finance: { economie_year_1: 1 } }],
        is_locked: true,
        selected_scenario_id: "BASE",
      }),
    };
    mockFetchRouter(scenariosRes);

    render(
      <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/scenarios`]}>
        <Routes>
          <Route path="/studies/:studyId/versions/:versionId/scenarios" element={<ScenariosPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(
      () => {
        expect(screen.getByText(/Solution sélectionnée/)).toBeInTheDocument();
        expect(screen.getByText("Télécharger à nouveau")).toBeInTheDocument();
      },
      { timeout: 4000 }
    );
  });
  it("snapshot périmé (V12 vs moteur V13) → bandeau needs_recompute + cartes non valides + recalcul", async () => {
    let recomputed = false;
    const staleBody = {
      ok: true,
      scenarios: [
        { id: "BASE", label: "Sans batterie", energy: { production_kwh: 5924 }, finance: { economie_year_1: 761 }, energy_basis: "hourly_8760" },
        { id: "BATTERY_PHYSICAL", label: "Batterie physique", energy: { production_kwh: 5924, pv_self_consumption_pct: 95.5 }, finance: { economie_year_1: 1095 }, energy_basis: "monthly_fallback", _engine_stale: true },
      ],
      is_locked: false,
      selected_scenario_id: null,
      needs_recompute: true,
      stale_snapshot: true,
      engine_coherent: false,
      snapshot_engine_version: "SmartPitch V-LIGHT V13",
      current_engine_version: "SmartPitch V-LIGHT V14",
    };
    const freshBody = {
      ok: true,
      scenarios: [
        { id: "BASE", label: "Sans batterie", energy: { production_kwh: 5924 }, finance: { economie_year_1: 761 }, energy_basis: "hourly_8760" },
        { id: "BATTERY_PHYSICAL", label: "Batterie physique", energy: { production_kwh: 5924, pv_self_consumption_pct: 75.5 }, finance: { economie_year_1: 873 }, energy_basis: "hourly_8760" },
      ],
      is_locked: false,
      selected_scenario_id: null,
      needs_recompute: false,
      stale_snapshot: false,
      engine_coherent: true,
      snapshot_engine_version: "SmartPitch V-LIGHT V14",
      current_engine_version: "SmartPitch V-LIGHT V14",
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/versions/") && url.includes("/calc")) {
        recomputed = true;
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response);
      }
      if (url.includes("/versions/") && url.includes("/scenarios")) {
        return Promise.resolve({ ok: true, json: async () => (recomputed ? freshBody : staleBody) } as unknown as Response);
      }
      if (url.includes(`/api/studies/${mockStudyId}`) && !url.includes("/versions")) {
        return Promise.resolve(studyPayload as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/scenarios`]}>
        <Routes>
          <Route path="/studies/:studyId/versions/:versionId/scenarios" element={<ScenariosPage />} />
        </Routes>
      </MemoryRouter>
    );

    // 1) Bandeau de péremption affiché
    await waitFor(() => {
      expect(
        screen.getByText("Snapshot périmé — recalcul requis")
      ).toBeInTheDocument();
    });
    // 2) Bouton de recalcul présent
    const recomputeBtn = screen.getByRole("button", { name: "Recalculer les scénarios" });
    expect(recomputeBtn).toBeInTheDocument();
    // 3) Anciennes cartes marquées non valides (conteneur périmé, désactivé)
    const staleWrap = screen.getByTestId("scenarios-stale");
    expect(staleWrap).toHaveAttribute("aria-disabled", "true");

    // 4) Recalcul → POST /calc puis rechargement → bandeau disparaît
    fireEvent.click(recomputeBtn);
    await waitFor(() => {
      expect(recomputed).toBe(true);
    });
    await waitFor(() => {
      expect(
        screen.queryByText("Snapshot périmé — recalcul requis")
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("scenarios-stale")).not.toBeInTheDocument();
  });

});
