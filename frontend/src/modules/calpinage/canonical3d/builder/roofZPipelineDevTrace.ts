/**
 * Instrumentation DEV temporaire : chaîne Z toiture legacy (resolveZ → spike → unify → impose).
 *
 * Activer dans la console navigateur : `window.__ROOF_Z_PIPELINE_TRACE__ = true`
 * puis recharger / rouvrir la vue 3D qui appelle `buildRoofModel3DFromLegacyGeometry`.
 */

declare global {
  interface Window {
    __ROOF_Z_PIPELINE_TRACE__?: boolean;
  }
}

export type RoofZPipelineDevCornerCtx = {
  readonly panId: string;
  readonly cornerIndex: number;
};

type ChainEntry = {
  readonly xPx: number;
  readonly yPx: number;
  chain: string[];
  zs: number[];
};

const chains = new Map<string, ChainEntry>();

function cornerKey(panId: string, ci: number): string {
  return `${panId}:${ci}`;
}

export function isRoofZPipelineDevTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.__ROOF_Z_PIPELINE_TRACE__ === true;
  } catch {
    return false;
  }
}

/** À appeler au début de chaque build toiture (ex. après validation mpp). */
export function roofZTraceReset(): void {
  chains.clear();
}

export function roofZTraceRecordInitial(
  panId: string,
  cornerIndex: number,
  xPx: number,
  yPx: number,
  winningRule: string,
  z: number,
  extra?: Readonly<Record<string, unknown>>,
): void {
  if (!isRoofZPipelineDevTraceEnabled()) return;
  const k = cornerKey(panId, cornerIndex);
  chains.set(k, { xPx, yPx, chain: [winningRule], zs: [z] });
  console.info("[ROOF_Z_TRACE][resolveZ]", {
    panId,
    cornerIndex,
    xPx,
    yPx,
    winningRule,
    z,
    ...extra,
  });
}

export function roofZTraceRecordStep(
  panId: string,
  cornerIndex: number,
  step: string,
  z: number,
  extra?: Readonly<Record<string, unknown>>,
): void {
  if (!isRoofZPipelineDevTraceEnabled()) return;
  const e = chains.get(cornerKey(panId, cornerIndex));
  if (e) {
    e.chain.push(step);
    e.zs.push(z);
  }
  console.info("[ROOF_Z_TRACE][step]", { panId, cornerIndex, step, z, ...extra });
}

export function roofZTraceLogAntiSpike(payload: Readonly<Record<string, unknown>>): void {
  if (!isRoofZPipelineDevTraceEnabled()) return;
  console.info("[ROOF_Z_TRACE][antiSpike]", payload);
}

export function roofZTraceLogUnifyCluster(payload: Readonly<Record<string, unknown>>): void {
  if (!isRoofZPipelineDevTraceEnabled()) return;
  console.info("[ROOF_Z_TRACE][unify]", payload);
}

export function roofZTraceLogImpose(payload: Readonly<Record<string, unknown>>): void {
  if (!isRoofZPipelineDevTraceEnabled()) return;
  console.info("[ROOF_Z_TRACE][impose]", payload);
}

export function roofZTraceLogRmsPhase(payload: Readonly<Record<string, unknown>>): void {
  if (!isRoofZPipelineDevTraceEnabled()) return;
  console.info("[ROOF_Z_TRACE][rmsPhase]", payload);
}

export function roofZTraceLogFinalPan(payload: Readonly<Record<string, unknown>>): void {
  if (!isRoofZPipelineDevTraceEnabled()) return;
  console.info("[ROOF_Z_TRACE][finalPan]", payload);
}

/** Résumé tabulaire console (une fois par build). */
export function roofZTracePrintSummaryTable(): void {
  if (!isRoofZPipelineDevTraceEnabled()) return;
  const rows: unknown[] = [];
  for (const [key, e] of chains) {
    const [panId, ciStr] = key.split(":");
    rows.push({
      panId,
      cornerIndex: Number(ciStr),
      xPx: e.xPx,
      yPx: e.yPx,
      chain: e.chain.join(" → "),
      zFinal: e.zs[e.zs.length - 1],
      zHistory: e.zs,
    });
  }
  console.info("[ROOF_Z_TRACE][SUMMARY_TABLE]", rows);
}

export function roofZTraceGetChain(panId: string, cornerIndex: number): ChainEntry | undefined {
  return chains.get(cornerKey(panId, cornerIndex));
}
