/**
 * Contrat officiel de données 3D — frontière adaptateur entre le runtime 2D et le pipeline canonique.
 *
 * CE FICHIER EST UNE DÉCLARATION DE TYPES PURE.
 * Il ne branche rien au produit, ne modifie aucun flux existant.
 *
 * Rôle :
 *   Ce module définit les DTOs qui traversent la frontière :
 *     CALPINAGE_STATE (runtime 2D)  →  [adaptateur]  →  CanonicalSceneInputEnvelope
 *
 *   L'enveloppe est ensuite consommée par les builders canoniques :
 *     buildRoofModel3DFromLegacyGeometry / buildRoofVolumes3D / buildPvPanels3D / buildSolarScene3D
 *
 * Ce qu'il NE DUPLIQUE PAS :
 *   - Les types de sortie des builders (RoofObstacleVolume3D, PvPanelSurface3D, SolarScene3D…)
 *   - Les types bruts du legacy (LegacyRoofGeometryInput, LegacyPanInput…)
 *   - Les diagnostics internes au moteur de reconstruction
 *
 * Ce qu'il AJOUTE :
 *   - La confiance explicite à chaque couche (pan, volume, panneau)
 *   - Le mode de résolution de hauteur (fitPlane runtime, défaut, explicite…)
 *   - Une enveloppe globale unique qui est LA frontière officielle 2D↔3D
 *
 * Dépendances autorisées :
 *   - ../types/quality.ts  (ConfidenceTier, GeometryDiagnostic, QualityBlock)
 *   - ../builder/legacyInput.ts  (LegacyImagePoint2D — point image + hauteur optionnelle)
 *
 * Aucune dépendance vers le runtime legacy calpinage (CALPINAGE_STATE, window.*, etc.).
 */

import type { ConfidenceTier, GeometryDiagnostic, QualityBlock } from "../types/quality";
import type { LegacyImagePoint2D } from "../builder/legacyInput";

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRIMITIVES ADAPTATEUR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coordonnées GPS optionnelles du chantier.
 * Utilisées pour le contexte solaire (vecteurs soleil, masque horizon).
 */
export interface CanonicalGpsCoordinates {
  readonly latDeg: number;
  readonly lonDeg: number;
  /** Altitude absolue (m NGF ou ellipsoïdale) — optionnelle ; 0 si inconnue. */
  readonly altM?: number;
}

/**
 * Alias sémantiques sur ConfidenceTier — même union, nommage contextualisé pour lisibilité.
 *
 * "high"    : hauteur résolue via fitPlane runtime (pans-bundle CalpinagePans.getHeightAtXY)
 * "medium"  : hauteur partiellement résolue (un seul point d'appui, interpolation grossière)
 * "low"     : hauteur par défaut forcée (runtime absent ou pan sans Z)
 * "unknown" : aucune information — à traiter comme toiture plate
 */
export type HeightConfidence = ConfidenceTier;

/**
 * Confiance géométrique d'un volume (obstacle / extension).
 *
 * "high"    : footprint en pixels propre, hauteur catalogue connue
 * "medium"  : footprint approximatif ou hauteur estimée
 * "low"     : footprint dégradé / hauteur par défaut
 * "unknown" : données insuffisantes pour reconstruction fiable
 */
export type VolumeGeometryConfidence = ConfidenceTier;

/**
 * Confiance de la projection d'un panneau PV sur un pan 3D.
 *
 * "high"    : centre projeté sur patch résolu, axes slopeAxis/perpAxis fiables
 * "medium"  : pan trouvé mais projection approchée (ex. bord de pan)
 * "low"     : aucun patch 3D résolu — projection dégradée (plan horizontal par défaut)
 * "unknown" : aucun pan associé en entrée
 */
export type PanelProjectionConfidence = ConfidenceTier;

/**
 * Mode de résolution de la hauteur d'un sommet de polygone.
 *
 * "runtime_fitplane"  : hauteur issue de window.getHeightAtXY (CalpinagePans.fitPlane)
 * "explicit_input"    : hauteur fournie explicitement dans l'état legacy (pan.physical.slope…)
 * "default_fallback"  : valeur par défaut utilisée (runtime absent ou pas de retour)
 * "missing"           : aucun heightM — le builder applique defaultHeightM
 */
