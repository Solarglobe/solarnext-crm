/**
 * Adaptateur principal CALPINAGE_STATE → LegacyRoofGeometryInput.
 *
 * DIFFÉRENCE CRITIQUE vs `mapCalpinageToCanonicalNearShading.ts` (ligne 98-116) :
 *
 *   AVANT (cassé) :
 *     polygonPx = poly.map(pt => ({ xPx: pt.x, yPx: pt.y }))
 *     defaultHeightM: 5  // ← TOITURE PLATE FORCÉE
 *
 *   MAINTENANT (corrigé) :
 *     polygonPx = poly.map(pt => ({
 *       xPx: pt.x, yPx: pt.y,
 *       heightM: uniquement si resolveHeightAtPxRuntime accepte la valeur (isValidH) — sinon omis (B→G)
 *     }))
 *     defaultHeightM: configurable (5.5 par défaut)
 *
 * Ce fichier est une FONCTION PURE (sauf lecture de `window.getHeightAtXY`) :
 * - Aucune dépendance au state React ou à l'IIFE legacy.
 * - Aucun effet de bord (lecture seule sur le runtime).
 * - Testable avec des fixtures JSON (en mockant `window.getHeightAtXY`).
 *
 * Usage depuis le produit :
 *   import { calpinageStateToLegacyRoofInput } from "../../adapter/calpinageStateToLegacyRoofInput";
 *   const input = calpinageStateToLegacyRoofInput(CALPINAGE_STATE.roof, CALPINAGE_STATE.structural);
 *   if (input) {
 *     const model = buildRoofModel3DFromLegacyGeometry(input);
 *     // → modèle 3D avec pentes réelles, non plus toiture plate
 *   }
 *
 * Références :
 *   - `pans-bundle.js` lignes 1175-1194 : `CalpinagePans.getHeightAtXY` (fitPlane)
 *   - `canonical3d/builder/legacyInput.ts` : contrat de sortie
 *   - `docs/architecture/3d-convergence-plan.md` § Étape 2 : cet adaptateur EST le maillon manquant
 */

import type {
  LegacyImagePoint2D,
  LegacyPanInput,
  LegacyRoofGeometryInput,
  LegacyStructuralLine2D,
} from "../canonical3d/builder/legacyInput";
import { isRuntimeHeightResolverAvailable } from "./resolveHeightsFromRuntime";
import { resolveHeightAtPxRuntime } from "../core/heightResolver";
import {
  DEFAULT_MIN_STRUCTURAL_SEGMENT_PX,
  structuralRoofLineRawUsable,
} from "../integration/calpinageStructuralRoofFromRuntime";

// ─── Options ───────────────────────────────────────────────────────────────

export interface CalpinageRoofAdapterOptions {
  /**
   * Hauteur par défaut (m) utilisée si `window.getHeightAtXY` ne retourne rien pour un sommet.
   * Moyenne entre gouttière (4m) et faîtage (7m).
   * @default 5.5
   */
  defaultHeightM?: number;
  /**
   * Si true, log un warning console si le résolveur runtime n'est pas disponible.
   * Désactiver en tests unitaires (fixtures JSON sans window).
   * @default true
   */
  warnIfNoRuntime?: boolean;
}

// ─── Helpers internes ──────────────────────────────────────────────────────

/**
 * Hauteur injectable dans le legacy : uniquement si le moteur canonique l’accepte (isValidH).
 * Aucun repli vers `resolveHeightAtPx` (contournait le filtre et laissait passer des Z aberrants).
 */
function legacyHeightMFromValidatedRuntime(
  panId: string,
  xPx: number,
  yPx: number,
): number | undefined {
  const hRuntime = resolveHeightAtPxRuntime(panId, xPx, yPx);
  if (import.meta.env.DEV && !Number.isFinite(hRuntime)) {
    console.warn("[HEIGHT_REJECTED]", { panId, xPx, yPx });
  }
  return Number.isFinite(hRuntime) ? hRuntime : undefined;
}

/**
 * Mappe un point d'extrémité de ligne structurante vers `LegacyImagePoint2D`
 * en résolvant la hauteur via le runtime si possible.
 *
 * `panIdHint` : ID du pan le plus proche (approximation pour le ridge/trait).
 * Les faîtages sont partagés entre deux pans — on passe l'ID du ridge lui-même
 * car `window.getHeightAtXY` accepte des IDs non-pan (retourne undefined → fallback OK).
 */
