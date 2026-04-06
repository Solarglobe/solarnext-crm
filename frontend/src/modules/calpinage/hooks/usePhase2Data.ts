/**
 * usePhase2Data — Hook lecture seule pour sidebar Phase 2 (Relevé toiture).
 * Lit CALPINAGE_STATE, getPhase2Data, getPhase2ActiveTool.
 * Pas de polling — écoute l'événement phase2:update.
 */
import { useCallback, useEffect, useState } from "react";

const EVENT_NAME = "phase2:update";

function computePhase2Data() {
  const win = window as any;
  const getData =
    typeof win.getPhase2Data === "function"
      ? win.getPhase2Data()
      : {
          contourClosed: false,
          ridgeDefined: false,
          heightsDefined: false,
          obstaclesCount: 0,
          canValidate: false,
          validateHint: "",
          hasExistingGeometry: false,
        };
  const activeTool =
    typeof win.getPhase2ActiveTool === "function"
      ? win.getPhase2ActiveTool()
      : "select";

  return {
    contourClosed: !!getData.contourClosed,
    ridgeDefined: !!getData.ridgeDefined,
    heightsDefined: !!getData.heightsDefined,
    obstaclesCount: Number(getData.obstaclesCount) || 0,
    canValidate: !!getData.canValidate,
    validateHint: String(getData.validateHint || ""),
    captured: !!getData.captured,
    activeTool: String(activeTool || "select"),
    hasExistingGeometry: !!getData.hasExistingGeometry,
  };
}

export function usePhase2Data() {
  const [data, setData] = useState(computePhase2Data);

  const refresh = useCallback(() => {
    setData(computePhase2Data());
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
export function setupPhase2SidebarNotify() {
  const fn = () => window.dispatchEvent(new Event(EVENT_NAME));
  (window as any).notifyPhase2SidebarUpdate = fn;
  return fn;
}
