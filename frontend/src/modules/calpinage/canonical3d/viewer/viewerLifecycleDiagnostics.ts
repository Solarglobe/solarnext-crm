import * as THREE from "three";

export type ViewerLifecycleBlockReason =
  | "NONE"
  | "NO_CANVAS"
  | "NO_WEBGL"
  | "NO_CAMERA"
  | "NO_BOUNDS"
  | "NO_CAMERA_FIT"
  | "NO_SCENE"
  | "NO_FIRST_FRAME"
  | "ZERO_CONTAINER"
  | "NON_FINITE_CAMERA"
  | "CONTEXT_LOST"
  | "RELIABILITY_NOT_READY";

export interface ViewerLifecycleDiagnostics {
  readonly canvasMounted: boolean;
  readonly webglInitialized: boolean;
  readonly cameraInitialized: boolean;
  readonly boundsComputed: boolean;
  readonly cameraFitExecuted: boolean;
  readonly sceneAttached: boolean;
  readonly firstFrameRendered: boolean;
  readonly viewerReady: boolean;
  readonly viewerBlocked: boolean;
  readonly webglContextLost: boolean;
  readonly webglContextRestored: boolean;
  readonly lastBlockReason: ViewerLifecycleBlockReason;
  readonly frameCount: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly camera: {
    readonly position: readonly [number, number, number] | null;
    readonly target: readonly [number, number, number] | null;
    readonly near: number | null;
    readonly far: number | null;
    readonly zoom: number | null;
  };
  readonly bounds: {
    readonly min: readonly [number, number, number] | null;
    readonly max: readonly [number, number, number] | null;
  };
}

const GLOBAL_KEY = "__CALPINAGE_3D_VIEWER_LIFECYCLE__";

const initialDiagnostics: ViewerLifecycleDiagnostics = {
  canvasMounted: false,
  webglInitialized: false,
  cameraInitialized: false,
  boundsComputed: false,
  cameraFitExecuted: false,
  sceneAttached: false,
  firstFrameRendered: false,
  viewerReady: false,
  viewerBlocked: true,
  webglContextLost: false,
  webglContextRestored: false,
  lastBlockReason: "NO_CANVAS",
  frameCount: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  containerWidth: 0,
  containerHeight: 0,
  camera: {
    position: null,
    target: null,
    near: null,
    far: null,
    zoom: null,
  },
  bounds: {
    min: null,
    max: null,
  },
};

function target(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  return window as unknown as Record<string, unknown>;
}

function current(): ViewerLifecycleDiagnostics {
  const t = target();
  return (t?.[GLOBAL_KEY] as ViewerLifecycleDiagnostics | undefined) ?? initialDiagnostics;
}

function finiteTriplet(v: THREE.Vector3): readonly [number, number, number] | null {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
    ? [v.x, v.y, v.z]
    : null;
}

function deriveBlockReason(next: ViewerLifecycleDiagnostics): ViewerLifecycleBlockReason {
  if (next.webglContextLost && !next.webglContextRestored) return "CONTEXT_LOST";
  if (!next.canvasMounted) return "NO_CANVAS";
  if (!next.webglInitialized) return "NO_WEBGL";
  if (next.containerWidth <= 0 || next.containerHeight <= 0 || next.canvasWidth <= 0 || next.canvasHeight <= 0) {
    return "ZERO_CONTAINER";
  }
  if (!next.cameraInitialized) return "NO_CAMERA";
  if (!next.boundsComputed) return "NO_BOUNDS";
  if (!next.cameraFitExecuted) return "NO_CAMERA_FIT";
  if (!next.sceneAttached) return "NO_SCENE";
  if (!next.firstFrameRendered) return "NO_FIRST_FRAME";
  return "NONE";
}

export function resetViewerLifecycleDiagnostics(): ViewerLifecycleDiagnostics {
  const next = { ...initialDiagnostics };
  const t = target();
  if (t) {
    t[GLOBAL_KEY] = next;
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("calpinage-3d-lifecycle", { detail: next }));
    }
  }
  return next;
}

export function readViewerLifecycleDiagnostics(): ViewerLifecycleDiagnostics {
  return current();
}

export function updateViewerLifecycleDiagnostics(
  patch: Partial<ViewerLifecycleDiagnostics>,
): ViewerLifecycleDiagnostics {
  const merged = {
    ...current(),
    ...patch,
    camera: { ...current().camera, ...patch.camera },
    bounds: { ...current().bounds, ...patch.bounds },
  };
  const lastBlockReason = deriveBlockReason(merged);
  const next: ViewerLifecycleDiagnostics = {
    ...merged,
    lastBlockReason,
    viewerReady: lastBlockReason === "NONE",
    viewerBlocked: lastBlockReason !== "NONE",
  };
  const t = target();
  if (t) t[GLOBAL_KEY] = next;
  return next;
}

export function cameraLifecycleSnapshot(
  camera: THREE.Camera,
  targetPoint?: THREE.Vector3,
): ViewerLifecycleDiagnostics["camera"] {
  const maybeNear = (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).near;
  const maybeFar = (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).far;
  const maybeZoom = (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).zoom;
  return {
    position: finiteTriplet(camera.position),
    target: targetPoint ? finiteTriplet(targetPoint) : null,
    near: Number.isFinite(maybeNear) ? maybeNear : null,
    far: Number.isFinite(maybeFar) ? maybeFar : null,
    zoom: Number.isFinite(maybeZoom) ? maybeZoom : null,
  };
}

export function boundsLifecycleSnapshot(box: THREE.Box3): ViewerLifecycleDiagnostics["bounds"] {
  return {
    min: finiteTriplet(box.min),
    max: finiteTriplet(box.max),
  };
}
