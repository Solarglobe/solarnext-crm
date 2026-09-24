import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import CalpinageOverlay from "../CalpinageOverlay";
import { setAuthToken } from "../../services/api";

// Replace only the Google Maps / WebGL shell. The editor initializer, geometry
// exporter, local storage, API service and Overlay persistence remain real.
vi.mock("../../modules/calpinage/CalpinageApp", async () => {
  const React = await import("react");
  const { initCalpinage } = await import("../../modules/calpinage/legacy/calpinage.module");
  return {
    default: function RealLegacyEditor(props: any) {
      const container = React.useRef<HTMLDivElement>(null);
      const callbacks = React.useRef(props);
      callbacks.current = props;
      React.useEffect(() => initCalpinage(container.current!, {
        studyId: props.studyId,
        versionId: props.versionId,
        onDirty: (geometry: unknown) => callbacks.current.onDirty?.(geometry),
        onLoadState: (event: unknown) => callbacks.current.onLoadState?.(event),
        onValidate: (data: unknown) => callbacks.current.onValidate?.(data),
      }), [props.studyId, props.versionId]);
      return <div data-testid="real-legacy-editor" ref={container} />;
    },
  };
});

type Geometry = ReturnType<typeof geometry>;
type Write = { studyId: string; body: { geometry_json: Geometry; expectedRevision?: string | null } };
type Saved = { geometry: Geometry; revision: string };
const w = () => window as any;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const localKey = (studyId = "study-a") => `calpinage:${studyId}:1:state`;
const saveStatus = () => within(screen.getByRole("region", { name: "État de sauvegarde du calpinage" })).getByRole("status");
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let records: Map<string, Saved>;
let writes: Write[];
let networkFailures: boolean;
let conflictPosts: boolean;
let heldWrites: Array<() => void>;
let holdPosts: boolean;
let initCount = 0;
let routers: ReturnType<typeof createMemoryRouter>[] = [];

function geometry(height = 4) {
  return {
    schemaVersion: "v2",
    calpinageCheckpoint: { savedAt: "2026-09-20T09:00:00.000Z", phase: 2, currentPhase: "ROOF_EDIT" },
    phase: 2, currentPhase: "ROOF_EDIT", roofSurveyLocked: false,
    roofState: {
      contoursBati: [{ id: "roof", roofRole: "main", points: [
        { x: 0, y: 0, h: height }, { x: 100, y: 0, h: 4 },
        { x: 100, y: 100, h: 4 }, { x: 0, y: 100, h: 4 },
      ] }],
      ridges: [], traits: [], obstacles: [], scale: { metersPerPixel: 0.1 }, roof: {},
    },
    pans: [], frozenBlocks: [],
  };
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  records = new Map([["study-a", { geometry: geometry(), revision: "study-a-base" }], ["study-b", { geometry: geometry(8), revision: "study-b-base" }]]);
  writes = [];
  heldWrites = [];
  holdPosts = false;
  networkFailures = false;
  conflictPosts = false;
  initCount = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  w().CalpinageCanvas = {};
  w().__CALPINAGE_INITIAL_PROVIDER__ = "geoportail-ortho";
  w().CalpinageMap = { createMapProvider: () => ({ getState: () => ({}), destroy() {}, resize() {} }) };
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    // A visible synthetic map avoids the legacy 10s container-size retry after teardown.
    return this.id === "map-container" ? new DOMRect(0, 0, 640, 480) : originalRect.call(this);
  });
  w().CalpinagePans = { panState: { pans: [], activePanId: null, activePoint: null }, ensurePanPhysicalProps() {}, recomputeAllPanPhysicalProps() {} };
  delete w().__CALPINAGE_LAST_RELOAD_DIAG__;
  delete w().__CALPINAGE_GEOMETRY_LOAD_SOURCE__;
  // Node's native Request rejects jsdom's AbortSignal by realm. Preserve the
  // router's signal on the request without passing it through Node's validator.
  vi.stubGlobal("Request", class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined });
      if (init?.signal) Object.defineProperty(this, "signal", { value: init.signal });
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const pathname = new URL(String(input), "http://synthetic.test").pathname;
    const method = init.method || "GET";
    const match = pathname.match(/\/api\/studies\/([^/]+)\/versions\/1\/calpinage$/);
    if (match) {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer synthetic-calpinage-regression-token");
      const studyId = match[1];
      const saved = records.get(studyId)!;
      if (method === "GET") {
        initCount++;
        return jsonResponse({ ok: true, serverRevision: saved.revision, calpinageData: { geometry_json: clone(saved.geometry) } });
      }
      if (method === "POST") {
        const body = JSON.parse(String(init.body));
        writes.push({ studyId, body });
        if (networkFailures) return jsonResponse({ error: "Serveur indisponible (test isolé)" }, 503);
        if (conflictPosts) return jsonResponse({ error: "Conflit de révision", code: "CALPINAGE_REVISION_CONFLICT", serverRevision: "concurrent-revision" }, 409);
        const accept = () => {
          const revision = `${studyId}-revision-${writes.length}`;
          records.set(studyId, { geometry: clone(body.geometry_json), revision });
          return jsonResponse({ ok: true, serverRevision: revision, calpinageData: { geometry_json: clone(body.geometry_json) } });
        };
        if (holdPosts) return new Promise<Response>(resolve => heldWrites.push(() => resolve(accept())));
        return accept();
      }
    }
    if (method === "GET" && pathname.endsWith("/has-active-study")) return jsonResponse({ hasActiveStudy: false });
    if (method === "GET") return jsonResponse([]); // catalogs in memory; never forward to a network
    throw new Error(`Unexpected request: ${method} ${pathname}`);
  }));
  setAuthToken("synthetic-calpinage-regression-token");
});

