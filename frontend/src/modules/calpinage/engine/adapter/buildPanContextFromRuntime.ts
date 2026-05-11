/**
 * buildPanContextFromRuntime.ts — Phase 2 adapter.
 *
 * Construit un PanContext depuis les globals legacy window :
 *   - CALPINAGE_STATE.pans[panId]    → RoofFace
 *   - CALPINAGE_STATE.roof            → WorldTransform
 *   - solveFace() (roofGeometryEngine) → RoofFaceDerived3D
 *   - RuntimeHeightResolver           → injection HeightResolver dans solveFace
 *
 * Règles immuables :
 *   - Ce fichier est le SEUL point d'accès à window.CALPINAGE_STATE depuis le moteur extrait.
 *   - Le moteur pvPlacementEngine reçoit un PanContext — il n'appelle jamais window directement.
 *   - Si le pan est introuvable ou si l'état est invalide, la fonction retourne null.
 *
 * Source legacy des champs :
 *   pan.id               → RoofFace.id
 *   pan.points[]         → RoofFace.polygonPx (x→xPx, y→yPx, h?→heightM?)
 *   pan.roofType         → RoofFace.roofType ("FLAT" | "PITCHED", default: "PITCHED")
 *   pan.flatRoofConfig   → RoofFace.flatRoofConfig (si FLAT)
 *   pan.tiltDeg          → RoofFace.tiltDegExplicit
 *   pan.physical?.orientation?.azimuthDeg ?? pan.azimuthDeg → RoofFace.azimuthDegExplicit
 *   state.roof.scale.metersPerPixel          → WorldTransform.metersPerPixel
 *   state.roof.north.angleDeg (ou .roof.roof.north.angleDeg) → WorldTransform.northAngleDeg
 */

import type { PanContext, RoofFace, PanPolygonVertex, PanRoofType } from "../interfaces/PanContext";
import type { WorldTransform } from "../interfaces/WorldTransform";
import type { HeightResolver } from "../interfaces/HeightResolver";
import type { FlatRoofConfig } from "../interfaces/PlacementRules";
import { solveFace } from "../roofGeometryEngine/faceSolver";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES LOCAUX — shape minimale des globals window legacy
// ─────────────────────────────────────────────────────────────────────────────

/** Shape minimale d'un point de polygone de pan dans CALPINAGE_STATE.pans[i].points. */
interface LegacyPanPoint {
  x: number;
  y: number;
  /** Hauteur explicite (m, repère absolu) — absent si non saisie. */
  h?: number;
}

/** Shape minimale d'un pan dans CALPINAGE_STATE.pans. */
interface LegacyPan {
  id: string;
  points: LegacyPanPoint[];
  /** Inclinaison explicite saisie en Phase 2 (deg). null = non renseignée. */
  tiltDeg?: number | null;
  /** Azimut explicite au format "flat" (deg). null = non renseigné. */
  azimuthDeg?: number | null;
  /** Données physiques avancées (calcul 3D pans-bundle). */
  physical?: {
    orientation?: {
      azimuthDeg?: number | null;
    };
  };
  /** "FLAT" si toiture plate, absent ou autre = toiture inclinée. */
  roofType?: string;
  /** Config toiture plate — présent si et seulement si roofType === "FLAT". */
  flatRoofConfig?: FlatRoofConfig;
}

/** Shape minimale de CALPINAGE_STATE telle qu'exposée par calpinage.module.js. */
interface LegacyCalpinageState {
  pans?: LegacyPan[];
  roof?: {
    scale?: { metersPerPixel?: number };
    /** Format A : north à plat sur roof. */
    north?: { angleDeg?: number };
    /** Format B : north imbriqué dans roof.roof (legacy ancien). */
    roof?: { north?: { angleDeg?: number } };
  };
}

