/**
 * Données checklist Phase 3 depuis window.getPhase3ChecklistData (legacy).
 * Réutilisable par Phase3ChecklistBridge et Phase3Sidebar.
 *
 * Mise à jour pilotée par événements uniquement (pas de polling) :
 *  - "phase3:update"         — émis par setupPhase3SidebarNotify (→ notifyPhase3SidebarUpdate)
 *  - notifyPhase3ChecklistUpdate — monkey-patché pour un refresh synchrone immédiat
 * Le refresh initial se produit au montage (ou quand isVisible passe à true).
 */
import { useCallback, useEffect, useState } from "react";
import { isPhase3ChecklistOk } from "../Phase3ChecklistPanel";
import type { InverterFamily } from "../utils/inverterSizing";
import { hasPhase3CatalogModuleSelected } from "./phase3LegacyValidateUi";

const PHASE3_UPDATE = "phase3:update";

export type Phase3ChecklistData = {
  panelCount: number;
  totalDcKw: number;
  selectedInverter: { name: string; acPowerKw: number } | null;
  inverterFamily?: InverterFamily;
};

// ---------------------------------------------------------------------------
// Near shading fallback status — lecture seule sur CALPINAGE_STATE (window)
// ---------------------------------------------------------------------------

interface NearShadingStatus {
  nearShadingPct: number | null;
  fallbackTriggered: boolean;
  fallbackReason: string | undefined;
}

type CalpinageStateWindow = {
  CALPINAGE_STATE?: {
    shading?: {
      lastResult?: {
        meta?: {
          nearOfficial?: {
            officialLossPct?: number | null;
            fallbackTriggered?: boolean;
            canonicalRejectedBecause?: string;
          };
        };
      };
    };
  };
};

function getNearShadingStatus(): NearShadingStatus {
  try {
    const nearOfficial = (window as unknown as CalpinageStateWindow)
      .CALPINAGE_STATE?.shading?.lastResult?.meta?.nearOfficial;
    if (!nearOfficial) {
      return { nearShadingPct: null, fallbackTriggered: false, fallbackReason: undefined };
    }
    return {
      nearShadingPct: typeof nearOfficial.officialLossPct === "number" ? nearOfficial.officialLossPct : null,
      fallbackTriggered: !!nearOfficial.fallbackTriggered,
      fallbackReason: nearOfficial.canonicalRejectedBecause ?? undefined,
    };
  } catch {
    return { nearShadingPct: null, fallbackTriggered: false, fallbackReason: undefined };
  }
}

function getData(): Phase3ChecklistData | null {
  const fn = (window as unknown as { getPhase3ChecklistData?: () => Phase3ChecklistData })
    .getPhase3ChecklistData;
  if (typeof fn !== "function") return null;
  try {
    return fn();
  } catch {
    return null;
  }
}

export function usePhase3ChecklistData(isVisible = true): {
  data: Phase3ChecklistData | null;
  checklistOk: boolean;
  catalogModuleSelected: boolean;
  nearShadingPct: number | null;
  fallbackTriggered: boolean;
  fallbackReason: string | undefined;
} {
  const [data, setData] = useState<Phase3ChecklistData | null>(null);
  const [catalogModuleSelected, setCatalogModuleSelected] = useState(() =>
    hasPhase3CatalogModuleSelected(),
  );
  const [nearShadingStatus, setNearShadingStatus] = useState<NearShadingStatus>(getNearShadingStatus);

  const refresh = useCallback(() => {
    const next = getData();
    const cat = hasPhase3CatalogModuleSelected();
    setCatalogModuleSelected((c) => (c === cat ? c : cat));
    setNearShadingStatus(getNearShadingStatus());
    setData((prev) => {
      if (!next && !prev) return prev;
      if (
        prev &&
        next &&
        prev.panelCount === next.panelCount &&
        prev.totalDcKw === next.totalDcKw &&
        prev.selectedInverter?.name === next.selectedInverter?.name &&
        prev.selectedInverter?.acPowerKw === next.selectedInverter?.acPowerKw &&
        (prev.inverterFamily ?? "CENTRAL") === (next.inverterFamily ?? "CENTRAL")
      )
        return prev;
      return next;
    });
  }, []);

  // Refresh initial à l'activation (montage ou isVisible → true).
  useEffect(() => {
    if (!isVisible) return;
    refresh();
  }, [isVisible, refresh]);

  // Abonnement événements — aucun polling, zéro appel superflu sidebar fermée.
  useEffect(() => {
    if (!isVisible) return;
    const onPhase3 = () => refresh();
    window.addEventListener(PHASE3_UPDATE, onPhase3);
    // Monkey-patch notifyPhase3ChecklistUpdate : refresh synchrone immédiat
    // avant la prochaine frame RAF (complémentaire à l'événement phase3:update).
    const win = window as unknown as { notifyPhase3ChecklistUpdate?: () => void };
    const prevNotify = win.notifyPhase3ChecklistUpdate;
    win.notifyPhase3ChecklistUpdate = () => {
      if (typeof prevNotify === "function") prevNotify();
      refresh();
    };
    return () => {
      window.removeEventListener(PHASE3_UPDATE, onPhase3);
      win.notifyPhase3ChecklistUpdate = prevNotify;
    };
  }, [isVisible, refresh]);

  const checklistOk = data ? isPhase3ChecklistOk(data) : false;
  return { data, checklistOk, catalogModuleSelected, ...nearShadingStatus };
}
