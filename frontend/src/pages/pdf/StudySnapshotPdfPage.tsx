/**
 * PDF V2 — Page React standalone de rendu PDF
 * CP-PDF-V2-019 : si renderToken dans l'URL → route interne (Playwright).
 * Sinon → GET /api/studies/:studyId/versions/:versionId/pdf-view-model (JWT CRM).
 * Signal de readiness : __pdf_render_ready et #pdf-ready[data-status="ready"] dès view-model chargé (P10 ne bloque plus).
 */

import React, { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../../services/api";
import PdfLegacyPort from "./PdfLegacyPort";
import "./pdf-print.css";
import "./PdfEngine/pdf-unified.css";
import "./study-report-page.css";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

const API_BASE = getCrmApiBaseWithWindowFallback();

interface PdfViewModel {
  meta?: { scenarioType?: string };
  client?: { name?: string; city?: string };
  production?: { annualProductionKwh?: number };
  economics?: { roiYears?: number };
  selectedScenario?: { label?: string };
  fullReport?: unknown;
  [key: string]: unknown;
}

type Status = "loading" | "error" | "success";

function getIdsFromUrl(): { studyId: string; versionId: string; renderToken: string } {
  if (typeof window === "undefined") return { studyId: "", versionId: "", renderToken: "" };
  const search = new URLSearchParams(window.location.search);
  return {
    studyId: search.get("studyId") ?? "",
    versionId: search.get("versionId") ?? "",
    renderToken: search.get("renderToken") ?? "",
  };
}

export default function StudySnapshotPdfPage(props?: { studyId?: string; versionId?: string }) {
  const urlIds = useMemo(() => getIdsFromUrl(), []);
  const { studyId: paramStudyId, versionId: paramVersionId } = useParams<{ studyId?: string; versionId?: string }>();
  const studyId = props?.studyId ?? urlIds.studyId ?? paramStudyId ?? "";
  const versionId = props?.versionId ?? urlIds.versionId ?? paramVersionId ?? "";
  const renderToken = urlIds.renderToken;
  const [status, setStatus] = useState<Status>("loading");
  const [viewModel, setViewModel] = useState<PdfViewModel | null>(null);

  // Reset readiness au montage (aucun fallback temporel)
  useEffect(() => {
    (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = false;
    return () => {
      (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = false;
    };
  }, []);

  // Fetch pdf-view-model — route interne si renderToken (Playwright), sinon JWT (CRM)
  useEffect(() => {
    if (!studyId || !versionId) {
      setStatus("error");
      return;
    }

    const url = renderToken
      ? `${API_BASE}/api/internal/pdf-view-model/${encodeURIComponent(studyId)}/${encodeURIComponent(versionId)}?renderToken=${encodeURIComponent(renderToken)}`
      : `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/pdf-view-model`;
    (renderToken ? fetch(url) : apiFetch(url))
      .then((res) => {
        if (!res.ok) {
          setStatus("error");
          return;
        }
        return res.json();
      })
      .then((data: { ok?: boolean; viewModel?: PdfViewModel }) => {
        if (data?.ok === true && data.viewModel) {
          setViewModel(data.viewModel);
          setStatus("success");
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, [studyId, versionId, renderToken]);

  // __pdf_render_ready = true uniquement après rendu effectif (données présentes)
  useEffect(() => {
    if (status === "success" && viewModel != null) {
      (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = true;
      return () => {
        (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = false;
      };
    }
  }, [status, viewModel]);

  if (status === "loading") {
    return (
      <div id="pdf-loading" style={{ padding: "2rem", textAlign: "center" }}>
        Chargement du document...
      </div>
    );
  }

  if (status === "error") {
    const errorMsg = !studyId || !versionId
      ? "Paramètres manquants : studyId et versionId requis dans l'URL."
      : "Impossible de charger le document.";
    return (
      <div id="pdf-error" style={{ padding: "2rem", textAlign: "center", color: "#b91c1c" }}>
        {errorMsg}
      </div>
    );
  }

  const vm = (viewModel ?? {}) as { fullReport?: { p3b?: { p3b_auto?: { layout_snapshot?: string } } }; [key: string]: unknown };
  return (
    <div id="pdf-root" className="study-report-root">
      <PdfLegacyPort viewModel={vm} />
      <div
        id="pdf-ready"
        data-status={status === "success" && viewModel != null ? "ready" : "pending"}
        aria-hidden="true"
      />
    </div>
  );
}
