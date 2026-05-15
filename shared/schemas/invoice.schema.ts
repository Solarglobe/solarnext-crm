/**
 * invoice.schema.ts — Schémas Zod canoniques pour les entités Facture et Paiements.
 *
 * Aligné sur les tables SQL `invoices` + `invoice_lines` + `payments`.
 * Structure proche du devis avec en plus : total payé, paiements, statut de règlement.
 *
 * @module shared/schemas/invoice
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Énumérations
// ---------------------------------------------------------------------------

export const InvoiceStatusSchema = z.enum([
  "draft",
  "sent",
  "partial",
  "paid",
  "overdue",
  "cancelled",
  "refunded",
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const PaymentMethodSchema = z.enum([
  "virement",
  "cheque",
  "especes",
  "carte",
  "prelevement",
  "autre",
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// ---------------------------------------------------------------------------
// Paiement
// ---------------------------------------------------------------------------

const PaymentBaseSchema = z.object({
  /** Montant du paiement (€). */
  amount: z.number().positive().finite(),
  /** Date du paiement (ISO 8601 date, ex. "2024-06-15"). */
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: PaymentMethodSchema,
  /** Référence de virement / numéro de chèque / etc. */
  reference: z.string().max(255).optional(),
  notes: z.string().optional(),
});

export const PaymentResponseSchema = PaymentBaseSchema.extend({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  created_at: z.string().datetime(),
  recorded_by_user_id: z.string().uuid().optional(),
});
export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;

export const CreatePaymentSchema = PaymentBaseSchema;
export type CreatePayment = z.infer<typeof CreatePaymentSchema>;

// ---------------------------------------------------------------------------
// Ligne de facture
// ---------------------------------------------------------------------------

const InvoiceLineBaseSchema = z.object({
  article_id: z.string().uuid().optional(),
  description: z.string().min(1).max(1000),
  quantity: z.number().positive().finite(),
  unit_price_ht: z.number().nonnegative().finite(),
  /** Taux de TVA (ratio, ex. 0.10 pour 10%). */
  vat_rate: z.number().min(0).max(1).finite(),
  position: z.number().int().positive().default(1),
  unit: z.string().max(30).optional(),
});

export const InvoiceLineResponseSchema = InvoiceLineBaseSchema.extend({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  total_line_ht: z.number().nonnegative().finite(),
  total_line_vat: z.number().nonnegative().finite(),
  total_line_ttc: z.number().nonnegative().finite(),
});
export type InvoiceLineResponse = z.infer<typeof InvoiceLineResponseSchema>;

export const CreateInvoiceLineSchema = InvoiceLineBaseSchema;
export type CreateInvoiceLine = z.infer<typeof CreateInvoiceLineSchema>;

// ---------------------------------------------------------------------------
// Schéma de base Facture
// ---------------------------------------------------------------------------

const InvoiceBaseSchema = z.object({
  /** Numéro lisible de la facture (ex. "FAC-2024-0042"). Généré côté serveur si absent. */
  invoice_number: z.string().max(50).optional(),
  status: InvoiceStatusSchema.default("draft"),

  // Références
  client_id: z.string().uuid(),
  /** Devis d'origine (optionnel). */
  quote_id: z.string().uuid().optional(),
  study_version_id: z.string().uuid().optional(),

  // Totaux
  total_ht: z.number().nonnegative().finite().optional(),
  total_vat: z.number().nonnegative().finite().optional(),
  total_ttc: z.number().nonnegative().finite().optional(),

  /** Date d'émission (ISO 8601 date). */
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Date d'échéance (ISO 8601 date). */
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  notes: z.string().optional(),
  metadata_json: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateInvoiceSchema = InvoiceBaseSchema.extend({
  lines: z.array(CreateInvoiceLineSchema).min(1).optional(),
  /** Paiements initiaux (acompte à la commande, etc.). */
  payments: z.array(CreatePaymentSchema).optional(),
});
export type CreateInvoice = z.infer<typeof CreateInvoiceSchema>;

// ---------------------------------------------------------------------------
// Update (PATCH partiel)
// ---------------------------------------------------------------------------

export const UpdateInvoiceSchema = InvoiceBaseSchema.partial().extend({
  lines: z.array(CreateInvoiceLineSchema).optional(),
});
export type UpdateInvoice = z.infer<typeof UpdateInvoiceSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const InvoiceResponseSchema = InvoiceBaseSchema.extend({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  /** Totaux toujours présents en response. */
  total_ht: z.number().nonnegative().finite(),
  total_vat: z.number().nonnegative().finite(),
  total_ttc: z.number().nonnegative().finite(),
  /** Total des paiements reçus (€). */
  total_paid: z.number().nonnegative().finite(),
  /** Solde restant à payer (€ = total_ttc − total_paid). */
  balance_due: z.number().finite(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  /** Lignes incluses si expand=lines. */
  lines: z.array(InvoiceLineResponseSchema).optional(),
  /** Paiements inclus si expand=payments. */
  payments: z.array(PaymentResponseSchema).optional(),
});
export type InvoiceResponse = z.infer<typeof InvoiceResponseSchema>;
