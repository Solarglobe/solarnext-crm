/**
 * geometry.schema.ts — Schémas Zod canoniques pour les types géométriques SolarNext.
 *
 * Couvre : coordonnées 2D/3D, polygones de toiture, layout panneaux, résultats d'ombrage.
 * Ces types sont la source de vérité pour les modules calpinage (Phase 2–3) et Étude PV (Phase 4).
 *
 * @module shared/schemas/geometry
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives 2D / 3D
// ---------------------------------------------------------------------------

/** Point 2D en pixels image (espace Konva). */
export const Point2DPxSchema = z.object({
  xPx: z.number().finite(),
  yPx: z.number().finite(),
});
export type Point2DPx = z.infer<typeof Point2DPxSchema>;

/** Point 2D en mètres (espace plan local). */
export const Point2DMSchema = z.object({
  xM: z.number().finite(),
  yM: z.number().finite(),
});
export type Point2DM = z.infer<typeof Point2DMSchema>;

/** Point 3D en mètres (espace monde). */
export const Point3DSchema = z.object({
  xM: z.number().finite(),
  yM: z.number().finite(),
  zM: z.number().finite(),
});
export type Point3D = z.infer<typeof Point3DSchema>;

/** Coordonnées GPS canoniques. */
export const GpsCoordinatesSchema = z.object({
  latDeg: z.number().min(-90).max(90),
  lonDeg: z.number().min(-180).max(180),
  altM: z.number().finite().optional(),
});
export type GpsCoordinates = z.infer<typeof GpsCoordinatesSchema>;

// ---------------------------------------------------------------------------
// Calibration image satellite
// ---------------------------------------------------------------------------

/** Facteur de conversion pixels → mètres (strictement positif). */
export const MetersPerPixelSchema = z.number().positive().finite();

/** Angle Nord géographique par rapport à l'axe Y de l'image, en degrés [0, 360[. */
export const NorthAngleDegSchema = z.number().min(0).lt(360);

/** Calibration complète d'une image satellite. */
export const SatelliteCalibrationSchema = z.object({
  metersPerPixel: MetersPerPixelSchema,
  northAngleDeg: NorthAngleDegSchema,
  originGps: GpsCoordinatesSchema,
});
export type SatelliteCalibration = z.infer<typeof SatelliteCalibrationSchema>;

// ---------------------------------------------------------------------------
// Polygones de toiture
// ---------------------------------------------------------------------------

/** Polygone de pan de toiture défini en pixels image. */
export const RoofPanPolygonPxSchema = z.object({
  /** Identifiant unique du pan. */
  id: z.string().min(1),
  /** Contour du pan en pixels (minimum 3 points). */
  contourPx: z.array(Point2DPxSchema).min(3),
  /** Inclinaison suggérée par l'utilisateur [0°–90°]. Null = non renseigné. */
  tiltDegHint: z.number().min(0).max(90).nullable().optional(),
  /** Azimut suggéré [0°–360°[. Null = non renseigné. */
  azimuthDegHint: z.number().min(0).lt(360).nullable().optional(),
  /** Hauteur de gouttière (mètre sol). */
  gutterHeightM: z.number().finite().optional(),
  /** Hauteur de faîtage (mètre sol). */
  ridgeHeightM: z.number().finite().optional(),
});
export type RoofPanPolygonPx = z.infer<typeof RoofPanPolygonPxSchema>;

/** Polygone de pan reconstruit en 3D (espace monde local). */
export const RoofPanPolygon3DSchema = z.object({
  id: z.string().min(1),
  /** Coins du pan en coordonnées monde (mètres). */
  cornersWorld: z.array(Point3DSchema).min(3),
  /** Inclinaison réelle calculée [0°–90°]. */
  tiltDeg: z.number().min(0).max(90),
  /** Azimut réel calculé [0°–360°[. */
  azimuthDeg: z.number().min(0).lt(360),
  /** Normale au plan du pan (vecteur unitaire). */
  normalWorld: Point3DSchema.optional(),
});
export type RoofPanPolygon3D = z.infer<typeof RoofPanPolygon3DSchema>;

