import { describe, expect, it } from "vitest";
import {
  createViewerLifecycleRebuildScheduler,
  type ViewerLifecycleExecution,
} from "../lifecycleRebuildScheduler";

function manualScheduler() {
  const frames: (() => void)[] = [];
  const scene: ViewerLifecycleExecution[] = [];
  const overlay: ViewerLifecycleExecution[] = [];
  const scheduler = createViewerLifecycleRebuildScheduler({
    executeSceneBuild: (ctx) => scene.push(ctx),
    executePvOverlayBuild: (ctx) => overlay.push(ctx),
    scheduleFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame: () => undefined,
    now: () => 0,
  });
  return {
    scheduler,
    scene,
    overlay,
    flushOne: () => frames.shift()?.(),
    frameCount: () => frames.length,
  };
}

describe("ViewerLifecycleRebuildScheduler", () => {
  it("coalesce trois demandes scene dans la meme frame en un seul build", () => {
    const t = manualScheduler();
    t.scheduler.request({ action: "move-roof-vertex", kind: "roof", reason: "ROOF_VERTEX_HEIGHT_EDIT" });
    t.scheduler.request({ action: "move-roof-vertex", kind: "roof", reason: "ROOF_VERTEX_HEIGHT_EDIT" });
    t.scheduler.request({ action: "move-roof-vertex", kind: "roof", reason: "ROOF_VERTEX_HEIGHT_EDIT" });

    expect(t.frameCount()).toBe(1);
    t.flushOne();
    expect(t.scene).toHaveLength(1);
    expect(t.overlay).toHaveLength(1);
    expect(t.scheduler.snapshot().counters.sceneBuildRequested).toBe(3);
    expect(t.scheduler.snapshot().counters.sceneBuildExecuted).toBe(1);
  });

  it("absorbe une invalidation arrivee pendant pending et execute la generation recente", () => {
    const t = manualScheduler();
    t.scheduler.request({ action: "add-pv", kind: "pv", reason: "PV_PLACEMENT_SYNC" });
    t.scheduler.request({ action: "add-pv", kind: "pv_overlay", reason: "PV_PLACEMENT_SYNC" });

    t.flushOne();
    expect(t.scene).toHaveLength(1);
    expect(t.overlay).toHaveLength(1);
    expect(t.scene[0]!.generation).toBe(t.overlay[0]!.generation);
    expect(t.scene[0]!.kinds).toEqual(["pv", "pv_overlay"]);
  });

  it("detecte une generation ancienne comme obsolete apres une demande plus recente", () => {
    const t = manualScheduler();
    t.scheduler.request({ action: "roof", kind: "roof" });
    t.flushOne();
    const gen1 = t.scene[0]!.generation;

    t.scheduler.request({ action: "roof", kind: "roof" });
    t.flushOne();
    expect(t.scheduler.isCurrentGeneration(gen1)).toBe(false);
    t.scheduler.markObsoleteBuildIgnored();
    expect(t.scheduler.snapshot().counters.obsoleteBuildIgnored).toBe(1);
  });

  it("camera seule ne declenche aucun build canonical ni overlay", () => {
    const t = manualScheduler();
    t.scheduler.requestCamera("orbit-camera");
    t.flushOne();
    expect(t.scene).toHaveLength(0);
    expect(t.overlay).toHaveLength(0);
    expect(t.scheduler.snapshot().counters.sceneBuildExecuted).toBe(0);
  });

  it("selection seule ne declenche pas canonical", () => {
    const t = manualScheduler();
    t.scheduler.requestSelection("select-panel");
    t.flushOne();
    expect(t.scene).toHaveLength(0);
    expect(t.overlay).toHaveLength(0);
  });

  it("roof + pv publient scene et overlay sur la meme generation", () => {
    const t = manualScheduler();
    t.scheduler.request({ action: "roof-and-pv", kind: "roof" });
    t.scheduler.request({ action: "roof-and-pv", kind: "pv" });
    t.flushOne();

    expect(t.scene).toHaveLength(1);
    expect(t.overlay).toHaveLength(1);
    expect(t.scene[0]!.generation).toBe(t.overlay[0]!.generation);
  });
});