afterEach(async () => {
  cleanup();
  for (const router of routers) router.dispose();
  routers = [];
  setAuthToken(null);
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  document.body.innerHTML = "";
});

async function mountEditor(studyId = "study-a", callbacks: { onClose?: () => void; onSaved?: () => void; waitForGeometry?: boolean; strict?: boolean } = {}) {
  const onClose = callbacks.onClose || vi.fn();
  const onSaved = callbacks.onSaved || vi.fn();
  const element = <CalpinageOverlay studyId={studyId} versionId="1" onClose={onClose} onSaved={onSaved} />;
  const router = createMemoryRouter([
    { path: "/editor", element },
    { path: "/other", element: <div>Autre page</div> },
  ], { initialEntries: ["/other", "/editor"], initialIndex: 1 });
  routers.push(router);
  const provider = <RouterProvider router={router} />;
  const view = render(callbacks.strict ? <React.StrictMode>{provider}</React.StrictMode> : provider);
  if (callbacks.waitForGeometry !== false) {
    await waitFor(() => expect(w().CALPINAGE_STATE?.contours?.[0]?.points?.[0]?.h).toBe(records.get(studyId)!.geometry.roofState.contoursBati[0].points[0].h));
  }
  await act(async () => { await Promise.resolve(); });
  return { ...view, router, onClose, onSaved };
}

function editHeight(height: number) {
  act(() => {
    const result = w().__calpinageApplyStructuralHeightSelection({ type: "contour", index: 0, pointIndex: 0 }, height);
    expect(result).toEqual({ ok: true });
  });
  expect(w().CALPINAGE_STATE.contours[0].points[0].h).toBe(height);
}

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  });
}

function quotaForGeometry() {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith("calpinage:") && key.endsWith(":state")) throw new DOMException("Quota test", "QuotaExceededError");
    return original.call(this, key, value);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function savedHeight(write: Write) { return write.body.geometry_json.roofState.contoursBati[0].points[0].h; }