/** Extension de Window pour les globals legacy calpinage. */
interface CalpinageLegacyWindow extends Window {
  CALPINAGE_STATE?: LegacyCalpinageState;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lit le CALPINAGE_STATE depuis window.
 * Retourne null si window n'est pas disponible ou si l'état n'est pas initialisé.
 */
function readLegacyState(): LegacyCalpinageState | null {
  if (typeof window === "undefined") return null;
  const state = (window as CalpinageLegacyWindow).CALPINAGE_STATE;
  return state ?? null;
}

/**
 * Extrait les paramètres WorldTransform depuis l'état legacy.
 *
 * Gère deux formats historiques pour northAngleDeg :
 *   Format A (courant) : state.roof.north.angleDeg
 *   Format B (ancien)  : state.roof.roof.north.angleDeg
 *
 * Retourne null si metersPerPixel est absent, nul ou invalide.
 */
function extractWorldTransform(state: LegacyCalpinageState): WorldTransform | null {
  const roof = state.roof;
  if (!roof) return null;

  const mpp = roof.scale?.metersPerPixel;
  if (!mpp || !Number.isFinite(mpp) || mpp <= 0) return null;

  // Format A (courant) : state.roof.north.angleDeg
  let northAngleDeg: number | null = null;
  if (roof.north != null && typeof roof.north.angleDeg === "number") {
    northAngleDeg = roof.north.angleDeg;
  } else if (roof.roof?.north != null && typeof roof.roof.north.angleDeg === "number") {
    // Format B (ancien)
    northAngleDeg = roof.roof.north.angleDeg;
  }

  return {
    metersPerPixel: mpp,
    northAngleDeg: northAngleDeg ?? 0,
  };
}

/**
 * Mappe un LegacyPan → RoofFace (interface typée du moteur).
 *
 * Priorisation azimuthDegExplicit :
 *   1. pan.physical.orientation.azimuthDeg (calculé par pans-bundle fitPlane)
 *   2. pan.azimuthDeg (saisie directe utilisateur)
 *   3. null
 */
function mapLegacyPanToRoofFace(pan: LegacyPan): RoofFace {
  const polygonPx: PanPolygonVertex[] = pan.points.map((p) => {
    const v: PanPolygonVertex = { xPx: p.x, yPx: p.y };
    if (typeof p.h === "number" && Number.isFinite(p.h)) {
      (v as { xPx: number; yPx: number; heightM?: number }).heightM = p.h;
    }
    return v;
  });

  const roofType: PanRoofType = pan.roofType === "FLAT" ? "FLAT" : "PITCHED";

  // Azimut explicite : priorité physical.orientation.azimuthDeg (calculé 3D) sur azimuthDeg (hint utilisateur)
  const azimuthDegExplicit: number | null =
    (pan.physical?.orientation?.azimuthDeg != null && Number.isFinite(pan.physical.orientation.azimuthDeg))
      ? pan.physical.orientation.azimuthDeg
      : (pan.azimuthDeg != null && Number.isFinite(pan.azimuthDeg) ? pan.azimuthDeg : null);

  const tiltDegExplicit: number | null =
    (pan.tiltDeg != null && Number.isFinite(pan.tiltDeg)) ? pan.tiltDeg : null;

  const face: RoofFace = {
    id: pan.id,
    polygonPx,
    roofType,
    tiltDegExplicit,
    azimuthDegExplicit,
  };

  // flatRoofConfig uniquement si roofType === "FLAT"
  if (roofType === "FLAT" && pan.flatRoofConfig) {
    return { ...face, flatRoofConfig: pan.flatRoofConfig };
  }

  return face;
}

/**
 * Cherche un pan par id dans CALPINAGE_STATE.pans.
 * Retourne null si introuvable.
 */
function findLegacyPan(state: LegacyCalpinageState, panId: string): LegacyPan | null {
  if (!state.pans || state.pans.length === 0) return null;
  for (const pan of state.pans) {
    if (pan.id === panId) return pan;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FONCTION PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit un PanContext complet depuis les globals window legacy.
 *
 * @param panId    — identifiant stable du pan (ex. "pan-0", UUID)
 * @param resolver — HeightResolver injecté (RuntimeHeightResolver en Phase 2)
 * @returns PanContext si le pan est trouvé et l'état est valide, null sinon.
 *
 * Exemple d'usage :
 * ```ts
 * const resolver = createRuntimeHeightResolver();
 * const ctx = buildPanContextFromRuntime("pan-0", resolver);
 * if (ctx) {
 *   const derived = ctx.panDerived;
 *   // derived.tiltDeg, derived.azimuthDeg, derived.cornersWorld, ...
 * }
 * ```
 *
 * Cas de retour null :
 *   - window indisponible (SSR)
 *   - CALPINAGE_STATE non initialisé
 *   - pan introuvable dans state.pans
 *   - WorldTransform invalide (metersPerPixel <= 0 ou absent)
 *   - pan.points vide ou < 3 sommets (polygone dégénéré)
 */
export function buildPanContextFromRuntime(
  panId: string,
  resolver: HeightResolver,
): PanContext | null {
  // 1. Lire l'état legacy
  const state = readLegacyState();
  if (!state) return null;

  // 2. Trouver le pan
  const legacyPan = findLegacyPan(state, panId);
  if (!legacyPan) return null;

  // 3. Extraire WorldTransform
  const worldTransform = extractWorldTransform(state);
  if (!worldTransform) return null;

  // 4. Valider le polygone (minimum 3 sommets)
  if (!legacyPan.points || legacyPan.points.length < 3) return null;

  // 5. Mapper LegacyPan → RoofFace
  const pan = mapLegacyPanToRoofFace(legacyPan);

  // 6. Calculer RoofFaceDerived3D via solveFace (roofGeometryEngine)
  //    solveFace résout les hauteurs Z via resolver.getHeightAtImagePoint,
  //    calcule la normale, pente, azimut, et les coins en WORLD ENU.
  const panDerived = solveFace(pan, worldTransform, resolver);

  return { pan, panDerived, worldTransform };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT NOMMÉ — factory de convenance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit le PanContext pour le pan actif courant (CALPINAGE_STATE.selectedPanId
 * ou CalpinagePans.panState.activePanId).
 *
 * Raccourci pour les consommateurs qui ne connaissent pas l'id du pan actif.
 * Retourne null si aucun pan actif ou si le contexte est invalide.
 */
export function buildActivePanContextFromRuntime(
  resolver: HeightResolver,
): PanContext | null {
  if (typeof window === "undefined") return null;

  const w = window as CalpinageLegacyWindow & {
    CalpinagePans?: { panState?: { activePanId?: string | null } };
  };

  // Priorité : panState.activePanId (CalpinagePans) > CALPINAGE_STATE.selectedPanId (fallback)
  const activePanId: string | null | undefined =
    w.CalpinagePans?.panState?.activePanId ??
    ((w.CALPINAGE_STATE as (LegacyCalpinageState & { selectedPanId?: string | null }) | undefined)
      ?.selectedPanId);

  if (!activePanId) return null;

  return buildPanContextFromRuntime(activePanId, resolver);
}
