import type { PvPanelSurface3D } from "../canonical3d/types/pv-panel-3d";

export type PvModulePowerSource =
  | "catalog_selected_panel"
  | "window_selected_panel"
  | "runtime_panel_spec"
  | "runtime_panel"
  | "missing";

export interface SelectedPvModulePower {
  readonly unitPowerWc: number | null;
  readonly source: PvModulePowerSource;
  readonly moduleId: string | null;
}

export interface InstalledPvPowerSummary {
  readonly unitPowerWc: number | null;
  readonly totalPowerWc: number | null;
  readonly totalPowerKwc: number | null;
  readonly countablePanelCount: number;
  readonly ignoredPanelCount: number;
  readonly unavailableReason: "module_power_missing" | null;
}

type RawRecord = Record<string, unknown>;

function asObject(value: unknown): RawRecord | null {
  return value && typeof value === "object" ? (value as RawRecord) : null;
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n > 50 ? n : null;
}

function resolveModuleId(module: unknown): string | null {
  const obj = asObject(module);
  if (!obj) return null;
  const raw = obj.panel_id ?? obj.id ?? null;
  if (raw == null || String(raw).trim() === "") return null;
  return String(raw).trim();
}

export function resolvePvModulePowerWc(module: unknown): number | null {
  const obj = asObject(module);
  if (!obj) return null;
  return (
    normalizeNumber(obj.power_wc) ??
    normalizeNumber(obj.powerWc) ??
    normalizeNumber(obj.power_w) ??
    normalizeNumber(obj.powerWp)
  );
}

export function resolveSelectedPvModulePower(args: {
  readonly selectedPanelId?: string | null;
  readonly selectedPanel?: unknown;
  readonly panelCatalog?: readonly unknown[];
  readonly runtimeSnapshot?: unknown;
}): SelectedPvModulePower {
  const selectedPanelId = args.selectedPanelId != null && String(args.selectedPanelId).trim() !== ""
    ? String(args.selectedPanelId).trim()
    : null;
  const selectedPanelObj = asObject(args.selectedPanel);
  const selectedPanelOwnId = resolveModuleId(selectedPanelObj);
  const lookupId = selectedPanelId ?? selectedPanelOwnId;
  const catalog = Array.isArray(args.panelCatalog) ? args.panelCatalog : [];
  const catalogMatch = lookupId
    ? catalog.find((entry) => resolveModuleId(entry) === lookupId)
    : null;

  const ordered: Array<{ source: PvModulePowerSource; module: unknown }> = [
    { source: "catalog_selected_panel", module: catalogMatch },
    { source: "window_selected_panel", module: selectedPanelObj },
  ];

  const runtime = asObject(args.runtimeSnapshot);
  if (runtime) {
    ordered.push(
      { source: "runtime_panel_spec", module: runtime.panelSpec },
      { source: "runtime_panel", module: runtime.panel },
    );
  }

  for (const entry of ordered) {
    const unitPowerWc = resolvePvModulePowerWc(entry.module);
    if (unitPowerWc != null) {
      return {
        unitPowerWc,
        source: entry.source,
        moduleId: lookupId ?? resolveModuleId(entry.module),
      };
    }
  }

  return { unitPowerWc: null, source: "missing", moduleId: lookupId };
}

export function isPvPanelCountableForPower(panel: Pick<PvPanelSurface3D, "placementValidity"> | null | undefined): boolean {
  const status = panel?.placementValidity?.status;
  return status == null || status === "VALID";
}

export function computeInstalledPvPower(args: {
  readonly panels: readonly unknown[];
  readonly modulePowerWc: number | null | undefined;
}): InstalledPvPowerSummary {
  const countablePanels = args.panels.filter((panel) => {
    const obj = asObject(panel);
    if (obj?.enabled === false) return false;
    return isPvPanelCountableForPower(panel as Pick<PvPanelSurface3D, "placementValidity">);
  });
  const countablePanelCount = countablePanels.length;
  const ignoredPanelCount = Math.max(0, args.panels.length - countablePanelCount);
  const unitPowerWc = normalizeNumber(args.modulePowerWc);
  let hasAnyPanelPower = false;
  let hasMissingPanelPower = false;
  let mixedTotalPowerWc = 0;
  for (const panel of countablePanels) {
    const panelPowerWc = resolvePvModulePowerWc(panel);
    if (panelPowerWc == null) {
      hasMissingPanelPower = true;
      continue;
    }
    hasAnyPanelPower = true;
    mixedTotalPowerWc += panelPowerWc;
  }
  if (hasAnyPanelPower && !hasMissingPanelPower) {
    return {
      unitPowerWc,
      totalPowerWc: mixedTotalPowerWc,
      totalPowerKwc: mixedTotalPowerWc / 1000,
      countablePanelCount,
      ignoredPanelCount,
      unavailableReason: null,
    };
  }
  if (unitPowerWc == null) {
    return {
      unitPowerWc: null,
      totalPowerWc: null,
      totalPowerKwc: null,
      countablePanelCount,
      ignoredPanelCount,
      unavailableReason: "module_power_missing",
    };
  }
  const totalPowerWc = countablePanelCount * unitPowerWc;
  return {
    unitPowerWc,
    totalPowerWc,
    totalPowerKwc: totalPowerWc / 1000,
    countablePanelCount,
    ignoredPanelCount,
    unavailableReason: null,
  };
}

export function formatKwcFr(totalWc: number): string {
  return (totalWc / 1000).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
