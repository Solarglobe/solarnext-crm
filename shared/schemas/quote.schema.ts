/**
 * quote.schema.ts — Schémas Zod canoniques pour les entités Devis et Lignes de devis.
 *
 * Aligné sur la table SQL `quotes` + `quote_lines`.
 * Les montants sont en euros (€), sans arrondi — le moteur de calcul gère l'arrondi.
 *
 * @module shared/schemas/quote
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Énumérations
// ---------------------------------------------------------------------------

export const QuoteStatusSchema = z.enum([
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
]);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

// ---------------------------------------------------------------------------
// Ligne de devis
// ---------------------------------------------------------------------------

const QuoteLineBaseSchema = z.object({
  /** Référence article / produit (optionnel si description libre). */
  article_id: z.string().uuid().optional(),
  description: z.string().min(1).max(1000),
  quantity: z.number().positive().finite(),
  unit_price_ht: z.number().nonnegative().finite(),
  /** Taux de TVA (ratio, ex. 0.10 pour 10%). */
  vat_rate: z.number().min(0).max(1).finite(),
  /** Position d'affichage dans le devis (entier ≥ 1). */
  position: z.number().int().positive().default(1),
  /** Unité de mesure (ex. "unité", "m²", "kWc"). */
  unit: z.string().max(30).optional(),
});

/** Ligne calculée (totaux déduits de quantity × unit_price_ht). */
export const QuoteLineResponseSchema = QuoteLineBaseSchema.extend({
  id: z.string().uuid(),
  quote_id: z.string().uuid(),
  total_line_ht: z.number().nonnegative().finite(),
  total_line_vat: z.number().nonnegative().finite(),
  total_line_ttc: z.number().nonnegative().finite(),
});
export type QuoteLineResponse = z.infer<typeof QuoteLineResponseSchema>;

export const CreateQuoteLineSchema = QuoteLineBaseSchema;
export type CreateQuoteLine = z.infer<typeof CreateQuoteLineSchema>;

export const UpdateQuoteLineSchema = QuoteLineBaseSchema.partial();
export type UpdateQuoteLine = z.infer<typeof UpdateQuoteLineSchema>;

// ---------------------------------------------------------------------------
// Schéma de base Devis
// ---------------------------------------------------------------------------

const QuoteBaseSchema = z.object({
  /** Numéro lisible du devis (ex. "DEV-2024-0042"). Généré côté serveur si absent. */
  quote_number: z.string().max(50).optional(),
  status: QuoteStatusSchema.default("draft"),

  // Références
  client_id: z.string().uuid(),
  study_version_id: z.string().uuid().optional(),

  // Totaux (calculés par le serveur, acceptés en entrée pour les devis manuels)
  total_ht: z.number().nonnegative().finite().optional(),
  total_vat: z.number().nonnegative().finite().optional(),
  total_ttc: z.number().nonnegative().finite().optional(),

  /** Date de validité (ISO 8601 date, ex. "2024-12-31"). */
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  notes: z.string().optional(),

  /** Métadonnées libres (JSON). */
  metadata_json: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateQuoteSchema = QuoteBaseSchema.extend({
  /** Lignes du devis à créer en même temps. */
  lines: z.array(CreateQuoteLineSchema).min(1).optional(),
});
export type CreateQuote = z.infer<typeof CreateQuoteSchema>;

// ---------------------------------------------------------------------------
// Update (PATCH partiel)
// ---------------------------------------------------------------------------

export const UpdateQuoteSchema = QuoteBaseSchema.partial().extend({
  lines: z.array(CreateQuoteLineSchema).optional(),
});
export type UpdateQuote = z.infer<typeof UpdateQuoteSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const QuoteResponseSchema = QuoteBaseSchema.extend({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  /** Totaux toujours présents en response. */
  total_ht: z.number().nonnegative().finite(),
  total_vat: z.number().nonnegative().finite(),
  total_ttc: z.number().nonnegative().finite(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  /** Lignes incluses si expand=lines. */
  lines: z.array(QuoteLineResponseSchema).optional(),
});
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;
