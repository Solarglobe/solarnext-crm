import { describe, expect, it } from "vitest";
import { preserveCalpinageSnapshotExtras, selectCalpinageLoadCandidate } from "../calpinageLoadPolicy";

const scope = { studyId: "synthetic-policy", versionId: "1" };
const document = (date?: string, ridges: unknown[] = []) => ({ calpinageCheckpoint: { savedAt: date }, roofState: { ridges }, pans: [] });
const metadata = (extra = {}) => ({ schemaVersion: 1, ...scope, revisionId: "local-edit", baseServerRevisionId: "server-current", modifiedAt: "2026-09-24T10:00:00Z", ...extra });
const choose = (local: any, server: any, extra = {}) => selectCalpinageLoadCandidate({ scope, local, server, serverRevision: "server-current", serverAvailable: true, ...extra });

describe("calpinage load policy", () => {
  it("retains a newer unsent local document based on the current server revision", () => {
    expect(choose({ ...document(), persistence: metadata() }, document())).toMatchObject({ kind: "selected", source: "local" });
  });
  it("selects a changed server when the local document was acknowledged, independently of clocks", () => {
    expect(choose({ ...document("2030-01-01"), persistence: metadata({ acknowledgedServerRevisionId: "older-server" }) }, document("2020-01-01")))
      .toMatchObject({ kind: "selected", source: "server" });
  });
  it("does not equate distinct branches or different contents with the same client revision", () => {
    expect(choose({ ...document(), persistence: metadata({ baseServerRevisionId: "server-previous" }) }, document())).toMatchObject({ kind: "conflict" });
    expect(choose({ ...document(undefined, [1]), persistence: metadata({ baseServerRevisionId: "server-previous" }) }, { ...document(), persistence: metadata() }))
      .toMatchObject({ kind: "conflict", reason: "same-revision-divergent-content" });
  });
  it("keeps both candidates unchanged in an ambiguous legacy conflict", () => {
    const local = document(undefined, [{ id: "ridge" }]);
    const server = document();
    const before = JSON.stringify({ local, server });
    expect(choose(local, server)).toEqual({ kind: "conflict", reason: "legacy-freshness-ambiguous", local, server });
    expect(JSON.stringify({ local, server })).toBe(before);
  });
  it.each([undefined, "2026-09-24T10:00:00Z"])("does not guess from ridges when dates are equal or missing (%s)", date => {
    expect(choose(document(date, [1]), document(date))).toMatchObject({ kind: "conflict" });
  });
  it("honors both directions of legacy freshness including deliberately removed ridges", () => {
    expect(choose(document("2026-09-20", [1]), document("2026-09-21"))).toMatchObject({ source: "server" });
    expect(choose(document("2026-09-22"), document("2026-09-21", [1]))).toMatchObject({ source: "local" });
  });
  it("cannot automatically apply a differently scoped or unscoped legacy document", () => {
    expect(choose({ ...document(), persistence: metadata({ studyId: "other-study" }) }, document())).toMatchObject({ reason: "local-scope-mismatch" });
    expect(choose({ ...document(), studyId: "other-study", versionId: "1" }, document())).toMatchObject({ reason: "local-scope-mismatch" });
    expect(choose(document("2026-10-01"), document(), { unscopedLegacy: true })).toMatchObject({ reason: "unscoped-legacy-identity-unknown" });
  });
  it("distinguishes unavailable server from a server document removed after the local baseline", () => {
    const local = { ...document(), persistence: metadata() };
    expect(choose(local, null, { serverRevision: null, serverAvailable: false })).toMatchObject({ source: "local", reason: "local-server-unverified" });
    expect(choose(local, null, { serverRevision: null })).toMatchObject({ kind: "conflict", reason: "server-document-removed-since-local-base" });
  });
  it("preserves unknown fields but never merges runtime arrays or revives the obsolete contour alias", () => {
    const base = { extension: { value: 4 }, persistence: metadata(), roofState: { serverExtra: 5, ridges: [1], contourBati: [1, 2, 3] } };
    const snapshot = { roofState: { contoursBati: [], ridges: [] } };
    expect(preserveCalpinageSnapshotExtras(base, snapshot)).toEqual({ extension: { value: 4 }, persistence: metadata(), roofState: { serverExtra: 5, contoursBati: [], ridges: [] } });
    expect(base.roofState.ridges).toEqual([1]);
  });
});
