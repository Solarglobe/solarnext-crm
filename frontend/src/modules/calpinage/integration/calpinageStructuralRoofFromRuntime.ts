/**
 * Contrat unique runtime → chaîne canonical3d pour les lignes structurantes toiture
 * (faîtages / arêtiers / traits), aligné sur `CALPINAGE_STATE.ridges` et `CALPINAGE_STATE.traits`.
 *
 * Aucune géométrie inventée : copie / filtre défensif uniquement.
 *
 * @see docs/architecture/canonical3d-structural-roof-runtime.md
 */

/** Pass-through attendu par `mapCalpinageRoofToLegacyRoofGeometryInput` / `calpinageStateToLegacyRoofInput`. */
export type CalpinageStructuralRoofPayload = {
  readonly ridges: readonly unknown[];
  readonly traits: readonly unknown[];
};

export type CalpinageStructuralRoofSource = "explicit" | "explicit_empty" | "runtime_state" | "none";

export type CalpinageStructuralRoofResolution = {
  readonly payload: CalpinageStructuralRoofPayload;
  readonly source: CalpinageStructuralRoofSource;
  readonly stats: {
    readonly ridgeRaw: number;
    readonly traitRaw: number;
    readonly ridgeKept: number;
    readonly traitKept: number;
    readonly ridgeDropped: number;
    readonly traitDropped: number;
  };
  /** Messages stables pour `CanonicalScene3DInput.diagnostics.warnings` ou logs. */
  readonly warnings: readonly string[];
};

/** Longueur minimale du segment (px image) — en dessous = dégénéré, rejet explicite. */
export const DEFAULT_MIN_STRUCTURAL_SEGMENT_PX = 1e-3;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Même critères que l’adaptateur legacy → `LegacyStructuralLine2D`, plus longueur segment > min.
 */
export function structuralRoofLineRawUsable(raw: unknown, minSegmentLenPx: number): boolean {
  if (minSegmentLenPx < 0 || !Number.isFinite(minSegmentLenPx)) return false;
  const o = raw as Record<string, unknown> | null;
  if (!o || o.roofRole === "chienAssis") return false;
  const a = o.a as { x?: number; y?: number } | undefined;
  const b = o.b as { x?: number; y?: number } | undefined;
  if (!a || !b || typeof a.x !== "number" || typeof b.x !== "number") return false;
  const ay = typeof a.y === "number" ? a.y : 0;
  const by = typeof b.y === "number" ? b.y : 0;
  if (!Number.isFinite(a.x) || !Number.isFinite(ay) || !Number.isFinite(b.x) || !Number.isFinite(by)) {
    return false;
  }
  const len = Math.hypot(b.x - a.x, by - ay);
  return len >= minSegmentLenPx;
}

function countPansOnCalpinageState(state: unknown): number {
  if (!state || typeof state !== "object") return 0;
  const s = state as Record<string, unknown>;
  const roof = s.roof;
  if (roof && typeof roof === "object") {
    const rp = (roof as Record<string, unknown>).roofPans;
    if (Array.isArray(rp)) return rp.length;
  }
  const pans = s.pans;
  if (Array.isArray(pans)) return pans.length;
  return 0;
}

function filterStructuralLines(
  items: readonly unknown[],
  minSegmentLenPx: number,
): { kept: unknown[]; dropped: number } {
  const kept: unknown[] = [];
  let dropped = 0;
  for (const raw of items) {
    if (structuralRoofLineRawUsable(raw, minSegmentLenPx)) kept.push(raw);
    else dropped++;
  }
  return { kept, dropped };
}

/**
 * Résout le paquet ridges/traits pour toute la chaîne canonical (scène + `buildSolarScene3DFromCalpinageRuntime`).
 *
 * - `explicit === undefined` : lecture sur `state.ridges` / `state.traits` si `state` défini.
 * - `explicit === null` : forcer l’absence de lignes (override tests / appelant).
 * - `explicit` objet : priorité absolue (sous-ensembles `ridges` / `traits` optionnels).
 */
export type CalpinageStructuralRoofExplicitInput =
  | { readonly ridges?: readonly unknown[]; readonly traits?: readonly unknown[] }
  | null
  | undefined;

export function resolveCalpinageStructuralRoofForCanonicalChain(
  state: unknown | undefined,
  explicit: CalpinageStructuralRoofExplicitInput,
  options?: { minSegmentLenPx?: number },
): CalpinageStructuralRoofResolution {
  const minPx = options?.minSegmentLenPx ?? DEFAULT_MIN_STRUCTURAL_SEGMENT_PX;
  const warnings: string[] = [];

  let source: CalpinageStructuralRoofSource;
  let ridgeRaw: unknown[];
  let traitRaw: unknown[];

  if (explicit === null) {
    source = "explicit_empty";
    ridgeRaw = [];
    traitRaw = [];
  } else if (explicit !== undefined) {
    source = "explicit";
    ridgeRaw = explicit.ridges ? [...explicit.ridges] : [];
    traitRaw = explicit.traits ? [...explicit.traits] : [];
  } else if (state && typeof state === "object") {
    source = "runtime_state";
    const s = state as Record<string, unknown>;
    ridgeRaw = asArray(s.ridges);
    traitRaw = asArray(s.traits);
  } else {
    source = "none";
    ridgeRaw = [];
    traitRaw = [];
  }

  const rF = filterStructuralLines(ridgeRaw, minPx);
  const tF = filterStructuralLines(traitRaw, minPx);

  if (rF.dropped > 0) {
    warnings.push(`STRUCTURAL_ROOF_DROPPED_RIDGES: raw=${ridgeRaw.length} kept=${rF.kept.length} dropped=${rF.dropped}`);
  }
  if (tF.dropped > 0) {
    warnings.push(`STRUCTURAL_ROOF_DROPPED_TRAITS: raw=${traitRaw.length} kept=${tF.kept.length} dropped=${tF.dropped}`);
  }

  const anyKept = rF.kept.length > 0 || tF.kept.length > 0;
  const anyRaw = ridgeRaw.length > 0 || traitRaw.length > 0;
  const panCount = state && typeof state === "object" ? countPansOnCalpinageState(state) : 0;

  if (source === "runtime_state" && !anyRaw && panCount >= 2) {
    warnings.push(
      "STRUCTURAL_ROOF_MULTI_PAN_NO_LINES: multiple pans but no ridges/traits on state — 3D uses pan polygons only",
    );
  } else if (source === "runtime_state" && anyRaw && !anyKept) {
    warnings.push("STRUCTURAL_ROOF_ALL_REJECTED: runtime had structural entries but none passed validation");
  }

  return {
    payload: { ridges: rF.kept, traits: tF.kept },
    source,
    stats: {
      ridgeRaw: ridgeRaw.length,
      traitRaw: traitRaw.length,
      ridgeKept: rF.kept.length,
      traitKept: tF.kept.length,
      ridgeDropped: rF.dropped,
      traitDropped: tF.dropped,
    },
    warnings,
  };
}
