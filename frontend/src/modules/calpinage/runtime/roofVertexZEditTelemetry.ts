/**
 * Télémétrie structurée édition Z sommet toiture (drag 3D, overlay inspection).
 *
 * **Console** (`console.log`, préfixe `[CALPINAGE][ROOF_Z_TELEMETRY]`) si :
 * - build Vite `import.meta.env.DEV`, ou
 * - `window.__CALPINAGE_ROOF_Z_TELEMETRY_CONSOLE__ = true`, ou
 * - `localStorage.setItem("calpinage_roof_z_telemetry_console", "1")` puis recharger.
 *
 * **Hook** (tous environnements) : `window.__CALPINAGE_ROOF_Z_TELEMETRY__ = (row) => { … }`.
 */

export type RoofVertexZTelemetryPayload =
  | {
      readonly event: "roof_vertex_z_drag_start";
      readonly dragSessionId: string;
      readonly panId: string;
      readonly vertexIndex: number;
      readonly startHeightM: number;
      readonly source: "3d_marker";
    }
  | {
      readonly event: "roof_vertex_z_drag_end";
      readonly dragSessionId: string;
      readonly durationMs: number;
      readonly viewerCommitInvocationCount: number;
      readonly source: "3d_marker";
    }
  | {
      readonly event: "roof_vertex_z_commit_attempt";
      readonly panId: string;
      readonly vertexIndex: number;
      readonly heightM: number;
      readonly dragSessionId: string | null;
      readonly source: string;
    }
  | {
      readonly event: "roof_vertex_z_commit_applied";
      readonly panId: string;
      readonly vertexIndex: number;
      readonly heightM: number;
      readonly dragSessionId: string | null;
      readonly source: string;
      readonly pipeline: string;
    }
  | {
      readonly event: "roof_vertex_z_commit_rejected";
      readonly panId: string;
      readonly vertexIndex: number;
      readonly heightM: number;
      readonly dragSessionId: string | null;
      readonly source: string;
      readonly reasonCode: string;
      readonly reasonDetail?: string;
    }
  /** Appel manuel : `window.__CALPINAGE_ROOF_Z_TELEMETRY_PING__()` pour vérifier console / hook. */
  | {
      readonly event: "roof_vertex_z_diagnostic_ping";
    };

export function generateRoofZDragSessionId(): string {
  return `rvz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function shouldLogRoofZTelemetryToConsole(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  const g = window as unknown as { __CALPINAGE_ROOF_Z_TELEMETRY_CONSOLE__?: boolean };
  if (g.__CALPINAGE_ROOF_Z_TELEMETRY_CONSOLE__ === true) return true;
  try {
    return localStorage.getItem("calpinage_roof_z_telemetry_console") === "1";
  } catch {
    return false;
  }
}

export function emitRoofVertexZTelemetry(payload: RoofVertexZTelemetryPayload): void {
  const row = { ts: Date.now(), ...payload };
  if (shouldLogRoofZTelemetryToConsole()) {
    console.log("[CALPINAGE][ROOF_Z_TELEMETRY]", row);
  }
  try {
    const w = typeof window !== "undefined" ? (window as unknown as { __CALPINAGE_ROOF_Z_TELEMETRY__?: (r: unknown) => void }) : null;
    const hook = w?.__CALPINAGE_ROOF_Z_TELEMETRY__;
    if (typeof hook === "function") hook(row);
  } catch {
    /* ignore */
  }
}
