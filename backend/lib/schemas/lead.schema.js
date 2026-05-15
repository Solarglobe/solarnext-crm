/**
 * backend/lib/schemas/lead.schema.js
 *
 * Schémas Zod pour le domaine Leads.
 * Version JS — miroir de shared/schemas/lead.schema.ts.
 */

import { z } from "zod";
import { UuidParamsSchema } from "./geometry.schema.js";

export { UuidParamsSchema };

// ---------------------------------------------------------------------------
// Shape de base (tous les champs du lead)
// ---------------------------------------------------------------------------
const LeadShapeSchema = z.object({
  first_name:    z.string().min(1, "Le prénom est requis").max(100),
  last_name:     z.string().min(1, "Le nom est requis").max(100),
  email:         z.string().email("Email invalide").optional().nullable(),
  phone:         z.string().max(30).optional().nullable(),
  address:       z.string().max(500).optional().nullable(),
  city:          z.string().max(100).optional().nullable(),
  zip:           z.string().max(20).optional().nullable(),
  lat:           z.number().min(-90).max(90).optional().nullable(),
  lng:           z.number().min(-180).max(180).optional().nullable(),
  status:        z.enum(["NEW", "CONTACTED", "QUALIFIED", "SIGNED", "LOST", "ARCHIVED", "CLIENT"]).optional(),
  source:        z.string().max(100).optional().nullable(),
  notes:         z.string().optional().nullable(),
  assigned_to:   z.string().uuid().optional().nullable(),
  consumption_kwh_year: z.number().positive().optional().nullable(),
  roof_area_m2:  z.number().positive().optional().nullable(),
});

export const CreateLeadSchema = LeadShapeSchema;
export const PatchLeadSchema  = LeadShapeSchema.partial();

// ---------------------------------------------------------------------------
// Query string pour la liste des leads
// ---------------------------------------------------------------------------
export const LeadListQuerySchema = z.object({
  status:    z.string().optional(),
  assigned:  z.string().uuid().optional(),
  page:      z.coerce.number().int().positive().optional().default(1),
  limit:     z.coerce.number().int().min(1).max(200).optional().default(50),
  search:    z.string().max(200).optional(),
  archived:  z.enum(["true", "false", "only"]).optional(),
  sort:      z.enum(["created_at", "updated_at", "last_name", "status"]).optional(),
  order:     z.enum(["asc", "desc"]).optional(),
});