export type HeightResolutionMode =
  | "runtime_fitplane"
  | "explicit_input"
  | "default_fallback"
  | "missing";

// ─────────────────────────────────────────────────────────────────────────────
// 2. PAN TOITURE CANONIQUE (entrée adaptateur)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Point 2D image annoté avec son mode de résolution de hauteur.
 * Étend LegacyImagePoint2D pour traçabilité à la frontière adaptateur.
 */
export interface AnnotatedImagePoint2D extends LegacyImagePoint2D {
  /** Comment la hauteur a été obtenue pour ce sommet spécifique. */
  readonly heightResolutionMode: HeightResolutionMode;
}

/**
 * Pan de toit prêt pour la reconstruction 3D — DTO de frontière adaptateur.
 *
 * Relation avec les types existants :
 *   - polygonPxAnnotated → sera passé comme polygonPx à LegacyPanInput
 *   - tiltDegHint / azimuthDegHint → hints physiques si saisis en Phase 2
 *   - heightConfidence → qualité globale des hauteurs de ce pan
 *
 * IMPORTANT : ce type représente CE QUE L'ADAPTATEUR PRODUIT avant d'entrer dans
 * buildRoofModel3DFromLegacyGeometry. Il n'est pas un duplicat de LegacyPanInput.
 */
