import {
  runSmartRoofDrawingComparison,
  type SmartRoofComparisonReport,
} from "./comparison";
import type { ComputePansFromGeometryCore, LegacyCalpinageStateLike } from "./legacyBridge";
import type { SmartRoofDiagnostic } from "./types";

export interface SmartRoofComparisonRuntimeReport extends SmartRoofComparisonReport {
  readonly mutationGuard: {
    readonly checked: boolean;
    readonly activeStateMutated: boolean;
  };
}

export interface SmartRoofComparisonRuntimeApi {
  readonly run: () => SmartRoofComparisonRuntimeReport;
  readonly getLastReport: () => SmartRoofComparisonRuntimeReport | null;
  readonly dispose: () => void;
}

function diagnostic(
  severity: SmartRoofDiagnostic["severity"],
  code: string,
  message: string,
): SmartRoofDiagnostic {
  return { severity, code, message };
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function createSmartRoofComparisonRuntimeApi(options: {
  readonly getState: () => LegacyCalpinageStateLike;
  readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
  readonly modelTolerancePx?: number;
}): SmartRoofComparisonRuntimeApi {
  let disposed = false;
  let lastReport: SmartRoofComparisonRuntimeReport | null = null;

  return {
    run() {
      if (disposed) throw new Error("Smart roof comparison runtime has been disposed.");
      const activeState = options.getState();
      const before = safeStringify(activeState);
      const report = runSmartRoofDrawingComparison({
        state: activeState,
        computePansFromGeometryCore: options.computePansFromGeometryCore,
        modelTolerancePx: options.modelTolerancePx,
      });
      const after = safeStringify(activeState);
      const checked = before != null && after != null;
      const activeStateMutated = checked ? before !== after : false;
      lastReport = {
        ...report,
        diagnostics: activeStateMutated
          ? [
              ...report.diagnostics,
              diagnostic("error", "ACTIVE_STATE_MUTATED_BY_COMPARISON", "The read-only smart roof comparison changed the active calpinage state."),
            ]
          : report.diagnostics,
        mutationGuard: {
          checked,
          activeStateMutated,
        },
      };
      return lastReport;
    },
    getLastReport() {
      return lastReport;
    },
    dispose() {
      disposed = true;
      lastReport = null;
    },
  };
}
