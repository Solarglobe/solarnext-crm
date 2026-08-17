/**
 * Mapping quote-prep (étude) → lignes devis commercial — import explicite uniquement.
 */

import { adminGetQuoteCatalog } from "../../services/admin.api";
import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "../../services/api";
import type { QuoteLine } from "./quote.types";
import type { InstallerCostResult } from "../installers/installers.types";

const API_BASE = getCrmApiBase();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type EconomicPrepItem = {
  label?: string;
  quantity?: number;
  unit_price?: number;
  vat_rate?: number;
  catalog_item_id?: string | null;
  /** Texte libre éventuel (hors snapshot catalogue). */
  description?: string | null;
  product_snapshot?: { description?: string | null } | null;
  /** Prix d'achat HT centimes (devis technique) — aligné marge matériel. */
  purchase_price_ht_cents?: number | null;
};

/** Aligné sur `EconomicData.conditions` (devis technique / quote-prep). */
export type QuotePrepConditionsRaw = {
  discount_percent?: number;
  discount_amount?: number;
} | null;

/**
 * Remise document normalisée (même sémantique que metadata_json du devis commercial).
 */
export type QuotePrepConditionsNormalized = {
  discount_percent: number;
  /** Montant fixe HT (équivalent conditions.discount_amount côté prep). */
  discount_amount_ht: number;
};

/**
 * Données quote-prep utiles à l’import devis (lignes + remise + version snapshot).
 */
export type QuotePrepImportData = {
  items: EconomicPrepItem[];
  installer_cost?: InstallerCostResult | null;
  conditions: QuotePrepConditionsNormalized;
  /** `economic_state.snapshot_version` (économic_snapshots.version_number) si présent. */
  snapshot_version: number | null;
};

export function normalizeQuotePrepConditions(
  raw: QuotePrepConditionsRaw | undefined
): QuotePrepConditionsNormalized {
  const pct = Math.max(0, Math.min(100, Number(raw?.discount_percent) || 0));
  const amt = Math.max(0, round2(Number(raw?.discount_amount) || 0));
  return { discount_percent: round2(pct), discount_amount_ht: amt };
}

/**
 * Métadonnées `POST /api/quotes` : remise document + study_import (création depuis étude).
 * `quote_prep_economic_snapshot_version` = `economic_snapshots.version_number` (traçabilité, optionnel).
 */
export function mapQuotePrepToQuoteDraftMetadata(
  studyVersionId: string,
  conditions: QuotePrepConditionsNormalized,
  quotePrepSnapshotVersion: number | null = null,
  installerCost: InstallerCostResult | null = null
): {
  study_import: {
    last_at: string;
    study_version_id: string;
    quote_prep_economic_snapshot_version?: number;
  };
  global_discount_percent: number;
  global_discount_amount_ht: number;
  installer_cost?: InstallerCostResult;
} {
  return {
    study_import: {
      last_at: new Date().toISOString(),
      study_version_id: studyVersionId,
      ...(quotePrepSnapshotVersion != null && Number.isFinite(quotePrepSnapshotVersion)
        ? { quote_prep_economic_snapshot_version: Math.floor(quotePrepSnapshotVersion) }
        : {}),
    },
    global_discount_percent: conditions.discount_percent,
    global_discount_amount_ht: conditions.discount_amount_ht,
    ...(installerCost ? { installer_cost: installerCost } : {}),
  };
}

/**
 * Assemble le couple items + metadata pour `createQuoteDraft` depuis le résultat de fetch.
 * `studyVersionId` = UUID de version d’étude (pas le numéro de snapshot économique).
 */
export function buildQuoteCreatePayloadFromQuotePrep(
  studyVersionId: string,
  data: QuotePrepImportData
): {
  items: ReturnType<typeof mapEconomicItemsToStudyQuoteItems>;
  metadata: ReturnType<typeof mapQuotePrepToQuoteDraftMetadata>;
} {
  const items = [
    ...(data.items.length ? mapEconomicItemsToStudyQuoteItems(data.items) : []),
    ...installerCostToQuoteCreateItems(data.installer_cost ?? null),
  ];
  return {
    items,
    metadata: mapQuotePrepToQuoteDraftMetadata(
      studyVersionId,
      data.conditions,
      data.snapshot_version,
      data.installer_cost ?? null
    ),
  };
}

/** Description affichable : snapshot quote-prep, puis champ ligne. */
export function extractPrepItemDescription(it: EconomicPrepItem): string {
  const fromSnap = it?.product_snapshot?.description;
  if (typeof fromSnap === "string" && fromSnap.trim().length > 0) {
    return fromSnap.trim();
  }
  const top = it?.description;
  if (typeof top === "string" && top.trim().length > 0) {
    return top.trim();
  }
  return "";
}

/**
 * Complète les descriptions manquantes depuis le catalogue articles (GET admin).
 * Utile car le devis technique omet souvent `description` dans `product_snapshot` quand elle était
 * absente au moment de l’ajout catalogue (clé JSON non sérialisée), alors que le catalogue la contient désormais.
 */
