/**
 * Hook pour monter les engines legacy PDF (P1–P12 — P13 & P14 retirés).
 * La page « Méthodologie SolarGlobe » (#p-methodology-solarglobe) est statique React, sans engine.
 * Appelle bindEngine et émet le viewModel quand disponible.
 * Le fullReport doit être fourni par le backend (pdfViewModel.mapper).
 *
 * CP-PDF-P1-FIX : Ordre strict bind → emit. React exécute les effets dans l'ordre,
 * donc le bind (effet 1) s'exécute avant l'emit (effet 2). Aucun p1:update perdu.
 */
import { useEffect } from "react";
import { buildLegacyPdfViewModel } from "../legacy/legacyPdfViewModelMapper";

declare global {
  interface Window {
    Engine?: { on: (e: string, h: (p: unknown) => void) => void };
    API?: {
      bindEngineP1?: (e: unknown) => void;
      bindEngineP2?: (e: unknown) => void;
      bindEngineP3?: (e: unknown) => void;
      bindEngineP4?: (e: unknown) => void;
      bindEngineP5?: (e: unknown) => void;
      bindEngineP6?: (e: unknown) => void;
      bindEngineP7?: (e: unknown) => void;
      bindEngineP8?: (e: unknown) => void;
      bindEngineP9?: (e: unknown) => void;
      bindEngineP10?: (e: unknown) => void;
      bindEngineP11?: (e: unknown) => void;
      bindEngineP12?: (e: unknown) => void;
      bindEngineP14?: (e: unknown) => void;
    };
    emitPdfViewData?: (vm: { fullReport?: Record<string, unknown> }) => void;
  }
}

export function useLegacyPdfEngine(viewModel: { fullReport?: Record<string, unknown> } | null) {
  // 1) Bind de tous les engines (s'exécute en premier)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const Engine = window.Engine;
    if (!Engine) return;

    window.API?.bindEngineP1?.(Engine);
    window.API?.bindEngineP2?.(Engine);
    // P4 : rendu React pur, plus d'engine-p4
    window.API?.bindEngineP5?.(Engine);
    window.API?.bindEngineP6?.(Engine);
    // P7 : rendu React pur, plus d'engine-p7
    window.API?.bindEngineP8?.(Engine);
    window.API?.bindEngineP9?.(Engine);
    window.API?.bindEngineP11?.(Engine);
    window.API?.bindEngineP12?.(Engine);
  }, []);

  // 2) Émettre viewModel uniquement APRÈS bind (effet s'exécute après le précédent)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!viewModel) return;
    const legacyVM = buildLegacyPdfViewModel(viewModel as Record<string, unknown>);
    if (window.emitPdfViewData) {
      window.emitPdfViewData(legacyVM as { fullReport?: Record<string, unknown> });
    }
    if (import.meta.env?.DEV) {
      console.log("PDF FULLREPORT EMITTED", legacyVM.fullReport);
    }
  }, [viewModel]);
}
