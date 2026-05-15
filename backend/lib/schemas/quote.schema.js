/**
 * backend/lib/schemas/quote.schema.js
 *
 * Schémas Zod pour le domaine Quotes.
 * Version JS — miroir de shared/schemas/quote.schema.ts.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Ligne de devis
// ---------------------------------------------------------------------------
const QuoteLineSchema = z.object({
  description:  z.string().min(1, "La description est requise").max(500),
  quantity:     z.number().positive("La quantité doit être positive"),
  unit_price:   z.number().finite("Le prix unitaire doit être un nombre fini"),
  vat_rate:     z.number().min(0).max(1).optional().default(0.2),
  discount:     z.number().min(0).max(1).optional().default(0),
  catalog_ref:  z.string().optional().nullable(),
  category:     z.string().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Devis
// ---------------------------------------------------------------------------
const QuoteShapeSchema = z.object({
  lead_id:      z.string().uuid("lead_id doit être un UUID"),
  study_id:     z.string().uuid().optional().nullable(),
  title:        z.string().min(1).max(200).optional(),
  notes:        z.string().optional().nullable(),
  valid_until:  z.string().datetime({ offset: true }).optional().nullable(),
  lines:        z.array(QuoteLineSchema).optional().default([]),
  discount_pct: z.number().min(0).max(100).optional().nullable(),
  payment_terms: z.string().max(500).optional().nullable(),
});

export const CreateQuoteSchema = QuoteShapeSchema;
export const PatchQuoteSchema  = QuoteShapeSchema.partial();

// ---------------------------------------------------------------------------
// Changement de statut
// ---------------------------------------------------------------------------
export const PatchQuoteStatusSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]),
  reason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Query string
// ---------------------------------------------------------------------------
export const QuoteListQuerySchema = z.object({
  lead_id:  z.string().uuid().optional(),
  status:   z.string().optional(),
  page:     z.coerce.number().int().positive().optional().default(1),
  limit:    z.coerce.number().int().min(1).max(100).optional().default(50),
  archived: z.enum(["true", "false", "only"]).optional(),
});
