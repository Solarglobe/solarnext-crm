/**
 * Diagnostics passifs obstacles (anti-régression Calpinage).
 * Ne modifie aucun state métier — lecture + logs uniquement.
 */

const IS_DEV_BUILD =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV === true;

let __buildGeometryBaseline = null;
let __pansCoreBaseline = null;

export function obstacleIntegrityClearPansCoreBaseline() {
  __pansCoreBaseline = null;
}

function sortIds(arr) {
  return arr.slice().sort();
}

/**
 * @param {Record<string, unknown> | null | undefined} state
 */
export function captureObstacleLivePanLinks(state) {
  const st = state || {};
  const pans = st.pans || [];
  /** @type {Record<string, string[]>} */
  const byObstacle = Object.create(null);
  for (let i = 0; i < pans.length; i++) {
    const p = pans[i];
    if (!p || typeof p.id !== "string") continue;
    const obs = p.obstacles;
    if (!Array.isArray(obs)) continue;
    for (let j = 0; j < obs.length; j++) {
      const oid = obs[j];
      if (typeof oid !== "string") continue;
      if (!byObstacle[oid]) byObstacle[oid] = [];
      byObstacle[oid].push(p.id);
    }
  }
  return byObstacle;
}

/**
 * @param {Record<string, unknown> | null | undefined} state
 */
export function captureObstacleIntegritySnapshot(state) {
  const st = state || {};
  const list = st.obstacles || [];
  const obstacleIds = [];
  const validObstacleIds = [];
  /** @type {Record<string, number>} */
  const pointsLengthById = Object.create(null);
  /** @type {Record<string, string | null>} */
  const kindById = Object.create(null);
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o || typeof o.id !== "string") continue;
    obstacleIds.push(o.id);
    const plen = o.points && Array.isArray(o.points) ? o.points.length : 0;
    pointsLengthById[o.id] = plen;
    kindById[o.id] = o.kind != null ? String(o.kind) : o.type != null ? String(o.type) : null;
    if (plen >= 3) validObstacleIds.push(o.id);
  }
  return {
    totalCount: list.length,
    obstacleIds: sortIds(obstacleIds),
    validObstacleIds: sortIds(validObstacleIds),
    pointsLengthById,
    kindById,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} state
 */
export function captureObstacleIntegrityFull(state) {
  const snap = captureObstacleIntegritySnapshot(state);
  return Object.assign({}, snap, {
    livePanLinksByObstacleId: captureObstacleLivePanLinks(state),
  });
}

/**
 * @param {ReturnType<typeof captureObstacleIntegrityFull>} prevFull
 * @param {ReturnType<typeof captureObstacleIntegrityFull>} nextFull
 * @param {null | { roofState?: { obstacles?: Array<{ id?: string }> } }} exportData
 */
export function diffObstacleIntegrity(prevFull, nextFull, exportData) {
  const nextIds = new Set(nextFull.obstacleIds);
  const lostGlobalObstacleIds = prevFull.obstacleIds.filter((id) => !nextIds.has(id));

  const becameInvalidObstacleIds = [];
  for (let i = 0; i < prevFull.validObstacleIds.length; i++) {
    const id = prevFull.validObstacleIds[i];
    if (!nextIds.has(id)) continue;
    const pl = nextFull.pointsLengthById[id];
    if (typeof pl !== "number" || pl < 3) becameInvalidObstacleIds.push(id);
  }

  let missingFromExportObstacleIds = [];
  if (exportData && exportData.roofState && Array.isArray(exportData.roofState.obstacles)) {
    const expIds = new Set();
    const exp = exportData.roofState.obstacles;
    for (let e = 0; e < exp.length; e++) {
      const row = exp[e];
      if (row && typeof row.id === "string") expIds.add(row.id);
    }
    missingFromExportObstacleIds = nextFull.validObstacleIds.filter((id) => !expIds.has(id));
  }

  const prevLinks = prevFull.livePanLinksByObstacleId || Object.create(null);
  const nextLinks = nextFull.livePanLinksByObstacleId || Object.create(null);
  const detachedFromLivePansObstacleIds = [];
  for (let i = 0; i < prevFull.validObstacleIds.length; i++) {
    const id = prevFull.validObstacleIds[i];
    if (!nextIds.has(id)) continue;
    const pl = nextFull.pointsLengthById[id];
    if (typeof pl !== "number" || pl < 3) continue;
    const pa = prevLinks[id] && prevLinks[id].length > 0;
    const na = nextLinks[id] && nextLinks[id].length > 0;
    if (pa && !na) detachedFromLivePansObstacleIds.push(id);
  }

  return {
    lostGlobalObstacleIds,
    becameInvalidObstacleIds,
    missingFromExportObstacleIds,
    detachedFromLivePansObstacleIds,
  };
}

const TAG = "[CALPINAGE-INTEGRITY][OBSTACLE]";

/**
 * @param {string} checkpoint
 * @param {string} phase
 * @param {ReturnType<typeof diffObstacleIntegrity>} diff
 * @param {Record<string, unknown>} [extra]
 */
