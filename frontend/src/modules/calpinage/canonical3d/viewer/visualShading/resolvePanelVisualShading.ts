/**
 * Adapter pur : runtime `shading.perPanel` → entrées viewer (aucun recalcul ombrage).
 */

import type { PanelVisualShading } from "../../types/panelVisualShading";

export function lossPctToQualityScore01(lossPct: number): number {
  return Math.max(0, Math.min(1, 1 - lossPct / 100));
}

/** Lit le tableau brut `runtime.shading.perPanel` sans interprétation métier. */
export function extractRuntimeShadingPerPanelRows(runtime: unknown): readonly unknown[] {
  if (!runtime || typeof runtime !== "object") return [];
  const sh = (runtime as Record<string, unknown>).shading;
  if (!sh || typeof sh !== "object") return [];
  const pp = (sh as Record<string, unknown>).perPanel;
  return Array.isArray(pp) ? pp : [];
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
