/**
 * Adapter pur : runtime `shading.perPanel` → entrées viewer (aucun recalcul ombrage).
 */

import type { PanelVisualShading, PanelVisualShadingSummary } from "../../types/panelVisualShading";

export function lossPctToQualityScore01(lossPct: number): number {
  return Math.max(0, Math.min(1, 1 - lossPct / 100));
}

/** Lit le tableau brut `runtime.shading.perPanel` sans interprétation métier. */
export function extractRuntimeShadingPerPanelRows(runtime: unknown): readonly unknown[] {
  if (!runtime || typeof runtime !== "object") return [];
  const sh = (runtime as Record<string, unknown>).shading;
  if (!sh || typeof sh !== "object") return [];
  const shading = sh as Record<string, unknown>;
  const direct = shading.perPanel;
  if (Array.isArray(direct)) return direct;
  const normalized = shading.normalized;
  if (normalized && typeof normalized === "object") {
    const nested = (normalized as Record<string, unknown>).perPanel;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/**
 * Agrège les lignes per-panel : une entrée par `panelId` (ou `id`), dernière occurrence gagne.
 * Valeur `"invalid"` si la ligne existe mais `lossPct` non exploitable.
 */
export function buildLossPctByPanelIdFromPerPanelRows(rows: readonly unknown[]): ReadonlyMap<string, number | "invalid"> {
  const m = new Map<string, number | "invalid">();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const idRaw = r.panelId ?? r.id;
    if (idRaw == null || String(idRaw).trim() === "") continue;
    const id = String(idRaw);
    const loss = r.lossPct;
    if (typeof loss !== "number" || !Number.isFinite(loss) || loss < 0 || loss > 100) {
      m.set(id, "invalid");
      continue;
    }
    m.set(id, loss);
  }
  return m;
}

/**
 * Pour chaque panneau 3D connu : état + score visuel si correspondance **exacte** d’id.
 */
export function resolvePanelVisualShadingForPanels(
  panelIds: readonly string[],
  lossByPanelId: ReadonlyMap<string, number | "invalid">,
): Readonly<Record<string, PanelVisualShading>> {
  const out: Record<string, PanelVisualShading> = {};
  for (const pid of panelIds) {
    if (!lossByPanelId.has(pid)) {
      out[pid] = {
        panelId: pid,
        lossPct: null,
        qualityScore01: null,
        state: "MISSING",
        provenance: "runtime_per_panel",
      };
      continue;
    }
    const v = lossByPanelId.get(pid)!;
    if (v === "invalid") {
      out[pid] = {
        panelId: pid,
        lossPct: null,
        qualityScore01: null,
        state: "INVALID",
        provenance: "runtime_per_panel",
      };
      continue;
    }
    out[pid] = {
      panelId: pid,
      lossPct: v,
      qualityScore01: lossPctToQualityScore01(v),
      state: "AVAILABLE",
      provenance: "runtime_per_panel",
    };
  }
  return out;
}

/** Chaîne runtime → carte id → `PanelVisualShading` (matching strict). */
export function buildPanelVisualShadingMapFromRuntime(
  panelIds: readonly string[],
  runtime: unknown,
): Readonly<Record<string, PanelVisualShading>> {
  const rows = extractRuntimeShadingPerPanelRows(runtime);
  const lossBy = buildLossPctByPanelIdFromPerPanelRows(rows);
  return resolvePanelVisualShadingForPanels(panelIds, lossBy);
}

function finitePctOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function readNestedPct(source: Record<string, unknown>, key: string): number | null {
  const raw = source[key];
  if (raw && typeof raw === "object") {
    return finitePctOrNull((raw as Record<string, unknown>).totalLossPct);
  }
  return finitePctOrNull(raw);
}

export function extractRuntimeShadingSummary(runtime: unknown): PanelVisualShadingSummary | null {
  if (!runtime || typeof runtime !== "object") return null;
  const sh = (runtime as Record<string, unknown>).shading;
  if (!sh || typeof sh !== "object") return null;
  const shading = sh as Record<string, unknown>;
  const normalizedRaw = shading.normalized;
  const source =
    normalizedRaw && typeof normalizedRaw === "object"
      ? (normalizedRaw as Record<string, unknown>)
      : shading;

  const totalLossPct =
    finitePctOrNull(source.totalLossPct) ??
    readNestedPct(source, "combined") ??
    finitePctOrNull(source.annualLossPercent);
  const nearLossPct = readNestedPct(source, "near") ?? finitePctOrNull(source.nearLossPct);
  const farLossPct = readNestedPct(source, "far") ?? finitePctOrNull(source.farLossPct);
  const rows = extractRuntimeShadingPerPanelRows(runtime);
  const panelCount =
    typeof source.panelCount === "number" && Number.isFinite(source.panelCount)
      ? source.panelCount
      : rows.length > 0
        ? rows.length
        : null;
  const quality = source.shadingQuality;
  const far = source.far;
  const blockingReason =
    quality && typeof quality === "object" && typeof (quality as Record<string, unknown>).blockingReason === "string"
      ? String((quality as Record<string, unknown>).blockingReason)
      : far && typeof far === "object" && typeof (far as Record<string, unknown>).source === "string"
        ? String((far as Record<string, unknown>).source)
        : null;

  if (
    totalLossPct == null &&
    nearLossPct == null &&
    farLossPct == null &&
    panelCount == null &&
    blockingReason == null
  ) {
    return null;
  }

  return {
    totalLossPct,
    nearLossPct,
    farLossPct,
    panelCount,
    computedAt:
      typeof source.computedAt === "number" || typeof source.computedAt === "string"
        ? source.computedAt
        : null,
    blockingReason,
  };
}
