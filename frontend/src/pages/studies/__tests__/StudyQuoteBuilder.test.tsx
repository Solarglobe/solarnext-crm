/**
 * Tests minimaux : page Quote-builder (Préparation du devis technique).
 * Vérifie le rendu, le fetch quote-prep et le comportement validate/fork.
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import StudyQuoteBuilder from "../StudyQuoteBuilder";

describe("StudyQuoteBuilder", () => {
  const mockStudyId = "study-123";
  const mockVersionId = "version-456";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "fake-token"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it("affiche le titre Préparation du devis technique après chargement", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        technical_snapshot_summary: {
          nb_panels: 12,
          power_kwc: 6,
          production_annual_kwh: 7000,
          shading_pct: 5,
          orientation_deg: 180,
          tilt_deg: 30,
          inverter_family: "Hybrid",
          dc_ac_ratio: 1.2,
          gps: null,
          snapshot_version: 1,
        },
        economic_state: null,
        study_version_id: mockVersionId,
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/quote-builder`]}>
        <Routes>
          <Route path="/studies/:studyId/versions/:versionId/quote-builder" element={<StudyQuoteBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Préparation du devis technique")).toBeInTheDocument();
    });

    expect(screen.getByText("Impact d’ombrage global")).toBeInTheDocument();
    expect(screen.getByText("5 %")).toBeInTheDocument();
    expect(screen.queryByText(/kWh\/an/)).not.toBeInTheDocument();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/studies/${mockStudyId}/versions/${mockVersionId}/quote-prep`),
      expect.any(Object)
    );
  });

  it("affiche Résumé technique et Matériel principal", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        technical_snapshot_summary: { nb_panels: 8, power_kwc: 4, snapshot_version: 1 },
        economic_state: null,
        study_version_id: mockVersionId,
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/quote-builder`]}>
        <Routes>
          <Route path="/studies/:studyId/versions/:versionId/quote-builder" element={<StudyQuoteBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Résumé technique")).toBeInTheDocument();
      expect(screen.getByText("Matériel principal")).toBeInTheDocument();
      expect(screen.getByText("Prix & conditions")).toBeInTheDocument();
      expect(screen.getByText(/Options scénario/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Ajouter depuis le catalogue" })).toBeInTheDocument();
  });

  it("affiche erreur si quote-prep 404 (aucun calpinage pour cette version)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    render(
      <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/quote-builder`]}>
        <Routes>
          <Route path="/studies/:studyId/versions/:versionId/quote-builder" element={<StudyQuoteBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Version non trouvée|calpinage non validé|Paramètres d'URL manquants|Aucun calpinage/)).toBeInTheDocument();
    });
  });

  it("affiche marque/modèle panneaux et onduleurs quand technical_snapshot_summary les fournit", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        technical_snapshot_summary: {
          nb_panels: 16,
          power_kwc: 8,
          total_panels: 16,
          total_power_kwc: 8,
          panel: { brand: "MarquePanneau", model: "ModèleXYZ" },
          inverter: { brand: "MarqueOnduleur", name: "NomOnduleur 6kW" },
          snapshot_version: 1,
        },
        economic_state: null,
        study_version_id: mockVersionId,
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/studies/${mockStudyId}/versions/${mockVersionId}/quote-builder`]}>
        <Routes>
          <Route path="/studies/:studyId/versions/:versionId/quote-builder" element={<StudyQuoteBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Préparation du devis technique")).toBeInTheDocument();
    });
    expect(screen.getByText("MarquePanneau — ModèleXYZ")).toBeInTheDocument();
    expect(screen.getByText("MarqueOnduleur — NomOnduleur 6kW")).toBeInTheDocument();
  });
});
