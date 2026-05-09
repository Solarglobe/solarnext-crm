/**
 * usePhase3Data — Hook lecture seule pour sidebar Phase 3.
 *
 * Phase 1 : lit depuis calpinageStore (Zustand) au lieu de window.*.
 * L'adapter legacyCalpinageStateAdapter.ts se charge de lire les globals PV
 * et de mettre à jour store.phase3 sur chaque événement "phase3:update".
 *
 * Ce hook ne contient plus aucun accès window.* — uniquement du calcul
 * sur les données brutes du store (validateInverterSizing, normalizeInverterFamily).
 */
import { useMemo } from "react";
import { useCalpinageStore } from "../store/calpinageStore";
import { validateInverterSizing } from "../inverterSizing";
import { normalizeInverterFamily } from "../utils/normalizeInverterFamily";

/** Émis par setupPhase3SidebarNotify / legacy ; réutilisable pour rafraîchir la vue 3D. */
export const PHASE3_SIDEBAR_UPDATE_EVENT = "phase3:update";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — lookup dans les catalogues (pure, sans window)
// ─────────────────────────────────────────────────────────────────────────────

function findInverterById(
  inverters: unknown[],
  id: string | null,
): unknown | null {
  if (!id) return null;
  return (
    (inverters as Array<Record<string, unknown>>).find((i) => i?.id === id) ??
    null
  );
}

function findPanelById(
  catalog: unknown[],
  id: string | null,
): unknown | null {
  if (!id) return null;
  return (
    (catalog as Array<Record<string, unknown>>).find((p) => p?.id === id) ??
    null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function usePhase3Data() {
  const raw = useCalpinageStore((s) => s.phase3);

  return useMemo(() => {
    const {
      modulesCount,
      selectedInverterId,
      pvSelectedInverter,
      selectedPanelId,
      pvSelectedPanel,
      inverters,
      panelCatalog,
      validatedRoofData,
      activePanId,
      pvLayoutOrientation,
      focusBlockOrientation,
      activeTool,
      autofillEnabled,
      autofillText,
      autofillValidCount,
      hasActiveBlockWithPanels,
      flatRoofProjection,
    } = raw;

    // ── Onduleur ──────────────────────────────────────────────────────────
    const inv =
      pvSelectedInverter ||
      findInverterById(inverters, selectedInverterId);

    // ── Panneau catalogue ─────────────────────────────────────────────────
    const pvSelPanObj = pvSelectedPanel as Record<string, unknown> | null;
    const selectedPanel =
      findPanelById(panelCatalog, selectedPanelId) ||
      (pvSelPanObj?.id != null
        ? findPanelById(panelCatalog, String(pvSelPanObj.id))
        : null) ||
      pvSelectedPanel;

    const selPanObj = selectedPanel as Record<string, unknown> | null;
    const powerWc =
      selPanObj &&
      (selPanObj.power_wc != null || selPanObj.powerWc != null)
        ? Number(selPanObj.power_wc ?? selPanObj.powerWc) || 0
        : 0;
    const totalKwc =
      modulesCount > 0 && powerWc > 0
        ? (modulesCount * powerWc) / 1000
        : 0;

    const panelSpec = selPanObj
      ? {
          power_wc: powerWc,
          isc_a: selPanObj.isc_a,
          vmp_v: selPanObj.vmp_v,
          strings: selPanObj.strings,
        }
      : null;

    // ── Validation onduleur ───────────────────────────────────────────────
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

    const invObj = inv as Record<string, unknown> | null;
    const unitsRequired = validation.requiredUnits;
    const family = inv ? (normalizeInverterFamily(inv) || "CENTRAL") : "CENTRAL";
    const acPowerKw =
      invObj &&
      (invObj.nominal_power_kw != null || invObj.max_dc_power_kw != null)
        ? Number(invObj.nominal_power_kw ?? invObj.max_dc_power_kw) || 0
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

    const inverterName = invObj
      ? (String(invObj.name ?? invObj.model_ref ?? "").trim() ||
          String(invObj.id ?? "") ||
          "—")
      : "—";

    // ── Inclinaison — pan actif ou premier pan ────────────────────────────
    const vrd = validatedRoofData as Record<string, unknown> | null | undefined;
    const pans = vrd?.pans;
    let tiltDeg: number | null = null;
    if (Array.isArray(pans) && pans.length > 0) {
      const pan = activePanId
        ? (pans as Array<Record<string, unknown>>).find(
            (p) => p?.id === activePanId,
          )
        : (pans as Array<Record<string, unknown>>)[0];
      if (pan) {
        const physical = pan.physical as Record<string, unknown> | undefined;
        const slope = physical?.slope as Record<string, unknown> | undefined;
        tiltDeg =
          (slope?.valueDeg as number | undefined) ??
          (pan.tiltDeg as number | undefined) ??
          null;
      }
    }

    // ── Orientation effective ─────────────────────────────────────────────
    let orientationNorm: "portrait" | "landscape" = pvLayoutOrientation;
    if (focusBlockOrientation != null) {
      const lo = focusBlockOrientation.toLowerCase();
      if (lo === "landscape" || lo === "paysage") {
        orientationNorm = "landscape";
      } else if (lo === "portrait") {
        orientationNorm = "portrait";
      }
    }

    // ── Toiture plate — re-expose les champs du store ─────────────────────
    const flatRoof = {
      inPvLayout: flatRoofProjection.inPvLayout,
      hasPanCtx: flatRoofProjection.hasPanCtx,
      activePanId: flatRoofProjection.activePanId,
      isFlat: flatRoofProjection.isFlat,
      showFlatEnable: flatRoofProjection.showFlatEnable,
      supportTiltDeg: flatRoofProjection.supportTiltDeg,
      layoutPortrait: flatRoofProjection.layoutPortrait,
    };

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
      autofillActive: autofillEnabled,
      autofillText,
      autofillValidCount,
      hasActiveBlockWithPanels,
      flatRoof,
    };
  }, [raw]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Notify — identique à avant (le legacy l'appelle pour déclencher l'adapter)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exposé sur window pour que le legacy puisse notifier les mises à jour.
 * Retourne la fn assignée pour cleanup (appelé par Phase3Sidebar).
 */
export function setupPhase3SidebarNotify(): () => void {
  const fn = () =>
    window.dispatchEvent(new Event(PHASE3_SIDEBAR_UPDATE_EVENT));
  (window as unknown as Record<string, unknown>).notifyPhase3SidebarUpdate =
    fn;
  return fn;
}
