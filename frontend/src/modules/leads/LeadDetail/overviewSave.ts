/**
 * Sauvegarde Vue générale — lead + consumption (autosave)
 */

import type { EquipementActuelParams, EquipementsAVenir } from "./equipmentPilotageHelpers";
import type { EquipmentV2 } from "./equipmentTypes";
import {
  ensureActuelV2FromApi,
  ensureAvenirV2FromApi,
  legacyActuelStringFromItems,
  toEquipmentV2Payload,
} from "./equipmentV2Normalize";

export interface OverviewLeadSnapshot {
  civility?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  /** PRO : nom de l'entreprise (devient full_name pivot) */
  company_name?: string;
  /** PRO : contact physique au sein de l'entreprise */
  contact_first_name?: string;
  contact_last_name?: string;
  /** PRO : numéro SIRET */
  siret?: string | null;
  phone_mobile?: string;
  email?: string;
  phone_landline?: string;
  assigned_salesperson_user_id?: string;
  assigned_to?: string;
  customer_type?: "PERSON" | "PRO";
  lead_source?: string;
  property_type?: string;
  household_size?: number;
  construction_year?: number;
  insulation_level?: string;
  roof_type?: string;
  frame_type?: string;
  project_status?: string;
  energy_profile?: unknown;
  consumption_mode?: "ANNUAL" | "MONTHLY" | "PDL";
  consumption_annual_kwh?: number;
  consumption_annual_calculated_kwh?: number;
  consumption_pdl?: string;
  hp_hc?: boolean;
  supplier_name?: string;
  consumption_profile?: string;
  tariff_type?: string;
  grid_type?: string;
  meter_power_kva?: number;
  /** Pilotage charge — chaîne moteur (ex. « ve pac ballon ») */
  equipement_actuel?: string | null;
  equipement_actuel_params?: EquipementActuelParams | EquipmentV2 | null;
  equipements_a_venir?: EquipementsAVenir | EquipmentV2 | null;
}

export function buildLeadPatch(
  formLead: OverviewLeadSnapshot,
  opts?: { omitEnergyProfile?: boolean }
): Partial<OverviewLeadSnapshot> {
  const isPro = formLead.customer_type === "PRO";
  return {
    civility: isPro ? undefined : formLead.civility,
    // full_name : le backend recalcule automatiquement ; on peut aussi l'envoyer explicitement
    full_name: formLead.full_name,
    // PERSON : prénom / nom
    first_name: isPro ? undefined : formLead.first_name,
    last_name: isPro ? undefined : formLead.last_name,
    // PRO : entreprise + contact
    company_name: formLead.company_name,
    contact_first_name: formLead.contact_first_name,
    contact_last_name: formLead.contact_last_name,
    siret: formLead.siret,
    phone_mobile: formLead.phone_mobile,
    email: formLead.email,
    phone_landline: formLead.phone_landline,
    assigned_salesperson_user_id: formLead.assigned_salesperson_user_id,
    assigned_to: formLead.assigned_salesperson_user_id ?? formLead.assigned_to,
    customer_type: formLead.customer_type,
    lead_source: formLead.lead_source,
    property_type: formLead.property_type,
    household_size: formLead.household_size,
    construction_year: formLead.construction_year,
    insulation_level: formLead.insulation_level,
    roof_type: formLead.roof_type,
    frame_type: formLead.frame_type,
    project_status: formLead.project_status,
    ...(opts?.omitEnergyProfile ? {} : { energy_profile: formLead.energy_profile }),
  };
}

/** Champs conso / équipements / profil portés par `lead_meters` (synchronisés sur `leads` si compteur par défaut). */
export function applyMeterRowToLeadSnapshot(
  meter: Record<string, unknown>
): Partial<OverviewLeadSnapshot> {
  return {
    consumption_pdl: meter.consumption_pdl as OverviewLeadSnapshot["consumption_pdl"],
    meter_power_kva: meter.meter_power_kva as OverviewLeadSnapshot["meter_power_kva"],
    grid_type: meter.grid_type as OverviewLeadSnapshot["grid_type"],
    consumption_mode: meter.consumption_mode as OverviewLeadSnapshot["consumption_mode"],
    consumption_annual_kwh: meter.consumption_annual_kwh as OverviewLeadSnapshot["consumption_annual_kwh"],
    consumption_annual_calculated_kwh: meter.consumption_annual_calculated_kwh as OverviewLeadSnapshot["consumption_annual_calculated_kwh"],
    consumption_profile: meter.consumption_profile as OverviewLeadSnapshot["consumption_profile"],
    hp_hc: meter.hp_hc as OverviewLeadSnapshot["hp_hc"],
    supplier_name: meter.supplier_name as OverviewLeadSnapshot["supplier_name"],
    tariff_type: meter.tariff_type as OverviewLeadSnapshot["tariff_type"],
    energy_profile: meter.energy_profile as OverviewLeadSnapshot["energy_profile"],
    equipement_actuel: meter.equipement_actuel as OverviewLeadSnapshot["equipement_actuel"],
    equipement_actuel_params: meter.equipement_actuel_params as OverviewLeadSnapshot["equipement_actuel_params"],
    equipements_a_venir: meter.equipements_a_venir as OverviewLeadSnapshot["equipements_a_venir"],
  };
}

/** Payload PATCH /api/leads/:leadId/meters/:id — autosave fiche (nom + conso + équipements + profil). */
export function buildMeterAutosavePayload(
  formLead: OverviewLeadSnapshot,
  meterName: string,
  monthlyLocal: { month: number; kwh: number }[]
): Record<string, unknown> {
  const cons = buildConsumptionPayload(formLead, monthlyLocal);
  const name = String(meterName ?? "").trim();
  return {
    ...cons,
    ...(name ? { name } : {}),
    energy_profile: formLead.energy_profile ?? null,
  };
}

export function buildConsumptionPayload(
  formLead: OverviewLeadSnapshot,
  monthlyLocal: { month: number; kwh: number }[]
): Record<string, unknown> {
  const mode = formLead.consumption_mode || "ANNUAL";
  const consPayload: Record<string, unknown> = {
    consumption_mode: mode,
    hp_hc: formLead.hp_hc,
    supplier_name: formLead.supplier_name,
    consumption_profile: formLead.consumption_profile,
    tariff_type: formLead.tariff_type,
    grid_type: formLead.grid_type,
    meter_power_kva: formLead.meter_power_kva,
    consumption_pdl: formLead.consumption_pdl,
  };
  if (mode === "ANNUAL") {
    consPayload.consumption_annual_kwh = formLead.consumption_annual_kwh;
  }
  if (mode === "PDL") {
    consPayload.consumption_pdl = formLead.consumption_pdl;
  }
  if (mode === "MONTHLY") {
    const months =
      monthlyLocal.length === 12
        ? monthlyLocal
        : Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            kwh: monthlyLocal.find((m) => m.month === i + 1)?.kwh ?? 0,
          }));
    consPayload.year = new Date().getFullYear();
    consPayload.months = months;
  }
  const actuelV2 = ensureActuelV2FromApi(
    formLead.equipement_actuel_params,
    formLead.equipement_actuel ?? null
  );
  const avenirV2 = ensureAvenirV2FromApi(formLead.equipements_a_venir);
  consPayload.equipement_actuel = legacyActuelStringFromItems(actuelV2.items);
  consPayload.equipement_actuel_params = toEquipmentV2Payload(actuelV2);
  consPayload.equipements_a_venir = toEquipmentV2Payload(avenirV2);
  return consPayload;
}
