/** Selection only: neither candidate is mutated, merged, written or discarded here. */
export type CalpinageGeometry = Record<string, any>;
export interface CalpinageScope { studyId: string; versionId: string }
export interface CalpinageLoadState {
  status: "loading" | "ready" | "conflict";
  scope: CalpinageScope;
  geometry?: CalpinageGeometry | null;
  serverRevision: string | null;
  source?: "server" | "local" | "empty";
  serverAvailable: boolean;
  conflict?: { server: CalpinageGeometry | null; local: CalpinageGeometry | null; reason: string; localRaw?: string };
  resolve?: (source: "local" | "server") => void;
}
export interface CalpinagePersistenceMetadata extends CalpinageScope {
  schemaVersion: 1;
  revisionId: string;
  baseServerRevisionId: string | null;
  modifiedAt: string;
  acknowledgedServerRevisionId?: string;
}
export type CalpinageLoadSelection =
  | { kind: "selected"; source: "local" | "server"; geometry: CalpinageGeometry; reason: string }
  | { kind: "empty"; source: "empty"; geometry: null; reason: string }
  | { kind: "conflict"; reason: string; server: CalpinageGeometry | null; local: CalpinageGeometry | null };

export function geometryScopeMatches(geometry: CalpinageGeometry, scope: CalpinageScope): boolean {
  const identity = geometry.persistence ?? geometry;
  return String(identity.studyId ?? "") === scope.studyId && String(identity.versionId ?? "") === scope.versionId;
}

export function geometryHasConflictingScope(geometry: CalpinageGeometry, scope: CalpinageScope): boolean {
  const hasExplicitIdentity = geometry.persistence != null || geometry.studyId != null || geometry.versionId != null;
  return hasExplicitIdentity && !geometryScopeMatches(geometry, scope);
}

function metadata(geometry: CalpinageGeometry): CalpinagePersistenceMetadata | null {
  const value = geometry.persistence;
  return value?.schemaVersion === 1 && typeof value.revisionId === "string" && value.revisionId.length > 0
    ? value as CalpinagePersistenceMetadata : null;
}

function checkpointTime(geometry: CalpinageGeometry): number | null {
  for (const value of [geometry.persistence?.modifiedAt, geometry.calpinageCheckpoint?.savedAt, geometry.meta?.generatedAt]) {
    const time = typeof value === "string" ? Date.parse(value) : NaN;
    if (Number.isFinite(time)) return time;
  }
  return null;
}

// Ignore only local acknowledgement, which is not part of the server document.
function comparable(value: unknown): string {
  const normalize = (entry: any, inPersistence = false): any => {
    if (Array.isArray(entry)) return entry.map(item => normalize(item));
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.keys(entry).sort()
      .filter(key => !(inPersistence && key === "acknowledgedServerRevisionId"))
      .map(key => [key, normalize(entry[key], key === "persistence")]));
  };
  return JSON.stringify(normalize(value));
}

export function selectCalpinageLoadCandidate(input: {
  scope: CalpinageScope;
  server: CalpinageGeometry | null;
  local: CalpinageGeometry | null;
  serverRevision: string | null;
  serverAvailable: boolean;
  unscopedLegacy?: boolean;
}): CalpinageLoadSelection {
  const { scope, server, local, serverRevision, serverAvailable } = input;
  const conflict = (reason: string): CalpinageLoadSelection => ({ kind: "conflict", reason, server, local });
  const select = (source: "local" | "server", reason: string): CalpinageLoadSelection => ({
    kind: "selected", source, geometry: (source === "local" ? local : server)!, reason,
  });
  if (server && geometryHasConflictingScope(server, scope)) return conflict("server-scope-mismatch");
  if (local && geometryHasConflictingScope(local, scope)) return conflict("local-scope-mismatch");
  if (local && input.unscopedLegacy) return conflict("unscoped-legacy-identity-unknown");
  if (!local && !server) return { kind: "empty", source: "empty", geometry: null, reason: serverAvailable ? "no-saved-document" : "server-unavailable" };
  if (!local) return select("server", "server-only");
  if (!server) {
    const localMetadata = metadata(local);
    if (serverAvailable && localMetadata && (localMetadata.baseServerRevisionId || localMetadata.acknowledgedServerRevisionId)) {
      return conflict("server-document-removed-since-local-base");
    }
    return select("local", serverAvailable ? "local-only" : "local-server-unverified");
  }
  if (comparable(local) === comparable(server)) return select("server", "same-document");
  const localMetadata = metadata(local);
  const serverMetadata = metadata(server);
  if (localMetadata) {
    // An acknowledged local copy has no unsent edits. A changed server wins even when its clock is older.
    if (localMetadata.acknowledgedServerRevisionId) return select("server", "local-already-acknowledged");
    if (localMetadata.baseServerRevisionId === serverRevision && serverRevision !== null) {
      return select("local", "unsent-local-derived-from-current-server");
    }
    // Equal client IDs with different contents are not proof of successful synchronization.
    return conflict(serverMetadata?.revisionId === localMetadata.revisionId ? "same-revision-divergent-content" : "divergent-revisions");
  }
  // Compatibility for scoped documents written before revisions existed. Never use roof contents as chronology.
  const localTime = checkpointTime(local);
  const serverTime = checkpointTime(server);
  if (localTime !== null && serverTime !== null && localTime !== serverTime) {
    return localTime > serverTime ? select("local", "legacy-local-newer-checkpoint") : select("server", "legacy-server-newer-checkpoint");
  }
  return conflict("legacy-freshness-ambiguous");
}

/** Keep extension fields without restoring deleted runtime arrays or the obsolete contour alias. */
export function preserveCalpinageSnapshotExtras(base: CalpinageGeometry | null, snapshot: CalpinageGeometry): CalpinageGeometry {
  if (!base) return snapshot;
  const result = { ...base, ...snapshot };
  for (const key of ["meta", "calpinageCheckpoint", "roofState"]) {
    if (base[key] && snapshot[key]) result[key] = { ...base[key], ...snapshot[key] };
  }
  if (result.roofState && Object.prototype.hasOwnProperty.call(snapshot.roofState ?? {}, "contoursBati")) delete result.roofState.contourBati;
  return result;
}
