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
  /** Données ombrage inter-rangées — présentes si le backend a calculé row_to_row. */
  rowToRow?: {
    pitchActualM: number;
    pitchMinM: number;
    annualLossPct: number;
  } | null;
};

// ---------------------------------------------------------------------------
// Near shading fallback status — lecture seule sur CALPINAGE_STATE (window)
// ---------------------------------------------------------------------------

interface NearShadingStatus {
  nearShadingPct: number | null;
  fallbackTriggered: boolean;
  fallbackReason: string | undefined;
}

type RowToRowData = {
  pitchActualM: number;
  pitchMinM: number;
  annualLossPct: number;
} | null;

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
          row_to_row?: {
            pitch_actual_m?: number;
            pitch_min_m?: number;
            annual_loss_pct?: number;
          } | null;
        };
      };
    };
    rowToRow?: {
      pitchActualM?: number;
      pitchMinM?: number;
      annualLossPct?: number;
    } | null;
  };
  LAST_CALC_RESULT?: {
    meta?: {
      row_to_row?: {
        pitch_actual_m?: number;
        pitch_min_m?: number;
        annual_loss_pct?: number;
      } | null;
    };
  };
};

function getRowToRowData(): RowToRowData {
  try {
    const win = window as unknown as CalpinageStateWindow;
    // Priorité 1 : CALPINAGE_STATE.rowToRow (format camelCase injecté par le store)
    const rtr = win.CALPINAGE_STATE?.rowToRow;
    if (rtr && typeof rtr.pitchActualM === "number" && typeof rtr.pitchMinM === "number" && typeof rtr.annualLossPct === "number") {
      return { pitchActualM: rtr.pitchActualM, pitchMinM: rtr.pitchMinM, annualLossPct: rtr.annualLossPct };
    }
    // Priorité 2 : CALPINAGE_STATE.shading.lastResult.meta.row_to_row (format snake_case backend)
    const shadingRtr = win.CALPINAGE_STATE?.shading?.lastResult?.meta?.row_to_row;
    if (shadingRtr && typeof shadingRtr.pitch_actual_m === "number" && typeof shadingRtr.pitch_min_m === "number" && typeof shadingRtr.annual_loss_pct === "number") {
      return { pitchActualM: shadingRtr.pitch_actual_m, pitchMinM: shadingRtr.pitch_min_m, annualLossPct: shadingRtr.annual_loss_pct };
    }
    // Priorité 3 : LAST_CALC_RESULT.meta.row_to_row
    const calcRtr = win.LAST_CALC_RESULT?.meta?.row_to_row;
    if (calcRtr && typeof calcRtr.pitch_actual_m === "number" && typeof calcRtr.pitch_min_m === "number" && typeof calcRtr.annual_loss_pct === "number") {
      return { pitchActualM: calcRtr.pitch_actual_m, pitchMinM: calcRtr.pitch_min_m, annualLossPct: calcRtr.annual_loss_pct };
    }
    return null;
  } catch {
    return null;
  }
}

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
  rowToRow: RowToRowData;
} {
  const [data, setData] = useState<Phase3ChecklistData | null>(null);
  const [catalogModuleSelected, setCatalogModuleSelected] = useState(() =>
    hasPhase3CatalogModuleSelected(),
  );
  const [nearShadingStatus, setNearShadingStatus] = useState<NearShadingStatus>(getNearShadingStatus);
  const [rowToRow, setRowToRow] = useState<RowToRowData>(getRowToRowData);

  const refresh = useCallback(() => {
    const next = getData();
    const cat = hasPhase3CatalogModuleSelected();
    setCatalogModuleSelected((c) => (c === cat ? c : cat));
    setNearShadingStatus(getNearShadingStatus());
    setRowToRow(getRowToRowData());
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
  return { data, checklistOk, catalogModuleSelected, rowToRow, ...nearShadingStatus };
}
