import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import type { CameraViewMode } from "./cameraViewMode";
import type { ViewerQualityTier } from "./viewerQualityProfile";
import type { ViewerReliabilityState } from "./viewerReliabilityState";

export interface ViewerRenderInvalidationInput {
  readonly sceneKey: string;
  readonly cameraViewMode: CameraViewMode;
  readonly qualityTier: ViewerQualityTier;
  readonly frameloop: "always" | "demand";
  readonly reliability: Pick<
    ViewerReliabilityState,
    "kind" | "generation" | "renderedGeneration" | "source" | "geometryTruthStatus" | "issueCodes"
  >;
  readonly patchCount: number;
  readonly pvPanelCount: number;
  readonly obstacleCount: number;
  readonly extensionCount: number;
  readonly pvOverlayEpoch: number;
}

export interface ViewerRenderInvalidationSnapshot {
  readonly count: number;
  readonly lastKey: string | null;
  readonly lastReason: string | null;
  readonly lastAtIso: string | null;
  readonly history: readonly {
    readonly key: string;
    readonly reason: string;
    readonly atIso: string;
  }[];
}

const RENDER_INVALIDATION_GLOBAL = "__CALPINAGE_3D_RENDER_INVALIDATION__";
const MAX_HISTORY = 20;

function readTarget(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  return window as unknown as Record<string, unknown>;
}

function exposeRenderInvalidation(reason: string, key: string): void {
  const target = readTarget();
  if (!target) return;
  const previous = target[RENDER_INVALIDATION_GLOBAL] as ViewerRenderInvalidationSnapshot | undefined;
  const atIso = new Date().toISOString();
  target[RENDER_INVALIDATION_GLOBAL] = {
    count: (previous?.count ?? 0) + 1,
    lastKey: key,
    lastReason: reason,
    lastAtIso: atIso,
    history: [
      ...(previous?.history ?? []),
      { key, reason, atIso },
    ].slice(-MAX_HISTORY),
  };
}

export function readViewerRenderInvalidationSnapshot(): ViewerRenderInvalidationSnapshot | null {
  const target = readTarget();
  if (!target) return null;
  return (target[RENDER_INVALIDATION_GLOBAL] as ViewerRenderInvalidationSnapshot | undefined) ?? null;
}

export function buildViewerRenderInvalidationKey(input: ViewerRenderInvalidationInput): string {
  return [
    `scene=${input.sceneKey}`,
    `mode=${input.cameraViewMode}`,
    `tier=${input.qualityTier}`,
    `loop=${input.frameloop}`,
    `rel=${input.reliability.kind}`,
    `gen=${input.reliability.generation}`,
    `rendered=${input.reliability.renderedGeneration ?? "none"}`,
    `source=${input.reliability.source}`,
    `truth=${input.reliability.geometryTruthStatus}`,
    `issues=${input.reliability.issueCodes.join(",")}`,
    `patches=${input.patchCount}`,
    `pv=${input.pvPanelCount}`,
    `obstacles=${input.obstacleCount}`,
    `extensions=${input.extensionCount}`,
    `pvOverlay=${input.pvOverlayEpoch}`,
  ].join("|");
}

export function ViewerRenderInvalidator(input: ViewerRenderInvalidationInput): null {
  const invalidate = useThree((s) => s.invalidate);
  const lastKeyRef = useRef<string | null>(null);
  const key = buildViewerRenderInvalidationKey(input);

  useLayoutEffect(() => {
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    const reason = input.frameloop === "demand" ? "demand-scene-publication" : "scene-publication";
    exposeRenderInvalidation(reason, key);
    invalidate();

    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
    const frame = window.requestAnimationFrame(() => {
      exposeRenderInvalidation(`${reason}:raf`, key);
      invalidate();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [input.frameloop, invalidate, key]);

  return null;
}
