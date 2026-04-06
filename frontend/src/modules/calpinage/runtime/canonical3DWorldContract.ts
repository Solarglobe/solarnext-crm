/**
 * Contrat monde officiel pour la chaîne canonical3d — porté par `CALPINAGE_STATE.roof`.
 *
 * Source de vérité géométrique reste `roof.scale.metersPerPixel` + `roof.roof.north.angleDeg` (runtime legacy).
 * `canonical3DWorldContract` est un miroir explicite, sérialisable, recalculé quand ces valeurs changent.
 *
 * @see docs/architecture/canonical3d-world-contract-runtime.md
 */

export const CANONICAL_3D_REFERENCE_FRAME = "LOCAL_IMAGE_ENU" as const;

/** Garder aligné avec `normalizeWorldConfig.ts` (`peekCalpinageRuntimeWorldFrame`). */
export const MPP_CONTRACT_DRIFT_EPS = 1e-9;
export const NORTH_CONTRACT_DRIFT_EPS = 1e-6;

export type Canonical3DWorldContract = {
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly referenceFrame: typeof CANONICAL_3D_REFERENCE_FRAME;
  /** Version du schéma du bloc (audit / migrations futures). */
  readonly schemaVersion: 1;
};

export type Canonical3DWorldContractApplyStatus =
  | "complete"
  | "missing_meters_per_pixel"
  | "invalid_meters_per_pixel"
  | "missing_north_angle"
  | "invalid_north_angle";

export type Canonical3DWorldContractDiagnostics = {
  readonly status: Canonical3DWorldContractApplyStatus;
  /** Présent uniquement si status === "complete". */
  readonly contract: Canonical3DWorldContract | null;
  /** Codes stables pour logs / UI (pas d’i18n ici). */
  readonly codes: readonly string[];
};

