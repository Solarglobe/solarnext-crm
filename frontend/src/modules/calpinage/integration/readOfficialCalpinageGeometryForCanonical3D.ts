/**
 * Source unique de vérité géométrique 2D → chaîne 3D canonical (runtime calpinage).
 *
 * ## Audit des lectures concurrentes (référence produit)
 *
 * | Fichier | Fonction | Source lue | Rôle | Politique |
 * |---------|----------|------------|------|-----------|
 * | `readOfficialCalpinageGeometryForCanonical3D.ts` | `readOfficialRoofPanRecordsForCanonical3D` | `state.pans` puis `roof.roofPans` | Liste pans officielle | **OUI — seule API pans pour 3D** |
 * | `buildCanonicalPans3DFromRuntime.ts` | `buildCanonicalPans3DFromRuntime` | via reader ci-dessus | Pans 3D canoniques | OUI |
 * | `calpinageStateToLegacyRoofInput.ts` | `calpinageStateToLegacyRoofInput` | via reader + `roof.scale` / `roof.roof.north` | Legacy riche | OUI |
 * | `mapCalpinageToCanonicalNearShading.ts` | `mapCalpinageRoofToLegacyRoofGeometryInput` | idem + fallback | Legacy pipeline 3D | OUI |
 * | `buildCanonicalScene3DInput.ts` | `prepareCanonicalPans3DFromCalpinageState` | state (pans via runtime) | Scène 3D | OUI |
 * | `fallbackMinimalHouse3D.ts` | `extractBuildingContourPolygonPx` | `state.contours` | Repli emprise | OUI |
 * | `calpinageStructuralRoofFromRuntime.ts` | `resolveCalpinageStructuralRoofForCanonicalChain` | `state` / `structural` | ridges/traits | OUI |
 * | `parseCalpinageStateToCanonicalHouse3D.ts` | parse document | `state.pans`, contours… | Document maison (hors pipeline produit SolarScene3D) | Parallèle, non bloquant produit |
 * | `phase2RoofDerivedModel.js` | `syncRoofPansMirrorFromPans` | `state.pans` → écrit `roof.roofPans` | Miroir affichage / legacy | **Dérivé — ne pas lire en priorité** |
 *
 * ## Règle produit
 *
 * - **Primaire** : `CALPINAGE_STATE.pans`, `contours`, `ridges`, `traits`, `roof.scale`, `roof.roof.north.angleDeg`, `roof.canonical3DWorldContract`.
 * - **Non officiel** : `roof.roofPans` — autorisé uniquement en **compatibilité** quand `state.pans` est vide, avec avertissement explicite.
 *
 * ## Chaîne produit (`buildSolarScene3DFromCalpinageRuntime`)
 *
 * `readStrictStatePansForProduct3D` : **uniquement** `state.pans` (non vide). Aucune lecture du miroir `roof.roofPans`.
 */

export type OfficialRoofPanPrimaryField = "state.pans" | "roof.roofPans_compatibility_only";

/** Produit strict : source = racine `state.pans` seule. */
export type ProductStrictRoofPanPrimaryField = "state.pans";

export type OfficialRoofPanReadResult = {
  readonly pans: readonly Record<string, unknown>[];
  readonly primaryField: OfficialRoofPanPrimaryField;
  /** true si la liste provient du miroir (state.pans absent ou vide). */
  readonly usedRoofRoofPansMirror: boolean;
  readonly geometryWarnings: readonly string[];
};

/**
 * Liste des pans toiture pour la chaîne 3D : **state.pans** d’abord, jamais l’inverse silencieux.
 */
export function readOfficialRoofPanRecordsForCanonical3D(state: unknown): OfficialRoofPanReadResult {
  const geometryWarnings: string[] = [];
  if (!state || typeof state !== "object") {
    return {
      pans: [],
      primaryField: "state.pans",
      usedRoofRoofPansMirror: false,
      geometryWarnings: ["OFFICIAL_GEOMETRY_STATE_MISSING"],
    };
  }
  const s = state as Record<string, unknown>;
  const live = s.pans;
  if (Array.isArray(live) && live.length > 0) {
    const roof = s.roof;
    if (roof && typeof roof === "object") {
      const rp = (roof as Record<string, unknown>).roofPans;
      if (Array.isArray(rp) && rp.length > 0 && rp.length !== live.length) {
        geometryWarnings.push(
          `OFFICIAL_GEOMETRY_MIRROR_LENGTH_MISMATCH: roof.roofPans.length=${rp.length} !== state.pans.length=${live.length} — source officielle = state.pans`,
        );
      }
    }
    return {
      pans: live as Record<string, unknown>[],
      primaryField: "state.pans",
      usedRoofRoofPansMirror: false,
      geometryWarnings,
    };
  }

  const roof = s.roof;
  if (roof && typeof roof === "object") {
    const rp = (roof as Record<string, unknown>).roofPans;
    if (Array.isArray(rp) && rp.length > 0) {
      geometryWarnings.push(
        "COMPATIBILITY_USED_ROOF_ROOFPANS: state.pans absent ou vide — lecture du miroir roof.roofPans (non officiel, compatibilité)",
      );
      return {
        pans: rp as Record<string, unknown>[],
        primaryField: "roof.roofPans_compatibility_only",
        usedRoofRoofPansMirror: true,
        geometryWarnings,
      };
    }
  }

  return {
    pans: [],
    primaryField: "state.pans",
    usedRoofRoofPansMirror: false,
    geometryWarnings,
  };
}

