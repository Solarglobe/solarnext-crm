/**
 * Modèle de grille tarifaire batterie virtuelle — segments × kVA.
 * Compatible computeVirtualBatteryQuoteFromGrid (backend).
 */

export const SEGMENT_CODES = ["PART_BASE", "PART_HPHC", "PRO_BASE_CU", "PRO_HPHC_MU"] as const;
export type SegmentCode = (typeof SEGMENT_CODES)[number];

export const KVA_LIST = [3, 6, 9, 12, 15, 18, 24, 30, 36] as const;
export type KvaValue = (typeof KVA_LIST)[number];

/** Une ligne tarifaire par puissance compteur (kVA). */
export interface VirtualBatteryKvaRow {
  kva: number;
  /** Abonnement fixe compteur (€/mois TTC). */
  subscription_fixed_ttc: number;
  /** Abonnement virtuel €/kWc/mois HT. */
  virtual_subscription_eur_kwc_month_ht: number;
  /** Coût énergie restituée €/kWh HT. */
  restitution_energy_eur_kwh_ht: number;
  /** Coût réseau / acheminement €/kWh HT. */
  restitution_network_fee_eur_kwh_ht: number;
  /** Contribution autoproducteur €/an HT. */
  autoproducer_contribution_eur_year_ht: number;
  /** Frais activation (une fois) HT. */
  activation_fee_ht: number;
}

/** Segment tarifaire (ex. PART_BASE) avec grille par kVA. */
export interface VirtualBatterySegment {
  segmentCode: SegmentCode;
  kvaRows: VirtualBatteryKvaRow[];
}

/** Grille pour un fournisseur : segments avec kvaRows. Persistée dans tariff_grid_json. */
export interface VirtualBatteryTariffGrid {
  segments: VirtualBatterySegment[];
}

/** Grille multi-fournisseurs (structure JSON cible optionnelle). */
export interface VirtualBatteryTariffGridMultiProvider {
  providers: Array<{
    provider_code: string;
    segments: VirtualBatterySegment[];
  }>;
}

export const SEGMENT_LABELS: Record<SegmentCode, string> = {
  PART_BASE: "Particulier Base",
  PART_HPHC: "Particulier HP/HC",
  PRO_BASE_CU: "Pro Base (CU)",
  PRO_HPHC_MU: "Pro HP/HC (MU)",
};

/** Crée une ligne kVA par défaut. */
export function createDefaultKvaRow(kva: number): VirtualBatteryKvaRow {
  return {
    kva,
    subscription_fixed_ttc: 0,
    virtual_subscription_eur_kwc_month_ht: 0,
    restitution_energy_eur_kwh_ht: 0,
    restitution_network_fee_eur_kwh_ht: 0,
    autoproducer_contribution_eur_year_ht: 0,
    activation_fee_ht: 0,
  };
}

/** Crée un segment avec toutes les lignes kVA. */
export function createDefaultSegment(segmentCode: SegmentCode): VirtualBatterySegment {
  return {
    segmentCode,
    kvaRows: KVA_LIST.map((kva) => createDefaultKvaRow(kva)),
  };
}

/** Grille complète par défaut (4 segments × 9 kVA). */
export function createDefaultTariffGrid(): VirtualBatteryTariffGrid {
  return {
    segments: SEGMENT_CODES.map((code) => createDefaultSegment(code)),
  };
}

/** Valide une ligne kVA : kVA dans la liste, montants >= 0. */
export function validateKvaRow(row: VirtualBatteryKvaRow): string | null {
  if (!KVA_LIST.includes(row.kva as KvaValue)) {
    return `kVA ${row.kva} invalide. Valeurs autorisées : ${KVA_LIST.join(", ")}`;
  }
  const checks: Array<{ key: keyof VirtualBatteryKvaRow; label: string }> = [
    { key: "subscription_fixed_ttc", label: "Abonnement fixe (€/mois)" },
    { key: "virtual_subscription_eur_kwc_month_ht", label: "Abonnement €/kWc/mois" },
    { key: "restitution_energy_eur_kwh_ht", label: "Restitution énergie €/kWh" },
    { key: "restitution_network_fee_eur_kwh_ht", label: "Réseau €/kWh" },
    { key: "autoproducer_contribution_eur_year_ht", label: "Contribution €/an" },
    { key: "activation_fee_ht", label: "Frais activation" },
  ];
  for (const { key, label } of checks) {
    const v = Number((row as unknown as Record<string, unknown>)[key]);
    if (Number.isNaN(v) || v < 0) return `${label} doit être >= 0`;
  }
  return null;
}

