import { resolvePanelPowerWc } from "../../utils/resolvePanelPowerWc.js";

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function collectPlacedPanelsFromGeometry(geometry) {
  if (!isObject(geometry)) return [];

  if (Array.isArray(geometry.frozenBlocks)) {
    const out = [];
    for (const block of geometry.frozenBlocks) {
      if (!block || !Array.isArray(block.panels)) continue;
      for (const panel of block.panels) {
        if (panel && typeof panel === "object") out.push(panel);
      }
    }
    if (out.length > 0) return out;
  }

  if (Array.isArray(geometry.placedPanels)) {
    const out = [];
    for (const panel of geometry.placedPanels) {
      if (panel && typeof panel === "object") out.push(panel);
    }
    if (out.length > 0) return out;
  }

  if (Array.isArray(geometry.panels?.items)) {
    const out = [];
    for (const panel of geometry.panels.items) {
      if (panel && typeof panel === "object") out.push(panel);
    }
    return out;
  }

  return [];
}

export function computeInstalledPowerFromPlacedPanels(panels, fallbackPowerWc = null) {
  if (!Array.isArray(panels) || panels.length === 0) return null;
  const fallback = Number(fallbackPowerWc);
  const usableFallback = Number.isFinite(fallback) && fallback > 50 ? fallback : null;
  const dimensionKeys = new Set();
  for (const panel of panels) {
    if (!panel || typeof panel !== "object" || panel.enabled === false) continue;
    const w = Number(panel.panelWidthMm ?? panel.width_mm ?? panel.widthMm);
    const h = Number(panel.panelHeightMm ?? panel.height_mm ?? panel.heightMm);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      const a = Math.round(Math.min(w, h));
      const b = Math.round(Math.max(w, h));
      dimensionKeys.add(`${a}x${b}`);
    }
  }
  const canUseFallbackForMissingPower = dimensionKeys.size <= 1;
  let totalPowerWc = 0;
  let count = 0;
  let knownPowerCount = 0;

  for (const panel of panels) {
    if (!panel || typeof panel !== "object" || panel.enabled === false) continue;
    count += 1;
    const panelPowerWc = resolvePanelPowerWc(panel);
    const powerWc = panelPowerWc != null ? panelPowerWc : (canUseFallbackForMissingPower ? usableFallback : null);
    if (powerWc == null) continue;
    knownPowerCount += 1;
    totalPowerWc += powerWc;
  }

  if (knownPowerCount < count && !canUseFallbackForMissingPower) return null;
  if (count === 0 || knownPowerCount === 0 || totalPowerWc <= 0) return null;
  return {
    panels_count: count,
    known_power_count: knownPowerCount,
    total_power_wc: totalPowerWc,
    total_power_kwc: totalPowerWc / 1000,
  };
}

export function computeInstalledPowerFromGeometry(geometry, fallbackPowerWc = null) {
  return computeInstalledPowerFromPlacedPanels(
    collectPlacedPanelsFromGeometry(geometry),
    fallbackPowerWc
  );
}