export async function enrichPrepItemsWithCatalogDescriptions(
  items: EconomicPrepItem[]
): Promise<EconomicPrepItem[]> {
  const anyMissing = items.some((it) => it.catalog_item_id && !extractPrepItemDescription(it));
  if (!anyMissing) return items;

  let catalogItems: Awaited<ReturnType<typeof adminGetQuoteCatalog>>["items"] = [];
  try {
    catalogItems = (await adminGetQuoteCatalog({ include_inactive: true })).items;
  } catch {
    return items;
  }
  const byId = new Map(catalogItems.map((c) => [c.id, c]));

  return items.map((it) => {
    if (!it.catalog_item_id || extractPrepItemDescription(it)) return it;
    const cat = byId.get(it.catalog_item_id);
    const desc = cat?.description?.trim();
    if (!desc) return it;
    return {
      ...it,
      product_snapshot: {
        ...(it.product_snapshot && typeof it.product_snapshot === "object" ? it.product_snapshot : {}),
        description: desc,
      },
    };
  });
}

/** Payload attendu par POST /api/quotes (aligné updateQuote items). */
export type QuoteCreateItemFromStudy = {
  label: string;
  description: string;
  quantity: number;
  unit_price_ht: number;
  tva_rate: number;
  discount_ht: number;
  line_source: "study_prep";
  catalog_item_id?: string | null;
  billing_party?: "SOLARGLOBE" | "INSTALLER_RGE";
  reference?: string;
};

export function mapEconomicItemsToStudyQuoteItems(items: EconomicPrepItem[]): QuoteCreateItemFromStudy[] {
  return items.map((it) => {
    const description = extractPrepItemDescription(it);
    return {
      label: String(it.label ?? "Ligne"),
      description,
      quantity: Math.max(0, Number(it.quantity) || 0),
      unit_price_ht: Math.max(0, Number(it.unit_price) || 0),
      tva_rate: Math.max(0, Number(it.vat_rate) || 20),
      discount_ht: 0,
      line_source: "study_prep",
      catalog_item_id: it.catalog_item_id ?? null,
      billing_party: "SOLARGLOBE",
    };
  });
}

export function installerCostToQuoteCreateItems(installerCost: InstallerCostResult | null): QuoteCreateItemFromStudy[] {
  if (!installerCost?.final_total_ht_cents || installerCost.final_total_ht_cents <= 0) return [];
  const installerName = installerCost.installer?.name || "installateur";
  const vatRate = Number.isFinite(Number(installerCost.vat_rate_percent))
    ? Math.max(0, Math.min(100, Number(installerCost.vat_rate_percent)))
    : 0;
  return [
    {
      label: `Installation photovoltaïque RGE — ${installerName}`,
      description: `Ligne consolidée installateur RGE. Détail figé dans le snapshot installateur du devis.`,
      quantity: 1,
      unit_price_ht: Math.round(installerCost.final_total_ht_cents) / 100,
      tva_rate: vatRate,
      discount_ht: 0,
      line_source: "study_prep",
      catalog_item_id: null,
      billing_party: "INSTALLER_RGE",
      reference: "INSTALLER_RGE_CONSOLIDATED",
    },
  ];
}

/** Lignes prêtes pour le state builder (remplace uniquement les lignes `study_prep` lors d’un refresh). */
export function quotePrepItemsToQuoteLines(items: EconomicPrepItem[], installerCost?: InstallerCostResult | null): QuoteLine[] {
  const mapped = [...mapEconomicItemsToStudyQuoteItems(items), ...installerCostToQuoteCreateItems(installerCost ?? null)];
  return mapped.map((it, i) => {
    const prep = items[i];
    const pc = prep?.purchase_price_ht_cents;
    const purchase_unit_price_ht_cents =
      pc != null && Number.isFinite(Number(pc)) && Number(pc) > 0 ? Math.floor(Number(pc)) : undefined;
    return {
      id: crypto.randomUUID(),
      type: it.catalog_item_id ? "catalog" : "custom",
      catalog_item_id: it.catalog_item_id ?? null,
      line_source: "study_prep",
      label: it.label,
      description: it.description,
      reference: it.reference ?? "",
      billing_party: it.billing_party === "INSTALLER_RGE" ? "INSTALLER_RGE" : "SOLARGLOBE",
      quantity: it.quantity,
      unit_price_ht: it.unit_price_ht,
      tva_percent: it.tva_rate,
      line_discount_percent: 0,
      position: i + 1,
      ...(purchase_unit_price_ht_cents != null ? { purchase_unit_price_ht_cents } : {}),
    };
  });
}

/**
 * GET quote-prep : lignes `items` + `conditions` (remise document) + version snapshot.
 * Si pas de snapshot économique : items vides, remises à 0.
 */
export async function fetchQuotePrepEconomicItems(
  studyId: string,
  versionId: string
): Promise<QuotePrepImportData> {
  const res = await apiFetch(
    `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/quote-prep`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const j = (await res.json()) as {
    economic_state?: {
      snapshot_version?: number;
      data?: {
        items?: EconomicPrepItem[];
        installer_cost?: InstallerCostResult | null;
        conditions?: { discount_percent?: number; discount_amount?: number };
      };
    } | null;
  };
  const dataBlock = j?.economic_state?.data;
  const rawItems = dataBlock?.items;
  const items = Array.isArray(rawItems) ? rawItems : [];
  const conditions = normalizeQuotePrepConditions(dataBlock?.conditions ?? undefined);
  const installer_cost = dataBlock?.installer_cost ?? null;
  const snap = j?.economic_state?.snapshot_version;
  const snapshot_version = snap != null && Number.isFinite(Number(snap)) ? Number(snap) : null;

  return { items, installer_cost, conditions, snapshot_version };
}
