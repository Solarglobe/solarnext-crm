/**
 * backend/lib/schemas/lead.schema.js
 *
 * Schemas Zod pour le domaine Leads.
 * Version JS - miroir de shared/schemas/lead.schema.ts.
 */

import { z } from "zod";
import { UuidParamsSchema } from "./geometry.schema.js";

export { UuidParamsSchema };

// ---------------------------------------------------------------------------
// Shape de base (tous les champs du lead)
// ---------------------------------------------------------------------------
const LeadShapeSchema = z.object({
  first_name: z.string().min(1, "Le prenom est requis").max(100).optional().nullable(),
  last_name: z.string().min(1, "Le nom est requis").max(100).optional().nullable(),
  email: z.string().email("Email invalide").optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  phone_mobile: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "SIGNED", "LOST", "ARCHIVED", "CLIENT"]).optional(),
  source: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  assigned_user_id: z.string().uuid().optional().nullable(),
  stage_id: z.string().uuid().optional().nullable(),
  source_id: z.string().uuid().optional().nullable(),
  customer_type: z.enum(["PERSON", "PRO"]).optional().default("PERSON"),
  company_name: z.string().min(1, "Le nom de l'entreprise est requis").max(255).optional().nullable(),
  contact_first_name: z.string().max(100).optional().nullable(),
  contact_last_name: z.string().max(100).optional().nullable(),
  siret: z.string().regex(/^\d{14}$/, "SIRET doit contenir exactement 14 chiffres").optional().nullable(),
  consumption_kwh_year: z.number().positive().optional().nullable(),
  roof_area_m2: z.number().positive().optional().nullable(),
});

export const CreateLeadSchema = LeadShapeSchema.superRefine((data, ctx) => {
  const customerType = data.customer_type ?? "PERSON";
  const hasPhone = Boolean((data.phone ?? data.phone_mobile ?? "").trim());
  const hasEmail = Boolean((data.email ?? "").trim());

  if (!hasPhone && !hasEmail) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["phone"],
      message: "Le telephone ou l'email est obligatoire",
    });
  }

  if (customerType === "PRO") {
    if (!data.company_name?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["company_name"],
        message: "Le nom de l'entreprise est requis",
      });
    }
    return;
  }

  if (!data.first_name?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["first_name"],
      message: "Le prenom est requis",
    });
  }
  if (!data.last_name?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["last_name"],
      message: "Le nom est requis",
    });
  }
});

export const PatchLeadSchema = LeadShapeSchema.partial();

// ---------------------------------------------------------------------------
// Query string pour la liste des leads
// ---------------------------------------------------------------------------
export const LeadListQuerySchema = z.object({
  status: z.string().optional(),
  assigned: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  search: z.string().max(200).optional(),
  archived: z.enum(["true", "false", "only"]).optional(),
  sort: z.enum(["created_at", "updated_at", "last_name", "status"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});
