/**
 * PDF V2 — Tests StudyPdfActions
 * TEST 1-4 : génération, affichage, téléchargement, régénération
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import StudyPdfActions from "../StudyPdfActions";

const API_BASE = "http://localhost:3000";

describe("StudyPdfActions", () => {
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

  it("TEST 1 — affiche Générer le PDF quand aucun document", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(
      <StudyPdfActions
        studyId={mockStudyId}
        versionId={mockVersionId}
        isLocked={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("PDF SolarNext")).toBeInTheDocument();
    });
    expect(screen.getByText("Aucun PDF généré")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Générer le PDF/i })).toBeInTheDocument();
  });

  it("TEST 2 — affiche Voir / Télécharger / Régénérer quand PDF existant", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "doc-1",
          file_name: "solarnext-study-123-v456.pdf",
          file_size: 1024,
          mime_type: "application/pdf",
          created_at: "2026-03-07T13:55:00Z",
          document_type: "study_pdf",
        },
      ],
    });

    render(
      <StudyPdfActions
        studyId={mockStudyId}
        versionId={mockVersionId}
        isLocked={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Dernière génération/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Voir/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Télécharger/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Régénérer/i })).toBeInTheDocument();
  });

  it("TEST 3 — Générer appelle POST generate-pdf et rafraîchit", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, documentId: "doc-new", fileName: "test.pdf" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "doc-new", file_name: "test.pdf", created_at: "2026-03-07T14:00:00Z", document_type: "study_pdf" },
        ],
      });

    render(
      <StudyPdfActions
        studyId={mockStudyId}
        versionId={mockVersionId}
        isLocked={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Générer le PDF/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Générer le PDF/i }));

    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const generateCall = calls.find(
        (c: [string, object]) =>
          typeof c[0] === "string" && c[0].includes("generate-pdf")
      );
      expect(generateCall).toBeDefined();
      expect(generateCall![0]).toContain(`/api/studies/${mockStudyId}/versions/${mockVersionId}/generate-pdf`);
    });
  });

  it("TEST 4 — Régénérer désactivé quand version verrouillée", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "doc-1",
          file_name: "solarnext-study.pdf",
          created_at: "2026-03-07T13:55:00Z",
          document_type: "study_pdf",
        },
      ],
    });

    render(
      <StudyPdfActions
        studyId={mockStudyId}
        versionId={mockVersionId}
        isLocked={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Régénérer/i })).toBeDisabled();
    });
  });

  it("TEST 5 — fetch documents study_version", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(
      <StudyPdfActions
        studyId={mockStudyId}
        versionId={mockVersionId}
      />
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/documents/study_version/${mockVersionId}`),
        expect.any(Object)
      );
    });
  });
});