function mapEndpointWithHeight(
  raw: { x?: unknown; y?: unknown } | null | undefined,
  panIdHint: string,
): LegacyImagePoint2D {
  const xPx = typeof raw?.x === "number" ? raw.x : 0;
  const yPx = typeof raw?.y === "number" ? raw.y : 0;
  const heightM = legacyHeightMFromValidatedRuntime(panIdHint, xPx, yPx);
  return { xPx, yPx, ...(heightM !== undefined ? { heightM } : {}) };
}

/**
 * Mappe les faîtages/arêtiers legacy → `LegacyStructuralLine2D[]`.
 * Filtre `roofRole === "chienAssis"` (extensions, pas de l'enveloppe principale).
 * Les extrémités reçoivent un `heightM` résolu si disponible.
 */
function mapRidgesWithHeights(ridges: unknown[] | undefined): LegacyStructuralLine2D[] {
  if (!Array.isArray(ridges)) return [];
  const out: LegacyStructuralLine2D[] = [];
  for (let i = 0; i < ridges.length; i++) {
    const raw = ridges[i];
    if (!structuralRoofLineRawUsable(raw, DEFAULT_MIN_STRUCTURAL_SEGMENT_PX)) continue;
    const rec = raw as Record<string, unknown>;
    const a = rec.a as { x?: number; y?: number };
    const b = rec.b as { x?: number; y?: number };
    const id = rec.id != null ? String(rec.id) : `ridge-${i}`;
    out.push({
      id,
      kind: "ridge",
      a: mapEndpointWithHeight(a, id),
      b: mapEndpointWithHeight(b, id),
    });
  }
  return out;
}

/**
 * Mappe les traits / cassures legacy → `LegacyStructuralLine2D[]`.
 * Filtre `roofRole === "chienAssis"`.
 * Les extrémités reçoivent un `heightM` résolu si disponible.
 */
function mapTraitsWithHeights(traits: unknown[] | undefined): LegacyStructuralLine2D[] {
  if (!Array.isArray(traits)) return [];
  const out: LegacyStructuralLine2D[] = [];
  for (let i = 0; i < traits.length; i++) {
    const raw = traits[i];
    if (!structuralRoofLineRawUsable(raw, DEFAULT_MIN_STRUCTURAL_SEGMENT_PX)) continue;
    const rec = raw as Record<string, unknown>;
    const a = rec.a as { x?: number; y?: number };
    const b = rec.b as { x?: number; y?: number };
    const id = rec.id != null ? String(rec.id) : `trait-${i}`;
    out.push({
      id,
      kind: "trait",
      a: mapEndpointWithHeight(a, id),
      b: mapEndpointWithHeight(b, id),
    });
  }
  return out;
}

// ─── Export principal ──────────────────────────────────────────────────────

/**
 * Construit un `LegacyRoofGeometryInput` depuis `CALPINAGE_STATE.roof`
 * et optionnellement `CALPINAGE_STATE.structural`.
 *
 * CONTRAT D'ENTRÉE :
 * @param roof       `CALPINAGE_STATE.roof` — objet brut du runtime legacy (défensif).
 * @param structural `{ ridges?, traits? }` issus de `CALPINAGE_STATE` (optionnel).
 * @param options    Voir `CalpinageRoofAdapterOptions`.
 *
 * CONTRAT DE SORTIE :
 * @returns `null` si l'état est invalide (mpp manquant, aucun pan valide, etc.).
 * @returns `LegacyRoofGeometryInput` avec `heightM` peuplé sur chaque sommet
 *          uniquement si `resolveHeightAtPxRuntime` valide la hauteur (isValidH) ;
 *          sinon sommet sans heightM → le builder applique les règles B→G.
 *
 * SIDE EFFECTS :
 *   Appels lecture seule à `window.getHeightAtXY` (pas de mutation d'état).
 *
 * QUALITÉ 3D résultante :
 * - Si runtime disponible ET pans ont des sommets h-valués → `quality: "high"` possible.
 * - Si runtime indisponible → `heightM` absent partout → `quality: "low"`, toiture à `defaultHeightM`.
 */
