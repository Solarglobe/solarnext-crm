import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/services/api";
import { initCalpinage } from "../calpinage.module";
import type { CalpinageLoadState } from "../../calpinageLoadPolicy";

vi.mock("@/services/api", () => ({ apiFetch: vi.fn() }));

const scope = { studyId: "persistence-load-synthetic", versionId: "1" };
const key = `calpinage:${scope.studyId}:${scope.versionId}:state`;
const ridge = { id: "removed-ridge", a: { x: 0, y: 20, h: 5 }, b: { x: 100, y: 20, h: 5 }, roofRole: "main" };
const geometry = (date: string, ridges: unknown[] = []) => ({
  schemaVersion: "v2", calpinageCheckpoint: { savedAt: date, phase: 2, currentPhase: "ROOF_EDIT" },
  phase: 2, currentPhase: "ROOF_EDIT", roofSurveyLocked: false,
  roofState: { ridges, contoursBati: [], traits: [], obstacles: [], scale: { metersPerPixel: 0.1 }, roof: {} },
  pans: [], frozenBlocks: [],
});
let cleanups: Array<() => void> = [];
function mount(options: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const cleanup = initCalpinage(container, { ...scope, ...options });
  if (cleanup) cleanups.push(cleanup);
  return container;
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  localStorage.clear(); // isolated jsdom storage only
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  const w = window as any;
  w.CalpinageCanvas = {};
  w.CalpinageMap = {};
  w.CalpinagePans = { panState: { pans: [], activePanId: null, activePoint: null }, ensurePanPhysicalProps() {}, recomputeAllPanPhysicalProps() {} };
  delete w.__CALPINAGE_GEOMETRY_LOAD_SOURCE__;
  delete w.__CALPINAGE_LAST_RELOAD_DIAG__;
  delete w.notifyCalpinageDirty;
});
afterEach(() => {
  cleanups.reverse().forEach(cleanup => cleanup());
  cleanups = [];
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (window as any).__CALPINAGE_GOOGLE_READY__;
});

