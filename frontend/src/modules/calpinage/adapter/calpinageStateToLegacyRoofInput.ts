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
import { extractHeightStateContextFromCalpinageState } from "../canonical3d/adapters/buildCanonicalPans3DFromRuntime";
import { isRuntimeHeightResolverAvailable } from "./resolveHeightsFromRuntime";
import { resolveHeightAtPxRuntime, type HeightStateContext } from "../core/heightResolver";
import {
  DEFAULT_MIN_STRUCTURAL_SEGMENT_PX,
  structuralRoofLineRawUsable,
} from "../integration/calpinageStructuralRoofFromRuntime";
import {
  readOfficialRoofPanRecordsForCanonical3D,
  readStrictStatePansForProduct3D,
} from "../integration/readOfficialCalpinageGeometryForCanonical3D";
import { resolvePanPolygonFor3D } from "../integration/resolvePanPolygonFor3D";
import { coerceFiniteRoofHeightMInput, finiteRoofHeightMOrUndefined } from "../core/vertexHeightSemantics";
import { legacySharedCornerClusterTolPx } from "../canonical3d/builder/legacyRoofPixelTolerances";
import { snapLegacyPanPolygonVerticesInPlace } from "../canonical3d/builder/snapLegacyPanPolygonVertices";

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
  /**
   * Produit : liste pans uniquement depuis `state.pans` (racine runtime), jamais `roof.roofPans`.
   */
  productStrictStatePansOnly?: boolean;
  /**
   * Si true : ne rapproche pas les sommets 2D entre pans distincts (`snapLegacyPanPolygonVerticesInPlace`).
   * Recommandé pour un **seul bâtiment** avec relevé précis (évite tout déplacement px des coins partagés).
   */
  skipInterPanVertexSnap?: boolean;
}

// ─── Helpers internes ──────────────────────────────────────────────────────

/**
 * Runtime officiel 3D : même extrait contours / ridges / traits que `buildCanonicalPans3DFromRuntime`.
 * Fusionne `structural` passé en paramètre si le root n’expose pas encore ridges/traits.
 */
function buildHeightStateContextForLegacyAdapter(
  roof: unknown,
  structural: { ridges?: unknown[]; traits?: unknown[] } | null | undefined,
  runtimeRootForOfficialPans: unknown | undefined,
): HeightStateContext | null {
  const baseRoot: Record<string, unknown> =
    runtimeRootForOfficialPans !== undefined && runtimeRootForOfficialPans !== null && typeof runtimeRootForOfficialPans === "object"
      ? { ...(runtimeRootForOfficialPans as Record<string, unknown>) }
      : { roof };
  const r = baseRoot;
  const ridgeList = Array.isArray(r.ridges) ? (r.ridges as unknown[]) : [];
  const traitList = Array.isArray(r.traits) ? (r.traits as unknown[]) : [];
  if (ridgeList.length === 0 && Array.isArray(structural?.ridges) && structural.ridges.length > 0) {
    r.ridges = structural.ridges;
  }
  if (traitList.length === 0 && Array.isArray(structural?.traits) && structural.traits.length > 0) {
    r.traits = structural.traits;
  }
  return extractHeightStateContextFromCalpinageState(r);
}

/**
 * Hauteur injectable dans le legacy : P1 (heightState) puis P2/P3 getHeightAtXY.
 * `heightState` doit être l’extrait CALPINAGE_STATE pour activer `getExplicitHeightAtPoint`.
 */
function legacyHeightMFromValidatedRuntime(
  panId: string,
  xPx: number,
  yPx: number,
  heightState: HeightStateContext | null,
): number | undefined {
  const hRuntime = resolveHeightAtPxRuntime(panId, xPx, yPx, heightState);
  if (import.meta.env.DEV && !Number.isFinite(hRuntime)) {
    console.warn("[HEIGHT_REJECTED]", { panId, xPx, yPx });
  }
  return Number.isFinite(hRuntime) ? hRuntime : undefined;
}

/**
 * Extrémité ridge/trait / point générique : priorité `h` / `heightM` explicites, sinon résolveur avec heightState.
 */
function mapEndpointWithHeight(
  raw: { x?: unknown; y?: unknown; h?: unknown; heightM?: unknown } | null | undefined,
  panIdHint: string,
  heightState: HeightStateContext | null,
): LegacyImagePoint2D {
  const xPx = typeof raw?.x === "number" ? raw.x : 0;
  const yPx = typeof raw?.y === "number" ? raw.y : 0;
  const pr = raw as Record<string, unknown> | null | undefined;
  const explicitH = pr ? finiteRoofHeightMOrUndefined(pr.h ?? pr.heightM) : undefined;
  const heightM =
    explicitH !== undefined
      ? explicitH
      : legacyHeightMFromValidatedRuntime(panIdHint, xPx, yPx, heightState);
  return { xPx, yPx, ...(heightM !== undefined ? { heightM } : {}) };
}