export function calpinageStateToLegacyRoofInput(
  roof: unknown,
  structural?: { ridges?: unknown[]; traits?: unknown[] } | null,
  options: CalpinageRoofAdapterOptions = {},
): LegacyRoofGeometryInput | null {
  const { defaultHeightM = 5.5, warnIfNoRuntime = true } = options;

  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;

  // ── Lecture mpp ──────────────────────────────────────────────────────────
  const scale = r.scale as { metersPerPixel?: number } | undefined;
  const mpp = scale?.metersPerPixel;
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) return null;

  // ── Lecture northAngleDeg ─────────────────────────────────────────────────
  // Chemin : CALPINAGE_STATE.roof.roof.north.angleDeg (voir roofState.ts)
  const roofBlock = r.roof as { north?: { angleDeg?: number } } | undefined;
  const northAngleDeg =
    typeof roofBlock?.north?.angleDeg === "number" ? roofBlock.north.angleDeg : 0;

  // ── Warning si résolveur runtime absent ───────────────────────────────────
  if (warnIfNoRuntime && !isRuntimeHeightResolverAvailable()) {
    console.warn(
      "[calpinageStateToLegacyRoofInput] window.getHeightAtXY non disponible.\n" +
        `Fallback sur defaultHeightM=${defaultHeightM}m (toiture plate).\n` +
        "Vérifier que pans-bundle.js est chargé avant cet appel.\n" +
        "En production, cet appel doit être fait depuis le contexte de la page calpinage.",
    );
  }

  // ── Pans ──────────────────────────────────────────────────────────────────
  const pansRaw = r.roofPans;
  if (!Array.isArray(pansRaw) || pansRaw.length === 0) return null;

  const pans: LegacyPanInput[] = [];
  for (let i = 0; i < pansRaw.length; i++) {
    const pan = pansRaw[i] as Record<string, unknown>;

    // Lecture défensive du polygone (3 noms possibles selon version legacy)
    const poly: Array<{ x: number; y: number }> | undefined =
      (pan.polygonPx as Array<{ x: number; y: number }> | undefined) ||
      (pan.points as Array<{ x: number; y: number }> | undefined) ||
      (pan.contour as { points?: Array<{ x: number; y: number }> } | undefined)?.points;

    if (!Array.isArray(poly) || poly.length < 3) continue;

    const panId = pan.id != null ? String(pan.id) : `pan-${i}`;

    // ── Résolution hauteur pour chaque sommet du polygone ─────────────────
    // Moteur canonique uniquement (P1 si state injecté + P2 fitPlane) — isValidH dans heightResolver.
    // Pas de heightM si indisponible ou hors plage : le builder utilise resolveZForPanCorner B→G.
    const polygonPx: LegacyImagePoint2D[] = poly.map((pt) => {
      const xPx = typeof pt.x === "number" ? pt.x : 0;
      const yPx = typeof pt.y === "number" ? pt.y : 0;
      const heightM = legacyHeightMFromValidatedRuntime(panId, xPx, yPx);
      return { xPx, yPx, ...(heightM !== undefined ? { heightM } : {}) };
    });

    // ── Hints physiques (pente, azimut) ───────────────────────────────────
    // Présents si l'utilisateur a saisi les valeurs manuellement en Phase 2.
    // Utilisés par le builder comme hints de validation, non comme source principale.
    const physical = pan.physical as
      | { slope?: { valueDeg?: number }; orientation?: { azimuthDeg?: number } }
      | undefined;
    const tiltDegHint = physical?.slope?.valueDeg;
    const azimuthDegHint = physical?.orientation?.azimuthDeg;

    pans.push({
      id: panId,
      polygonPx,
      sourceIndex: i,
      ...(typeof tiltDegHint === "number" ? { tiltDegHint } : {}),
      ...(typeof azimuthDegHint === "number" ? { azimuthDegHint } : {}),
    });
  }

  if (pans.length === 0) return null;

  // ── Lignes structurantes ──────────────────────────────────────────────────
  const ridges = mapRidgesWithHeights(structural?.ridges);
  const traits = mapTraitsWithHeights(structural?.traits);

  return {
    metersPerPixel: mpp,
    northAngleDeg,
    defaultHeightM,
    pans,
    ...(ridges.length > 0 ? { ridges } : {}),
    ...(traits.length > 0 ? { traits } : {}),
  };
}