function findLegacyKvaRow(rows: Array<Record<string, unknown>>, kva: number): Record<string, unknown> | null {
  const sorted = [...rows].sort((a, b) => (Number(b.kva) ?? 0) - (Number(a.kva) ?? 0));
  const found = sorted.find((r) => (Number(r.kva) ?? 0) <= kva);
  return found ?? sorted[sorted.length - 1] ?? null;
}

/** Parse tariff_grid_json (ancien ou nouveau format) vers VirtualBatteryTariffGrid. */
export function parseTariffGridFromProvider(
  tariffGridJson: Record<string, unknown> | null | undefined
): VirtualBatteryTariffGrid {
  if (!tariffGridJson || typeof tariffGridJson !== "object") {
    return createDefaultTariffGrid();
  }

  const rawSegments = (tariffGridJson.segments as Array<Record<string, unknown>>) ?? [];
  const segments: VirtualBatterySegment[] = SEGMENT_CODES.map((segmentCode) => {
    const raw = rawSegments.find((s) => s.segmentCode === segmentCode);
    const kvaRows: VirtualBatteryKvaRow[] = [];
    const rows = (raw?.kvaRows ?? (raw?.pricing as Record<string, unknown>)?.kvaRows) as Array<Record<string, unknown>> | undefined;
    const pricing = raw?.pricing as Record<string, unknown> | undefined;
    const virtualSub = pricing?.virtualSubscription as Record<string, unknown> | undefined;
    const annualContrib = pricing?.annualAutoproducerContribution as Record<string, unknown> | undefined;

    for (const kva of KVA_LIST) {
      const r = Array.isArray(rows) ? (rows.find((x) => Number(x.kva) === kva) ?? findLegacyKvaRow(rows, kva)) : null;
      const isNewFormat = r && typeof (r as Record<string, unknown>).subscription_fixed_ttc === "number";

      if (r && isNewFormat) {
        kvaRows.push({
          kva,
          subscription_fixed_ttc: Number(r.subscription_fixed_ttc ?? 0),
          virtual_subscription_eur_kwc_month_ht: Number(r.virtual_subscription_eur_kwc_month_ht ?? 0),
          restitution_energy_eur_kwh_ht: Number(r.restitution_energy_eur_kwh_ht ?? 0),
          restitution_network_fee_eur_kwh_ht: Number(r.restitution_network_fee_eur_kwh_ht ?? 0),
          autoproducer_contribution_eur_year_ht: Number(r.autoproducer_contribution_eur_year_ht ?? 0),
          activation_fee_ht: Number(r.activation_fee_ht ?? 0),
        });
      } else if (r) {
        const subFixed = r.subscriptionFixed as Record<string, unknown> | undefined;
        const vEnergy = r.virtualEnergy as Record<string, unknown> | undefined;
        const vNetwork = r.virtualNetworkFee as Record<string, unknown> | undefined;
        kvaRows.push({
          kva,
          subscription_fixed_ttc: subFixed?.ttc != null ? Number(subFixed.ttc) : 0,
          virtual_subscription_eur_kwc_month_ht: virtualSub?.value != null ? Number(virtualSub.value) : 0,
          restitution_energy_eur_kwh_ht: vEnergy?.htt != null ? Number(vEnergy.htt) : 0,
          restitution_network_fee_eur_kwh_ht: vNetwork?.htt != null ? Number(vNetwork.htt) : 0,
          autoproducer_contribution_eur_year_ht: annualContrib?.value != null ? Number(annualContrib.value) : 0,
          activation_fee_ht: 0,
        });
      } else {
        kvaRows.push(createDefaultKvaRow(kva));
      }
    }
    kvaRows.sort((a, b) => a.kva - b.kva);
    return { segmentCode, kvaRows };
  });

  return { segments };
}
