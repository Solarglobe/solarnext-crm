/**
 * CP-PDF-V2-020 — Portage fidèle du PDF legacy Solarglobe
 * Remplace FullReport : structure DOM, IDs, couleurs legacy conservés.
 * P3, P3B, P4, P5 : engines legacy (engine-bridge + engine-p3/p3b/p4/p5) hydratent le DOM.
 * Ordre fin : … P11 → p-methodology-solarglobe (avant-dernière) → P12 (clôture, dernière).
 */

import React from "react";
import { useLegacyPdfEngine } from "../hooks/useLegacyPdfEngine";
import PdfPage1 from "./PdfPage1";
import PdfPage2 from "./PdfPage2";
import PdfPage3 from "./PdfPage3";
import PdfPage4 from "./PdfPage4";
import PdfPage5 from "./PdfPage5";
import PdfPage6 from "./PdfPage6";
import PdfPage7 from "./PdfPage7";
import PdfPage8 from "./PdfPage8";
import PdfPage10 from "./PdfPage10";
import PdfPage11 from "./PdfPage11";
import PdfPageMethodologySolarGlobe from "./PdfPageMethodologySolarGlobe";
import PdfPage12 from "./PdfPage12";
import "./pdf-legacy-port.css";

export interface PdfLegacyPortProps {
  viewModel: {
    fullReport?: Record<string, unknown>;
    meta?: { studyId?: string; versionId?: string };
    organization?: Record<string, unknown>;
    selected_scenario_snapshot?: unknown;
    [key: string]: unknown;
  };
  /** Appelé après premier rendu peint de la page P10 (signal PDF Playwright). */
  onP10Ready?: () => void;
}

export default function PdfLegacyPort({ viewModel, onP10Ready }: PdfLegacyPortProps) {
  const fr = (viewModel?.fullReport ?? {}) as Record<string, unknown>;
  useLegacyPdfEngine(viewModel ?? null);
  const organization = (viewModel?.organization ?? {}) as {
    id?: string;
    logo_image_key?: string | null;
    logo_url?: string | null;
    pdf_cover_image_key?: string | null;
  };

  return (
    <div className="pdf-legacy-port">
      <PdfPage1 organization={organization} viewModel={viewModel} />
      <PdfPage2 organization={organization} viewModel={viewModel} />
      <PdfPage3 organization={organization} viewModel={viewModel} />
      <PdfPage4 organization={organization} viewModel={viewModel} />
      <PdfPage5 organization={organization} viewModel={viewModel} />
      <PdfPage6 organization={organization} viewModel={viewModel} />
      <PdfPage7 organization={organization} viewModel={viewModel} />
      {Boolean(fr.p9) && <PdfPage8 organization={organization} viewModel={viewModel} />}
      <PdfPage10 organization={organization} viewModel={viewModel} onReady={onP10Ready} />
      <PdfPage11 />
      <PdfPageMethodologySolarGlobe viewModel={viewModel} />
      <PdfPage12 />
    </div>
  );
}
