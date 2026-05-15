/**
 * scenario.schema.ts — Schémas Zod canoniques pour les scénarios énergétiques et financiers.
 *
 * Couvre : configuration batterie virtuelle, scénario de production/consommation,
 * snapshot financier (avec hash d'intégrité pour détecter les calculs obsolètes).
 *
 * @module shared/schemas/scenario
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Batterie virtuelle
// ---------------------------------------------------------------------------

/** Fournisseurs de batterie virtuelle supportés. */
export const VirtualBatteryProviderSchema = z.enum([
  "MYLIGHT_MYBATTERY",
  "MYLIGHT_MYSMARTBATTERY",
  "URBAN_SOLAR",
]);
export type VirtualBatteryProvider = z.infer<typeof VirtualBatteryProviderSchema>;

/** Types de contrat tarifaire. */
export const ContractTypeSchema = z.enum(["BASE", "HPHC"]);
export type ContractType = z.infer<typeof ContractTypeSchema>;

/**
 * Configuration d'une batterie virtuelle.
 * La capacité n'est requise que pour MYLIGHT_MYSMARTBATTERY.
 */
export const VirtualBatteryConfigSchema = z
  .object({
    provider: VirtualBatteryProviderSchema,
    contractType: ContractTypeSchema,
    /** Capacité en kWh — obligatoire pour MYLIGHT_MYSMARTBATTERY. */
    capacityKwh: z.number().positive().finite().optional(),
    /** Identifiant interne du contrat chez le fournisseur. */
    contractId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.provider === "MYLIGHT_MYSMARTBATTERY" &&
      data.capacityKwh === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capacityKwh"],
        message: "capacityKwh est obligatoire pour MYLIGHT_MYSMARTBATTERY",
      });
    }
  });
export type VirtualBatteryConfig = z.infer<typeof VirtualBatteryConfigSchema>;

// ---------------------------------------------------------------------------
// Scénario énergétique
// ---------------------------------------------------------------------------

/** Mode de saisie de la consommation électrique. */
export const ConsumptionModeSchema = z.enum(["ANNUAL", "MONTHLY", "PDL"]);
export type ConsumptionMode = z.infer<typeof ConsumptionModeSchema>;

/** Profil de consommation mensuelle (12 valeurs en kWh). */
export const MonthlyConsumptionSchema = z
  .array(z.number().nonnegative().finite())
  .length(12);
export type MonthlyConsumption = z.infer<typeof MonthlyConsumptionSchema>;

/** Scénario complet de production et consommation. */
export const EnergyScenarioSchema = z.object({
  scenarioId: z.string().min(1),
  label: z.string().min(1),

  // --- Production ---
  /** Puissance-crête installée (kWc). */
  installedPowerKwc: z.number().positive().finite(),
  /** Irradiation annuelle sur plan incliné (kWh/m²/an). */
  irradiationKwhM2Year: z.number().positive().finite(),
  /** Performance Ratio global (0–1). */
  performanceRatio: z.number().min(0).max(1),
  /** Production annuelle nette estimée (kWh/an). */
  annualProductionKwh: z.number().nonnegative().finite(),
  /** Production mensuelle (kWh) — 12 valeurs. */
  monthlyProductionKwh: MonthlyConsumptionSchema.optional(),

  // --- Consommation ---
  consumptionMode: ConsumptionModeSchema,
  /** Consommation annuelle totale (kWh/an). */
  annualConsumptionKwh: z.number().positive().finite(),
  /** Consommation mensuelle (kWh) — 12 valeurs (renseigné si mode MONTHLY ou PDL). */
  monthlyConsumptionKwh: MonthlyConsumptionSchema.optional(),

  // --- Autoconsommation ---
  /** Taux d'autoconsommation estimé (0–1). */
  selfConsumptionRatio: z.number().min(0).max(1).optional(),
  /** Taux d'autoproduction estimé (0–1). */
  selfSufficiencyRatio: z.number().min(0).max(1).optional(),

  // --- Batterie virtuelle ---
  virtualBattery: VirtualBatteryConfigSchema.optional(),

  /** Timestamp de création (ISO 8601). */
  createdAt: z.string().datetime().optional(),
});
export type EnergyScenario = z.infer<typeof EnergyScenarioSchema>;

