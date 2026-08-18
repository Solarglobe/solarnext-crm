import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type {
  ViewerFrameWindowStats,
  ViewerQualityMode,
  ViewerQualityProfile,
  ViewerQualityTier,
} from "./viewerQualityProfile";

export interface ViewerPerformanceSnapshot extends ViewerFrameWindowStats {
  readonly qualityMode: ViewerQualityMode;
  readonly effectiveTier: ViewerQualityTier;
  readonly dpr: number;
  readonly drawCalls: number;
  readonly rendererTriangles: number;
  readonly sceneTriangles: number;
  readonly meshes: number;
  readonly geometries: number;
  readonly textures: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly environment: boolean;
  readonly postprocessing: boolean;
  readonly smaa: boolean;
  readonly bloom: boolean;
  readonly vignette: boolean;
  readonly measuredAt: string;
}

export interface ViewerPerformanceDevApi {
  readonly snapshot: () => ViewerPerformanceSnapshot;
  readonly setMode: (mode: ViewerQualityMode) => void;
  readonly resetStats: () => void;
}

export interface ViewerPerformanceMonitorProps {
  readonly mode: ViewerQualityMode;
  readonly effectiveTier: ViewerQualityTier;
  readonly profile: ViewerQualityProfile;
  readonly setMode: (mode: ViewerQualityMode) => void;
  readonly onWindowStats: (stats: ViewerFrameWindowStats, nowMs: number) => void;
}

const MAX_FRAME_SAMPLES = 360;
const ADAPTATION_WINDOW_MS = 5000;

function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[idx] ?? 0;
}

function geometryTriangleCount(geometry: THREE.BufferGeometry): number {
  const indexCount = geometry.index?.count;
  if (typeof indexCount === "number") return Math.floor(indexCount / 3);
  const positionCount = geometry.getAttribute("position")?.count;
  return typeof positionCount === "number" ? Math.floor(positionCount / 3) : 0;
}

function collectSceneComplexity(scene: THREE.Scene): { meshes: number; sceneTriangles: number } {
  let meshes = 0;
  let sceneTriangles = 0;
  scene.traverse((obj) => {
    const maybeMesh = obj as THREE.Mesh | THREE.InstancedMesh;
    if (!("geometry" in maybeMesh) || !(maybeMesh.geometry instanceof THREE.BufferGeometry)) return;
    meshes += 1;
    const instanceCount = maybeMesh instanceof THREE.InstancedMesh ? maybeMesh.count : 1;
    sceneTriangles += geometryTriangleCount(maybeMesh.geometry) * Math.max(1, instanceCount);
  });
  return { meshes, sceneTriangles };
}

export function ViewerPerformanceMonitor({
  mode,
  effectiveTier,
  profile,
  setMode,
  onWindowStats,
}: ViewerPerformanceMonitorProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const samplesRef = useRef<{ readonly atMs: number; readonly frameTimeMs: number }[]>([]);
  const latestSnapshotRef = useRef<ViewerPerformanceSnapshot | null>(null);

  const resetStats = () => {
    samplesRef.current = [];
    latestSnapshotRef.current = makeSnapshot();
  };

  const makeWindowStats = (): ViewerFrameWindowStats => {
    const samples = samplesRef.current;
    if (samples.length === 0) {
      return { fpsAvg: 0, fpsLow: 0, frameTimeAvgMs: 0, frameTimeP95Ms: 0, frameCount: 0, durationMs: 0 };
    }
    const frameTimes = samples.map((s) => s.frameTimeMs);
    const durationMs = samples[samples.length - 1]!.atMs - samples[0]!.atMs;
    const frameTimeAvgMs = frameTimes.reduce((sum, v) => sum + v, 0) / frameTimes.length;
    const sortedFrameTimes = [...frameTimes].sort((a, b) => a - b);
    const sortedFps = frameTimes.map((v) => (v > 0 ? 1000 / v : 0)).sort((a, b) => a - b);
    return {
      fpsAvg: frameTimeAvgMs > 0 ? 1000 / frameTimeAvgMs : 0,
      fpsLow: percentile(sortedFps, 10),
      frameTimeAvgMs,
      frameTimeP95Ms: percentile(sortedFrameTimes, 95),
      frameCount: samples.length,
      durationMs,
    };
  };

  const makeSnapshot = (): ViewerPerformanceSnapshot => {
    const stats = makeWindowStats();
    const complexity = collectSceneComplexity(scene);
    return {
      ...stats,
      qualityMode: mode,
      effectiveTier,
      dpr: gl.getPixelRatio(),
      drawCalls: gl.info.render.calls,
      rendererTriangles: gl.info.render.triangles,
      sceneTriangles: complexity.sceneTriangles,
      meshes: complexity.meshes,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      shadows: profile.shadows,
      shadowMapSize: profile.shadowMapSize,
      environment: profile.environment,
      postprocessing: profile.postprocessing,
      smaa: profile.smaa,
      bloom: profile.bloom,
      vignette: profile.vignette,
      measuredAt: new Date().toISOString(),
    };
  };

  useFrame((_, delta) => {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const frameTimeMs = Math.max(0.001, delta * 1000);
    const next = [...samplesRef.current, { atMs: nowMs, frameTimeMs }]
      .filter((s) => nowMs - s.atMs <= ADAPTATION_WINDOW_MS)
      .slice(-MAX_FRAME_SAMPLES);
    samplesRef.current = next;
    const snapshot = makeSnapshot();
    latestSnapshotRef.current = snapshot;
    onWindowStats(snapshot, nowMs);
  });

  useEffect(() => {
    latestSnapshotRef.current = makeSnapshot();
    if (typeof window === "undefined") return;
    const api: ViewerPerformanceDevApi = {
      snapshot: () => latestSnapshotRef.current ?? makeSnapshot(),
      setMode,
      resetStats,
    };
    (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_PERF__"] = api;
    return () => {
      const target = window as unknown as Record<string, unknown>;
      if (target["__CALPINAGE_3D_PERF__"] === api) delete target["__CALPINAGE_3D_PERF__"];
    };
  });

  return null;
}