describe("real legacy persistence load", () => {
  it("does not resurrect an old local ridge deliberately absent from a newer server document", async () => {
    localStorage.setItem(key, JSON.stringify(geometry("2026-09-20T09:00:00Z", [ridge])));
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, serverRevision: "server-new", calpinageData: { geometry_json: geometry("2026-09-21T09:00:00Z") } })));
    mount();
    await vi.waitFor(() => expect((window as any).__CALPINAGE_LAST_RELOAD_DIAG__).toBeTruthy());
    expect((window as any).CALPINAGE_STATE.ridges).toEqual([]);
  });

  it("adopts a newer unsynchronized local edit without writing during initialization", async () => {
    const local = { ...geometry("2026-09-22T09:00:00Z", [ridge]), persistence: { schemaVersion: 1, ...scope, revisionId: "local-edit", baseServerRevisionId: "server-base", modifiedAt: "2026-09-22T09:00:00Z" } };
    localStorage.setItem(key, JSON.stringify(local));
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, serverRevision: "server-base", calpinageData: { geometry_json: geometry("2026-09-21T09:00:00Z") } })));
    const events: CalpinageLoadState[] = [];
    const onDirty = vi.fn();
    const notify = vi.fn();
    (window as any).notifyCalpinageDirty = notify;
    const write = vi.spyOn(Storage.prototype, "setItem");
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event), onDirty });
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("ready"));
    expect(events.at(-1)).toMatchObject({ source: "local", serverRevision: "server-base", serverAvailable: true, geometry: local });
    expect((window as any).CALPINAGE_STATE.ridges[0].id).toBe("removed-ridge");
    expect(onDirty).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("preserves ambiguous copies and waits for an explicit choice before applying either", async () => {
    const local = geometry("2026-09-21T09:00:00Z", [ridge]);
    const server = geometry("2026-09-21T09:00:00Z");
    const raw = JSON.stringify(local);
    localStorage.setItem(key, raw);
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, serverRevision: "ambiguous", calpinageData: { geometry_json: server } })));
    const events: CalpinageLoadState[] = [];
    const onDirty = vi.fn();
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event), onDirty });
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("conflict"));
    expect(events.at(-1)?.conflict).toMatchObject({ local, server, reason: "legacy-freshness-ambiguous" });
    expect(localStorage.getItem(key)).toBe(raw);
    expect(onDirty).not.toHaveBeenCalled();
    events.at(-1)!.resolve!("server");
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("ready"));
    expect((window as any).CALPINAGE_STATE.ridges).toEqual([]);
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it("keeps unknown unscoped legacy data intact instead of migrating it to the opened study", async () => {
    const raw = JSON.stringify(geometry("2026-09-22T09:00:00Z", [ridge]));
    localStorage.setItem("calpinage-state", raw);
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, serverRevision: "server", calpinageData: { geometry_json: geometry("2026-09-21T09:00:00Z") } })));
    const events: CalpinageLoadState[] = [];
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event) });
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("conflict"));
    expect(events.at(-1)?.conflict?.reason).toBe("unscoped-legacy-identity-unknown");
    expect(localStorage.getItem("calpinage-state")).toBe(raw);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("uses immutable explicit study/version options instead of unrelated URL parameters", async () => {
    history.replaceState(null, "", "/?studyId=wrong-study&versionId=99");
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, serverRevision: "server", calpinageData: { geometry_json: geometry("2026-09-21T09:00:00Z") } })));
    const events: CalpinageLoadState[] = [];
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event) });
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("ready"));
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain(`/studies/${scope.studyId}/versions/1/calpinage`);
    expect((window as any).CALPINAGE_STUDY_ID).toBe(scope.studyId);
  });

  it("ignores a response for study A arriving after study B is loaded", async () => {
    let finishA!: (response: Response) => void;
    vi.mocked(apiFetch).mockImplementation((url) => String(url).includes(scope.studyId)
      ? new Promise(resolve => { finishA = resolve; })
      : Promise.resolve(new Response(JSON.stringify({ ok: true, serverRevision: "b", calpinageData: { geometry_json: geometry("2026-09-22T09:00:00Z") } }))));
    const eventsA: CalpinageLoadState[] = [];
    const eventsB: CalpinageLoadState[] = [];
    mount({ onLoadState: (event: CalpinageLoadState) => eventsA.push(event) });
    await vi.waitFor(() => expect(finishA).toBeTypeOf("function"));
    mount({ studyId: "synthetic-study-b", versionId: "2", onLoadState: (event: CalpinageLoadState) => eventsB.push(event) });
    await vi.waitFor(() => expect(eventsB.at(-1)?.status).toBe("ready"));
    finishA(new Response(JSON.stringify({ ok: true, serverRevision: "a", calpinageData: { geometry_json: geometry("2026-09-23T09:00:00Z", [ridge]) } })));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(eventsA.map(event => event.status)).toEqual(["loading"]);
    expect((window as any).CALPINAGE_STUDY_ID).toBe("synthetic-study-b");
    expect((window as any).CALPINAGE_STATE.ridges).toEqual([]);
  });

  it("marks an offline local load as unverified and preserves its document", async () => {
    localStorage.setItem(key, JSON.stringify(geometry("2026-09-22T09:00:00Z", [ridge])));
    vi.mocked(apiFetch).mockRejectedValue(new Error("synthetic offline"));
    const events: CalpinageLoadState[] = [];
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event) });
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("ready"));
    expect(events.at(-1)).toMatchObject({ source: "local", serverAvailable: false, serverRevision: null });
    expect((window as any).CALPINAGE_STATE.ridges).toHaveLength(1);
  });

  it("keeps malformed local bytes recoverable and blocks initialization persistence", async () => {
    const raw = '{"roofState":{"ridges":[broken';
    localStorage.setItem(key, raw);
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, serverRevision: "server", calpinageData: { geometry_json: geometry("2026-09-21T09:00:00Z") } })));
    const events: CalpinageLoadState[] = [];
    const onDirty = vi.fn();
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event), onDirty });
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("conflict"));
    expect(events.at(-1)?.conflict).toMatchObject({ reason: "local-json-unreadable", localRaw: raw });
    events.at(-1)!.resolve!("local");
    expect(events.at(-1)?.status).toBe("conflict");
    expect(localStorage.getItem(key)).toBe(raw);
    expect(onDirty).not.toHaveBeenCalled();
  });

  it("refuses an explicit choice of a legacy copy identifying another study", async () => {
    localStorage.setItem(key, JSON.stringify({ ...geometry("2026-10-01T09:00:00Z", [ridge]), studyId: "other-study", versionId: "1" }));
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, serverRevision: "server", calpinageData: { geometry_json: geometry("2026-09-21T09:00:00Z") } })));
    const events: CalpinageLoadState[] = [];
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event) });
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("conflict"));
    expect(events.at(-1)?.conflict?.reason).toBe("local-scope-mismatch");
    events.at(-1)!.resolve!("local");
    expect(events.at(-1)?.status).toBe("conflict");
    events.at(-1)!.resolve!("server");
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("ready"));
    expect((window as any).CALPINAGE_STATE.ridges).toEqual([]);
  });

  it("keeps a deliberate flat-roof conversion through the real save/export and loader despite an older ridge cache", async () => {
    const server: any = geometry("2026-09-21T09:00:00Z");
    server.extensionFromServer = { preserved: true };
    server.roofState.contoursBati = [{ id: "contour-flat", roofRole: "contour", points: [
      { x: 0, y: 0, h: 3 }, { x: 100, y: 0, h: 3 }, { x: 100, y: 80, h: 3 }, { x: 0, y: 80, h: 3 },
    ] }];
    let persisted = server;
    vi.mocked(apiFetch).mockImplementation(async () => new Response(JSON.stringify({ ok: true, serverRevision: "flat-server", calpinageData: { geometry_json: persisted } })));
    const events: CalpinageLoadState[] = [];
    const onDirty = vi.fn((snapshot: any) => { persisted = snapshot; });
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event), onDirty });
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("ready"));
    expect(onDirty).not.toHaveBeenCalled();
    const w = window as any;
    expect(w.CALPINAGE_STATE.pans).toHaveLength(1);
    // The roof-type control belongs to the placement phase, after the real roof validation action.
    (document.querySelector("#btn-validate-roof") as HTMLButtonElement).click();
    expect(w.CALPINAGE_STATE.currentPhase).toBe("PV_LAYOUT");
    expect(w.__applyManualPanRoofTypeAndRecompute(w.CALPINAGE_STATE.pans[0].id, "FLAT")).toBe(true);
    expect(onDirty).toHaveBeenCalled();
    expect(persisted.pans[0].roofType).toBe("FLAT");
    expect(persisted.extensionFromServer).toEqual({ preserved: true });
    expect(persisted.roofState.ridges).toEqual([]);
    localStorage.setItem(key, JSON.stringify(geometry("2026-09-20T09:00:00Z", [ridge])));
    cleanups.pop()!();
    const reloadEvents: CalpinageLoadState[] = [];
    mount({ onLoadState: (event: CalpinageLoadState) => reloadEvents.push(event), onDirty });
    await vi.waitFor(() => expect(reloadEvents.at(-1)?.status).toBe("ready"));
    expect(reloadEvents.at(-1)?.source).toBe("server");
    expect(w.CALPINAGE_STATE.pans[0].roofType).toBe("FLAT");
    expect(w.CALPINAGE_STATE.ridges).toEqual([]);
  });

  it("cancels delayed map initialization when its study is unmounted before the container is measurable", async () => {
    vi.useFakeTimers();
    const createMapProvider = vi.fn(() => ({}));
    (window as any).CalpinageMap = { createMapProvider };
    (window as any).__CALPINAGE_GOOGLE_READY__ = true;
    vi.mocked(apiFetch).mockImplementation(async () => new Response(JSON.stringify({ ok: true, calpinageData: null, serverRevision: null })));
    mount();
    cleanups.pop()!();
    await vi.advanceTimersByTimeAsync(6000);
    expect(createMapProvider).not.toHaveBeenCalled();
    expect((window as any).calpinageMap).toBeFalsy();
  });

  it("does not announce a successful load when the selected document cannot be applied to the runtime", async () => {
    const broken = geometry("2026-09-21T09:00:00Z", [null]);
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, serverRevision: "broken", calpinageData: { geometry_json: broken } })));
    const events: CalpinageLoadState[] = [];
    const onDirty = vi.fn();
    mount({ onLoadState: (event: CalpinageLoadState) => events.push(event), onDirty });
    await vi.waitFor(() => expect(events.at(-1)?.status).not.toBe("loading"));
    expect(events.at(-1)).toMatchObject({ status: "conflict", conflict: { reason: "geometry-load-failed", server: broken } });
    expect(onDirty).not.toHaveBeenCalled();
    expect((window as any).getCalpinageGeometryForPersist().geometry_json).toBeNull();
  });
});