describe("real Overlay + legacy + API persistence", () => {
  it("flushes the last real edit before controlled close, before the 3500 ms debounce", async () => {
    const { onClose } = await mountEditor();
    vi.useFakeTimers();
    editHeight(6);
    fireEvent.click(screen.getByRole("dialog"));
    await tick();
    expect(writes, "La fermeture attend la sauvegarde du dernier dessin").toHaveLength(1);
    expect(savedHeight(writes[0])).toBe(6);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps server success distinct from local quota failure and reloads the saved geometry", async () => {
    const view = await mountEditor();
    quotaForGeometry();
    vi.useFakeTimers();
    editHeight(6);
    await tick(3500);
    expect(writes).toHaveLength(1);
    expect(savedHeight(writes[0])).toBe(6);
    expect(saveStatus()).toHaveTextContent(/Copie locale.*échec/i);
    expect(saveStatus()).toHaveTextContent(/Serveur.*révision courante confirmée/i);
    expect(localStorage.getItem(localKey()) || "").not.toContain('"h":6');
    view.unmount();
    vi.useRealTimers();
    await mountEditor();
    expect(initCount).toBe(2);
    expect(w().CALPINAGE_STATE.contours[0].points[0].h).toBe(6);
  });

  it("keeps failed quota plus failed POST visible and blocks close until an explicit choice", async () => {
    const { onClose } = await mountEditor();
    quotaForGeometry();
    networkFailures = true;
    vi.useFakeTimers();
    editHeight(7);
    fireEvent.click(screen.getByRole("dialog"));
    await tick();
    expect(writes).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(saveStatus()).toHaveTextContent(/Copie locale.*échec/i);
    expect(saveStatus()).toHaveTextContent(/Serveur.*échec.*non confirmé/i);
    expect(screen.getByRole("button", { name: /Réessayer la sauvegarde/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quitter sans confirmation serveur/i })).toBeInTheDocument();
    networkFailures = false;
    fireEvent.click(screen.getByRole("button", { name: /Réessayer la sauvegarde/i }));
    await tick();
    expect(savedHeight(writes[writes.length - 1])).toBe(7);
    expect(records.get("study-a")!.geometry.roofState.contoursBati[0].points[0].h).toBe(7);
    expect(saveStatus()).toHaveTextContent(/révision courante confirmée/i);
    expect(screen.queryByRole("button", { name: "Quitter sans confirmation serveur" })).not.toBeInTheDocument();
  });

  it("serializes slow responses and captures edits made while the previous POST is pending", async () => {
    const { onSaved } = await mountEditor();
    holdPosts = true;
    vi.useFakeTimers();
    editHeight(5);
    await tick(3500);
    expect(writes).toHaveLength(1);
    editHeight(6);
    await tick(3500);
    editHeight(7);
    await tick(3500);
    expect(writes, "Un seul POST à la fois, même après plusieurs périodes de debounce").toHaveLength(1);
    expect(savedHeight(writes[0]), "La requête capture une révision immuable").toBe(5);
    await act(async () => { heldWrites.shift()!(); });
    await tick();
    expect(writes).toHaveLength(2);
    expect(savedHeight(writes[1])).toBe(7);
    expect(writes[1].body.expectedRevision).toBe(records.get("study-a")!.revision);
    await act(async () => { heldWrites.shift()!(); });
    await tick();
    expect(records.get("study-a")!.geometry.roofState.contoursBati[0].points[0].h).toBe(7);
    expect(onSaved).toHaveBeenCalled();
  });

  it.each(["push", "back"])("flushes before router %s navigation", async (direction) => {
    const { router } = await mountEditor();
    holdPosts = true;
    vi.useFakeTimers();
    editHeight(6);
    await act(async () => { if (direction === "back") void router.navigate(-1); else void router.navigate("/other"); });
    await tick();
    expect(router.state.location.pathname).toBe("/editor");
    expect(writes).toHaveLength(1);
    await act(async () => { heldWrites.shift()!(); });
    await tick();
    expect(router.state.location.pathname).toBe("/other");
    expect(savedHeight(writes[0])).toBe(6);
  });

  it("warns on browser unload while the latest edit lacks server confirmation", async () => {
    await mountEditor();
    vi.useFakeTimers();
    editHeight(6);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await tick(3500);
    const confirmedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(confirmedEvent);
    expect(confirmedEvent.defaultPrevented).toBe(false);
  });

  it("resumes a blocked router navigation after the user retries a failed save successfully", async () => {
    const { router } = await mountEditor();
    networkFailures = true;
    vi.useFakeTimers();
    editHeight(6);
    await act(async () => { void router.navigate("/other"); });
    await tick();
    expect(router.state.location.pathname).toBe("/editor");
    expect(screen.getByRole("button", { name: "Quitter sans confirmation serveur" })).toBeInTheDocument();
    networkFailures = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer la sauvegarde" }));
    await tick();
    expect(router.state.location.pathname).toBe("/other");
    expect(records.get("study-a")!.geometry.roofState.contoursBati[0].points[0].h).toBe(6);
  });

  it("keeps study A's pending immutable snapshot separate from study B", async () => {
    const a = await mountEditor();
    holdPosts = true;
    vi.useFakeTimers();
    editHeight(6);
    await tick(3500);
    a.unmount();
    vi.useRealTimers();
    await mountEditor("study-b");
    vi.useFakeTimers();
    editHeight(9);
    await tick(3500);
    expect(writes.map(write => [write.studyId, savedHeight(write)])).toEqual([["study-a", 6], ["study-b", 9]]);
    await act(async () => { heldWrites.splice(0).forEach(resolve => resolve()); });
    await tick();
    expect(records.get("study-a")!.geometry.roofState.contoursBati[0].points[0].h).toBe(6);
    expect(records.get("study-b")!.geometry.roofState.contoursBati[0].points[0].h).toBe(9);
  });

  it("retains a pending save when parent callback identities change", async () => {
    let rerenderParent: () => void;
    const latestSaved = vi.fn();
    function Parent() {
      const [revision, setRevision] = React.useState(0);
      rerenderParent = () => setRevision(value => value + 1);
      return <CalpinageOverlay studyId="study-a" versionId="1" onClose={() => {}} onSaved={() => latestSaved(revision)} />;
    }
    const router = createMemoryRouter([{ path: "*", element: <Parent /> }]);
    routers.push(router);
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(w().CALPINAGE_STATE?.contours?.[0]?.points?.[0]?.h).toBe(4));
    vi.useFakeTimers();
    editHeight(6);
    await tick(1000);
    act(() => rerenderParent!());
    await tick(2500);
    expect(writes).toHaveLength(1);
    expect(savedHeight(writes[0])).toBe(6);
    expect(initCount).toBe(1);
    expect(latestSaved).toHaveBeenCalledWith(1);
  });

  it.each(["local", "server"])("holds both ambiguous copies and blocks editing until the %s choice", async (choice) => {
    const local = geometry(10);
    const originalLocal = JSON.stringify(local);
    const originalServer = clone(records.get("study-a")!);
    localStorage.setItem(localKey(), originalLocal);
    await mountEditor("study-a", { waitForGeometry: false });
    await waitFor(() => expect(screen.getByRole("button", { name: "Reprendre la version serveur" })).toBeInTheDocument());
    const editor = screen.getByTestId("real-legacy-editor").parentElement!;
    expect(editor).toHaveAttribute("aria-disabled", "true");
    expect(editor).toHaveStyle({ pointerEvents: "none" });
    const keyboardEdit = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    screen.getByTestId("real-legacy-editor").dispatchEvent(keyboardEdit);
    expect(keyboardEdit.defaultPrevented).toBe(true);
    expect(saveStatus()).toHaveTextContent(/conflit.*sauvegarde suspendue/i);
    expect(screen.getByRole("button", { name: "Réessayer la sauvegarde" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exporter les deux versions" })).toBeEnabled();
    vi.useFakeTimers();
    await tick(7000);
    expect(writes).toEqual([]);
    expect(localStorage.getItem(localKey())).toBe(originalLocal);
    expect(records.get("study-a")).toEqual(originalServer);
    fireEvent.click(screen.getByRole("button", { name: choice === "local" ? "Reprendre le brouillon local" : "Reprendre la version serveur" }));
    await tick();
    expect(w().CALPINAGE_STATE.contours[0].points[0].h).toBe(choice === "local" ? 10 : 4);
    expect(editor).toHaveAttribute("aria-disabled", "false");
    await tick(3500);
    if (choice === "local") {
      expect(writes).toHaveLength(1);
      expect(savedHeight(writes[0])).toBe(10);
      expect(writes[0].body.expectedRevision).toBe(originalServer.revision);
    } else {
      expect(writes).toEqual([]);
      expect(localStorage.getItem(localKey())).toBe(originalLocal);
    }
  });

  it("preserves an unsent draft after HTTP 409 and never reports it as confirmed", async () => {
    const { onClose, onSaved } = await mountEditor();
    conflictPosts = true;
    vi.useFakeTimers();
    editHeight(6);
    await tick(3500);
    expect(writes).toHaveLength(1);
    expect(saveStatus()).toHaveTextContent(/Serveur.*conflit.*sauvegarde suspendue/i);
    expect(saveStatus()).not.toHaveTextContent(/révision courante confirmée/i);
    expect(screen.getByRole("button", { name: "Réessayer la sauvegarde" })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem(localKey())!).roofState.contoursBati[0].points[0].h).toBe(6);
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Fermer le calpinage" }));
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Quitter sans confirmation serveur" })).toBeEnabled();
    await tick(7000);
    expect(writes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Quitter sans confirmation serveur" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(localKey())!).roofState.contoursBati[0].points[0].h).toBe(6);
  });

  it("keeps one live editor and one writer across StrictMode effect replay", async () => {
    const { onSaved } = await mountEditor("study-a", { strict: true });
    vi.useFakeTimers();
    editHeight(6);
    await tick(3500);
    expect(document.querySelectorAll("#calpinage-root")).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(savedHeight(writes[0])).toBe(6);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(saveStatus()).toHaveTextContent(/révision courante confirmée/i);
  });
});
