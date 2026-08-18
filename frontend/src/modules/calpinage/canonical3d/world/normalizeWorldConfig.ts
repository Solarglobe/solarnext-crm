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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function finitePositiveNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function readNestedRecord(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | null {
  let current: unknown = root;
  for (const key of path) {
    const rec = asRecord(current);
    if (!rec) return null;
    current = rec[key];
  }
  return asRecord(current);
}

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
  const root = state as Record<string, unknown>;
  const roof = asRecord(root.roof);
  const roofState = asRecord(root.roofState);
  const validatedRoofData = asRecord(root.validatedRoofData);

  const mpp =
    finitePositiveNumber(readNestedRecord(root, ["roof", "scale"])?.metersPerPixel) ??
    finitePositiveNumber(readNestedRecord(root, ["roofState", "canonical3DWorldContract"])?.metersPerPixel) ??
    finitePositiveNumber(readNestedRecord(root, ["roofState", "scale"])?.metersPerPixel) ??
    finitePositiveNumber(readNestedRecord(root, ["validatedRoofData", "scale"])?.metersPerPixel);
  if (mpp === undefined) return null;

  const northAngleDeg =
    finiteNumber(readNestedRecord(root, ["roof", "roof", "north"])?.angleDeg) ??
    finiteNumber(readNestedRecord(root, ["roofState", "canonical3DWorldContract"])?.northAngleDeg) ??
    finiteNumber(readNestedRecord(root, ["roofState", "roof", "north"])?.angleDeg) ??
    finiteNumber(readNestedRecord(root, ["validatedRoofData", "north", "north"])?.angleDeg);

  const contract =
    asRecord(roof?.canonical3DWorldContract) ??
    asRecord(roofState?.canonical3DWorldContract) ??
    asRecord(validatedRoofData?.canonical3DWorldContract);

  let referenceFrame: "LOCAL_IMAGE_ENU" | undefined;
  if (
    contract?.referenceFrame === "LOCAL_IMAGE_ENU" &&
    finitePositiveNumber(contract.metersPerPixel) !== undefined &&
    finiteNumber(contract.northAngleDeg) !== undefined &&
    northAngleDeg !== undefined &&
    Math.abs(Number(contract.metersPerPixel) - mpp) <= MPP_CONTRACT_DRIFT_EPS &&
    Math.abs(Number(contract.northAngleDeg) - northAngleDeg) <= NORTH_CONTRACT_DRIFT_EPS
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
