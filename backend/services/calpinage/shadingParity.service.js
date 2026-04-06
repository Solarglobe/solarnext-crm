/**
 * Parité UI (snapshot front) ↔ ombrage officiel serveur — observation uniquement.
 * Tolérances par défaut : total / near / far / combined 1 % ; maxPanel 2 %.
 */

const DEFAULT_TOLERANCES = {
  totalLossPct: 1,
  near: 1,
  far: 1,
  combined: 1,
  maxPanel: 2,
};

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function absDiff(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b);
}

function pickTotalLoss(shading) {
  if (!shading || typeof shading !== "object") return null;
  const c = numOrNull(shading.combined?.totalLossPct);
  if (c != null) return c;
  return numOrNull(shading.totalLossPct);
}

function pickNear(shading) {
  if (!shading || typeof shading !== "object") return null;
  return numOrNull(shading.near?.totalLossPct);
}

function pickFar(shading) {
  if (!shading || typeof shading !== "object") return null;
  return numOrNull(shading.far?.totalLossPct);
}

function pickCombined(shading) {
  if (!shading || typeof shading !== "object") return null;
  return numOrNull(shading.combined?.totalLossPct);
}

function panelMap(perPanel) {
  const m = new Map();
  if (!Array.isArray(perPanel)) return m;
  for (const p of perPanel) {
    if (!p || typeof p !== "object") continue;
    const id = p.panelId ?? p.id;
    if (id == null) continue;
    m.set(String(id), Number(p.lossPct) || 0);
  }
  return m;
}

/**
 * @param {object|null|undefined} uiShading - getUiShadingSnapshot() ou équivalent
 * @param {object|null|undefined} officialShading - buildOfficialShadingFromComputeResult
 * @param {Partial<typeof DEFAULT_TOLERANCES>} [tolerances]
 */
export function computeUiVsOfficialShadingDiff(uiShading, officialShading, tolerances = {}) {
  const tol = { ...DEFAULT_TOLERANCES, ...tolerances };

  const uiTot = numOrNull(uiShading?.totalLossPct) ?? pickTotalLoss(uiShading);
  const offTot = numOrNull(officialShading?.totalLossPct) ?? pickTotalLoss(officialShading);
  const totalLossPctDiff = absDiff(uiTot, offTot);

  const uiNear = pickNear(uiShading);
  const offNear = pickNear(officialShading);
  const nearDiff = absDiff(uiNear, offNear);

  const uiFar = pickFar(uiShading);
  const offFar = pickFar(officialShading);
  const farDiff = absDiff(uiFar, offFar);

  const uiComb = pickCombined(uiShading) ?? uiTot;
  const offComb = pickCombined(officialShading) ?? offTot;
  const combinedDiff = absDiff(uiComb, offComb);

  const um = panelMap(uiShading?.perPanel);
  const om = panelMap(officialShading?.perPanel);
  const ids = new Set([...um.keys(), ...om.keys()]);
  let maxPanelDiff = 0;
  let panelDiffCount = 0;
  for (const id of ids) {
    const a = um.get(id) ?? 0;
    const b = om.get(id) ?? 0;
    const d = Math.abs(a - b);
    if (d > 1e-9) panelDiffCount += 1;
    maxPanelDiff = Math.max(maxPanelDiff, d);
  }

  const within = (d, lim) => d == null || d <= lim;

  const isWithinTolerance =
    within(totalLossPctDiff, tol.totalLossPct) &&
    within(nearDiff, tol.near) &&
    within(farDiff, tol.far) &&
    within(combinedDiff, tol.combined) &&
    maxPanelDiff <= tol.maxPanel;

  return {
    totalLossPctDiff,
    nearDiff,
    farDiff,
    combinedDiff,
    maxPanelDiff,
    panelDiffCount,
    isWithinTolerance,
  };
}

/**
 * @param {"OK"|"DRIFT"|"PARTIAL"} parityStatus
 */
export function parityStatusFromDiff(diff, uiShading, officialShading) {
  if (!diff) return "PARTIAL";
  if (diff.isWithinTolerance) return "OK";
  const hasUi = uiShading && typeof uiShading === "object" && Object.keys(uiShading).length > 0;
  const hasOff = officialShading && typeof officialShading === "object";
  if (!hasUi || !hasOff) return "PARTIAL";
  return "DRIFT";
}

/**
 * @param {object} diff - computeUiVsOfficialShadingDiff
 * @param {object} [ctx]
 */
export function logShadingUiServerDriftIfNeeded(diff, ctx = {}) {
  if (!diff || typeof diff !== "object") return;
  const t = diff.totalLossPctDiff;
  const c = diff.combinedDiff;
  const m = diff.maxPanelDiff;
  const warnTotal = t != null && t > 1;
  const warnComb = c != null && c > 1;
  const warnPanel = typeof m === "number" && m > 2;
  if (warnTotal || warnComb || warnPanel) {
    console.warn("[SHADING_UI_SERVER_DRIFT]", {
      ...ctx,
      totalLossPctDiff: t,
      combinedDiff: c,
      maxPanelDiff: m,
    });
  }
}

export function slimOfficialForParityDebug(official) {
  if (!official || typeof official !== "object") return null;
  return {
    totalLossPct: official.totalLossPct,
    near: official.near && typeof official.near === "object" ? { totalLossPct: official.near.totalLossPct } : null,
    far: official.far && typeof official.far === "object" ? { totalLossPct: official.far.totalLossPct } : null,
    combined:
      official.combined && typeof official.combined === "object"
        ? { totalLossPct: official.combined.totalLossPct }
        : null,
    perPanel: Array.isArray(official.perPanel) ? official.perPanel : [],
    meta: official.meta ?? null,
  };
}

export function slimUiForParityDebug(ui) {
  if (!ui || typeof ui !== "object") return null;
  return {
    totalLossPct: ui.totalLossPct ?? null,
    source: ui.source ?? null,
    computedAt: ui.computedAt ?? null,
    lastAbortReason: ui.lastAbortReason ?? null,
    near: ui.near && typeof ui.near === "object" ? { totalLossPct: ui.near.totalLossPct } : ui.near,
    far: ui.far && typeof ui.far === "object" ? { totalLossPct: ui.far.totalLossPct } : ui.far,
    combined:
      ui.combined && typeof ui.combined === "object" ? { totalLossPct: ui.combined.totalLossPct } : ui.combined,
    perPanel: Array.isArray(ui.perPanel) ? ui.perPanel : [],
  };
}

export function isShadingParityPersistEnabled() {
  return String(process.env.SHADING_PARITY_PERSIST || "").toLowerCase() === "true";
}
