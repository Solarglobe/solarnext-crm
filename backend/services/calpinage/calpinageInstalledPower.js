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

async function resolveCatalogPowerWc(db, panel) {
  if (!db || !panel || typeof panel !== "object") return null;
  const panelId = panel.panel_id ?? panel.panelId ?? panel.panelCatalogId ?? null;
  if (panelId != null && String(panelId).trim() !== "") {
    const byId = await db.query(
      "SELECT power_wc FROM pv_panels WHERE id = $1 LIMIT 1",
      [String(panelId).trim()]
    );
    const powerWc = resolvePanelPowerWc(byId.rows?.[0]);
    if (powerWc != null) return powerWc;
  }

  const w = Number(panel.panelWidthMm ?? panel.width_mm ?? panel.widthMm);
  const h = Number(panel.panelHeightMm ?? panel.height_mm ?? panel.heightMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const byDimensions = await db.query(
    `SELECT power_wc
       FROM pv_panels
      WHERE active IS DISTINCT FROM false
        AND (
          (ABS(width_mm - $1) <= 2 AND ABS(height_mm - $2) <= 2)
          OR
          (ABS(width_mm - $2) <= 2 AND ABS(height_mm - $1) <= 2)
        )`,
    [w, h]
  );
  if (byDimensions.rows.length !== 1) return null;
  return resolvePanelPowerWc(byDimensions.rows[0]);
}

export async function computeInstalledPowerFromGeometryWithCatalog(db, geometry, fallbackPowerWc = null) {
  const panels = collectPlacedPanelsFromGeometry(geometry);
  if (panels.length === 0) return null;

  const enrichedPanels = [];
  for (const panel of panels) {
    if (!panel || typeof panel !== "object") {
      enrichedPanels.push(panel);
      continue;
    }
    if (resolvePanelPowerWc(panel) != null) {
      enrichedPanels.push(panel);
      continue;
    }
    const catalogPowerWc = await resolveCatalogPowerWc(db, panel);
    enrichedPanels.push(catalogPowerWc != null ? { ...panel, power_wc: catalogPowerWc } : panel);
  }

  return computeInstalledPowerFromPlacedPanels(enrichedPanels, fallbackPowerWc);
}

export async function computeInstalledPowerByPanFromGeometryWithCatalog(db, geometry, fallbackPowerWc = null) {
  const panelsByPanId = new Map();
  const blocks = Array.isArray(geometry?.frozenBlocks) ? geometry.frozenBlocks : [];
  for (const block of blocks) {
    const panId = block?.panId != null && String(block.panId).trim() !== "" ? String(block.panId).trim() : null;
    if (!panId || !Array.isArray(block.panels)) continue;
    if (!panelsByPanId.has(panId)) panelsByPanId.set(panId, []);
    for (const panel of block.panels) {
      if (panel && typeof panel === "object") panelsByPanId.get(panId).push(panel);
    }
  }

  const out = {};
  for (const [panId, panels] of panelsByPanId.entries()) {
    const enrichedPanels = [];
    for (const panel of panels) {
      if (resolvePanelPowerWc(panel) != null) {
        enrichedPanels.push(panel);
        continue;
      }
      const catalogPowerWc = await resolveCatalogPowerWc(db, panel);
      enrichedPanels.push(catalogPowerWc != null ? { ...panel, power_wc: catalogPowerWc } : panel);
    }
    const summary = computeInstalledPowerFromPlacedPanels(enrichedPanels, fallbackPowerWc);
    if (summary) out[panId] = summary;
  }
  return out;
}
