/**
 * PDF V2 — Tests ScenariosPage (flux generate-pdf-from-scenario → téléchargement PDF auth → rechargement)
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ScenariosPage from "../ScenariosPage";

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
});
