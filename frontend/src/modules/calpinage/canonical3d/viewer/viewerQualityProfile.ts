import * as THREE from "three";

export type ViewerQualityMode = "AUTO" | "HIGH" | "MEDIUM" | "LOW";
export type ViewerQualityTier = "HIGH" | "MEDIUM" | "LOW";

export interface ViewerQualityProfile {
  readonly tier: ViewerQualityTier;
  readonly dprMin: number;
  readonly dprMax: number;
  readonly shadows: boolean;
  readonly shadowMapSize: 512 | 1024 | 2048;
  readonly shadowMapType: THREE.ShadowMapType;
  readonly environment: boolean;
  readonly environmentIntensity: number;
  readonly postprocessing: boolean;
  readonly smaa: boolean;
  readonly bloom: boolean;
  readonly vignette: boolean;
  readonly nativeAntialias: boolean;
  readonly frameloop: "always" | "demand";
}

export interface ViewerDeviceCapabilitySignals {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency?: number | null;
  readonly deviceMemoryGb?: number | null;
  readonly isMobileLike?: boolean;
}

export interface ViewerFrameWindowStats {
  readonly fpsAvg: number;
  readonly fpsLow: number;
  readonly frameTimeAvgMs: number;
  readonly frameTimeP95Ms: number;
  readonly frameCount: number;
  readonly durationMs: number;
}

export interface ViewerQualityTransitionInput {
  readonly mode: ViewerQualityMode;
  readonly currentTier: ViewerQualityTier;
  readonly stats: ViewerFrameWindowStats;
  readonly nowMs: number;
  readonly lastTierChangeAtMs: number;
}

export interface ViewerQualityTransitionResult {
  readonly tier: ViewerQualityTier;
  readonly reason: string;
}

export const VIEWER_QUALITY_PROFILES: Record<ViewerQualityTier, ViewerQualityProfile> = {
  HIGH: {
    tier: "HIGH",
    dprMin: 1,
    dprMax: 1.75,
    shadows: true,
    shadowMapSize: 2048,
    shadowMapType: THREE.PCFSoftShadowMap,
    environment: true,
    environmentIntensity: 0.52,
    postprocessing: true,
    smaa: true,
    bloom: true,
    vignette: true,
    nativeAntialias: true,
    frameloop: "always",
  },
  MEDIUM: {
    tier: "MEDIUM",
    dprMin: 1,
    dprMax: 1.35,
    shadows: true,
    shadowMapSize: 1024,
    shadowMapType: THREE.PCFSoftShadowMap,
    environment: true,
    environmentIntensity: 0.44,
    postprocessing: true,
    smaa: true,
    bloom: false,
    vignette: false,
    nativeAntialias: true,
    frameloop: "always",
  },
  LOW: {
    tier: "LOW",
    dprMin: 1,
    dprMax: 1,
    shadows: false,
    shadowMapSize: 512,
    shadowMapType: THREE.BasicShadowMap,
    environment: false,
    environmentIntensity: 0,
    postprocessing: false,
    smaa: false,
    bloom: false,
    vignette: false,
    nativeAntialias: true,
    frameloop: "demand",
  },
} as const;

export const VIEWER_QUALITY_WINDOW_MIN_DURATION_MS = 2500;
export const VIEWER_QUALITY_WINDOW_MIN_FRAMES = 45;
export const VIEWER_QUALITY_DOWNGRADE_COOLDOWN_MS = 3500;
export const VIEWER_QUALITY_UPGRADE_COOLDOWN_MS = 15000;

export function clampViewerDpr(devicePixelRatio: number, profile: ViewerQualityProfile): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(profile.dprMax, Math.max(profile.dprMin, dpr));
}

export function isViewerQualityManual(mode: ViewerQualityMode): mode is ViewerQualityTier {
  return mode === "HIGH" || mode === "MEDIUM" || mode === "LOW";
}

