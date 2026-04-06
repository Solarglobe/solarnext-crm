/**
 * Normalisation STRICTE de la config monde : aucune valeur inventée, aucun tirage depuis le state ici.
 * Le state est lu uniquement par `peekCalpinageRuntimeWorldFrame` (appelant), puis passé explicitement.
 */

import {
  MPP_CONTRACT_DRIFT_EPS,
  NORTH_CONTRACT_DRIFT_EPS,
} from "../../runtime/canonical3DWorldContract";
import {
  type CanonicalWorldConfig,
  isValidCanonicalWorldConfig,
} from "./worldConvention";

/** Codes d’erreur stables pour logs / UI (contrat 3D). */
export const WORLD_CONFIG_ERROR_CODES = {
  WORLD_MPP_MISSING: "WORLD_MPP_MISSING",
  WORLD_NORTH_MISSING: "WORLD_NORTH_MISSING",
  WORLD_REFERENCE_FRAME_MISSING: "WORLD_REFERENCE_FRAME_MISSING",
  WORLD_CONFIG_INVALID: "WORLD_CONFIG_INVALID",
} as const;

export type WorldConfigErrorCode = (typeof WORLD_CONFIG_ERROR_CODES)[keyof typeof WORLD_CONFIG_ERROR_CODES];

export class WorldConfigError extends Error {
  readonly code: WorldConfigErrorCode;

  constructor(code: WorldConfigErrorCode, message: string) {
    super(message);
    this.name = "WorldConfigError";
    this.code = code;
  }
}

export type NormalizeWorldConfigInput = {
  readonly metersPerPixel?: unknown;
  readonly northAngleDeg?: unknown;
  readonly referenceFrame?: unknown;
};

/**
 * Extrait l’échelle / nord / repère depuis un state calpinage sans rien inventer.
 * - `northAngleDeg` : uniquement si `roof.roof.north.angleDeg` est un nombre fini (pas de 0 par défaut).
 * - `referenceFrame` : uniquement si `roof.canonical3DWorldContract` est **cohérent** avec scale + nord :
 *   même `metersPerPixel`, même `northAngleDeg`, et `referenceFrame === "LOCAL_IMAGE_ENU"`.
 *   Évite un repère « affiché » désynchronisé des sources autoritaires (scale / nord).
 */
export function peekCalpinageRuntimeWorldFrame(state: unknown): {
  readonly metersPerPixel: number;
  readonly northAngleDeg: number | undefined;
  readonly referenceFrame: "LOCAL_IMAGE_ENU" | undefined;
} | null {
  if (!state || typeof state !== "object") return null;
  const roof = (state as Record<string, unknown>).roof;
  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;
  const scale = r.scale as { metersPerPixel?: number } | undefined;
  const mpp = scale?.metersPerPixel;
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) return null;

  const roofBlock = r.roof as { north?: { angleDeg?: number } } | undefined;
  const rawNorth = roofBlock?.north?.angleDeg;
  const northAngleDeg =
    typeof rawNorth === "number" && Number.isFinite(rawNorth) ? rawNorth : undefined;

  const contract = r.canonical3DWorldContract as {
    referenceFrame?: unknown;
    metersPerPixel?: unknown;
    northAngleDeg?: unknown;
  } | undefined;

  let referenceFrame: "LOCAL_IMAGE_ENU" | undefined;
  if (
    contract?.referenceFrame === "LOCAL_IMAGE_ENU" &&
    typeof contract.metersPerPixel === "number" &&
    Number.isFinite(contract.metersPerPixel) &&
    contract.metersPerPixel > 0 &&
    typeof contract.northAngleDeg === "number" &&
    Number.isFinite(contract.northAngleDeg) &&
    northAngleDeg !== undefined &&
    Math.abs(contract.metersPerPixel - mpp) <= MPP_CONTRACT_DRIFT_EPS &&
    Math.abs(contract.northAngleDeg - northAngleDeg) <= NORTH_CONTRACT_DRIFT_EPS
  ) {
    referenceFrame = "LOCAL_IMAGE_ENU";
  }

  return { metersPerPixel: mpp, northAngleDeg, referenceFrame };
}

/**
 * Produit une `CanonicalWorldConfig` uniquement si les trois entrées sont réelles et valides.
 * Aucun fallback (pas de nord 0, pas de repère implicite, pas de fusion state ici).
 */
export function normalizeWorldConfig(input: unknown): CanonicalWorldConfig {
  if (input == null || typeof input !== "object") {
    throw new WorldConfigError(
      WORLD_CONFIG_ERROR_CODES.WORLD_CONFIG_INVALID,
      "normalizeWorldConfig: input must be a non-null object",
    );
  }
  const o = input as NormalizeWorldConfigInput;

  const mpp = o.metersPerPixel;
  if (mpp === undefined || mpp === null) {
    throw new WorldConfigError(
      WORLD_CONFIG_ERROR_CODES.WORLD_MPP_MISSING,
      "metersPerPixel is required (finite number > 0)",
    );
  }
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) {
    throw new WorldConfigError(
      WORLD_CONFIG_ERROR_CODES.WORLD_CONFIG_INVALID,
      "metersPerPixel must be a finite number > 0",
    );
  }

  const north = o.northAngleDeg;
  if (north === undefined || north === null) {
    throw new WorldConfigError(
      WORLD_CONFIG_ERROR_CODES.WORLD_NORTH_MISSING,
      "northAngleDeg is required (finite number, degrees)",
    );
  }
  if (typeof north !== "number" || !Number.isFinite(north)) {
    throw new WorldConfigError(
      WORLD_CONFIG_ERROR_CODES.WORLD_CONFIG_INVALID,
      "northAngleDeg must be a finite number",
    );
  }

  const rf = o.referenceFrame;
  if (rf === undefined || rf === null) {
    throw new WorldConfigError(
      WORLD_CONFIG_ERROR_CODES.WORLD_REFERENCE_FRAME_MISSING,
      'referenceFrame must be exactly "LOCAL_IMAGE_ENU"',
    );
  }
  if (rf !== "LOCAL_IMAGE_ENU") {
    throw new WorldConfigError(
      WORLD_CONFIG_ERROR_CODES.WORLD_CONFIG_INVALID,
      `referenceFrame must be LOCAL_IMAGE_ENU, got ${String(rf)}`,
    );
  }

  const config: CanonicalWorldConfig = {
    metersPerPixel: mpp,
    northAngleDeg: north,
    referenceFrame: "LOCAL_IMAGE_ENU",
  };
  if (!isValidCanonicalWorldConfig(config)) {
    throw new WorldConfigError(
      WORLD_CONFIG_ERROR_CODES.WORLD_CONFIG_INVALID,
      "internal validation failed for CanonicalWorldConfig",
    );
  }
  return config;
}
