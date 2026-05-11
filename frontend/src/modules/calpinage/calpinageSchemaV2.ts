/**
 * Phase 5 — Schema V2 : migration calpinage_meta.version → "CALPINAGE_V2".
 *
 * Ce module est la source de vérité pour :
 *   - Les types CalpinageMetaV1 / CalpinageMetaV2 / CalpinageMetaAny
 *   - La migration load-time (V1 → V2, meta absente → recompute)
 *   - La normalisation des données legacy (coordonnées x/y → xPx/yPx, frozenBlocks absent)
 *   - La stratégie de backup V1 (rollback 30 jours)
 *
 * Ordre d\'appel attendu au chargement :
 *   1. Lire localStorage → loadedData (JSON parsé)
 *   2. applyCalpinageV2MigrationIfNeeded(loadedData, studyId, versionId)
 *      → écrit le backup V1 si nécessaire
 *      → retourne loadedData muté avec calpinage_meta.version = "CALPINAGE_V2"
 *   3. computeReloadDiagnostic(loadedData, liveState)
 *
 * Invariants :
 *   - Aucune modification de schemaVersion, meta.version ou des champs shading
 *   - frozenBlocks absent → traité comme [] (pas d\'erreur)
 *   - coordonnées {x, y} normalisées en {xPx, yPx} sans arrondi flottant
 *   - Aucune référence à window.* (pure TS)
 */

import { getCalpinageScopedKey } from "./calpinageStorage";
import type { CalpinageMetaV2 } from "./integrity/calpinageReloadIntegrity";
import {
  computeGeometryHashFromRoofState,
  computePanelsHashFromFrozenBlocks,
  computeShadingHash,
  isCalpinageMetaV1,
  isCalpinageMetaV2,
  isCalpinageMetaAny,
} from "./integrity/calpinageReloadIntegrity";

// Types et guards ré-exportés depuis integrity (source de vérité unique).
export type { CalpinageMetaV1, CalpinageMetaV2, CalpinageMetaAny } from "./integrity/calpinageReloadIntegrity";
export { isCalpinageMetaV1, isCalpinageMetaV2, isCalpinageMetaAny };

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation des coordonnées legacy (Cas 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise un point legacy {x, y} en {xPx, yPx} si les champs suffixés sont absents.
 * Sans arrondi — copie stricte des valeurs numériques.
 */
function normalizeImagePoint(pt: unknown): unknown {
  if (!pt || typeof pt !== "object") return pt;
  const p = pt as Record<string, unknown>;
  if (typeof p.xPx === "number" && typeof p.yPx === "number") return p; // déjà normalisé
  if (typeof p.x === "number" && typeof p.y === "number") {
    const out: Record<string, unknown> = { xPx: p.x, yPx: p.y };
    if (typeof p.h === "number") out.heightM = p.h;   // h → heightM
    if (typeof p.heightM === "number") out.heightM = p.heightM;
    if (typeof p.id === "string") out.id = p.id;
    return out;
  }
  return p;
}

function normalizeFrozenBlockCoords(blocks: unknown[]): unknown[] {
  return blocks.map((bl) => {
    if (!bl || typeof bl !== "object") return bl;
    const b = bl as Record<string, unknown>;
    const panels = Array.isArray(b.panels)
      ? b.panels.map((p: unknown) => {
          if (!p || typeof p !== "object") return p;
          const q = p as Record<string, unknown>;
          const center = q.center && typeof q.center === "object"
            ? normalizeImagePoint(q.center)
            : q.center;
          return { ...q, center };
        })
      : [];
    return { ...b, panels };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup V1 (rollback 30 jours)
// ─────────────────────────────────────────────────────────────────────────────

const V1_BACKUP_SUFFIX = "state-v1-backup";

function writeV1Backup(
  studyId: string | null | undefined,
  versionId: string | null | undefined,
  rawJson: string,
): void {
  if (!studyId || !versionId || typeof localStorage === "undefined") return;
  // Clé manuelle (pas dans CalpinageBaseKey pour ne pas polluer l\'enum)
  const key = `calpinage:${studyId}:${versionId}:${V1_BACKUP_SUFFIX}`;
  try {
    localStorage.setItem(key, rawJson);
  } catch {
    /* quota exceeded — backup non critique */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration load-time
// ─────────────────────────────────────────────────────────────────────────────

type MigrationResult = {
  /** true si les données ont été modifiées (V1→V2 ou meta recomputée). */
  readonly migrated: boolean;
  /** true si un backup V1 a été écrit en localStorage. */
  readonly backupWritten: boolean;
};

/**
 * Migre `loadedData` vers V2 en mutation, si nécessaire.
 *
 * Cas 1 : calpinage_meta.version === "CALPINAGE_V1" → bump version
 * Cas 2 : calpinage_meta absent → recalcul depuis les données brutes
 * Cas 3 : calpinage_meta.version === "CALPINAGE_V2" → no-op
 * Cas 4 : frozenBlocks absent → traité comme []
 * Cas 5 : coordonnées {x,y} → {xPx,yPx} normalisées
 *
 * @param loadedData  — objet JSON parsé depuis localStorage (muté en place)
 * @param studyId     — pour le backup V1
 * @param versionId   — pour le backup V1
 * @param rawJson     — JSON string original (pour le backup, avant mutation)
 */
export function applyCalpinageV2MigrationIfNeeded(
  loadedData: Record<string, unknown>,
  studyId?: string | null,
  versionId?: string | null,
  rawJson?: string,
): MigrationResult {
  const existingMeta = loadedData.calpinage_meta;

  // Cas 3 : déjà V2
  if (isCalpinageMetaV2(existingMeta)) {
    return { migrated: false, backupWritten: false };
  }

  let backupWritten = false;

  // Cas 4 : frozenBlocks absent → normaliser en []
  if (!Array.isArray(loadedData.frozenBlocks)) {
    loadedData.frozenBlocks = [];
  }

  // Cas 5 : coordonnées {x,y} → {xPx,yPx}
  const normalizedBlocks = normalizeFrozenBlockCoords(loadedData.frozenBlocks as unknown[]);
  loadedData.frozenBlocks = normalizedBlocks;

  // Backup V1 avant toute mutation de calpinage_meta
  if (isCalpinageMetaV1(existingMeta) && rawJson && studyId && versionId) {
    writeV1Backup(studyId, versionId, rawJson);
    backupWritten = true;
  }

  // Cas 1 : V1 → V2 (bump version uniquement, hashes inchangés)
  if (isCalpinageMetaV1(existingMeta)) {
    const v2: CalpinageMetaV2 = {
      ...existingMeta,
      version: "CALPINAGE_V2",
    };
    loadedData.calpinage_meta = v2;
    return { migrated: true, backupWritten };
  }

  // Cas 2 : meta absente → recalcul
  const roofState = loadedData.roofState ?? null;
  const frozen = Array.isArray(loadedData.frozenBlocks) ? loadedData.frozenBlocks : [];
  const shading = loadedData.shading ?? null;

  const geometryHash = computeGeometryHashFromRoofState(roofState);
  const panelsHash = computePanelsHashFromFrozenBlocks(frozen);
  const shadingHash = computeShadingHash(shading);

  const now = new Date().toISOString();
  const recomputedMeta: CalpinageMetaV2 = {
    savedAt: now,
    geometryHash,
    panelsHash,
    shadingHash,
    shadingComputedAt: null,
    shadingSource: shading ? "persisted" : "none",
    shadingValid: false, // conservatif — shading non vérifié
    version: "CALPINAGE_V2",
  };
  loadedData.calpinage_meta = recomputedMeta;
  return { migrated: true, backupWritten };
}
