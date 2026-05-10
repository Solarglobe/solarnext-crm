/**
 * Reprise / reload : hashes stables, méta sauvegarde, diagnostic — observation uniquement.
 * Aucun recalcul shading, aucune mutation des données métier.
 */

export type CalpinageMetaV1 = {
  savedAt: string;
  geometryHash: string;
  panelsHash: string;
  shadingHash: string;
  shadingComputedAt: string | null;
  shadingSource: "persisted" | "none";
  shadingValid: boolean;
  version: "CALPINAGE_V1";
};

/** Meta V2 — Phase 5+. Mêmes champs, version bumpée. */
export type CalpinageMetaV2 = {
  savedAt: string;
  geometryHash: string;
  panelsHash: string;
  shadingHash: string;
  shadingComputedAt: string | null;
  shadingSource: "persisted" | "none";
  shadingValid: boolean;
  version: "CALPINAGE_V2";
};

export type CalpinageMetaAny = CalpinageMetaV1 | CalpinageMetaV2;

export function isCalpinageMetaV1(x: unknown): x is CalpinageMetaV1 {
  return !!x && typeof x === "object" && (x as Record<string, unknown>).version === "CALPINAGE_V1";
}

export function isCalpinageMetaV2(x: unknown): x is CalpinageMetaV2 {
  return !!x && typeof x === "object" && (x as Record<string, unknown>).version === "CALPINAGE_V2";
}

export function isCalpinageMetaAny(x: unknown): x is CalpinageMetaAny {
  return isCalpinageMetaV1(x) || isCalpinageMetaV2(x);
}

export type ReloadDiagnostic = {
  geometryMatch: boolean | null;
  panelsMatch: boolean | null;
  shadingMatch: boolean | null;
  shadingStale: boolean;
  reason: "OK" | "NO_CALPINAGE_META_LEGACY" | "GEOMETRY_CHANGED" | "PANELS_CHANGED" | "SHADING_OUTDATED" | "MULTIPLE_DRIFT" | "PARTIAL";
};

export type CalpinageStateStatus = {
  isConsistent: boolean;
  hasStaleShading: boolean;
  hasGeometryDrift: boolean;
  hasPanelDrift: boolean;
};

export type RestoreStats = {
  panelsRestored: number;
  panelsSkipped: number;
  frozenBlocksRestored: number;
  frozenBlocksSkipped: number;
};

const FNV_OFFSET = 0x811c9dc5;

function fnv1a32Hex(str: string): string {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function sortKeysDeep(x: unknown): unknown {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "function" || typeof v === "symbol") continue;
    out[k] = sortKeysDeep(v);
  }
  return out;
}

function stableSerialize(obj: unknown): string {
  try {
    return JSON.stringify(sortKeysDeep(obj));
  } catch {
    return '"<unserializable>"';
  }
}

/** Empreinte image légère (évite hasher tout le data URL). */
function imageFingerprint(img: unknown): unknown {
  if (!img || typeof img !== "object") return null;
  const im = img as Record<string, unknown>;
  const dataUrl = im.dataUrl;
  if (typeof dataUrl === "string" && dataUrl.length > 0) {
    return {
      width: im.width,
      height: im.height,
      len: dataUrl.length,
      head: dataUrl.slice(0, 80),
      tail: dataUrl.slice(-80),
    };
  }
  return { width: im.width, height: im.height };
}

/**
 * Hash géométrie aligné sur l'export `roofState` (buildGeometryForExport).
 */
export function computeGeometryHashFromRoofState(roofState: unknown): string {
  if (!roofState || typeof roofState !== "object") return fnv1a32Hex("roof:empty");
  const rs = roofState as Record<string, unknown>;
  const slim = {
    map: rs.map,
    scale: rs.scale,
    roof: rs.roof,
    gps: rs.gps,
    contoursBati: rs.contoursBati,
    traits: rs.traits,
    mesures: rs.mesures,
    ridges: rs.ridges,
    planes: rs.planes,
    obstacles: rs.obstacles,
    image: imageFingerprint(rs.image),
  };
  return fnv1a32Hex(stableSerialize(slim));
}

