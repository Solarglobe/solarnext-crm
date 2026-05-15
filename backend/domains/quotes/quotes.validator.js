/**
 * domains/quotes/quotes.validator.js — Middleware de validation Zod pour le domaine Quotes.
 */

import { z } from "zod";

const QuoteLineSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number().positive(),
  unit_price:  z.number(),
  vat_rate:    z.number().min(0).max(1).optional(),
  discount:    z.number().min(0).max(1).optional(),
});

const CreateQuoteSchema = z.object({
  lead_id:     z.string().uuid(),
  study_id:    z.string().uuid().optional().nullable(),
  title:       z.string().min(1).max(200).optional(),
  notes:       z.string().optional().nullable(),
  valid_until: z.string().datetime().optional().nullable(),
  lines:       z.array(QuoteLineSchema).optional(),
});

const PatchQuoteSchema = CreateQuoteSchema.partial();

export function validateCreateQuote(req, res, next) {
  const result = CreateQuoteSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: "Données de devis invalides",
      details: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

export function validatePatchQuote(req, res, next) {
  const result = PatchQuoteSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: "Données de mise à jour invalides",
      details: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}