function isFinitePositiveMpp(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isFiniteNorthDeg(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Lit les métriques monde actuellement portées par le sous-objet `roof` du state (pas de défaut silencieux).
 */
export function readRoofAuthoritativeWorldMetrics(roof: unknown): {
  readonly metersPerPixel: number | null;
  readonly northAngleDeg: number | null;
} {
  if (!roof || typeof roof !== "object") {
    return { metersPerPixel: null, northAngleDeg: null };
  }
  const r = roof as Record<string, unknown>;
  const scale = r.scale as { metersPerPixel?: unknown } | undefined;
  const mpp = scale?.metersPerPixel;
  const roofBlock = r.roof as { north?: { angleDeg?: unknown } } | undefined;
  const northDeg = roofBlock?.north?.angleDeg;

  return {
    metersPerPixel: isFinitePositiveMpp(mpp) ? mpp : null,
    northAngleDeg: isFiniteNorthDeg(northDeg) ? northDeg : null,
  };
}

function buildCodes(status: Canonical3DWorldContractApplyStatus): readonly string[] {
  switch (status) {
    case "complete":
      return ["CANONICAL_WORLD_CONTRACT_OK"];
    case "missing_meters_per_pixel":
      return ["CANONICAL_WORLD_CONTRACT_MISSING_MPP"];
    case "invalid_meters_per_pixel":
      return ["CANONICAL_WORLD_CONTRACT_INVALID_MPP"];
    case "missing_north_angle":
      return ["CANONICAL_WORLD_CONTRACT_MISSING_NORTH"];
    case "invalid_north_angle":
      return ["CANONICAL_WORLD_CONTRACT_INVALID_NORTH"];
    default:
      return ["CANONICAL_WORLD_CONTRACT_UNKNOWN"];
  }
}

/**
 * Dérive le statut sans muter `roof`.
 */
export function diagnoseCanonical3DWorldContract(roof: unknown): Canonical3DWorldContractDiagnostics {
  const { metersPerPixel, northAngleDeg } = readRoofAuthoritativeWorldMetrics(roof);

  if (metersPerPixel == null) {
    const scale = roof && typeof roof === "object" ? (roof as Record<string, unknown>).scale : undefined;
    const raw = scale && typeof scale === "object" ? (scale as { metersPerPixel?: unknown }).metersPerPixel : undefined;
    const st =
      raw === undefined || raw === null ? "missing_meters_per_pixel" : "invalid_meters_per_pixel";
    return { status: st, contract: null, codes: buildCodes(st) };
  }
  if (northAngleDeg == null) {
    const r = roof && typeof roof === "object" ? (roof as Record<string, unknown>).roof : undefined;
    const north =
      r && typeof r === "object" ? (r as { north?: { angleDeg?: unknown } }).north : undefined;
    const raw = north && typeof north === "object" ? (north as { angleDeg?: unknown }).angleDeg : undefined;
    const st = raw === undefined || raw === null ? "missing_north_angle" : "invalid_north_angle";
    return { status: st, contract: null, codes: buildCodes(st) };
  }

  const contract: Canonical3DWorldContract = {
    metersPerPixel,
    northAngleDeg,
    referenceFrame: CANONICAL_3D_REFERENCE_FRAME,
    schemaVersion: 1,
  };
  return { status: "complete", contract, codes: buildCodes("complete") };
}

/**
 * Met à jour `roof.canonical3DWorldContract` pour refléter strictement scale + nord.
 * Supprime la clé si le contrat ne peut pas être formé (dossier incomplet / legacy).
 */
export function applyCanonical3DWorldContractToRoof(roof: unknown): Canonical3DWorldContractDiagnostics {
  const diag = diagnoseCanonical3DWorldContract(roof);
  if (!roof || typeof roof !== "object") {
    return diag;
  }
  const r = roof as Record<string, unknown>;
  if (diag.status === "complete" && diag.contract) {
    r.canonical3DWorldContract = { ...diag.contract };
  } else {
    try {
      delete r.canonical3DWorldContract;
    } catch {
      r.canonical3DWorldContract = undefined;
    }
  }
  return diag;
}

/**
 * true si le runtime roof permet la 3D canonique (contrat monde résoluble par peek + normalize).
 */
export function isRoofCanonical3DWorldFrameReady(roof: unknown): boolean {
  return diagnoseCanonical3DWorldContract(roof).status === "complete";
}

export type Canonical3DWorldContractDriftReport = {
  readonly aligned: boolean;
  readonly codes: readonly string[];
  readonly authoritative: ReturnType<typeof readRoofAuthoritativeWorldMetrics>;
  readonly contractSnapshot: {
    readonly metersPerPixel: number | null;
    readonly northAngleDeg: number | null;
    readonly referenceFrame: string | null;
    readonly schemaVersion: number | null;
  } | null;
};

/**
 * Détecte si `roof.canonical3DWorldContract` n’est plus aligné sur `scale` + `roof.roof.north`,
 * ou si un contrat persiste alors que les sources autoritaires sont incomplètes.
 * Lecture seule — ne remplace pas `applyCanonical3DWorldContractToRoof`.
 */
export function getCanonical3DWorldContractDriftReport(roof: unknown): Canonical3DWorldContractDriftReport {
  const authoritative = readRoofAuthoritativeWorldMetrics(roof);
  const authComplete =
    authoritative.metersPerPixel != null && authoritative.northAngleDeg != null;

  if (!roof || typeof roof !== "object") {
    return {
      aligned: true,
      codes: ["CANONICAL_WORLD_DRIFT_SKIP_NO_ROOF"],
      authoritative,
      contractSnapshot: null,
    };
  }

  const r = roof as Record<string, unknown>;
  const rawContract = r.canonical3DWorldContract;
  const contract =
    rawContract && typeof rawContract === "object"
      ? (rawContract as Record<string, unknown>)
      : null;

  const contractSnapshot =
    contract == null
      ? null
      : {
          metersPerPixel:
            typeof contract.metersPerPixel === "number" && Number.isFinite(contract.metersPerPixel)
              ? contract.metersPerPixel
              : null,
          northAngleDeg:
            typeof contract.northAngleDeg === "number" && Number.isFinite(contract.northAngleDeg)
              ? contract.northAngleDeg
              : null,
          referenceFrame:
            typeof contract.referenceFrame === "string" ? contract.referenceFrame : null,
          schemaVersion:
            typeof contract.schemaVersion === "number" && Number.isFinite(contract.schemaVersion)
              ? contract.schemaVersion
              : null,
        };

  if (!authComplete) {
    if (contract == null) {
      return {
        aligned: true,
        codes: ["CANONICAL_WORLD_AUTH_INCOMPLETE_NO_CONTRACT"],
        authoritative,
        contractSnapshot,
      };
    }
    return {
      aligned: false,
      codes: ["CANONICAL_WORLD_DRIFT_ORPHAN_CONTRACT"],
      authoritative,
      contractSnapshot,
    };
  }

  if (contract == null) {
    return {
      aligned: false,
      codes: ["CANONICAL_WORLD_DRIFT_MISSING_MIRROR"],
      authoritative,
      contractSnapshot: null,
    };
  }

  const codes: string[] = [];

  if (contract.referenceFrame !== CANONICAL_3D_REFERENCE_FRAME) {
    codes.push("CANONICAL_WORLD_DRIFT_REFERENCE_FRAME");
  }
  if (contract.schemaVersion !== 1) {
    codes.push("CANONICAL_WORLD_DRIFT_SCHEMA_VERSION");
  }

  const cMpp = contractSnapshot?.metersPerPixel;
  const cNorth = contractSnapshot?.northAngleDeg;
  if (
    cMpp == null ||
    !Number.isFinite(cMpp) ||
    cMpp <= 0 ||
    Math.abs(cMpp - authoritative.metersPerPixel!) > MPP_CONTRACT_DRIFT_EPS
  ) {
    codes.push("CANONICAL_WORLD_DRIFT_METERS_PER_PIXEL");
  }
  if (
    cNorth == null ||
    !Number.isFinite(cNorth) ||
    Math.abs(cNorth - authoritative.northAngleDeg!) > NORTH_CONTRACT_DRIFT_EPS
  ) {
    codes.push("CANONICAL_WORLD_DRIFT_NORTH_ANGLE");
  }

  return {
    aligned: codes.length === 0,
    codes,
    authoritative,
    contractSnapshot,
  };
}
