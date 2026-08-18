export type ViewerInvalidationKind =
  | "camera"
  | "selection"
  | "handles"
  | "pv_overlay"
  | "pv"
  | "roof"
  | "obstacle"
  | "scene"
  | "resize"
  | "fallback";

export type ViewerLifecycleCounterName =
  | "sceneBuildRequested"
  | "sceneBuildExecuted"
  | "pvOverlayBuildRequested"
  | "pvOverlayBuildExecuted"
  | "roofGeometryBuild"
  | "viewerInvalidation"
  | "runtimeMutationEvent"
  | "structuralEvent"
  | "rafScheduled"
  | "rafExecuted"
  | "officialBuildSucceeded"
  | "officialBuildFailed"
  | "fallbackEmergencyUsed"
  | "obsoleteBuildIgnored";

export interface ViewerLifecycleRequest {
  readonly action: string;
  readonly kind: ViewerInvalidationKind;
  readonly reason?: string;
  readonly forceSceneRebuild?: boolean;
  readonly eventCount?: number;
}

export interface ViewerLifecycleExecution {
  readonly generation: number;
  readonly actionId: string;
  readonly kinds: readonly ViewerInvalidationKind[];
  readonly forceSceneRebuild: boolean;
}

export interface ViewerLifecycleSchedulerOptions {
  readonly executeSceneBuild: (ctx: ViewerLifecycleExecution) => void;
  readonly executePvOverlayBuild?: (ctx: ViewerLifecycleExecution) => void;
  readonly scheduleFrame?: (cb: () => void) => number;
  readonly cancelFrame?: (id: number) => void;
  readonly now?: () => number;
  readonly debugEnabled?: () => boolean;
}

export interface ViewerLifecycleActionSummary {
  readonly actionId: string;
  readonly action: string;
  readonly generation: number;
  readonly kinds: readonly ViewerInvalidationKind[];
  readonly counters: Readonly<Record<ViewerLifecycleCounterName, number>>;
  readonly durationMs: number;
  readonly forceSceneRebuild: boolean;
}

export interface ViewerLifecycleSnapshot {
  readonly currentGeneration: number;
  readonly pending: boolean;
  readonly lastAction: ViewerLifecycleActionSummary | null;
  readonly counters: Readonly<Record<ViewerLifecycleCounterName, number>>;
}

const COUNTER_NAMES: readonly ViewerLifecycleCounterName[] = [
  "sceneBuildRequested",
  "sceneBuildExecuted",
  "pvOverlayBuildRequested",
  "pvOverlayBuildExecuted",
  "roofGeometryBuild",
  "viewerInvalidation",
  "runtimeMutationEvent",
  "structuralEvent",
  "rafScheduled",
  "rafExecuted",
  "officialBuildSucceeded",
  "officialBuildFailed",
  "fallbackEmergencyUsed",
  "obsoleteBuildIgnored",
];

function emptyCounters(): Record<ViewerLifecycleCounterName, number> {
  return Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])) as Record<ViewerLifecycleCounterName, number>;
}

function requiresSceneBuild(kinds: ReadonlySet<ViewerInvalidationKind>): boolean {
  return (
    kinds.has("scene") ||
    kinds.has("roof") ||
    kinds.has("pv") ||
    kinds.has("obstacle") ||
    kinds.has("fallback")
  );
}

function requiresPvOverlayBuild(kinds: ReadonlySet<ViewerInvalidationKind>): boolean {
  return kinds.has("pv_overlay") || kinds.has("pv") || kinds.has("roof") || kinds.has("obstacle") || kinds.has("scene");
}

function defaultScheduleFrame(cb: () => void): number {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(cb);
  }
  return setTimeout(cb, 0) as unknown as number;
}

