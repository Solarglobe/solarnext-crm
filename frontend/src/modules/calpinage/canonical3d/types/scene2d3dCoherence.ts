/**
 * Types du diagnostic de cohérence 2D → 3D (scène finale `SolarScene3D`).
 * Fichier autonome pour éviter les cycles d’import avec le validateur.
 */

export type CoherenceSeverity = "INFO" | "WARNING" | "ERROR";

export type CoherenceScope =
  | "ROOF"
  | "PAN"
  | "OBSTACLE"
  | "PANEL"
  | "SHADOW_VOLUME"
  | "WORLD"
  | "SCENE"
  | "SOURCE";

export type CoherenceIssue = {
  readonly code: string;
  readonly severity: CoherenceSeverity;
  readonly scope: CoherenceScope;
  readonly message: string;
  readonly entityId?: string;
  readonly details?: Record<string, unknown>;
};

/** Traçabilité minimale dessin 2D → entrée pipeline (pas de dump d’état complet). */
export type Scene2DSourceTrace = {
  readonly schemaVersion: "scene-2d-source-trace-v1";
  readonly roofOutline2D?: {
    readonly contourPx?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
    readonly vertexCount?: number;
  };
  readonly sourcePanIds: readonly string[];
  readonly sourceObstacleIds: readonly string[];
  readonly sourcePanelIds: readonly string[];
  readonly sourceObstacleFootprints2D?: ReadonlyArray<{
    readonly id: string;
    readonly polygonPx: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  }>;
  /** Ids patches issus du builder toiture (chemin legacy / roof model). */
  readonly expectedRoofPlanePatchIds?: readonly string[];
  readonly metrics?: {
    readonly roofOutlineArea2DPx?: number;
    /** Aire horizontale monde (m²) du contour — `polygonHorizontalAreaM2FromImagePx` (trace Niveau 4 ; chaîne Niveau 3). */
    readonly roofOutlineHorizontalAreaM2?: number;
    readonly roofOutlineBBox2D?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
    readonly sourcePanCount?: number;
    readonly sourceObstacleCount?: number;
    readonly sourcePanelCount?: number;
  };
};

/** Synthèse honnête — dérivée de faits (trace, issues, couverture), pas un score marketing. */
export type CoherenceConfidence = {
  readonly source2DLinked: boolean;
  readonly roofTraceabilityLevel: "FULL" | "PARTIAL" | "LEGACY_ONLY" | "NONE";
  readonly geometryConfidence: "HIGH" | "MEDIUM" | "LOW";
  /** 0..1 — couverture moyenne ids source → entités scène (pans / obstacles / panneaux). */
  readonly sourceCoverageRatio?: number;
};

/** Résumé dérivé uniquement de `issues` + présence de `sourceTrace` sur la scène — une seule source de vérité. */
export type CoherenceSummary = {
  readonly hasSourceTrace: boolean;
  /** Erreur bloquante sur la géométrie / monde / maillage (scopes hors fidélité SOURCE pure). */
  readonly hasBlockingGeometryErrors: boolean;
  /** Couverture source insuffisante ou écart d’emprise toit (codes SOURCE_COVERAGE_LOW, ROOF_OUTLINE_AREA_MISMATCH). */
  readonly hasRoofSourceCoverageGap: boolean;
  /** Divergence ou alignement faible pans / legacy (codes ROOF_PATCH_*, ROOF_MODEL_PAN_ALIGNMENT_WEAK). */
  readonly hasRoofModelPatchDivergence: boolean;
  readonly hasPanelLayoutGlobalMismatch: boolean;
  /** Au moins un id source pan / obstacle / panneau absent en scène. */
  readonly hasMissingSceneEntitiesFromSource: boolean;
  readonly warningCount: number;
  readonly errorCount: number;
};

/** Grade produit — déduit de faits (`isCoherent`, `summary`, `confidence`). */
export type SceneQualityGrade = "A" | "B" | "C" | "D" | "F";

export type Validate2DTo3DCoherenceStats = {
  readonly roofCount: number;
  readonly panCount: number;
  readonly obstacleCount: number;
  readonly panelCount: number;
  readonly shadowVolumeCount: number;
  readonly invalidPanCount: number;
  readonly invalidObstacleCount: number;
  readonly invalidPanelCount: number;
  readonly invalidShadowVolumeCount: number;
};

export type Validate2DTo3DCoherenceResult = {
  /** Vrai si aucune issue `ERROR` (structure + fidélité sévère). */
  readonly isCoherent: boolean;
  readonly issues: readonly CoherenceIssue[];
  readonly stats: Validate2DTo3DCoherenceStats;
  readonly confidence: CoherenceConfidence;
  readonly summary: CoherenceSummary;
  readonly sceneQualityGrade: SceneQualityGrade;
};
