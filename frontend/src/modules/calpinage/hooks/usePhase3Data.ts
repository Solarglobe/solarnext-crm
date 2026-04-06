/**
 * usePhase3Data — Hook lecture seule pour sidebar Phase 3.
 * Lit pvPlacementEngine, PV_SELECTED_INVERTER, appelle validateInverterSizing.
 * Pas de polling — écoute l'événement phase3:update.
 */
import { useCallback, useEffect, useState } from "react";
import { validateInverterSizing } from "../inverterSizing";
import { normalizeInverterFamily } from "../utils/normalizeInverterFamily";

/** Émis par `setupPhase3SidebarNotify` / legacy ; réutilisable pour rafraîchir la vue 3D canonical Phase 3. */
export const PHASE3_SIDEBAR_UPDATE_EVENT = "phase3:update";

const EVENT_NAME = PHASE3_SIDEBAR_UPDATE_EVENT;

function getInverterList(): any[] {
  return Array.isArray((window as any).SOLARNEXT_INVERTERS)
    ? (window as any).SOLARNEXT_INVERTERS
    : [];
}

function getPanelList(): any[] {
  return Array.isArray((window as any).SOLARNEXT_PANELS)
    ? (window as any).SOLARNEXT_PANELS
    : [];
}

function findInverterById(id: string | null): any {
  if (!id) return null;
  return getInverterList().find((i) => i && i.id === id) ?? null;
}

function findPanelById(id: string | null): any {
  if (!id) return null;
  return getPanelList().find((p) => p && p.id === id) ?? null;
}