function mapRidgesWithHeights(
  ridges: unknown[] | undefined,
  heightState: HeightStateContext | null,
): LegacyStructuralLine2D[] {
  if (!Array.isArray(ridges)) return [];
  const out: LegacyStructuralLine2D[] = [];
  for (let i = 0; i < ridges.length; i++) {
    const raw = ridges[i];
    if (!structuralRoofLineRawUsable(raw, DEFAULT_MIN_STRUCTURAL_SEGMENT_PX)) continue;
    const rec = raw as Record<string, unknown>;
    const a = rec.a as { x?: number; y?: number; h?: number; heightM?: number };
    const b = rec.b as { x?: number; y?: number; h?: number; heightM?: number };
    const id = rec.id != null ? String(rec.id) : `ridge-${i}`;
    out.push({
      id,
      kind: "ridge",
      a: mapEndpointWithHeight(a, id, heightState),
      b: mapEndpointWithHeight(b, id, heightState),
    });
  }
  return out;
}

function mapTraitsWithHeights(
  traits: unknown[] | undefined,
  heightState: HeightStateContext | null,
): LegacyStructuralLine2D[] {
  if (!Array.isArray(traits)) return [];
  const out: LegacyStructuralLine2D[] = [];
  for (let i = 0; i < traits.length; i++) {
    const raw = traits[i];
    if (!structuralRoofLineRawUsable(raw, DEFAULT_MIN_STRUCTURAL_SEGMENT_PX)) continue;
    const rec = raw as Record<string, unknown>;
    const a = rec.a as { x?: number; y?: number; h?: number; heightM?: number };
    const b = rec.b as { x?: number; y?: number; h?: number; heightM?: number };
    const id = rec.id != null ? String(rec.id) : `trait-${i}`;
    out.push({
      id,
      kind: "trait",
      a: mapEndpointWithHeight(a, id, heightState),
      b: mapEndpointWithHeight(b, id, heightState),
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
  /**
   * `CALPINAGE_STATE` racine : permet `state.pans` **avant** `roof.roofPans`.
   * Si omis : équivalent `{ roof }` (tests / appels historiques).
   */
  runtimeRootForOfficialPans?: unknown,
): LegacyRoofGeometryInput | null {
  const {
    defaultHeightM = 5.5,
    warnIfNoRuntime = true,
    productStrictStatePansOnly = false,
    skipInterPanVertexSnap = false,
  } = options ?? {};

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

  const heightState = buildHeightStateContextForLegacyAdapter(roof, structural, runtimeRootForOfficialPans);

  // ── Pans (officiel compat : state.pans puis miroir ; produit strict : state.pans seul) ──
  const panRoot = runtimeRootForOfficialPans !== undefined ? runtimeRootForOfficialPans : { roof };
  const panRead = productStrictStatePansOnly
    ? readStrictStatePansForProduct3D(panRoot)
    : readOfficialRoofPanRecordsForCanonical3D(panRoot);
  const pansRaw = panRead.pans;
  if (!Array.isArray(pansRaw) || pansRaw.length === 0) return null;

  const pans: LegacyPanInput[] = [];
  for (let i = 0; i < pansRaw.length; i++) {
    const pan = pansRaw[i] as Record<string, unknown>;

    // Lecture défensive — `resolvePanPolygonFor3D` (polygonPx → points → polygon → contour.points).
    const resolved = resolvePanPolygonFor3D(pan);
    const poly = resolved.raw as Array<{ x: number; y: number; h?: number; heightM?: number }> | undefined;
    if (!poly || poly.length < 3) continue;

    const panId = pan.id != null ? String(pan.id) : `pan-${i}`;

    // ── Résolution hauteur pour chaque sommet du polygone ─────────────────
    // Moteur canonique uniquement (P1 si state injecté + P2 fitPlane) — isValidH dans heightResolver.
    // Pas de heightM si indisponible ou hors plage : le builder utilise resolveZForPanCorner B→G.
    const polygonPx: LegacyImagePoint2D[] = poly.map((pt) => {
      const xPx = typeof pt.x === "number" ? pt.x : 0;
      const yPx = typeof pt.y === "number" ? pt.y : 0;
      const pr = pt as Record<string, unknown>;
      const explicitH = finiteRoofHeightMOrUndefined(
        coerceFiniteRoofHeightMInput(pr.h ?? pr.heightM),
      );
      const heightM =
        explicitH !== undefined ? explicitH : legacyHeightMFromValidatedRuntime(panId, xPx, yPx, heightState);
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

  if (pans.length >= 2 && !skipInterPanVertexSnap) {
    const snapTolPx = legacySharedCornerClusterTolPx(mpp);
    const snapWrites = snapLegacyPanPolygonVerticesInPlace(pans, snapTolPx);
    if (import.meta.env.DEV && snapWrites > 0) {
      console.info("[CALPINAGE-2D][SNAP]", { mergedVertexWrites: snapWrites, tolPx: snapTolPx });
    }
  }

  // ── Lignes structurantes ──────────────────────────────────────────────────
  const ridges = mapRidgesWithHeights(structural?.ridges, heightState);
  const traits = mapTraitsWithHeights(structural?.traits, heightState);

  return {
    metersPerPixel: mpp,
    northAngleDeg,
    defaultHeightM,
    pans,
    ...(ridges.length > 0 ? { ridges } : {}),
    ...(traits.length > 0 ? { traits } : {}),
  };
}