export function readViewerDeviceCapabilitySignals(): ViewerDeviceCapabilitySignals {
  if (typeof window === "undefined") {
    return { viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1 };
  }
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const userAgent = nav?.userAgent ?? "";
  const navWithMemory = nav as (Navigator & { readonly deviceMemory?: number }) | undefined;
  return {
    viewportWidth: Math.max(1, window.innerWidth || 1280),
    viewportHeight: Math.max(1, window.innerHeight || 720),
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: nav?.hardwareConcurrency ?? null,
    deviceMemoryGb: navWithMemory?.deviceMemory ?? null,
    isMobileLike:
      /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
      (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches),
  };
}

export function resolveInitialViewerQualityTier(signals: ViewerDeviceCapabilitySignals): ViewerQualityTier {
  const dpr = Number.isFinite(signals.devicePixelRatio) && signals.devicePixelRatio > 0
    ? signals.devicePixelRatio
    : 1;
  const renderedMegaPixels = (signals.viewportWidth * signals.viewportHeight * dpr * dpr) / 1_000_000;
  const cores = signals.hardwareConcurrency ?? 4;
  const memory = signals.deviceMemoryGb ?? 4;

  if (signals.isMobileLike) {
    return renderedMegaPixels > 2.8 || cores <= 4 || memory <= 4 ? "LOW" : "MEDIUM";
  }
  if (renderedMegaPixels >= 7 || cores <= 4 || memory <= 3) return "LOW";
  if (renderedMegaPixels >= 4.8 || cores <= 6 || memory <= 6) return "MEDIUM";
  return "HIGH";
}

function downgradeTier(tier: ViewerQualityTier): ViewerQualityTier {
  if (tier === "HIGH") return "MEDIUM";
  if (tier === "MEDIUM") return "LOW";
  return "LOW";
}

function upgradeTier(tier: ViewerQualityTier): ViewerQualityTier {
  if (tier === "LOW") return "MEDIUM";
  if (tier === "MEDIUM") return "HIGH";
  return "HIGH";
}

export function resolveViewerQualityTransition(input: ViewerQualityTransitionInput): ViewerQualityTransitionResult {
  if (isViewerQualityManual(input.mode)) {
    return { tier: input.mode, reason: "manual" };
  }
  const s = input.stats;
  if (
    s.durationMs < VIEWER_QUALITY_WINDOW_MIN_DURATION_MS ||
    s.frameCount < VIEWER_QUALITY_WINDOW_MIN_FRAMES
  ) {
    return { tier: input.currentTier, reason: "insufficient-sample" };
  }

  const sinceChange = input.nowMs - input.lastTierChangeAtMs;
  const bad = s.fpsAvg < 42 || s.fpsLow < 30 || s.frameTimeP95Ms > 30;
  const severe = s.fpsAvg < 28 || s.fpsLow < 22 || s.frameTimeP95Ms > 45;
  if ((bad || severe) && input.currentTier !== "LOW") {
    if (sinceChange < VIEWER_QUALITY_DOWNGRADE_COOLDOWN_MS && !severe) {
      return { tier: input.currentTier, reason: "downgrade-cooldown" };
    }
    return {
      tier: downgradeTier(input.currentTier),
      reason: severe ? "measured-severe-slowdown" : "measured-slowdown",
    };
  }

  const excellent = s.fpsAvg >= 57 && s.fpsLow >= 50 && s.frameTimeP95Ms <= 20;
  const good = s.fpsAvg >= 53 && s.fpsLow >= 45 && s.frameTimeP95Ms <= 23;
  if ((excellent || good) && input.currentTier !== "HIGH") {
    if (sinceChange < VIEWER_QUALITY_UPGRADE_COOLDOWN_MS) {
      return { tier: input.currentTier, reason: "upgrade-hysteresis" };
    }
    return {
      tier: upgradeTier(input.currentTier),
      reason: excellent ? "measured-excellent-headroom" : "measured-good-headroom",
    };
  }

  return { tier: input.currentTier, reason: "stable" };
}