export type StrictStatePanReadResult = {
  readonly pans: readonly Record<string, unknown>[];
  readonly primaryField: ProductStrictRoofPanPrimaryField;
  readonly geometryWarnings: readonly string[];
};

/**
 * Lecture **produit** : seulement `CALPINAGE_STATE.pans` non vide. Ne lit jamais `roof.roofPans`.
 */
export function readStrictStatePansForProduct3D(state: unknown): StrictStatePanReadResult {
  const geometryWarnings: string[] = [];
  if (!state || typeof state !== "object") {
    return {
      pans: [],
      primaryField: "state.pans",
      geometryWarnings: ["PRODUCT_STRICT_STATE_PANS:STATE_MISSING"],
    };
  }
  const s = state as Record<string, unknown>;
  const roof = s.roof;
  if (roof && typeof roof === "object") {
    const rp = (roof as Record<string, unknown>).roofPans;
    if (Array.isArray(rp) && rp.length > 0) {
      const live = s.pans;
      if (!Array.isArray(live) || live.length === 0) {
        geometryWarnings.push(
          "PRODUCT_STRICT_STATE_PANS:ROOF_ROOFPANS_PRESENT_BUT_STATE_PANS_EMPTY — miroir ignoré, fournir state.pans",
        );
      } else if (live.length !== rp.length) {
        geometryWarnings.push(
          `PRODUCT_STRICT_PANS_MIRROR_LENGTH_MISMATCH: roof.roofPans.length=${rp.length} !== state.pans.length=${live.length}`,
        );
      }
    }
  }
  const live = s.pans;
  if (!Array.isArray(live)) {
    geometryWarnings.push("PRODUCT_STRICT_STATE_PANS:NOT_ARRAY");
    return { pans: [], primaryField: "state.pans", geometryWarnings };
  }
  if (live.length === 0) {
    geometryWarnings.push("PRODUCT_STRICT_STATE_PANS:EMPTY_ARRAY");
    return { pans: [], primaryField: "state.pans", geometryWarnings };
  }
  return {
    pans: live as Record<string, unknown>[],
    primaryField: "state.pans",
    geometryWarnings,
  };
}

export type ParseCalpinageRuntimeToCanonical3DGeometryTruthContext = {
  readonly productStrictStatePans?: boolean;
};

export type ParseCalpinageRuntimeToCanonical3DGeometryTruthResult = {
  readonly officialPanRead: OfficialRoofPanReadResult;
  /** Identifiant stable du parseur officiel (audit / logs). */
  readonly canonicalSourceBuilder: "readOfficialCalpinageGeometryForCanonical3D@v1";
  /** Présent uniquement si `productStrictStatePans` — lecture stricte racine. */
  readonly strictProductPanRead?: StrictStatePanReadResult;
};

/**
 * Point d’entrée unique de **lecture** runtime → métadonnées de vérité géométrique (pas de build 3D).
 */
export function parseCalpinageRuntimeToCanonical3DGeometryTruth(
  state: unknown,
  context?: ParseCalpinageRuntimeToCanonical3DGeometryTruthContext,
): ParseCalpinageRuntimeToCanonical3DGeometryTruthResult {
  const productStrict = context?.productStrictStatePans === true;
  if (!productStrict) {
    return {
      officialPanRead: readOfficialRoofPanRecordsForCanonical3D(state),
      canonicalSourceBuilder: "readOfficialCalpinageGeometryForCanonical3D@v1",
    };
  }
  const strict = readStrictStatePansForProduct3D(state);
  const officialPanRead: OfficialRoofPanReadResult = {
    pans: strict.pans,
    primaryField: "state.pans",
    usedRoofRoofPansMirror: false,
    geometryWarnings: [...strict.geometryWarnings],
  };
  return {
    officialPanRead,
    canonicalSourceBuilder: "readOfficialCalpinageGeometryForCanonical3D@v1",
    strictProductPanRead: strict,
  };
}

/** Diagnostic stable : provenance géométrique pipeline 3D produit. */
export type Canonical3DGeometryProvenanceDiagnostics = {
  readonly geometryTruthSource: "STATE_PANS" | "STATE_CONTOURS_FALLBACK";
  readonly usedRoofRoofPansMirror: boolean;
  readonly usedCompatibilityFallback: boolean;
  readonly canonicalSourceBuilder: string;
  readonly roofModelBuildCount: number;
  readonly geometryWarnings: readonly string[];
};

export function emptyCanonical3DGeometryProvenance(
  runtime: unknown,
  roofModelBuildCount = 0,
  context?: ParseCalpinageRuntimeToCanonical3DGeometryTruthContext,
): Canonical3DGeometryProvenanceDiagnostics {
  const g = parseCalpinageRuntimeToCanonical3DGeometryTruth(runtime, context);
  return {
    geometryTruthSource: "STATE_PANS",
    usedRoofRoofPansMirror: g.officialPanRead.usedRoofRoofPansMirror,
    usedCompatibilityFallback: g.officialPanRead.usedRoofRoofPansMirror,
    canonicalSourceBuilder: g.canonicalSourceBuilder,
    roofModelBuildCount,
    geometryWarnings: [...g.officialPanRead.geometryWarnings],
  };
}
