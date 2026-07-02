/**
 * Phase A — Interface de découplage : règles d'implantation PV.
 *
 * CONTRAT UNIQUEMENT — aucune implémentation, aucune référence à window.*.
 *
 * Rôle : typer window.PV_LAYOUT_RULES et la config par pan sous un contrat
 * stable, que le moteur pvPlacementEngine peut recevoir en paramètre sans
 * lire window directement.
 *
 * Sources legacy :
 *   - window.PV_LAYOUT_RULES (marginOuterCm, spacingXcm, spacingYcm, orientation)
 *     → initialisé ligne 3691 de calpinage.module.js
 *     → copié depuis CALPINAGE_STATE.pvParams à l'initialisation (ligne 4171)
 *   - pan.flatRoofConfig (supportTiltDeg, layoutOrientation, rowSpacingCm, etc.)
 *     → DEFAULT_FLAT_ROOF_CONFIG ligne 148 de calpinage.module.js
 *
 * Correspondance des champs (commentaire définitif — ne pas modifier) :
 *   spacingXcm = espacement perpendiculaire à la pente (inter-panneaux, axe faîtage)
 *   spacingYcm = espacement selon la pente (inter-rangées, axe pente)
 *   Alias legacy : spacingXcm_perpToSlope / spacingYcm_alongSlope
 *
 * Invariants :
 *   - marginOuterCm >= 0
 *   - spacingXcm >= 0
 *   - spacingYcm >= 0
 *   - flatRoofConfig présent si et seulement si roofType === "FLAT"
 *
 * Note store (Phase 1) : le store Zustand absorbera PV_LAYOUT_RULES
 * sous store.pvLayoutRules (Record, pas Map — cf. Section 1.6 du plan).
 */

// ─────────────────────────────────────────────────────────────────────────────
// FlatRoofConfig — configuration spécifique aux toitures plates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inclinaison du support en toiture plate (degrés).
 * Legacy (sans matériel de pose) : 5, 10 ou 15.
 * LOT A matériel de pose : valeurs imposées par le système fabricant
 * (K2 Dome 10/15°, ESDEC Fusion 13°, K2 TiltUp 20/25/30°) — d'où number.
 * La validation des valeurs autorisées est faite par normalizeFlatRoofConfig
 * (catalogue flatRoofMountingSystems.js), pas par ce type.
 */
export type FlatRoofSupportTiltDeg = number;

/**
 * Configuration spécifique toiture plate, par pan.
 *
 * PIÈGE (Section 6.2 du plan) : les champs ne doivent PAS être renommés ni restructurés
 * lors de la migration V1→V2 — cela repositionnerait les panneaux sur toutes les études plates.
 */
export interface FlatRoofConfig {
  /**
   * Inclinaison du support (5, 10 ou 15°).
   * Détermine l'espacement inter-rangées via la formule d'ombrage mutuel.
   */
  readonly supportTiltDeg: FlatRoofSupportTiltDeg;
  /**
   * Orientation des modules sur le support.
   * "portrait" (long côté vertical) ou "landscape" (long côté horizontal).
   */
  readonly layoutOrientation: "portrait" | "landscape";
  /**
   * Espacement minimal inter-rangées (cm), calculé depuis la géométrie du support.
   * Calculé automatiquement — pas modifiable directement par l'utilisateur.
   */
  readonly rowSpacingCm: number;
  /**
   * Même valeur en mm (rowSpacingCm × 10).
   * Conservé pour compatibilité legacy — certains affichages utilisent la valeur mm.
   */
  readonly rowSpacingMm?: number;
  /**
   * true si l'espacement inter-rangées a été surchargé manuellement.
   * false (ou absent) → valeur calculée automatiquement.
   */
  readonly rowSpacingManual?: boolean;
  /**
   * LOT A — id du système de pose fabricant (catalogue flatRoofMountingSystems.js).
   * null/absent = mode générique legacy (5/10/15°, 55 cm).
   */
  readonly mountingSystemId?: string | null;
  /**
   * LOT A — snapshot figé du système (marque, libellé, tilt, lien calculateur…)
   * persisté avec l'étude pour le devis / PDF (Lot D). Jamais lu par le moteur de placement.
   */
  readonly mountingSystem?: Readonly<Record<string, unknown>> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlacementRules — règles d'implantation PV globales
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Règles d'implantation PV injectées dans le moteur pvPlacementEngine.
 *
 * Correspond à window.PV_LAYOUT_RULES enrichi du roofType et de la config
 * spécifique toiture plate. Le moteur n'a pas à distinguer "global" vs "par pan" —
 * l'appelant construit un PlacementRules par pan avec les bonnes valeurs.
 *
 * Valeurs initiales par défaut (ligne 3691 du module legacy) :
 *   marginOuterCm: 20, spacingXcm: 2, spacingYcm: 4.5, orientation: "portrait"
 */
export interface PlacementRules {
  /**
   * Marge de sécurité par rapport aux bords du pan (cm).
   * Correspond à pvParams.distanceLimitesCm / PV_LAYOUT_RULES.marginOuterCm.
   * Appliquée à tous les bords (avant keepout zones additionnelles).
   */
  readonly marginOuterCm: number;

  /**
   * Espacement inter-panneaux perpendiculaire à la pente (cm).
   * = axe faîtage / inter-colonnes (axe X dans le repère du pan).
   * Alias legacy : spacingXcm_perpToSlope.
   * Correspond à pvParams.espacementHorizontalCm.
   */
  readonly spacingXcm: number;

  /**
   * Espacement inter-rangées selon la pente (cm).
   * = axe pente / inter-rangées (axe Y dans le repère du pan).
   * Alias legacy : spacingYcm_alongSlope.
   * Correspond à pvParams.espacementVerticalCm.
   * Pour les toitures plates, écrasé par flatRoofConfig.rowSpacingCm (calcul ombrage mutuel).
   */
  readonly spacingYcm: number;

  /**
   * Orientation des modules PV sur ce pan.
   * "portrait"  : côté long vertical (selon la pente)
   * "landscape" : côté long horizontal (perpendiculaire à la pente)
   */
  readonly orientation: "portrait" | "landscape";

  /**
   * Type de toiture pour ce jeu de règles.
   * "FLAT" → flatRoofConfig doit être présent.
   * "PITCHED" → flatRoofConfig absent ou ignoré.
   */
  readonly roofType: "PITCHED" | "FLAT";

  /**
   * Configuration spécifique toiture plate.
   * Obligatoire si roofType === "FLAT", ignoré sinon.
   */
  readonly flatRoofConfig?: FlatRoofConfig;
}
