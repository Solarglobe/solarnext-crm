/**
 * Phase A — Interface de découplage : contexte d'un pan pour le moteur de placement PV.
 *
 * CONTRAT UNIQUEMENT — aucune implémentation, aucune référence à window.*.
 *
 * Rôle : fournir au moteur pvPlacementEngine toutes les données d'un pan
 * sous une forme typée, découplée de CALPINAGE_STATE. Le moteur ne doit
 * jamais lire window.CalpinagePans ou window.CALPINAGE_STATE.pans directement.
 *
 * Composition :
 *   - RoofFace       : données source 2D du pan (polygone px, ID, type de toiture)
 *   - RoofFaceDerived3D : données géométriques 3D dérivées (normale, tilt, azimuth, coins ENU)
 *   - WorldTransform : conversion image px ↔ WORLD ENU (mpp, nord)
 *
 * Source legacy des champs :
 *   - RoofFace        ← CALPINAGE_STATE.pans[i] / validatedRoofData.pans[i]
 *   - RoofFaceDerived3D ← calculé par roofGeometryEngine (Phase 3) ou canonical3d/builder
 *   - WorldTransform  ← CALPINAGE_STATE.roof.scale + CALPINAGE_STATE.roof.roof.north
 *
 * Implémentations prévues :
 *   - buildPanContextFromRuntime(panId, state, heightResolver)  [Phase 2 adapter]
 *   - buildPanContextFromStore(panId, store)                    [Phase 3+]
 */

import type { WorldTransform } from "./WorldTransform";

// ─────────────────────────────────────────────────────────────────────────────
// RoofFace — pan source (données 2D persistées)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type de toiture pour ce pan — source : CALPINAGE_STATE.pans[i].roofType
 * ou flatRoofConfig présent.
 */
export type PanRoofType = "PITCHED" | "FLAT";

/**
 * Sommet du polygone source en pixels image.
 * Aligné sur LegacyImagePoint2D (canonical3d/builder/legacyInput.ts).
 */
export interface PanPolygonVertex {
  readonly xPx: number;
  readonly yPx: number;
  /** Hauteur explicite si saisie (m, repère absolu). Absent = à résoudre via HeightResolver. */
  readonly heightM?: number;
}

/**
 * Pan de toiture tel que fourni au moteur — données source 2D.
 *
 * Correspond aux champs essentiels d'un pan dans CALPINAGE_STATE.pans[i].
 * Ne contient PAS les champs dérivés 3D (dans RoofFaceDerived3D).
 * Ne contient PAS les champs UI (couleur, sélection, etc.).
 */
export interface RoofFace {
  /** Identifiant stable du pan (ex. "pan-0", UUID, "p_xxxx"). */
  readonly id: string;
  /**
   * Polygone source en pixels image.
   * Fermeture implicite (dernier point ≠ premier si non répété).
   * Au moins 3 sommets.
   */
  readonly polygonPx: readonly PanPolygonVertex[];
  /** Type de toiture : inclinée (default) ou plate. */
  readonly roofType: PanRoofType;
  /**
   * Configuration spécifique toiture plate.
   * Présent uniquement si roofType === "FLAT".
   * Importé depuis PlacementRules.ts pour éviter la duplication.
   */
  readonly flatRoofConfig?: import("./PlacementRules").FlatRoofConfig;
  /**
   * Orientation physique du pan saisie manuellement en Phase 2 (hint optionnel).
   * null si non renseignée (la géométrie fait foi).
   */
  readonly tiltDegExplicit: number | null;
  readonly azimuthDegExplicit: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RoofFaceDerived3D — données géométriques 3D calculées
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vecteur 3D normalisé (repère WORLD ENU, Z up).
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Coin d'un pan en coordonnées WORLD ENU (mètres, Z up).
 */
export interface WorldCorner3D {
  readonly x: number;  // Est (m)
  readonly y: number;  // Nord (m)
  readonly z: number;  // Hauteur (m)
}

/**
 * Données géométriques 3D dérivées d'un pan — calculées par le moteur géométrie (Phase 3)
 * ou l'adaptateur canonical3d lors du build de la scène.
 *
 * Ces données sont NON PERSISTÉES (recalculées à chaque session / montage).
 * Source → roofGeometryEngine/faceSolver.ts (Phase 3) ou buildRoofModel3DFromLegacyGeometry.
 */
export interface RoofFaceDerived3D {
  /** Pente du plan de toiture vs horizontal (0=horizontal, 90=vertical), degrés. */
  readonly tiltDeg: number;
  /** Azimut solaire du pan (0=Nord, 90=Est, 180=Sud, 270=Ouest), degrés. */
  readonly azimuthDeg: number;
  /** Normale unitaire extérieure (vers le ciel), repère WORLD ENU. */
  readonly normalWorld: Vec3;
  /**
   * Coins du polygone en WORLD ENU — même ordre et cardinal que RoofFace.polygonPx.
   * Calculés via worldMapping.imagePxToWorldHorizontalM + hauteurs résolues.
   */
  readonly cornersWorld: readonly WorldCorner3D[];
  /**
   * Axe de pente normalisé dans le plan du pan, direction "vers le haut de la pente" (WORLD).
   * Utilisé par le moteur PV pour orienter les rangées de panneaux.
   */
  readonly slopeAxisWorld: Vec3;
  /**
   * Axe perpendiculaire à la pente dans le plan du pan (WORLD).
   * Direction "horizontale" du pan (axe inter-colonnes).
   */
  readonly perpAxisWorld: Vec3;
  /**
   * Surface horizontale projetée du pan (m²).
   * Calculée depuis cornersWorld XY — réfère la charte fidélité Niveau 3.
   */
  readonly projectedAreaM2: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PanContext — contrat d'injection pour pvPlacementEngine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contexte complet d'un pan injecté dans le moteur de placement PV.
 *
 * Le moteur pvPlacementEngine reçoit un PanContext par pan actif.
 * Il ne doit PAS lire window.CalpinagePans, window.CALPINAGE_STATE.pans,
 * ni appeler getHeightAtXY directement — tout passe par ce contrat.
 *
 * Usage type dans le moteur :
 *   function autoPlacePanels(ctx: PanContext, rules: PlacementRules, resolver: HeightResolver): PVBlock[]
 */
export interface PanContext {
  /** Données source 2D du pan (polygone, roofType, hints physiques). */
  readonly pan: RoofFace;
  /**
   * Données géométriques 3D dérivées.
   * Calculées avant l'appel au moteur — le moteur les consomme en lecture seule.
   */
  readonly panDerived: RoofFaceDerived3D;
  /**
   * Transformation image ↔ monde pour ce pan.
   * Identique pour tous les pans d'une même étude (metersPerPixel + northAngleDeg partagés).
   */
  readonly worldTransform: WorldTransform;
}