function computePhase3Data() {
  const panels =
    typeof (window as any).pvPlacementEngine?.getAllPanels === "function"
      ? ((window as any).pvPlacementEngine.getAllPanels() || [])
      : [];
  const modulesCount = panels.length;

  const inv =
    (window as any).PV_SELECTED_INVERTER ||
    findInverterById((window as any).CALPINAGE_SELECTED_INVERTER_ID ?? null);

  const selectedPanel =
    findPanelById((window as any).CALPINAGE_SELECTED_PANEL_ID) ||
    ((window as any).PV_SELECTED_PANEL
      ? findPanelById((window as any).PV_SELECTED_PANEL?.id)
      : null) ||
    (window as any).PV_SELECTED_PANEL;

  const powerWc =
    selectedPanel &&
    (selectedPanel.power_wc != null || selectedPanel.powerWc != null)
      ? Number(selectedPanel.power_wc ?? selectedPanel.powerWc) || 0
      : 0;
  const totalKwc =
    modulesCount > 0 && powerWc > 0 ? (modulesCount * powerWc) / 1000 : 0;

  const panelSpec = selectedPanel
    ? {
        power_wc: powerWc,
        isc_a: selectedPanel.isc_a,
        vmp_v: selectedPanel.vmp_v,
        strings: selectedPanel.strings,
      }
    : null;

  const validation = inv
    ? validateInverterSizing({
        totalPanels: modulesCount,
        totalPowerKwc: totalKwc,
        inverter: inv,
        panelSpec,
      })
    : {
        requiredUnits: 0,
        isDcPowerOk: true,
        isCurrentOk: true,
        isMpptOk: true,
        isVoltageOk: true,
        warnings: [] as string[],
      };

  const unitsRequired = validation.requiredUnits;
  const family = inv ? (normalizeInverterFamily(inv) || "CENTRAL") : "CENTRAL";
  const acPowerKw =
    inv &&
    (inv.nominal_power_kw != null || inv.max_dc_power_kw != null)
      ? Number(inv.nominal_power_kw ?? inv.max_dc_power_kw) || 0
      : 0;

  const acTotal =
    family === "MICRO" && inv && modulesCount > 0 && acPowerKw > 0
      ? modulesCount * acPowerKw
      : family === "CENTRAL" && acPowerKw > 0
        ? acPowerKw
        : 0;

  const dcAcRatio = acTotal > 0 ? totalKwc / acTotal : null;

  const isValid =
    modulesCount > 0 &&
    !!inv &&
    (family === "MICRO" || (dcAcRatio !== null && dcAcRatio >= 0.8));

  const inverterName = inv
    ? (inv.name || inv.model_ref || "").trim() || inv.id || "—"
    : "—";

  // Inclinaison : pan actif ou premier pan (roof.tilt / physical.slope.valueDeg / tiltDeg)
  const state = (window as any).CALPINAGE_STATE;
  const validatedRoof = state?.validatedRoofData;
  const pans = validatedRoof?.pans;
  let tiltDeg: number | null = null;
  if (pans && pans.length > 0) {
    const activePanId =
      (window as any).CalpinagePans?.panState?.activePanId ??
      state?.selectedPanId;
    const pan = activePanId
      ? pans.find((p: any) => p && p.id === activePanId)
      : pans[0];
    if (pan) {
      tiltDeg =
        pan.physical?.slope?.valueDeg ?? pan.tiltDeg ?? null;
    }
  }

  const win = window as any;
  const eng = win.pvPlacementEngine;
  /** Aligné sur le legacy : seuls « panels » et « select » sont exposés ; évite libellé vide si valeur inattendue. */
  const rawPhase3Tool =
    typeof win.getPhase3ActiveTool === "function"
      ? win.getPhase3ActiveTool()
      : "panels";
  const activeToolStr = String(rawPhase3Tool || "panels");
  const activeTool: "panels" | "select" =
    activeToolStr === "select" ? "select" : "panels";

  let orientationRaw =
    (win.PV_LAYOUT_RULES && win.PV_LAYOUT_RULES.orientation) || "portrait";
  const focusBl =
    eng && typeof eng.getFocusBlock === "function"
      ? eng.getFocusBlock()
      : null;
  if (
    focusBl &&
    (focusBl.orientation === "PORTRAIT" ||
      focusBl.orientation === "PAYSAGE" ||
      focusBl.orientation === "landscape" ||
      focusBl.orientation === "portrait")
  ) {
    orientationRaw =
      focusBl.orientation === "PAYSAGE" ||
      focusBl.orientation === "landscape"
        ? "landscape"
        : "portrait";
  }
  const orientationNorm =
    String(orientationRaw).toLowerCase() === "landscape" ||
    String(orientationRaw).toLowerCase() === "paysage"
      ? "landscape"
      : "portrait";

  // État autofill
  const autofillActive = !!(
    win.__CALPINAGE_AUTOFILL_MODE__ &&
    (win.__CALPINAGE_AUTOFILL_MODE__ as { enabled?: boolean }).enabled
  );
  const autofillText: string = win.__CALPINAGE_AUTOFILL_TEXT__ || "";
  const autofillValidCount: number = win.__CALPINAGE_AUTOFILL_VALID_COUNT__ || 0;

  // Bloc actif avec au moins 1 panneau ET panneau catalogue sélectionné
  const activeBlock =
    eng && typeof eng.getActiveBlock === "function" ? eng.getActiveBlock() : null;
  const hasActiveBlockWithPanels = !!(win.PV_SELECTED_PANEL && activeBlock && activeBlock.panels && activeBlock.panels.length >= 1);

  let flatRoof: {
    inPvLayout: boolean;
    hasPanCtx: boolean;
    activePanId: string | null;
    isFlat: boolean;
    showFlatEnable: boolean;
    supportTiltDeg: number;
    layoutPortrait: boolean;
  } = {
    inPvLayout: false,
    hasPanCtx: false,
    activePanId: null,
    isFlat: false,
    showFlatEnable: false,
    supportTiltDeg: 10,
    layoutPortrait: true,
  };
  try {
    const st = (window as any).CALPINAGE_STATE;
    if (typeof win.projectCalpinageUi === "function" && st) {
      const ui = win.projectCalpinageUi(st);
      if (ui) {
        const lp = ui.livePan || ui.validatedPan;
        const fc =
          lp && typeof lp.flatRoofConfig === "object" && lp.flatRoofConfig
            ? lp.flatRoofConfig
            : {};
        const tilt = Number((fc as { supportTiltDeg?: number }).supportTiltDeg);
        const lo = String(
          (fc as { layoutOrientation?: string }).layoutOrientation || "portrait",
        ).toLowerCase();
        flatRoof = {
          inPvLayout: !!ui.inPvLayout,
          hasPanCtx: !!ui.hasPanCtx,
          activePanId:
            ui.activePanId != null && ui.activePanId !== ""
              ? String(ui.activePanId)
              : null,
          isFlat: !!ui.isFlat,
          showFlatEnable: !!ui.hasPanCtx && !ui.isFlat,
          supportTiltDeg:
            tilt === 5 || tilt === 10 || tilt === 15 ? tilt : 10,
          layoutPortrait: !(lo === "landscape" || lo === "paysage"),
        };
      }
    }
  } catch {
    /* ignore */
  }

  return {
    modulesCount,
    totalKwc,
    inverterName,
    unitsRequired,
    acTotal,
    dcAcRatio,
    isValid,
    activeTool,
    tiltDeg,
    orientation: orientationNorm,
    autofillActive,
    autofillText,
    autofillValidCount,
    hasActiveBlockWithPanels,
    flatRoof,
  };
}

export function usePhase3Data() {
  const [data, setData] = useState(computePhase3Data);

  const refresh = useCallback(() => {
    setData(computePhase3Data());
  }, []);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener(EVENT_NAME, handler);
    refresh();
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [refresh]);

  return data;
}

/** Exposé sur window pour que le legacy puisse notifier les mises à jour. Retourne la fn assignée pour cleanup. */
export function setupPhase3SidebarNotify() {
  const fn = () => window.dispatchEvent(new Event(EVENT_NAME));
  (window as any).notifyPhase3SidebarUpdate = fn;
  return fn;
}