/**
 * Sérialisation d'un frozenBlock pour le calcul du hash panneaux.
 *
 * RÈGLE ABSOLUE : cette fonction doit produire une structure JSON identique à celle
 * de `computePanelsHash()` dans `calpinage.module.js` (legacy), qui calcule le hash
 * au moment de la sauvegarde (stocké dans `calpinage_meta.panelsHash`).
 *
 * Toute divergence crée un faux positif `hasPanelDrift = true` au rechargement.
 *
 * Alignements explicites sur le legacy (P0.4) :
 *   - `id`          : `bl.id || null`      (legacy: `bl.id || null`)
 *   - `panId`       : `bl.panId || null`   (legacy: `bl.panId || null`)
 *   - `rotation`    : normalisation numérique explicite -> `null` si absent
 *                     (legacy: `typeof bl.rotation === "number" ? bl.rotation : null`)
 *   - `orientation` : valeur brute `|| null`, PAS de normalisation casse
 *                     (legacy: `bl.orientation || null`)
 *                     Raison : le hash de référence a été calculé sur la valeur en mémoire
 *                     telle quelle -- normaliser "portrait" -> "PORTRAIT" ici divergerait des
 *                     études historiques dont le hash legacy est sur la valeur minuscule.
 */
function mapBlockForPanelsHash(bl: Record<string, unknown>): Record<string, unknown> {
  const panels = Array.isArray(bl.panels) ? bl.panels : [];
  return {
    id: bl.id || null,
    panId: bl.panId || null,
    panels: panels.map((p: unknown) => {
      const q = p as Record<string, unknown>;
      return {
        // Alignement exact legacy (P0.4-b) :
        //   center/projection : null si absent ou non-objet (legacy: `p.center && typeof p.center === 'object' ? p.center : null`)
        //   state             : null si undefined             (legacy: `p.state ?? null`)
        center: q.center && typeof q.center === "object" ? q.center : null,
        projection: q.projection && typeof q.projection === "object" ? q.projection : null,
        state: q.state ?? null,
        enabled: q.enabled !== false,
        localRotationDeg: typeof q.localRotationDeg === "number" ? q.localRotationDeg : 0,
      };
    }),
    rotation: typeof bl.rotation === "number" ? bl.rotation : null,
    orientation: bl.orientation || null,
    useScreenAxes: bl.useScreenAxes === true,
  };
}

/** Hash placement PV (frozenBlocks sérialisés comme à l'export). */
export function computePanelsHashFromFrozenBlocks(frozenBlocks: unknown): string {
  if (!Array.isArray(frozenBlocks)) return fnv1a32Hex("fb:[]");
  const blocks = frozenBlocks
    .filter((b) => b && typeof b === "object")
    .map((b) => mapBlockForPanelsHash(b as Record<string, unknown>))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return fnv1a32Hex(stableSerialize(blocks));
}

