/**
 * Contrat d’entrée du builder 2D → 3D — **aucune dépendance** au runtime calpinage.
 * Les adaptateurs futurs mapperont `geometry_json` / état applicatif vers ce DTO.
 *
 * Repère image (héritage calpinage) :
 * - origine coin haut-gauche, +x vers la droite, +y vers le bas (pixels).
 * - Conversion WORLD : voir `worldMapping.ts` et commentaires sur `northAngleDeg`.
 */

/** Point 2D en pixels image + hauteur optionnelle en mètres (repère absolu vertical). */
export interface LegacyImagePoint2D {
  readonly xPx: number;
  readonly yPx: number;
  /** Hauteur au-dessus du repère zéro du chantier (m). Si absent, interpolation / défaut. */
  readonly heightM?: number;
}

/**
 * Un pan tel que produit par le legacy (polygone image + indices stables si disponibles).
 */
export interface LegacyPanInput {
  readonly id: string;
  /** Polygone fermé (dernier point ≠ premier si fermeture implicite ; le builder ferme le cycle). */
  readonly polygonPx: readonly LegacyImagePoint2D[];
  /** Indices optionnels pour traçabilité (legacy pan-1, etc.). */
  readonly sourceIndex?: number;
  /** Indices physiques du legacy (ne modifient pas la géométrie ; audit). */
  readonly tiltDegHint?: number;
  readonly azimuthDegHint?: number;
}

/**
 * Ligne structurante 2D (faîtage, rupture, noue…) — extrémités en pixels + hauteurs optionnelles.
 * Le builder l’utilise comme contrainte de reconstruction (Z, ridges 3D, cohérence d’arêtes).
 */
export interface LegacyStructuralLine2D {
  readonly id: string;
  readonly kind: "ridge" | "trait";
  readonly a: LegacyImagePoint2D;
  readonly b: LegacyImagePoint2D;
}

/**
 * Extension / lucarne reconnue en entrée — géométrie 3D résolue dans une passe ultérieure.
 * Présence typée pour éviter la dette structurelle ; le solveur principal peut l’ignorer.
 */
export interface LegacyExtensionInput {
  readonly id: string;
  readonly kind: "dormer" | "shed" | "chien_assis" | "other";
  /** Si vrai, hors enveloppe principale (shell) pour la reconstruction future. */
  readonly excludedFromMainShell?: boolean;
}

/**
 * Entrée complète pour reconstruction 3D.
 */
export interface LegacyRoofGeometryInput {
  /** Échelle horizontale : mètres par pixel image (strictement > 0). */
  readonly metersPerPixel: number;
  /**
   * Angle (deg) : rotation dans le plan horizontal du couple (Est,Nord) issu de l’image
   * pour aligner le « haut image » (-Y px) sur le nord géographique.
   * 0 = le haut de l’image est le nord géographique (convention calpinage nord image).
   * Aligné sur `roof.roof.north.angleDeg` côté legacy.
   */
  readonly northAngleDeg: number;
  /** Hauteur par défaut (m) si aucun sommet n’a de `heightM` sur un pan. */
  readonly defaultHeightM: number;
  readonly pans: readonly LegacyPanInput[];
  /** Faîtages / arêtiers (lignes structurantes fortes). */
  readonly ridges?: readonly LegacyStructuralLine2D[];
  /** Traits / cassures / lignes internes structurantes. */
  readonly traits?: readonly LegacyStructuralLine2D[];
  /** Extensions reconnues (audit / future intégration ; non résolues dans le solveur principal). */
  readonly extensions?: readonly LegacyExtensionInput[];
  readonly studyRef?: string;
  /** Horodatage ISO optionnel (sinon Date.now côté builder). */
  readonly createdAtIso?: string;
}