export function logObstacleIntegrityIfNeeded(checkpoint, phase, diff, extra) {
  const hard =
    diff.lostGlobalObstacleIds.length > 0 ||
    diff.becameInvalidObstacleIds.length > 0 ||
    diff.missingFromExportObstacleIds.length > 0;
  const soft = diff.detachedFromLivePansObstacleIds.length > 0;
  const verbose =
    typeof window !== "undefined" && window.__CALPINAGE_INTEGRITY_VERBOSE__ === true;
  const lastPv =
    typeof window !== "undefined" && typeof window.__CP_INTEGRITY_LAST_PV_TAG__ === "string"
      ? window.__CP_INTEGRITY_LAST_PV_TAG__
      : null;
  const logDetached = soft && (verbose || lastPv != null);

  if (!hard && !logDetached && !verbose) return;

  const payload = Object.assign(
    {
      checkpoint,
      phase,
      lostGlobalObstacleIds: diff.lostGlobalObstacleIds,
      becameInvalidObstacleIds: diff.becameInvalidObstacleIds,
      missingFromExportObstacleIds: diff.missingFromExportObstacleIds,
      detachedFromLivePansObstacleIds: logDetached ? diff.detachedFromLivePansObstacleIds : [],
    },
    extra || {}
  );

  if (hard) {
    console.warn(TAG, payload);
  } else if (logDetached) {
    console.info(TAG + " cohérence_pans", payload);
  } else if (verbose) {
    console.debug(TAG + " ok", payload);
  }

  const strict =
    typeof window !== "undefined" && window.__CALPINAGE_INTEGRITY_STRICT__ === true;
  if (strict && IS_DEV_BUILD && diff.lostGlobalObstacleIds.length > 0) {
    throw new Error(
      TAG + " STRICT: perte globale obstacles " + diff.lostGlobalObstacleIds.join(",")
    );
  }
}

/**
 * Début buildGeometryForExport (avant computePansFromGeometry).
 * @param {Record<string, unknown>} state
 */
export function obstacleIntegrityOnBuildGeometryStart(state) {
  __buildGeometryBaseline = captureObstacleIntegrityFull(state);
}

export function obstacleIntegrityClearBuildGeometryBaseline() {
  __buildGeometryBaseline = null;
}

/**
 * Fin buildGeometryForExport réussie.
 * @param {Record<string, unknown>} state
 * @param {unknown} exportData
 */
export function obstacleIntegrityOnBuildGeometryEnd(state, exportData) {
  if (!__buildGeometryBaseline) return;
  const prev = __buildGeometryBaseline;
  __buildGeometryBaseline = null;
  const next = captureObstacleIntegrityFull(state);
  const diff = diffObstacleIntegrity(prev, next, exportData);
  const lastPv =
    typeof window !== "undefined" && window.__CP_INTEGRITY_LAST_PV_TAG__ != null
      ? window.__CP_INTEGRITY_LAST_PV_TAG__
      : null;
  logObstacleIntegrityIfNeeded("buildGeometryForExport", lastPv || "geometry_export", diff, {
    lastPvAction: lastPv,
    prevObstacleCount: prev.totalCount,
    nextObstacleCount: next.totalCount,
  });
  if (typeof window !== "undefined") {
    try {
      delete window.__CP_INTEGRITY_LAST_PV_TAG__;
    } catch (_e) {}
  }
}

/**
 * @param {Record<string, unknown>} state
 */
export function obstacleIntegrityOnPansCoreBegin(state) {
  __pansCoreBaseline = captureObstacleIntegrityFull(state);
}

/**
 * @param {Record<string, unknown>} state
 */
export function obstacleIntegrityOnPansCoreEnd(state) {
  if (!__pansCoreBaseline) return;
  const prev = __pansCoreBaseline;
  __pansCoreBaseline = null;
  const next = captureObstacleIntegrityFull(state);
  const diff = diffObstacleIntegrity(prev, next, null);
  const verbose =
    typeof window !== "undefined" && window.__CALPINAGE_INTEGRITY_VERBOSE__ === true;
  const hard =
    diff.lostGlobalObstacleIds.length > 0 ||
    diff.becameInvalidObstacleIds.length > 0;
  const soft = diff.detachedFromLivePansObstacleIds.length > 0;
  if (!hard && !(soft && verbose)) return;

  logObstacleIntegrityIfNeeded(
    "computePansFromGeometryCore",
    "pans_core",
    {
      lostGlobalObstacleIds: diff.lostGlobalObstacleIds,
      becameInvalidObstacleIds: diff.becameInvalidObstacleIds,
      missingFromExportObstacleIds: [],
      detachedFromLivePansObstacleIds:
        hard || verbose ? diff.detachedFromLivePansObstacleIds : [],
    },
    { prevValidCount: prev.validObstacleIds.length, nextValidCount: next.validObstacleIds.length }
  );

  const strict =
    typeof window !== "undefined" && window.__CALPINAGE_INTEGRITY_STRICT__ === true;
  if (strict && IS_DEV_BUILD && diff.lostGlobalObstacleIds.length > 0) {
    throw new Error(TAG + " STRICT: perte globale après computePansFromGeometryCore");
  }
}

/**
 * @param {string} tag ex. removeBlock | removePanel | confirmAutofill
 */
export function obstacleIntegrityNotifyPvAction(tag) {
  if (typeof window === "undefined") return;
  window.__CP_INTEGRITY_LAST_PV_TAG__ = tag;
}