function defaultCancelFrame(id: number): void {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

export class ViewerLifecycleRebuildScheduler {
  private readonly executeSceneBuild: ViewerLifecycleSchedulerOptions["executeSceneBuild"];
  private readonly executePvOverlayBuild: NonNullable<ViewerLifecycleSchedulerOptions["executePvOverlayBuild"]>;
  private readonly scheduleFrame: NonNullable<ViewerLifecycleSchedulerOptions["scheduleFrame"]>;
  private readonly cancelFrame: NonNullable<ViewerLifecycleSchedulerOptions["cancelFrame"]>;
  private readonly now: NonNullable<ViewerLifecycleSchedulerOptions["now"]>;
  private readonly debugEnabled: NonNullable<ViewerLifecycleSchedulerOptions["debugEnabled"]>;
  private counters = emptyCounters();
  private pendingKinds = new Set<ViewerInvalidationKind>();
  private pendingAction = "unknown";
  private pendingForceSceneRebuild = false;
  private frameId: number | null = null;
  private currentGeneration = 0;
  private actionSeq = 0;
  private lastAction: ViewerLifecycleActionSummary | null = null;

  constructor(options: ViewerLifecycleSchedulerOptions) {
    this.executeSceneBuild = options.executeSceneBuild;
    this.executePvOverlayBuild = options.executePvOverlayBuild ?? (() => undefined);
    this.scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame;
    this.now = options.now ?? (() => performance.now());
    this.debugEnabled = options.debugEnabled ?? (() => false);
  }

  request(request: ViewerLifecycleRequest): void {
    this.increment("viewerInvalidation");
    if (request.kind === "roof") this.increment("roofGeometryBuild");
    if (request.reason != null) {
      if (request.reason.includes("STRUCTURAL") || request.reason.includes("ROOF")) this.increment("structuralEvent", request.eventCount ?? 1);
      if (request.reason.includes("PV") || request.reason.includes("RUNTIME")) this.increment("runtimeMutationEvent", request.eventCount ?? 1);
    }
    this.pendingKinds.add(request.kind);
    this.pendingAction = request.action;
    this.pendingForceSceneRebuild = this.pendingForceSceneRebuild || request.forceSceneRebuild === true;

    if (requiresSceneBuild(this.pendingKinds)) this.increment("sceneBuildRequested");
    if (requiresPvOverlayBuild(this.pendingKinds)) this.increment("pvOverlayBuildRequested");

    if (this.frameId != null) return;
    this.increment("rafScheduled");
    this.frameId = this.scheduleFrame(() => this.flush());
  }

  requestCamera(action = "camera"): void {
    this.request({ action, kind: "camera" });
  }

  requestSelection(action = "selection"): void {
    this.request({ action, kind: "selection" });
  }

  flush(): void {
    if (this.frameId != null) {
      this.frameId = null;
    }
    this.increment("rafExecuted");
    const kinds = new Set(this.pendingKinds);
    this.pendingKinds.clear();

    const action = this.pendingAction;
    const forceSceneRebuild = this.pendingForceSceneRebuild;
    this.pendingForceSceneRebuild = false;

    const needsScene = requiresSceneBuild(kinds);
    const needsOverlay = requiresPvOverlayBuild(kinds);
    const generation = needsScene || needsOverlay ? ++this.currentGeneration : this.currentGeneration;
    const actionId = `${action}-${++this.actionSeq}`;
    const started = this.now();
    const ctx: ViewerLifecycleExecution = {
      generation,
      actionId,
      kinds: [...kinds],
      forceSceneRebuild,
    };

    if (needsScene) {
      this.increment("sceneBuildExecuted");
      this.executeSceneBuild(ctx);
    }
    if (needsOverlay) {
      this.increment("pvOverlayBuildExecuted");
      this.executePvOverlayBuild(ctx);
    }

    this.lastAction = {
      actionId,
      action,
      generation,
      kinds: [...kinds],
      counters: { ...this.counters },
      durationMs: this.now() - started,
      forceSceneRebuild,
    };

    if (this.debugEnabled()) {
      // eslint-disable-next-line no-console
      console.debug("[3D-LIFECYCLE]", this.lastAction);
    }
  }

  isCurrentGeneration(generation: number): boolean {
    return generation >= this.currentGeneration;
  }

  markOfficialBuildSucceeded(): void {
    this.increment("officialBuildSucceeded");
  }

  markOfficialBuildFailed(): void {
    this.increment("officialBuildFailed");
  }

  markFallbackEmergencyUsed(): void {
    this.increment("fallbackEmergencyUsed");
  }

  markObsoleteBuildIgnored(): void {
    this.increment("obsoleteBuildIgnored");
  }

  cancel(): void {
    if (this.frameId != null) {
      this.cancelFrame(this.frameId);
      this.frameId = null;
    }
    this.pendingKinds.clear();
  }

  snapshot(): ViewerLifecycleSnapshot {
    return {
      currentGeneration: this.currentGeneration,
      pending: this.frameId != null,
      lastAction: this.lastAction,
      counters: { ...this.counters },
    };
  }

  private increment(name: ViewerLifecycleCounterName, amount = 1): void {
    this.counters[name] += amount;
  }
}

export function createViewerLifecycleRebuildScheduler(
  options: ViewerLifecycleSchedulerOptions,
): ViewerLifecycleRebuildScheduler {
  return new ViewerLifecycleRebuildScheduler(options);
}

export function exposeViewerLifecycleDiagnostics(
  scheduler: ViewerLifecycleRebuildScheduler,
  target: unknown = typeof window !== "undefined" ? window : undefined,
): void {
  if (!target || typeof target !== "object") return;
  (target as Record<string, unknown>)["__CALPINAGE_3D_LIFECYCLE__"] = {
    snapshot: () => scheduler.snapshot(),
    flush: () => scheduler.flush(),
  };
}
