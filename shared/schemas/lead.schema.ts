/**
 * lead.schema.ts
 * @module shared/schemas/lead
 */

import { z } from "zod";
import { ConsumptionModeSchema } from "./scenario.schema";

export const CivilitySchema = z.enum(["M", "Mme", "Dr", "Me"]);
export type Civility = z.infer<typeof CivilitySchema>;

export const CustomerTypeSchema = z.enum(["PERSON", "PRO"]);
export type CustomerType = z.infer<typeof CustomerTypeSchema>;

export const LeadStatusSchema = z.enum(["LEAD", "CLIENT"]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const ProjectStatusSchema = z.enum([
  "NOUVEAU",
  "CONTACTE",
  "RDV_PLANIFIE",
  "VISITE_EFFECTUEE",
  "DEVIS_ENVOYE",
  "DEVIS_ACCEPTE",
  "EN_INSTALLATION",
  "INSTALLE",
  "PERDU",
  "SANS_SUITE",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const AddressSchema = z.object({
  address_line1: z.string().max(255).optional(),
  address_line2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.string().max(100).default("France"),
});
export type Address = z.infer<typeof AddressSchema>;

export const LeadShapeSchema = z.object({
  civility: CivilitySchema.optional(),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(30).optional(),
  customer_type: CustomerTypeSchema.default("PERSON"),
  company_name: z.string().max(255).optional(),
  siret: z.string().regex(/^\d{14}$/, "SIRET doit contenir exactement 14 chiffres").optional(),
  ...AddressSchema.shape,
  construction_year: z.number().int().min(1800).max(2100).optional(),
  is_primary_residence: z.boolean().default(true),
  consumption_mode: ConsumptionModeSchema.default("ANNUAL"),
  consumption_annual_kwh: z.number().nonnegative().finite().optional(),
  rgpd_consent: z.boolean().default(false),
  status: LeadStatusSchema.default("LEAD"),
  project_status: ProjectStatusSchema.optional(),
  stage_id: z.string().uuid().optional(),
  assigned_user_id: z.string().uuid().optional(),
  source_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const CreateLeadSchema = LeadShapeSchema.superRefine((data, ctx) => {
  if (data.customer_type === "PRO" && !data.company_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["company_name"],
      message: "company_name est obligatoire pour un client professionnel",
    });
  }
});
export type CreateLead = z.infer<typeof CreateLeadSchema>;

export const UpdateLeadSchema = LeadShapeSchema.partial();
export type UpdateLead = z.infer<typeof UpdateLeadSchema>;

export const LeadResponseSchema = LeadShapeSchema.extend({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  study_count: z.number().int().nonnegative().optional(),
});
export type LeadResponse = z.infer<typeof LeadResponseSchema>;