export interface CanonicalPanAdapterInput {
  /** Identifiant stable issu du runtime legacy (ex. "pan-0", UUID, etc.). */
  readonly id: string;
  /** Index d'origine dans CALPINAGE_STATE.roof.roofPans (pour traçabilité). */
  readonly sourceIndex: number;
  /**
   * Polygone source en pixels image (fermeture implicite si dernier ≠ premier).
   * Chaque sommet est annoté avec son mode de résolution de hauteur.
   */
  readonly polygonPxAnnotated: readonly AnnotatedImagePoint2D[];
  /**
   * Confiance globale des hauteurs pour ce pan.
   * "high" uniquement si TOUS les sommets ont heightResolutionMode = "runtime_fitplane".
   */
  readonly heightConfidence: HeightConfidence;
  /** Pente physique en degrés (0=horizontal, 90=vertical) — hint optionnel Phase 2. */
  readonly tiltDegHint?: number;
  /** Azimuth solaire du pan (degrés depuis sud, positif vers ouest) — hint optionnel Phase 2. */
  readonly azimuthDegHint?: number;
  /** Diagnostics spécifiques à ce pan (ex. : sommet à hauteur 0 suspect, polygone non convexe). */
  readonly diagnostics: readonly GeometryDiagnostic[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. VOLUME CANONIQUE — OBSTACLES ET EXTENSIONS (entrée adaptateur)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type source d'un volume (pour traçabilité et dispatch dans le builder).
 *
 * "obstacle"   : obstruction simple (cheminée, velux, antenne…)
 * "keepout"    : zone d'exclusion non physique (servitude, espace sécurité)
 * "extension"  : chien-assis, lucarne, aile de bâtiment
 * "shadow_volume" : volume ombrant fictif (arbre, bâtiment voisin proche)
 */
export type CanonicalVolumeSourceType =
  | "obstacle"
  | "keepout"
  | "extension"
  | "shadow_volume";

/**
 * Volume 3D prêt pour la reconstruction canonique — DTO de frontière adaptateur.
 *
 * Relation avec les types existants :
 *   - Sera converti en LegacyObstacleVolumeInput / LegacyExtensionVolumeInput
 *     selon sourceType avant d'être passé à buildRoofVolumes3D
 *
 * IMPORTANT : ce type ne duplique pas RoofObstacleVolume3D (sortie builder).
 * Il représente l'ENTRÉE enrichie pour le pipeline canonique.
 */
export interface CanonicalVolumeAdapterInput {
  /** Identifiant stable côté adaptateur. */
  readonly id: string;
  /** Identifiant original dans CALPINAGE_STATE (obstacle.id, chienAssis.id…). */
  readonly sourceId: string;
  readonly sourceType: CanonicalVolumeSourceType;
  /**
   * Footprint source en pixels image (contour bas du volume).
   * Sera converti en LegacyVolumeFootprintSource { mode: "image_px" } par le builder.
   */
  readonly footprintPxSource: readonly LegacyImagePoint2D[];
  /** Hauteur d'extrusion (m) — toujours > 0. */
  readonly heightM: number;
  /**
   * Altitude de la base (m, repère monde).
   * 0 si inconnue / posée au sol ; sinon base sur le plan d'un pan adjacent.
   */
  readonly baseHeightM: number;
  /** IDs des pans canoniques potentiellement liés (pour ancrage roof-aware). */
  readonly relatedPanIds: readonly string[];
  readonly geometryConfidence: VolumeGeometryConfidence;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PANNEAU PV CANONIQUE (entrée adaptateur)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orientation du module (reprise du runtime legacy — aligné sur PvPanelOrientation2D).
 * Déclaré ici pour éviter une dépendance vers pv-panel-3d.ts depuis l'adaptateur.
 */
export type CanonicalPanelOrientation = "portrait" | "landscape";

/**
 * Panneau PV réellement posé, prêt pour la projection canonique 3D — DTO de frontière.
 *
 * Relation avec les types existants :
 *   - Sera converti en PvPanelPlacementInput avant buildPvPanels3D
 *   - Correspond à un panneau actif dans pvPlacementEngine (block.panels[i])
 *
 * IMPORTANT : ce type ne duplique pas PvPanelSurface3D (sortie builder).
 */
export interface CanonicalPanelAdapterInput {
  /** Identifiant stable du panneau côté adaptateur. */
  readonly id: string;
  /** ID du panneau dans le bloc placement (ex. panelId issu de block.panels[i].id). */
  readonly sourcePanelId: string;
  /**
   * ID du pan de toit porteur (CALPINAGE_STATE.pans[].id).
   * Utilisé pour le mapping panel→patch 3D dans le builder.
   */
  readonly sourcePanId: string;
  /**
   * Centre du panneau en pixels image (getEffectivePanelCenter).
   * Point d'ancrage principal pour la projection sur le plan du pan.
   */
  readonly centerPxSource: LegacyImagePoint2D;
  /**
   * Axe de pente (direction vers le haut du pan) normalisé dans le repère image.
   * Issu de getEffectivePanelProjection().slopeAxis.
   */
  readonly slopeAxisImage: Readonly<{ readonly x: number; readonly y: number }>;
  /**
   * Axe perpendiculaire (direction horizontale du pan) normalisé dans le repère image.
   * Issu de getEffectivePanelProjection().perpAxis.
   */
  readonly perpAxisImage: Readonly<{ readonly x: number; readonly y: number }>;
  /** Largeur physique du module (m), issue du catalogue. */
  readonly widthM: number;
  /** Hauteur physique du module (m), issue du catalogue. */
  readonly heightM: number;
  readonly orientation: CanonicalPanelOrientation;
  /**
   * Confiance de la projection sur le plan 3D.
   * Déterminée a posteriori par le builder lors du mapping panId → RoofPlanePatch3D.
   */
  readonly projectionConfidence: PanelProjectionConfidence;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. RÉSUMÉ GLOBAL DE CONFIANCE DE SCÈNE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synthèse de la confiance globale d'une scène adaptateur.
 * Déduit des confidences individuelles des pans, volumes et panneaux.
 *
 * Règle de déduction recommandée (à implémenter dans l'adaptateur) :
 *   - roofConfidence  = min(pan.heightConfidence) sur tous les pans
 *   - volumeConfidence = min(vol.geometryConfidence) sur tous les volumes (ou "high" si aucun)
 *   - panelConfidence  = min(panel.projectionConfidence) sur tous les panneaux (ou "high" si aucun)
 *   - overall         = min(roofConfidence, volumeConfidence, panelConfidence)
 */
export interface CanonicalSceneConfidenceSummary {
  readonly overall: ConfidenceTier;
  readonly roofConfidence: ConfidenceTier;
  readonly volumeConfidence: ConfidenceTier;
  readonly panelConfidence: ConfidenceTier;
  /**
   * Nombre de pans avec hauteur résolue via runtime fitPlane.
   * Permet d'évaluer rapidement si la scène est exploitable pour le near shading 3D.
   */
  readonly pansWithRuntimeHeight: number;
  readonly totalPans: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ENVELOPPE OFFICIELLE DE SCÈNE — frontière 2D ↔ 3D
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enveloppe d'entrée canonique complète — LE type officiel à la frontière entre
 * le runtime 2D (CALPINAGE_STATE) et le pipeline canonique 3D.
 *
 * C'est le seul objet que l'adaptateur produit.
 * C'est le seul objet que les builders canoniques doivent consommer via l'adaptateur.
 *
 * Flux :
 *   calpinageStateToCanonicalSceneInput(CALPINAGE_STATE)
 *     → CanonicalSceneInputEnvelope
 *       → buildRoofModel3DFromLegacyGeometry(toLeacyRoofInput(envelope))
 *       → buildRoofVolumes3D(toLegacyVolumeInputs(envelope))
 *       → buildPvPanels3D(toPvPanelInputs(envelope))
 *       → buildSolarScene3D(...)
 *
 * Invariants :
 *   - metersPerPixel > 0
 *   - roofPans.length >= 1
 *   - gps peut être null si non disponible (near shading dégradé)
 *   - obstacleVolumes / pvPanels peuvent être vides
 */
export interface CanonicalSceneInputEnvelope {
  // ── Métadonnées de capture ──────────────────────────────────────────────

  /** Horodatage ISO de création de l'enveloppe (Date.now dans l'adaptateur). */
  readonly capturedAtIso: string;
  /** Référence optionnelle à l'étude / version pour traçabilité. */
  readonly studyRef?: string;

  // ── Échelle et orientation ──────────────────────────────────────────────

  /**
   * Échelle image→monde (mètres par pixel).
   * Source : CALPINAGE_STATE.roof.scale.metersPerPixel
   */
  readonly metersPerPixel: number;

  /**
   * Angle (degrés) de rotation du haut de l'image vers le nord géographique.
   * 0 = haut image = nord. Source : CALPINAGE_STATE.roof.roof.north.angleDeg
   */
  readonly northAngleDeg: number;

  // ── Géolocalisation ─────────────────────────────────────────────────────

  /**
   * Coordonnées GPS du chantier.
   * null si non encore renseignées (calpinage non géolocalisé).
   * Requises pour le contexte solaire (near shading canonique).
   */
  readonly gps: CanonicalGpsCoordinates | null;

  // ── Entités géométriques ────────────────────────────────────────────────

  /**
   * Pans de toit enrichis avec confiance et diagnostics.
   * Au moins 1 élément garanti si l'enveloppe est valide.
   */
  readonly roofPans: readonly CanonicalPanAdapterInput[];

  /**
   * Volumes obstacles et extensions enrichis.
   * Peut être vide (pas d'obstacles).
   */
  readonly obstacleVolumes: readonly CanonicalVolumeAdapterInput[];

  /**
   * Panneaux PV enrichis.
   * Peut être vide (avant pose ou calcul pré-placement).
   */
  readonly pvPanels: readonly CanonicalPanelAdapterInput[];

  // ── Qualité globale ─────────────────────────────────────────────────────

  /** Synthèse des niveaux de confiance par couche. */
  readonly globalConfidenceSummary: CanonicalSceneConfidenceSummary;

  /**
   * Diagnostics globaux de l'adaptateur (non spécifiques à un pan ou volume).
   * Ex. : "runtime height resolver absent", "GPS manquant", "aucun obstacle mappé".
   */
  readonly globalDiagnostics: readonly GeometryDiagnostic[];

  /**
   * Qualité globale condensée (réexporte globalConfidenceSummary.overall + globalDiagnostics).
   * Permet d'utiliser les mêmes helpers QualityBlock que le reste du pipeline canonique.
   */
  readonly globalQuality: QualityBlock;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. RÉSULTAT DE LA CONSTRUCTION D'ENVELOPPE (retour de l'adaptateur)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résultat typé retourné par la fonction d'adaptation.
 * Permet au consommateur de distinguer succès, enveloppe dégradée, et échec.
 */
export type CanonicalSceneInputResult =
  | {
      readonly ok: true;
      readonly envelope: CanonicalSceneInputEnvelope;
    }
  | {
      readonly ok: false;
      /** Raison machine (pour logs, métriques, feature flag). */
      readonly reason:
        | "INVALID_MPP"
        | "NO_VALID_PANS"
        | "MISSING_ROOF_STATE"
        | "UNEXPECTED_ERROR";
      readonly diagnostics: readonly GeometryDiagnostic[];
    };