/** Représentation complète d'un toit (ensemble de pans). */
export const RoofPolygonSchema = z.object({
  roofId: z.string().min(1),
  pans: z.array(RoofPanPolygon3DSchema).min(1),
  /** Emprise globale du toit en coordonnées monde. */
  footprintWorld: z.array(Point3DSchema).min(3).optional(),
});
export type RoofPolygon = z.infer<typeof RoofPolygonSchema>;

// ---------------------------------------------------------------------------
// Layout panneaux
// ---------------------------------------------------------------------------

/** Dimensions physiques d'un panneau solaire (mètres). */
export const PanelDimensionsSchema = z.object({
  widthM: z.number().positive().finite(),
  heightM: z.number().positive().finite(),
  thicknessM: z.number().positive().finite().optional(),
});
export type PanelDimensions = z.infer<typeof PanelDimensionsSchema>;

/** Un panneau positionné sur un pan de toiture. */
export const PlacedPanelSchema = z.object({
  panelId: z.string().min(1),
  /** Identifiant du pan hôte. */
  panId: z.string().min(1),
  /** Centre du panneau en coordonnées monde. */
  centerWorld: Point3DSchema,
  /** Rotation autour de la normale au pan (radians). */
  rotationRad: z.number().finite().optional(),
  /** Puissance-crête nominale (Wc). */
  powerWc: z.number().positive().finite(),
});
export type PlacedPanel = z.infer<typeof PlacedPanelSchema>;

/** Layout complet de tous les panneaux sur tous les pans. */
export const PanelLayoutSchema = z.object({
  studyId: z.string().min(1),
  totalPowerKwc: z.number().nonnegative().finite(),
  panelCount: z.number().int().nonnegative(),
  panels: z.array(PlacedPanelSchema),
  /** Timestamp de génération du layout (ISO 8601). */
  generatedAt: z.string().datetime().optional(),
});
export type PanelLayout = z.infer<typeof PanelLayoutSchema>;

// ---------------------------------------------------------------------------
// Ombrage
// ---------------------------------------------------------------------------

/** Masque d'horizon pour un point de mesure (lossFactors par tranche d'azimut). */
export const HorizonMaskSchema = z.object({
  /** Azimuths de mesure en degrés [0–360[. */
  azimuthsDeg: z.array(z.number().min(0).lt(360)),
  /** Élévation de l'horizon correspondante (degrés). Même longueur que azimuthsDeg. */
  elevationsDeg: z.array(z.number().min(0).max(90)),
});
export type HorizonMask = z.infer<typeof HorizonMaskSchema>;

/** Résultat d'ombrage pour un pan ou pour l'installation complète. */
export const ShadingResultSchema = z.object({
  /** Identifiant du pan (null = résultat global installation). */
  panId: z.string().min(1).nullable(),
  /** Perte annuelle due aux ombrages proches (ratio 0–1). */
  nearShadingLossRatio: z.number().min(0).max(1),
  /** Perte annuelle due à l'horizon lointain (ratio 0–1). */
  farHorizonLossRatio: z.number().min(0).max(1),
  /** Perte combinée totale (ratio 0–1). */
  totalShadingLossRatio: z.number().min(0).max(1),
  /** Facteur de performance après ombrage (= 1 - totalShadingLossRatio). */
  shadingPerformanceFactor: z.number().min(0).max(1),
  /** Masque d'horizon utilisé pour le calcul. */
  horizonMask: HorizonMaskSchema.optional(),
  /** Timestamp du calcul (ISO 8601). */
  computedAt: z.string().datetime().optional(),
});
export type ShadingResult = z.infer<typeof ShadingResultSchema>;
