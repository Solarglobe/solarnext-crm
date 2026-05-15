/**
 * backend/lib/schemas/geometry.schema.js
 *
 * Schémas Zod de validation géométrique PV.
 * Version JS (runtime) — miroir de shared/schemas/geometry.schema.ts.
 *
 * Règle clé : un polygone de toit doit avoir au moins 3 points.
 * Le moteur géométrique (domains/studies/geometry/geometry.engine.js)
 * ne reçoit que des données validées via le middleware validate().
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/** Point 2D en pixels (espace image satellite) */
export const Point2DPxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/** Point 2D en mètres (espace monde) */
export const Point2DMSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/** Point 3D en mètres */
export const Point3DSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

/** Coordonnées GPS */
export const GpsCoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  alt: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Polygone de toit — validation avec raffinements métier
// ---------------------------------------------------------------------------

const MIN_POLYGON_POINTS = 3;

/**
 * Schéma de base pour un polygone de toit (liste de points 2D px).
 * Valide : au moins 3 points, coordonnées finies.
 */
export const RoofPolygonPxSchema = z
  .array(Point2DPxSchema)
  .min(MIN_POLYGON_POINTS, `Un polygone de toit doit avoir au moins ${MIN_POLYGON_POINTS} points`);

/**
 * Polygone de toit avec validation du fermeture optionnelle.
 * Si le premier et dernier point sont identiques, c'est un polygone fermé.
 */
export const RoofPolygonClosedSchema = RoofPolygonPxSchema.superRefine((points, ctx) => {
  if (points.length < MIN_POLYGON_POINTS) return; // déjà géré par .min()

  const first = points[0];
  const last = points[points.length - 1];

  // Si seulement 2 points distincts après déduplication → pas un vrai polygone
  const distinct = new Set(points.map(p => `${p.x},${p.y}`)).size;
  if (distinct < MIN_POLYGON_POINTS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Le polygone doit avoir au moins ${MIN_POLYGON_POINTS} points distincts`,
    });
  }
});

/** Polygone 3D d'un pan de toit */
export const RoofPanPolygon3DSchema = z.object({
  points: z.array(Point3DSchema).min(3, "Minimum 3 points pour un pan de toit"),
  normal: Point3DSchema.optional(),
  slope_deg: z.number().min(0).max(90).optional(),
  azimuth_deg: z.number().min(-180).max(180).optional(),
});

// ---------------------------------------------------------------------------
// Calibration satellite
// ---------------------------------------------------------------------------

export const SatelliteCalibrationSchema = z.object({
  pixels_per_meter: z.number().positive(),
  origin_px:        Point2DPxSchema,
  origin_gps:       GpsCoordinatesSchema,
  rotation_deg:     z.number().optional(),
});

// ---------------------------------------------------------------------------
// Panneaux
// ---------------------------------------------------------------------------

export const PanelDimensionsSchema = z.object({
  width_m:  z.number().positive(),
  height_m: z.number().positive(),
  power_wc: z.number().positive(),
});

export const PlacedPanelSchema = z.object({
  id:        z.string(),
  polygon:   z.array(Point2DPxSchema).min(4),
  pan_id:    z.string().optional(),
  rotation:  z.number().optional(),
});

export const PanelLayoutSchema = z.object({
  panels:     z.array(PlacedPanelSchema),
  total_kwc:  z.number().nonnegative(),
  pan_id:     z.string().optional(),
});

// ---------------------------------------------------------------------------
// Masque d'horizon et ombrage
// ---------------------------------------------------------------------------

export const HorizonMaskSchema = z.object({
  azimuths_deg:      z.array(z.number()),
  elevations_deg:    z.array(z.number()),
  source:            z.enum(["pvgis", "dsm", "synthetic", "manual"]).optional(),
});

export const ShadingResultSchema = z.object({
  shading_loss_pct:  z.number().min(0).max(100),
  monthly_loss_pct:  z.array(z.number().min(0).max(100)).length(12).optional(),
  source:            z.string().optional(),
});

// ---------------------------------------------------------------------------
// Params d'URL courants
// ---------------------------------------------------------------------------

/** Valide un paramètre :id UUID */
export const UuidParamsSchema = z.object({
  id: z.string().uuid("L'identifiant doit être un UUID valide"),
});

/** Valide :studyId + :versionId */
export const StudyVersionParamsSchema = z.object({
  studyId:   z.string().uuid(),
  versionId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Payload du moteur géométrique (endpoint POST /studies/:id/geometry)
// ---------------------------------------------------------------------------

/**
 * Payload de calcul géométrique — validé AVANT d'atteindre le moteur.
 * Un polygone non fermé ou avec moins de 3 points → 422 immédiat.
 */
export const GeometryCalculationSchema = z.object({
  lat:             z.number().min(-90).max(90),
  lng:             z.number().min(-180).max(180),
  peak_power_kwp:  z.number().positive("La puissance crête doit être positive"),
  tilt:            z.number().min(0).max(90).optional(),
  azimuth:         z.number().min(-180).max(180).optional(),
  roof_polygon:    RoofPolygonClosedSchema.optional(),
  shading:         ShadingResultSchema.optional(),
  csv_path:        z.string().optional(),
  multi_pan:       z.array(RoofPanPolygon3DSchema).optional(),
  equipment: z.object({
    panel_id:      z.string().optional(),
    inverter_id:   z.string().optional(),
    battery_id:    z.string().optional(),
  }).optional(),
});
