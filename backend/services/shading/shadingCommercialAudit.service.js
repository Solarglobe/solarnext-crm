/**
 * Garde-fous ombrage « étude client » : mismatch multi-pan, seuils d’alerte.
 */

export const SHADING_PAN_MISMATCH_WARN_DELTA = 2;
export const SHADING_PAN_MISMATCH_BLOCK_DELTA = 8;

/**
 * Moyenne pondérée modules à partir du breakdown serveur (même logique que buildOfficialPans).
 * @param {Array<{ id?: string, panelCount?: number, panel_count?: number }>} pans
 * @param {Array<{ panelId?: string, id?: string, lossPct?: number }>} perPanelBreakdown
 * @returns {number|null}
 */
export function computeWeightedLossFromPerPanelBreakdown(pans, perPanelBreakdown) {
  if (!Array.isArray(pans) || pans.length === 0 || !Array.isArray(perPanelBreakdown) || perPanelBreakdown.length === 0) {
    return null;
  }
  const lossByPanelId = new Map();
  for (const row of perPanelBreakdown) {
    if (!row || typeof row !== "object") continue;
    const pid = row.panelId ?? row.id;
    if (pid == null) continue;
    const lp = Number(row.lossPct);
    if (!Number.isFinite(lp)) continue;
    lossByPanelId.set(String(pid), lp);
  }
  if (lossByPanelId.size === 0) return null;

  let sumW = 0;
  let sumLoss = 0;
  for (const pan of pans) {
    const panId = pan.id != null ? String(pan.id) : "";
    const cnt = Math.max(0, Math.floor(Number(pan.panelCount ?? pan.panel_count) || 0));
    if (cnt <= 0 || !panId) continue;
    let s = 0;
    let n = 0;
    for (let i = 0; i < cnt; i++) {
      const syntheticId = `${panId}_${i}`;
      const keys = [syntheticId, `${panId}-${i}`, `p-${panId}-${i}`];
      let found = null;
      for (const k of keys) {
        if (lossByPanelId.has(k)) {
          found = lossByPanelId.get(k);
          break;
        }
      }
      if (found == null) {
        for (const [kid, lv] of lossByPanelId) {
          if (kid.startsWith(panId + "_") || kid.startsWith(panId + "-")) {
            found = lv;
            break;
          }
        }
      }
      if (typeof found === "number") {
        s += found;
        n += 1;
      }
    }
    if (n > 0) {
      const avg = s / n;
      sumLoss += avg * cnt;
      sumW += cnt;
    }
  }
  if (sumW <= 0) return null;
  return Math.round((sumLoss / sumW) * 1000) / 1000;
}

/**
 * Fallback : moyenne simple des lossPct du breakdown (si mapping pan↔panel impossible).
 */
export function computeMeanPerPanelBreakdownLoss(perPanelBreakdown) {
  if (!Array.isArray(perPanelBreakdown) || perPanelBreakdown.length === 0) return null;
  let s = 0;
  let n = 0;
  for (const row of perPanelBreakdown) {
    const lp = Number(row?.lossPct);
    if (Number.isFinite(lp)) {
      s += lp;
      n += 1;
    }
  }
  if (n === 0) return null;
  return Math.round((s / n) * 1000) / 1000;
}

/**
 * @param {Array} pans
 * @param {Array} perPanelBreakdown
 * @param {number|null} persistedWeighted — ex. computeWeightedShadingCombinedPct(roofPans)
 */
export function auditMultiPanShadingMismatch(pans, perPanelBreakdown, persistedWeighted) {
  if (persistedWeighted == null || !Number.isFinite(Number(persistedWeighted))) {
    return { status: "SKIP", absDiff: null, serverWeighted: null };
  }
  let serverWeighted = computeWeightedLossFromPerPanelBreakdown(pans, perPanelBreakdown);
  if (serverWeighted == null) {
    serverWeighted = computeMeanPerPanelBreakdownLoss(perPanelBreakdown);
  }
  if (serverWeighted == null) {
    return { status: "SKIP", absDiff: null, serverWeighted: null };
  }
  const absDiff = Math.abs(serverWeighted - Number(persistedWeighted));
  if (absDiff >= SHADING_PAN_MISMATCH_BLOCK_DELTA) {
    return { status: "BLOCK", absDiff, serverWeighted, persistedWeighted: Number(persistedWeighted) };
  }
  if (absDiff >= SHADING_PAN_MISMATCH_WARN_DELTA) {
    return { status: "WARN", absDiff, serverWeighted, persistedWeighted: Number(persistedWeighted) };
  }
  return { status: "OK", absDiff, serverWeighted, persistedWeighted: Number(persistedWeighted) };
}
