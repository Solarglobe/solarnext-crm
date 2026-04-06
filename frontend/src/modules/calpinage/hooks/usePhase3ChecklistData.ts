/**
 * Données checklist Phase 3 depuis window.getPhase3ChecklistData (legacy).
 * Réutilisable par Phase3ChecklistBridge et Phase3Sidebar.
 */
import { useCallback, useEffect, useState } from "react";
import { isPhase3ChecklistOk } from "../Phase3ChecklistPanel";
import type { InverterFamily } from "../utils/inverterSizing";
import { hasPhase3CatalogModuleSelected } from "./phase3LegacyValidateUi";

const POLL_MS = 400;
const PHASE3_UPDATE = "phase3:update";

export type Phase3ChecklistData = {
  panelCount: number;
  totalDcKw: number;
  selectedInverter: { name: string; acPowerKw: number } | null;
  inverterFamily?: InverterFamily;
};

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

export function usePhase3ChecklistData(): {
  data: Phase3ChecklistData | null;
  checklistOk: boolean;
  catalogModuleSelected: boolean;
} {
  const [data, setData] = useState<Phase3ChecklistData | null>(null);
  const [catalogModuleSelected, setCatalogModuleSelected] = useState(() =>
    hasPhase3CatalogModuleSelected(),
  );

  const refresh = useCallback(() => {
    const next = getData();
    const cat = hasPhase3CatalogModuleSelected();
    setCatalogModuleSelected((c) => (c === cat ? c : cat));
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

  useEffect(() => {
    refresh();
    const onPhase3 = () => refresh();
    window.addEventListener(PHASE3_UPDATE, onPhase3);
    const win = window as unknown as { notifyPhase3ChecklistUpdate?: () => void };
    const prevNotify = win.notifyPhase3ChecklistUpdate;
    win.notifyPhase3ChecklistUpdate = () => {
      if (typeof prevNotify === "function") prevNotify();
      refresh();
    };
    const id = setInterval(refresh, POLL_MS);
    return () => {
      window.removeEventListener(PHASE3_UPDATE, onPhase3);
      win.notifyPhase3ChecklistUpdate = prevNotify;
      clearInterval(id);
    };
  }, [refresh]);

  const checklistOk = data ? isPhase3ChecklistOk(data) : false;
  return { data, checklistOk, catalogModuleSelected };
}
