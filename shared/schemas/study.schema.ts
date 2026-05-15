/**
 * study.schema.ts — Schémas Zod canoniques pour l'entité Étude PV.
 *
 * Une étude appartient à un lead. Elle contient un ou plusieurs "versions"
 * avec les données calpinage et les scénarios financiers.
 * La StudyVersionDataJson est le blob persisté dans la colonne JSONB.
 *
 * @module shared/schemas/study
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Statut
// ---------------------------------------------------------------------------

export const StudyStatusSchema = z.enum([
  "DRAFT",
  "EN_COURS",
  "VALIDEE",
  "ARCHIVEE",
]);
export type StudyStatus = z.infer<typeof StudyStatusSchema>;

// ---------------------------------------------------------------------------
// Données de version (blob JSONB)
// ---------------------------------------------------------------------------

/** Snapshot tarifaire au moment du calcul. */
export const MeterSnapshotSchema = z.object({
  /** Prix d'achat du kWh réseau (€/kWh). */
  gridPriceEurKwh: z.number().positive().finite(),
  /** Tarif de revente EDF OA (€/kWh). Null si pas de revente. */
  sellingPriceEurKwh: z.number().nonnegative().finite().nullable().default(null),
  /** Hausse tarifaire annuelle estimée (ratio, ex. 0.03 pour 3%). */
  annualPriceRise: z.number().min(0).max(0.5).default(0.03),
  /** Option tarifaire (BASE, HPHC, etc.). */
  tariffOption: z.string().optional(),
  /** Date du relevé / snapshot (ISO 8601 date). */
  snapshotDate: z.string().datetime().optional(),
});
export type MeterSnapshot = z.infer<typeof MeterSnapshotSchema>;

/** Résultat de calcul persisté dans la version. */
export const StudyCalcResultSchema = z.object({
  /** Puissance-crête totale calculée (kWc). */
  totalPowerKwc: z.number().nonnegative().finite(),
  /** Production annuelle estimée (kWh/an). */
  annualProductionKwh: z.number().nonnegative().finite(),
  /** Retour sur investissement (années). */
  paybackYears: z.number().positive().finite().optional(),
  /** TRI 25 ans (%). */
  irr25Pct: z.number().finite().optional(),
  /** VAN 25 ans (€). */
  npv25Eur: z.number().finite().optional(),
  /** Économies annuelles estimées (€/an, année 1). */
  annualSavingsEur: z.number().nonnegative().finite().optional(),
  /** Hash d'intégrité SHA-256 des paramètres du calcul. */
  integrityHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .default(null),
  /** Version du moteur de calcul. */
  engineVersion: z.string().optional(),
  /** Timestamp du calcul (ISO 8601). */
  computedAt: z.string().datetime().optional(),
});
export type StudyCalcResult = z.infer<typeof StudyCalcResultSchema>;

/** Blob JSONB complet d'une version d'étude. */
export const StudyVersionDataJsonSchema = z.object({
  /** Snapshot tarifaire utilisé pour le calcul. */
  meter_snapshot: MeterSnapshotSchema.optional(),
  /** Résultat de calcul. */
  calc_result: StudyCalcResultSchema.optional(),
  /** Référence aux scénarios v2 (IDs). */
  scenario_ids_v2: z.array(z.string().uuid()).optional(),
  /** Données brutes calpinage (référence, pas stockées ici). */
  calpinage_runtime_ref: z.string().optional(),
});
export type StudyVersionDataJson = z.infer<typeof StudyVersionDataJsonSchema>;

// ---------------------------------------------------------------------------
// Schéma de base
// ---------------------------------------------------------------------------

const StudyBaseSchema = z.object({
  /** Identifiant lisible de l'étude (ex. "ETU-2024-0042"). */
  study_number: z.string().max(50).optional(),
  title: z.string().min(1).max(255).optional(),
  status: StudyStatusSchema.default("DRAFT"),

  // Référence lead
  lead_id: z.string().uuid(),

  // Données calpinage
  /** Puissance totale du calpinage validé (kWc). */
  calpinage_power_kwc: z.number().nonnegative().finite().optional(),
  /** Indique si les scénarios v2 (FinancialSnapshot) sont utilisés. */
  has_scenarios_v2: z.boolean().default(false),

  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateStudySchema = StudyBaseSchema;
export type CreateStudy = z.infer<typeof CreateStudySchema>;

// ---------------------------------------------------------------------------
// Update (PATCH partiel)
// ---------------------------------------------------------------------------

export const UpdateStudySchema = StudyBaseSchema.partial();
export type UpdateStudy = z.infer<typeof UpdateStudySchema>;

// ---------------------------------------------------------------------------
// Version d'étude (entité enfant)
// ---------------------------------------------------------------------------

export const StudyVersionResponseSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  version_number: z.number().int().positive(),
  label: z.string().optional(),
  data_json: StudyVersionDataJsonSchema.optional(),
  is_current: z.boolean().default(false),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type StudyVersionResponse = z.infer<typeof StudyVersionResponseSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const StudyResponseSchema = StudyBaseSchema.extend({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  /** Versions de l'étude (incluses si expand=versions). */
  versions: z.array(StudyVersionResponseSchema).optional(),
  /** Version courante (incluse si expand=current_version). */
  current_version: StudyVersionResponseSchema.nullable().optional(),
});
export type StudyResponse = z.infer<typeof StudyResponseSchema>;
