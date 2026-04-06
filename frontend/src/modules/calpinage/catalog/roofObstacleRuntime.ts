/**
 * Logique runtime : near-shading, GeoEntity3D, création d'obstacles — une seule source de vérité
 * s'appuyant sur le catalogue métier.
 */

import type { GeoEntityType } from "../geometry/geoEntity3D";
import {
  getRoofObstacleCatalogEntry,
  LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M,
  LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M,
  type RoofObstacleCatalogEntry,
} from "./roofObstacleCatalog";

const META_KEY = "businessObstacleId";

function readMeta(o: Record<string, unknown>): Record<string, unknown> | null {
  const m = o.meta;
  if (m && typeof m === "object" && !Array.isArray(m)) return m as Record<string, unknown>;
  return null;
}

/** Identifiant métier obstacle (meta ou racine legacy). */
function resolveBusinessObstacleId(o: Record<string, unknown>): string | null {
  const meta = readMeta(o);
  return (
    (meta && typeof meta[META_KEY] === "string" ? (meta[META_KEY] as string) : null) ||
    (typeof o[META_KEY] === "string" ? (o[META_KEY] as string) : null)
  );
}

/**
 * Zone de non-pose (keepout) : pas de hauteur verticale utile pour near-shading, GeoEntity 3D, etc.
 * Détecté par meta.isShadingObstacle === false ou par entrée catalogue non ombrante.
 */
export function isKeepoutNonShadingObstacle(entity: unknown): boolean {
  if (!entity || typeof entity !== "object") return false;
  const o = entity as Record<string, unknown>;
  const meta = readMeta(o);
  if (meta && meta.isShadingObstacle === false) return true;
  const bid = resolveBusinessObstacleId(o);
  const entry = getRoofObstacleCatalogEntry(bid);
  return !!(entry && entry.isShadingObstacle === false);
}

/** Hauteur explicite sur l'entité (même ordre que le legacy buildNearObstaclesFromState). */
export function readExplicitHeightM(entity: Record<string, unknown>): number | null {
  const h = entity.height as Record<string, unknown> | undefined;
  if (h && typeof h === "object" && typeof (h as { heightM?: unknown }).heightM === "number") {
    const hm = (h as { heightM: number }).heightM;
    if (hm >= 0) return hm;
  }
  if (typeof entity.heightM === "number" && entity.heightM >= 0) return entity.heightM;
  if (typeof entity.heightRelM === "number" && entity.heightRelM >= 0) return entity.heightRelM;
  if (typeof entity.height === "number" && entity.height >= 0) return entity.height;
  if (entity.ridgeHeightRelM != null && typeof entity.ridgeHeightRelM === "number") {
    return entity.ridgeHeightRelM >= 0 ? entity.ridgeHeightRelM : null;
  }
  return null;
}

/**
 * Obstacle 2D métier « non ombrant » : exclusion du calcul near-shading physique.
 */
export function shouldExcludeObstacleFromNearShading(entity: unknown): boolean {
  return isKeepoutNonShadingObstacle(entity);
}

function resolveCatalogDefaultHeightM(entry: RoofObstacleCatalogEntry | null): number | null {
  if (!entry) return null;
  if (entry.isShadingObstacle && typeof entry.defaultHeightM === "number") return entry.defaultHeightM;
  return null;
}

/**
 * Hauteur utilisée pour near-shading (obstacles ombrants 2D uniquement ; keepout → 0, jamais de legacy 1 m).
 */
export function resolveNearShadingHeightM(entity: unknown): number {
  if (!entity || typeof entity !== "object") return LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M;
  const o = entity as Record<string, unknown>;
  if (isKeepoutNonShadingObstacle(o)) return 0;

  const explicit = readExplicitHeightM(o);
  if (explicit !== null) return explicit;

  const bid = resolveBusinessObstacleId(o);
  const entry = getRoofObstacleCatalogEntry(bid);

  const dh = resolveCatalogDefaultHeightM(entry);
  if (dh !== null) return dh;

  const isShadow = o.type === "shadow_volume";
  if (isShadow) return LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M;
  return LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M;
}

/**
 * Hauteur pour normalisation GeoEntity3D — keepout : 0 toujours (champs height* résiduels ignorés).
 */
export function resolveGeoEntityHeightM(entity: Record<string, unknown>, type: GeoEntityType): number {
  if (type === "OBSTACLE" && isKeepoutNonShadingObstacle(entity)) return 0;

  const explicit = readExplicitHeightM(entity);
  if (explicit !== null) return explicit;

  const meta = readMeta(entity);

  if (type === "OBSTACLE") {
    const bid = resolveBusinessObstacleId(entity);
    if (bid) {
      const entry = getRoofObstacleCatalogEntry(bid);
      const dh = resolveCatalogDefaultHeightM(entry);
      if (dh !== null) return dh;
    }
    return LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M;
  }

  if (type === "SHADOW_VOLUME") {
    const bid = typeof meta?.[META_KEY] === "string" ? (meta[META_KEY] as string) : null;
    if (bid) {
      const entry = getRoofObstacleCatalogEntry(bid);
      const dh = resolveCatalogDefaultHeightM(entry);
      if (dh !== null) return dh;
    }
    return LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M;
  }

  if (type === "PV_PANEL" || type === "PAN_SURFACE" || type === "BUILDING_CONTOUR" || type === "ROOF_CONTOUR" || type === "ROOF_EXTENSION") {
    return 0;
  }

  return 0;
}

export function buildObstacleMetaFromCatalogId(businessId: string): Record<string, unknown> {
  const entry = getRoofObstacleCatalogEntry(businessId);
  if (!entry) {
    return { [META_KEY]: businessId, isShadingObstacle: true, category: "opaque_shading" as const };
  }
  return {
    [META_KEY]: entry.id,
    isShadingObstacle: entry.isShadingObstacle,
    category: entry.category,
    label: entry.label,
  };
}

export type ShadowVolumeLegacyShape = "cube" | "tube";

export interface ShadowVolumeCreationPayload {
  shape: ShadowVolumeLegacyShape;
  width: number;
  depth: number;
  height: number;
  meta: Record<string, unknown>;
}

/**
 * Défauts à la création d'un volume ombrant (moteur legacy : cube = prisme, tube = cylindre).
 * Les dimensions restent modifiables par drag comme avant.
 */
export function getShadowVolumeCreationPayload(businessId: string): ShadowVolumeCreationPayload {
  const entry = getRoofObstacleCatalogEntry(businessId);
  const shape: ShadowVolumeLegacyShape =
    entry?.geometryShape === "rect" ? "cube" : "tube";

  let width = 0.6;
  let depth = 0.6;
  let height = entry?.defaultHeightM ?? LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M;

  if (shape === "cube") {
    width = entry?.defaultWidthM ?? 0.6;
    depth = entry?.defaultDepthM ?? 0.6;
  } else {
    const d = entry?.defaultDiameterM ?? 0.35;
    width = d;
    depth = d;
  }

  return {
    shape,
    width,
    depth,
    height,
    meta: buildObstacleMetaFromCatalogId(businessId),
  };
}

/** Anciens volumes sans meta métier : fallback stable pour hauteur / affichage. */
export function resolveLegacyShadowVolumeBusinessId(shape: unknown): string {
  return shape === "tube" ? "legacy_shadow_tube" : "legacy_shadow_cube";
}