// ---------------------------------------------------------------------------
// Snapshot financier
// ---------------------------------------------------------------------------

/**
 * Hash d'intégrité : chaîne hexadécimale SHA-256 des paramètres d'entrée du calcul.
 * Permet de détecter qu'un snapshot est obsolète (paramètres ont changé depuis le calcul).
 */
export const IntegrityHashSchema = z.string().regex(/^[0-9a-f]{64}$/, {
  message: "Doit être un hash SHA-256 (64 caractères hexadécimaux)",
});
export type IntegrityHash = z.infer<typeof IntegrityHashSchema>;

/** Détail d'une aide financière (prime, subvention, crédit d'impôt). */
export const FinancialAidSchema = z.object({
  label: z.string().min(1),
  /** Montant de l'aide (€). */
  amountEur: z.number().nonnegative().finite(),
  /** Type : prime à l'investissement, subvention, crédit d'impôt, autre. */
  aidType: z.enum(["PRIME_INVESTISSEMENT", "SUBVENTION", "CREDIT_IMPOT", "AUTRE"]),
  /** Organisme versant. */
  provider: z.string().optional(),
});
export type FinancialAid = z.infer<typeof FinancialAidSchema>;

/** Snapshot des résultats financiers d'un scénario Étude PV. */
export const FinancialSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  /** Référence au scénario énergétique. */
  scenarioId: z.string().min(1),
  /** Référence à la version d'étude. */
  studyVersionId: z.string().min(1),

  // --- Investissement ---
  /** Coût total TTC de l'installation (€). */
  totalCostTtcEur: z.number().nonnegative().finite(),
  /** Aides déduites du coût d'investissement. */
  aids: z.array(FinancialAidSchema).default([]),
  /** Coût net après aides (€). */
  netCostAfterAidsEur: z.number().nonnegative().finite(),

  // --- Revenus & économies ---
  /** Économies annuelles sur la facture électrique (€/an, année 1). */
  annualSavingsEur: z.number().nonnegative().finite(),
  /** Revente surplus EDF OA (€/an, année 1). Null si pas de revente. */
  annualRevenueEur: z.number().nonnegative().finite().nullable().default(null),
  /** Revenus totaux annuels (économies + revente, année 1). */
  annualTotalGainEur: z.number().nonnegative().finite(),

  // --- Rentabilité ---
  /** Retour sur investissement simple (années). */
  paybackYears: z.number().positive().finite(),
  /** TRI sur 25 ans (%). */
  irr25Pct: z.number().finite().optional(),
  /** VAN sur 25 ans (€). */
  npv25Eur: z.number().finite().optional(),
  /** Gain cumulé sur 25 ans (€). */
  cumulativeGain25Eur: z.number().finite().optional(),

  // --- Intégrité ---
  /**
   * SHA-256 des paramètres d'entrée (puissance, coûts, tarifs, consommation).
   * Si null, le snapshot n'a pas été calculé de manière traçable.
   */
  integrityHash: IntegrityHashSchema.nullable().default(null),
  /** Timestamp du calcul (ISO 8601). */
  computedAt: z.string().datetime(),
  /** Version du moteur de calcul. */
  engineVersion: z.string().optional(),
});
export type FinancialSnapshot = z.infer<typeof FinancialSnapshotSchema>;

/** Schéma de création (sans IDs générés par le serveur). */
export const CreateFinancialSnapshotSchema = FinancialSnapshotSchema.omit({
  snapshotId: true,
  computedAt: true,
});
export type CreateFinancialSnapshot = z.infer<typeof CreateFinancialSnapshotSchema>;
