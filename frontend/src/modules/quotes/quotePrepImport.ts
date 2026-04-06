/**
 * Mapping quote-prep (étude) → lignes devis commercial — import explicite uniquement.
 */

import { apiFetch } from "../../services/api";
import type { QuoteLine } from "./quote.types";

const API_BASE = import.meta.env?.VITE_API_URL || "";

export type EconomicPrepItem = {
  label?: string;
  quantity?: number;
  unit_price?: number;
  vat_rate?: number;
  catalog_item_id?: string | null;
  product_snapshot?: { description?: string } | null;
};

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
};

export function mapEconomicItemsToStudyQuoteItems(items: EconomicPrepItem[]): QuoteCreateItemFromStudy[] {
  return items.map((it) => {
    const description =
      typeof it?.product_snapshot?.description === "string" &&
      it.product_snapshot.description.trim().length > 0
        ? it.product_snapshot.description.trim()
        : "";
    return {
      label: String(it.label ?? "Ligne"),
      description,
      quantity: Math.max(0, Number(it.quantity) || 0),
      unit_price_ht: Math.max(0, Number(it.unit_price) || 0),
      tva_rate: Math.max(0, Number(it.vat_rate) || 20),
      discount_ht: 0,
      line_source: "study_prep",
      catalog_item_id: it.catalog_item_id ?? null,
    };
  });
}

/** Lignes prêtes pour le state builder (remplace uniquement les lignes `study_prep` lors d’un refresh). */
export function quotePrepItemsToQuoteLines(items: EconomicPrepItem[]): QuoteLine[] {
  const mapped = mapEconomicItemsToStudyQuoteItems(items);
  return mapped.map((it, i) => ({
    id: crypto.randomUUID(),
    type: it.catalog_item_id ? "catalog" : "custom",
    catalog_item_id: it.catalog_item_id ?? null,
    line_source: "study_prep",
    label: it.label,
    description: it.description,
    reference: "",
    quantity: it.quantity,
    unit_price_ht: it.unit_price_ht,
    tva_percent: it.tva_rate,
    line_discount_percent: 0,
    position: i + 1,
  }));
}

export async function fetchQuotePrepEconomicItems(
  studyId: string,
  versionId: string
): Promise<{ items: EconomicPrepItem[] }> {
  const res = await apiFetch(
    `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/quote-prep`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const j = (await res.json()) as {
    economic_state?: { data?: { items?: EconomicPrepItem[] } } | null;
  };
  const raw = j?.economic_state?.data?.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { items: [] };
  }
  return { items: raw };
}