/** Hash ombrage normalisé (KPI + perPanel triés). */
export function computeShadingHash(shading: unknown): string {
  if (!shading || typeof shading !== "object") return fnv1a32Hex("sh:null");
  const s = shading as Record<string, unknown>;
  const perRaw = Array.isArray(s.perPanel) ? s.perPanel : [];
  const perPanel = [...perRaw]
    .map((p) => {
      const q = p as Record<string, unknown>;
      const id = q.panelId ?? q.id;
      return { id: id != null ? String(id) : "", l: q.lossPct };
    })
    .filter((x) => x.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const slim = {
    combined: s.combined,
    near: s.near && typeof s.near === "object" ? { totalLossPct: (s.near as Record<string, unknown>).totalLossPct } : s.near,
    far: s.far && typeof s.far === "object" ? { totalLossPct: (s.far as Record<string, unknown>).totalLossPct } : s.far,
    totalLossPct: s.totalLossPct,
    perPanel,
    computedAt: s.computedAt,
  };
  return fnv1a32Hex(stableSerialize(slim));
}

type BuildMetaOpts = {
  savedAt: string;
  shadingLastComputedAt?: number | null;
  shadingAbortReason?: string | null;
};

export function buildCalpinageMetaForExport(
  exportObj: Record<string, unknown>,
  opts: BuildMetaOpts
): CalpinageMetaV2 {
  const roofState = exportObj.roofState;
  const frozen = exportObj.frozenBlocks;
  const shading = exportObj.shading;
  const geom = computeGeometryHashFromRoofState(roofState);
  const pan = computePanelsHashFromFrozenBlocks(frozen);
  const sh = computeShadingHash(shading);

  let shadingComputedAt: string | null = null;
  if (shading && typeof shading === "object") {
    const shObj = shading as Record<string, unknown>;
    const c = shObj.computedAt;
    if (typeof c === "string") shadingComputedAt = c;
    else if (typeof c === "number" && Number.isFinite(c)) shadingComputedAt = new Date(c).toISOString();
  }
  if (shadingComputedAt == null && opts.shadingLastComputedAt != null && Number.isFinite(opts.shadingLastComputedAt)) {
    shadingComputedAt = new Date(opts.shadingLastComputedAt).toISOString();
  }

  const shadingValid = !opts.shadingAbortReason;

  return {
    savedAt: opts.savedAt,
    geometryHash: geom,
    panelsHash: pan,
    shadingHash: sh,
    shadingComputedAt,
    shadingSource: shading ? "persisted" : "none",
    shadingValid,
    version: "CALPINAGE_V2",
  };
}

type CalpinageStateLike = {
  roof?: Record<string, unknown>;
  contours?: unknown[];
  traits?: unknown[];
  measures?: unknown[];
  ridges?: unknown[];
  planes?: unknown;
  obstacles?: unknown[];
  shading?: { normalized?: unknown; lastAbortReason?: string | null; lastComputedAt?: number | null };
};

/** Reconstruit un `roofState` minimal depuis l'état runtime (même forme que l'export). */
export function buildRoofStateSliceFromCalpinageState(state: CalpinageStateLike): Record<string, unknown> {
  const roof = state.roof || {};
  const contours = Array.isArray(state.contours) ? state.contours : [];
  const traits = Array.isArray(state.traits) ? state.traits : [];
  const mesures = Array.isArray(state.measures) ? state.measures : [];
  const ridges = Array.isArray(state.ridges) ? state.ridges : [];
  const obstacles = Array.isArray(state.obstacles) ? state.obstacles : [];

  return {
    map: roof.map,
    image: roof.image,
    scale: roof.scale,
    roof: roof.roof,
    contoursBati: contours
      .map((c: unknown) => {
        const x = c as Record<string, unknown>;
        return { id: x.id, points: x.points, roofRole: x.roofRole };
      })
      .filter((c) => c.points),
    traits: traits.map((t: unknown) => {
      const x = t as Record<string, unknown>;
      return { id: x.id, a: x.a, b: x.b, roofRole: x.roofRole };
    }),
    mesures,
    ridges: ridges.map((r: unknown) => {
      const x = r as Record<string, unknown>;
      return { id: x.id, a: x.a, b: x.b, roofRole: x.roofRole };
    }),
    planes: state.planes,
    obstacles: obstacles
      .map((o: unknown) => {
        const x = o as Record<string, unknown>;
        if (!x.points || !Array.isArray(x.points) || x.points.length < 3) return null;
        const out: Record<string, unknown> = {
          id: x.id,
          type: "polygon",
          points: (x.points as unknown[]).map((p: unknown) => {
            const pt = p as Record<string, unknown>;
            return { x: pt.x, y: pt.y };
          }),
          roofRole: x.roofRole || null,
          kind: x.kind || "other",
          meta: x.meta && typeof x.meta === "object" ? x.meta : {},
        };
        if (x.shapeMeta && typeof x.shapeMeta === "object") out.shapeMeta = x.shapeMeta;
        if (typeof x.heightM === "number" && Number.isFinite(x.heightM)) out.heightM = x.heightM;
        return out;
      })
      .filter(Boolean),
    gps: roof.gps ?? null,
  };
}

function getEngineFrozenBlocksExport(): unknown[] {
  const w = window as unknown as {
    pvPlacementEngine?: { getFrozenBlocks?: () => unknown[]; getActiveBlock?: () => unknown };
    ActivePlacementBlock?: { getFrozenBlocks?: () => unknown[]; getActiveBlock?: () => unknown };
  };
  const getFrozen =
    w.pvPlacementEngine?.getFrozenBlocks || w.ActivePlacementBlock?.getFrozenBlocks;
  if (typeof getFrozen !== "function") return [];
  const raw = getFrozen();
  const frozen = Array.isArray(raw) ? raw : [];
  // P0.4-c : restoreFrozenBlocks() pop le dernier bloc figé pour en faire le bloc actif.
  // getFrozenBlocks() retourne N-1 blocs au reload alors que le hash de sauvegarde couvrait N blocs.
  // On inclut le bloc actif pour restaurer la parité.
  const getActive =
    w.pvPlacementEngine?.getActiveBlock || w.ActivePlacementBlock?.getActiveBlock;
  if (typeof getActive === "function") {
    const active = getActive() as Record<string, unknown> | null;
    if (active && Array.isArray(active.panels) && (active.panels as unknown[]).length > 0) {
      const inFrozen = frozen.some((b) => b && (b as Record<string, unknown>).id === active.id);
      if (!inFrozen) return [...frozen, active];
    }
  }
  return frozen;
}

export function computeReloadDiagnostic(
  loadedData: Record<string, unknown>,
  liveState: CalpinageStateLike
): { diagnostic: ReloadDiagnostic; status: CalpinageStateStatus; current: { geometryHash: string; panelsHash: string; shadingHash: string } } {
  const meta = loadedData.calpinage_meta as CalpinageMetaAny | undefined;

  const roofSlice = buildRoofStateSliceFromCalpinageState(liveState);
  const curGeom = computeGeometryHashFromRoofState(roofSlice);

  const curPanels = computePanelsHashFromFrozenBlocks(getEngineFrozenBlocksExport());

  const norm = liveState.shading?.normalized;
  const curSh = computeShadingHash(norm ?? null);

  const current = { geometryHash: curGeom, panelsHash: curPanels, shadingHash: curSh };

  if (!meta || typeof meta !== "object" || !isCalpinageMetaAny(meta)) {
    return {
      diagnostic: {
        geometryMatch: null,
        panelsMatch: null,
        shadingMatch: null,
        shadingStale: true,
        reason: "NO_CALPINAGE_META_LEGACY",
      },
      status: {
        isConsistent: false,
        hasStaleShading: true,
        hasGeometryDrift: true,
        hasPanelDrift: true,
      },
      current,
    };
  }

  const geometryMatch = curGeom === meta.geometryHash;
  const panelsMatch = curPanels === meta.panelsHash;
  const shadingMatch = curSh === meta.shadingHash;

  const noComputedAt = meta.shadingComputedAt == null || String(meta.shadingComputedAt).trim() === "";
  const shadingStale =
    !geometryMatch ||
    !panelsMatch ||
    !shadingMatch ||
    noComputedAt ||
    meta.shadingValid === false;

  const drifts: string[] = [];
  if (!geometryMatch) drifts.push("G");
  if (!panelsMatch) drifts.push("P");
  if (!shadingMatch) drifts.push("S");

  let reason: ReloadDiagnostic["reason"] = "OK";
  if (drifts.length > 1) reason = "MULTIPLE_DRIFT";
  else if (!geometryMatch) reason = "GEOMETRY_CHANGED";
  else if (!panelsMatch) reason = "PANELS_CHANGED";
  else if (!shadingMatch || noComputedAt || meta.shadingValid === false) reason = "SHADING_OUTDATED";
  if (drifts.length === 0 && !noComputedAt && meta.shadingValid !== false) reason = "OK";

  const status: CalpinageStateStatus = {
    isConsistent: geometryMatch && panelsMatch && shadingMatch && !noComputedAt && meta.shadingValid !== false,
    hasStaleShading: shadingStale,
    hasGeometryDrift: !geometryMatch,
    hasPanelDrift: !panelsMatch,
  };

  return {
    diagnostic: {
      geometryMatch,
      panelsMatch,
      shadingMatch,
      shadingStale,
      reason: reason === "OK" && drifts.length === 0 ? "OK" : reason === "OK" ? "PARTIAL" : reason,
    },
    status,
    current,
  };
}

/** Ajuste reason si OK mais partial edge */
export function finalizeReloadReason(d: ReloadDiagnostic): ReloadDiagnostic {
  if (d.reason === "PARTIAL" && d.geometryMatch && d.panelsMatch && d.shadingMatch) {
    return { ...d, reason: "OK" };
  }
  return d;
}

export function logReloadIssueIfNeeded(
  diagnostic: ReloadDiagnostic,
  status: CalpinageStateStatus,
  extra?: Record<string, unknown>
): void {
  const bad =
    !status.isConsistent ||
    status.hasStaleShading ||
    status.hasGeometryDrift ||
    status.hasPanelDrift;
  if (!bad) return;
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[CALPINAGE_RELOAD_ISSUE]", {
      geometryMatch: diagnostic.geometryMatch,
      panelsMatch: diagnostic.panelsMatch,
      shadingMatch: diagnostic.shadingMatch,
      shadingStale: diagnostic.shadingStale,
      reason: diagnostic.reason,
      ...extra,
    });
  }
}

const reloadIntegrityApi = {
  computeGeometryHashFromRoofState,
  computePanelsHashFromFrozenBlocks,
  computeShadingHash,
  buildCalpinageMetaForExport,
  buildRoofStateSliceFromCalpinageState,
  computeReloadDiagnostic,
  logReloadIssueIfNeeded,
};

export type CalpinageReloadIntegrityApi = typeof reloadIntegrityApi;

export function attachReloadIntegrityToWindow(): void {
  const w = window as unknown as { __CALPINAGE_RELOAD_INTEGRITY__?: CalpinageReloadIntegrityApi };
  w.__CALPINAGE_RELOAD_INTEGRITY__ = reloadIntegrityApi;
}
