/**
 * backend/lib/schemas/study.schema.js
 *
 * Schémas Zod pour le domaine Studies.
 * Version JS — miroir de shared/schemas/study.schema.ts.
 */

import { z } from "zod";
import { GeometryCalculationSchema } from "./geometry.schema.js";

export { GeometryCalculationSchema };

// ---------------------------------------------------------------------------
// Paramètres d'URL études
// ---------------------------------------------------------------------------
export const StudyParamsSchema = z.object({
  id:        z.string().uuid("L'identifiant d'étude doit être un UUID"),
  versionId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Création / mise à jour d'étude
// ---------------------------------------------------------------------------
export const CreateStudySchema = z.object({
  lead_id:     z.string().uuid("lead_id doit être un UUID"),
  name:        z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
});

export const PatchStudySchema = CreateStudySchema.partial();

// ---------------------------------------------------------------------------
// Sélection de scénario
// ---------------------------------------------------------------------------
export const SelectScenarioSchema = z.object({
  scenario_index: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// Payload de lancement de calcul (POST /studies/:id/run)
// ---------------------------------------------------------------------------
export const RunStudySchema = z.object({
  meter_id:      z.string().uuid().optional(),
  force_recalc:  z.boolean().optional().default(false),
  geometry_override: GeometryCalculationSchema.partial().optional(),
});
