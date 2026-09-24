import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalpinageSaveError, CalpinageSaveSession, type CalpinageGeometry } from "../calpinageSaveSession";

type Receipt = { geometry: CalpinageGeometry | null; serverRevision: string | null };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function receipt(geometry: CalpinageGeometry, serverRevision: string): Receipt {
  return { geometry: clone(geometry), serverRevision };
}

function setup() {
  let local: CalpinageGeometry | null = null;
  const scope = { studyId: "study-a", versionId: "1" };
  const post = vi.fn(async (geometry: CalpinageGeometry, _expectedRevision: string | null) => receipt(geometry, "server-next"));
  const readServer = vi.fn(async (): Promise<Receipt> => ({ geometry: null, serverRevision: null }));
  const writeLocal = vi.fn((geometry: CalpinageGeometry) => { local = clone(geometry); });
  const onConfirmed = vi.fn();
  const session = new CalpinageSaveSession({
    scope, post, readServer, writeLocal, readLocal: () => local ? clone(local) : null,
    onConfirmed, debounceMs: 3500,
  });
  session.adopt({ pans: [], meta: { generatedAt: "initial" } }, "server", "server-base", true);
  return { session, scope, post, readServer, writeLocal, onConfirmed,
    getLocal: () => local ? clone(local) : null,
    replaceLocal: (geometry: CalpinageGeometry) => { local = clone(geometry); },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  let sequence = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `revision-${++sequence}` });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("calpinage save coordinator", () => {
  it("captures an immutable study/version and a detached geometry before asynchronous work", async () => {
    const h = setup();
    const geometry = { pans: [{ id: "pan-a", height: 2 }] };
    h.scope.studyId = "study-b";
    h.scope.versionId = "9";
    expect(h.session.capture(geometry)).toBe(true);
    geometry.pans[0].height = 99;
    const exported = h.session.getGeometry()!;
    exported.pans[0].height = 123;
    expect(await h.session.flush()).toBe(true);
    expect(h.post).toHaveBeenCalledOnce();
    expect(h.post.mock.calls[0][0]).toMatchObject({ pans: [{ height: 2 }], persistence: { studyId: "study-a", versionId: "1" } });
    expect(h.post.mock.calls[0][1]).toBe("server-base");
    expect(h.getLocal()?.pans[0].height).toBe(2);
  });

  it("serializes edits made during a slow POST and confirms only the newest local revision", async () => {
    const h = setup();
    const first = deferred<Receipt>();
    const second = deferred<Receipt>();
    h.post.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    h.session.capture({ pans: [{ id: "old" }] });
    const flushing = h.session.flush();
    await Promise.resolve();
    expect(h.post).toHaveBeenCalledOnce();
    const sentFirst = clone(h.post.mock.calls[0][0]);
    h.session.capture({ pans: [{ id: "new" }] });
    expect(h.session.flush()).toBe(flushing);
    expect(h.getLocal()?.pans[0].id).toBe("new");
    first.resolve(receipt(sentFirst, "server-first"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.post).toHaveBeenCalledTimes(2);
    expect(h.post.mock.calls[1][0].pans[0].id).toBe("new");
    expect(h.post.mock.calls[1][1]).toBe("server-first");
    expect(h.session.getState().confirmedRevision).toBe(1);
    expect(h.session.hasUnconfirmedChanges()).toBe(true);
    expect(h.onConfirmed).not.toHaveBeenCalled();
    second.resolve(receipt(h.post.mock.calls[1][0], "server-second"));
    expect(await flushing).toBe(true);
    expect(h.session.getState()).toMatchObject({ revision: 2, confirmedRevision: 2, server: "confirmed" });
    expect(h.getLocal()).toMatchObject({ pans: [{ id: "new" }], persistence: { acknowledgedServerRevisionId: "server-second" } });
    expect(h.onConfirmed).toHaveBeenCalledOnce();
  });

  it("never replaces a newer editor's local draft with a late receipt", async () => {
    const h = setup();
    const pending = deferred<Receipt>();
    h.post.mockImplementationOnce(() => pending.promise);
    h.session.capture({ pans: [{ id: "old-editor" }] });
    const flushing = h.session.flush();
    await Promise.resolve();
    const newerDraft = { pans: [{ id: "new-editor" }], persistence: { studyId: "study-a", versionId: "1", revisionId: "another-editor" } };
    h.replaceLocal(newerDraft);
    pending.resolve(receipt(h.post.mock.calls[0][0], "server-old-editor"));
    expect(await flushing).toBe(true);
    expect(h.getLocal()).toEqual(newerDraft);
    expect(h.writeLocal).toHaveBeenCalledOnce();
  });

  it("keeps the local draft and retries after an ordinary POST failure", async () => {
    const h = setup();
    h.post.mockRejectedValueOnce(new Error("HTTP 503"));
    h.session.capture({ pans: [{ id: "unsaved" }] });
    expect(await h.session.flush()).toBe(false);
    expect(h.session.getState()).toMatchObject({ local: "saved", server: "failed", confirmedRevision: 0 });
    expect(h.session.hasUnconfirmedChanges()).toBe(true);
    expect(h.getLocal()?.pans[0].id).toBe("unsaved");
    expect(h.onConfirmed).not.toHaveBeenCalled();
    expect(await h.session.flush()).toBe(true);
    expect(h.post.mock.calls[1][1]).toBe("server-base");
  });

  it("does not retry a conflict automatically or clear the useful local draft", async () => {
    const h = setup();
    h.post.mockRejectedValueOnce(new CalpinageSaveError("revision changed", true));
    h.session.capture({ pans: [{ id: "mine" }] });
    expect(await h.session.flush()).toBe(false);
    h.session.capture({ pans: [{ id: "mine-again" }] });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await h.session.flush()).toBe(false);
    expect(h.post).toHaveBeenCalledOnce();
    expect(h.session.getState().server).toBe("conflict");
    expect(h.getLocal()?.pans[0].id).toBe("mine-again");
  });

  it.each(["revisionId", "studyId", "versionId", "serverRevision", "geometry"])("refuses a receipt with mismatched %s", async (field) => {
    const h = setup();
    h.post.mockImplementationOnce(async geometry => {
      const result = receipt(geometry, "server-result");
      if (field === "serverRevision") result.serverRevision = null;
      else if (field === "geometry") result.geometry = null;
      else result.geometry!.persistence[field] = "wrong";
      return result;
    });
    h.session.capture({ pans: [{ id: "mine" }] });
    expect(await h.session.flush()).toBe(false);
    expect(h.session.getState().server).toBe("failed");
    expect(h.session.hasUnconfirmedChanges()).toBe(true);
    expect(h.getLocal()?.persistence.acknowledgedServerRevisionId).toBeUndefined();
    expect(h.onConfirmed).not.toHaveBeenCalled();
  });

  it("handles a transport timeout as an unconfirmed save while preserving the draft", async () => {
    const h = setup();
    h.post.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      setTimeout(() => reject(new DOMException("Request timed out", "AbortError")), 30000);
    }));
    h.session.capture({ pans: [{ id: "slow" }] });
    const flushing = h.session.flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(await flushing).toBe(false);
    expect(h.session.getState()).toMatchObject({ local: "saved", server: "failed" });
    expect(h.session.hasUnconfirmedChanges()).toBe(true);
    expect(h.getLocal()?.pans[0].id).toBe("slow");
  });

  it("records local quota failure separately from successful server confirmation", async () => {
    const h = setup();
    h.writeLocal.mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    h.session.capture({ pans: [{ id: "server-only" }] });
    expect(h.session.getState().local).toBe("failed");
    expect(await h.session.flush()).toBe(true);
    expect(h.session.getState()).toMatchObject({ local: "failed", server: "confirmed", confirmedRevision: 1 });
  });

  it("verifies an unknown offline base before posting and blocks divergent server content", async () => {
    const h = setup();
    h.session.adopt({ pans: [{ id: "offline" }], persistence: { baseServerRevisionId: "last-known" } }, "local", null, false);
    h.readServer.mockResolvedValue({ geometry: { pans: [{ id: "remote" }] }, serverRevision: "different" });
    expect(await h.session.flush()).toBe(false);
    expect(h.post).not.toHaveBeenCalled();
    expect(h.session.getState().server).toBe("conflict");
    expect(h.getLocal()?.pans[0].id).toBe("offline");
  });

  it("uses the verified offline base and excludes acknowledgement metadata from a new POST", async () => {
    const h = setup();
    h.session.adopt({ pans: [{ id: "offline" }], persistence: { baseServerRevisionId: "previous-base", acknowledgedServerRevisionId: "last-known" } }, "local", null, false);
    h.readServer.mockResolvedValue({ geometry: { pans: [{ id: "remote" }] }, serverRevision: "last-known" });
    expect(await h.session.flush()).toBe(true);
    expect(h.post.mock.calls[0][1]).toBe("last-known");
    expect(h.post.mock.calls[0][0].persistence.acknowledgedServerRevisionId).toBeUndefined();
  });

  it("does not treat export-only timestamp changes as another geometry edit", async () => {
    const h = setup();
    h.session.capture({ pans: [{ id: "same" }], meta: { generatedAt: "first" }, calpinageCheckpoint: { savedAt: "first" } });
    await h.session.flush();
    h.session.capture({ pans: [{ id: "same" }], meta: { generatedAt: "second" }, calpinageCheckpoint: { savedAt: "second" } });
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.post).toHaveBeenCalledOnce();
    expect(h.session.getState().revision).toBe(1);
  });

  it.each(["study", "version"])("rejects a captured drawing from another %s without altering local storage", async (kind) => {
    const h = setup();
    const foreign = { pans: [{ id: "foreign" }], persistence: {
      studyId: kind === "study" ? "study-b" : "study-a",
      versionId: kind === "version" ? "2" : "1",
    } };
    expect(h.session.capture(foreign)).toBe(false);
    expect(h.session.getState().server).toBe("conflict");
    expect(h.session.hasUnconfirmedChanges()).toBe(true);
    expect(await h.session.flush()).toBe(false);
    expect(h.writeLocal).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
  });

  it("a capture failure during a slow POST cannot acknowledge the failed edit or start a retry loop", async () => {
    const h = setup();
    const pending = deferred<Receipt>();
    // Fail a possible unwanted second request so this regression can never spin.
    h.post.mockImplementationOnce(() => pending.promise).mockRejectedValue(new Error("Unexpected second POST"));
    h.session.capture({ pans: [{ id: "before-invalid-edit" }] });
    const flushing = h.session.flush();
    await Promise.resolve();
    const invalid: CalpinageGeometry = { pans: [{ id: "invalid-edit" }] };
    invalid.circular = invalid;
    expect(h.session.capture(invalid)).toBe(false);
    pending.resolve(receipt(h.post.mock.calls[0][0], "server-before-invalid-edit"));
    expect(await flushing).toBe(false);
    expect(h.post).toHaveBeenCalledOnce();
    expect(h.onConfirmed).not.toHaveBeenCalled();
    expect(h.session.hasUnconfirmedChanges()).toBe(true);
    expect(h.session.getState().server).not.toBe("confirmed");
    expect(h.getLocal()?.pans[0].id).toBe("before-invalid-edit");
  });

  it("an old receipt cannot acknowledge a newly adopted local draft whose revision counter restarted", async () => {
    const h = setup();
    const pending = deferred<Receipt>();
    h.post.mockImplementationOnce(() => pending.promise);
    h.session.capture({ pans: [{ id: "before-adopt" }] });
    const flushing = h.session.flush();
    await Promise.resolve();
    const oldSent = clone(h.post.mock.calls[0][0]);
    h.session.pause(true);
    h.session.adopt({ pans: [{ id: "after-adopt" }] }, "local", "server-reloaded", true);
    const adoptedRevisionId = h.session.getState().revisionId;
    expect(adoptedRevisionId).not.toBe(oldSent.persistence.revisionId);
    pending.resolve(receipt(oldSent, "server-old"));
    await flushing;
    const confirmationBelongsToAdopted = h.post.mock.calls.some(([geometry]) => geometry.persistence.revisionId === adoptedRevisionId);
    expect(h.session.getState().server === "confirmed" && !confirmationBelongsToAdopted,
      "The old revision counter must not acknowledge another adopted revisionId").toBe(false);
    expect(h.getLocal()?.persistence.acknowledgedServerRevisionId).not.toBe("server-old");
    expect(h.getLocal()?.pans[0].id).toBe("after-adopt");
    expect(h.session.hasUnconfirmedChanges()).toBe(true);
    expect(h.post).toHaveBeenCalledOnce();
    expect(h.onConfirmed).not.toHaveBeenCalled();
  });

  it("an obsolete offline verification cannot replace the base of a newly adopted server document", async () => {
    const h = setup();
    const oldRead = deferred<Receipt>();
    h.readServer.mockImplementationOnce(() => oldRead.promise);
    h.session.adopt({ pans: [{ id: "offline" }] }, "local", null, false);
    const verifying = h.session.flush();
    await Promise.resolve();
    expect(h.readServer).toHaveBeenCalledOnce();
    h.session.adopt({ pans: [{ id: "new-server-document" }], persistence: {
      studyId: "study-a", versionId: "1", revisionId: "from-server", baseServerRevisionId: "older-base",
    } }, "server", "server-reloaded", true);
    oldRead.resolve({ geometry: null, serverRevision: null });
    await verifying;
    h.session.capture({ pans: [{ id: "edit-after-reload" }] });
    await h.session.flush();
    // An implementation may either keep the known new base or stop on a reload
    // conflict. It must never POST a new document against the obsolete absence.
    expect(h.post.mock.calls.every(([_geometry, expectedRevision]) => expectedRevision === "server-reloaded")).toBe(true);
    expect(h.getLocal()?.pans[0].id).toBe("edit-after-reload");
  });
});
