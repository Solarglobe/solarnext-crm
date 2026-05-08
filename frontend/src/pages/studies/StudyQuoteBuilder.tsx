/**
 * Préparation du devis technique — quote-builder (page existante refondue).
 * Route : /studies/:studyId/quote-builder
 * Résumé → Matériel → Prix & conditions → Options scénario → Financement → Actions (une carte travail)
 * GET/PUT /quote-prep, POST validate, POST fork. Lead-only (pas de client requis).
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../../services/api";
import { createQuoteDraft } from "../../services/financial.api";
import {
  buildQuoteCreatePayloadFromQuotePrep,
  fetchQuotePrepEconomicItems,
} from "../../modules/quotes/quotePrepImport";
import { listBatteries, type PvBattery } from "../../api/pvCatalogApi";
import type { VirtualBatteryConfig, PvVirtualBatterySettings } from "../../types/pvVirtualBatterySettings";
import VirtualBatteryConfigurator from "../../components/study/VirtualBatteryConfigurator";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import StudyMeterSelector from "../../modules/studies/components/StudyMeterSelector";
import LocaleNumberInput from "../../modules/quotes/LocaleNumberInput";
import "./study-quote-builder.css";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";
import { computeMaterialMarginFromLines, round2 } from "../../modules/quotes/quoteCalc";

const API_BASE = getCrmApiBaseWithWindowFallback();

// ——— Types ———
interface TechnicalSummary {
  nb_panels: number;
  power_kwc: number;
  total_panels?: number;
  total_power_kwc?: number | null;
  production_annual_kwh: number | null;
  shading_pct: number | null;
  total_loss_pct?: number | null;
  orientation_deg: number | null;
  tilt_deg: number | null;
  orientation_mean_deg?: number | null;
  tilt_mean_deg?: number | null;
  inverter_family: string | null;
  dc_ac_ratio: number | null;
  gps: { lat: number; lon: number } | null;
  snapshot_version: number | null;
  calpinage_snapshot_id?: string;
}

// ——— Formatage kWc (résumé technique depuis payload) ———
const fmtKwc3 = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : "—";

const fmtEur2 = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** Montant avec 2 décimales et séparateurs (sans suffixe € — souvent l’en-tête de colonne le porte). */
const fmtAmount2 = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPctFr = (n: number, minD: number, maxD: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: minD, maximumFractionDigits: maxD });

interface QuotePrepItem {
  id?: string;
  catalog_item_id?: string | null;
  label: string;
  category?: string;
  quantity: number;
  unit_price: number;
  /** Taux de TVA en % (ex: 20). Par défaut 20. */
  vat_rate: number;
  total: number;
  product_snapshot?: Record<string, unknown>;
  /** Prix d'achat HT en centimes (catalogue devis). Absent = 0 pour calcul marge. */
  purchase_price_ht_cents?: number;
}

interface BatteryOption {
  enabled: boolean;
  catalog_item_id?: string | null;
  label?: string;
  /** Batterie physique : prix unitaire HT (catalogue PV). Affichage page en TTC. */
  price?: number;
  qty?: number;
  product_snapshot?: Record<string, unknown>;
  /** Id batterie catalogue PV (pv_batteries) pour pré-remplissage prix */
  batteryId?: string | null;
  /** Coût d'achat HT unitaire figé au snapshot (sélection / devis) — ne pas relire le catalogue live */
  purchase_price_ht?: number | null;
  /** True si l'utilisateur a modifié le prix manuellement → ne pas écraser au changement de batterie */
  batteryPriceEdited?: boolean;
  /** Capacité utile unitaire (kWh) figée au snapshot — alimentée depuis usable_kwh du catalogue */
  capacity_kwh?: number | null;
}

/** Format retourné par GET /api/admin/quote-catalog (items[].) */
interface CatalogItemApi {
  id: string;
  name: string;
  description: string | null;
  category: string;
  pricing_mode: string;
  sale_price_ht_cents: number;
  purchase_price_ht_cents?: number;
  default_vat_rate_bps: number;
}

/** Données de financement (configuration uniquement, économique_snapshots.config_json.financing) */
interface FinancingConfig {
  enabled: boolean;
  amount: number;
  duration_months: number;
  interest_rate_annual: number;
}

interface EconomicData {
  items: QuotePrepItem[];
  batteries: { physical: BatteryOption; virtual: BatteryOption };
  conditions: {
    discount_percent: number;
    discount_amount: number;
  };
  /** Config batterie virtuelle (grilles) — stockée dans config_json.virtualBattery */
  virtualBattery?: VirtualBatteryConfig | null;
  totals?: { ht: number; tva: number; ttc: number; net: number };
  /** Financement optionnel — persistant dans economic_state.data.financing */
  financing?: FinancingConfig | null;
}

interface QuotePrepResponse {
  technical_snapshot_summary: TechnicalSummary;
  economic_state: {
    snapshot_id: string;
    study_version_id: string;
    snapshot_version: number;
    status: "DRAFT" | "READY_FOR_STUDY";
    data: EconomicData;
  } | null;
  study_version_id: string;
  lead_meter_power_kva?: number;
  /** Type de client : PRO → TVA 20% forcée sur toutes les lignes */
  lead_customer_type?: "PERSON" | "PRO";
  lead_siret?: string | null;
  organization_pv_virtual_battery?: PvVirtualBatterySettings | null;
}

const DEFAULT_FINANCING: FinancingConfig = {
  enabled: false,
  amount: 0,
  duration_months: 0,
  interest_rate_annual: 0,
};

const DEFAULT_ECONOMIC_DATA: EconomicData = {
  items: [],
  batteries: {
    physical: { enabled: false, qty: 1, batteryId: null, batteryPriceEdited: false },
    virtual: { enabled: false, qty: 1 },
  },
  conditions: { discount_percent: 0, discount_amount: 0 },
  virtualBattery: null,
  financing: { ...DEFAULT_FINANCING },
};

function mergeFinancing(raw: Partial<FinancingConfig> | null | undefined, totalsTtc: number): FinancingConfig {
  const f = { ...DEFAULT_FINANCING, ...raw };
  const duration = Math.max(0, Number(f.duration_months) || 0);
  const rate = Number(f.interest_rate_annual);
  const rateOk = Number.isFinite(rate) ? rate : 0;
  const enabled = duration > 0 && rateOk > 0;
  let amount = Number(f.amount);
  if (!Number.isFinite(amount) || amount < 0) amount = 0;
  if (enabled && amount <= 0 && totalsTtc > 0) amount = totalsTtc;
  return { enabled, amount, duration_months: duration, interest_rate_annual: rateOk };
}

const DEFAULT_VAT_RATE = 20;

/** Prix batterie physique catalogue / saisi : stocké HT ; affichage page en TTC (taux fixe, aligné lignes matériel à 20 %). */
const PHYSICAL_BATTERY_VAT_RATE = DEFAULT_VAT_RATE;

function physicalBatteryUnitHtToTtc(unitHt: number): number {
  return Math.round(unitHt * (1 + PHYSICAL_BATTERY_VAT_RATE / 100) * 100) / 100;
}

/**
 * Coût interne HT unitaire batterie physique : snapshot (config_json) d’abord, puis catalogue live si absence (legacy).
 */
function physicalBatteryPurchaseUnitHtFromSnapshot(
  physical: BatteryOption,
  catalogBattery: PvBattery | undefined
): number {
  const fromField = physical.purchase_price_ht;
  if (fromField != null && Number.isFinite(Number(fromField)) && Number(fromField) >= 0) {
    return Number(fromField);
  }
  const ps = physical.product_snapshot;
  if (ps && typeof ps === "object" && ps !== null && "purchase_price_ht" in ps) {
    const v = Number((ps as Record<string, unknown>).purchase_price_ht);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  if (physical.batteryId != null && catalogBattery?.purchase_price_ht != null) {
    const p = Number(catalogBattery.purchase_price_ht);
    if (Number.isFinite(p) && p >= 0) return p;
  }
  return 0;
}

function physicalBatteryUnitTtcToHt(unitTtc: number): number {
  return Math.round((unitTtc / (1 + PHYSICAL_BATTERY_VAT_RATE / 100)) * 100) / 100;
}

// ——— Calculs par ligne (TVA par ligne) ———
function calculateLineHT(line: QuotePrepItem): number {
  return Math.round((line.quantity * line.unit_price) * 100) / 100;
}
function calculateLineTVA(line: QuotePrepItem): number {
  const ht = calculateLineHT(line);
  const rate = Math.max(0, Math.min(300, line.vat_rate ?? DEFAULT_VAT_RATE));
  return Math.round(ht * (rate / 100) * 100) / 100;
}
function calculateLineTTC(line: QuotePrepItem): number {
  return Math.round((calculateLineHT(line) + calculateLineTVA(line)) * 100) / 100;
}
function calculateTotalHT(lines: QuotePrepItem[]): number {
  return Math.round(lines.reduce((s, line) => s + calculateLineHT(line), 0) * 100) / 100;
}
function calculateTotalTVA(lines: QuotePrepItem[]): number {
  return Math.round(lines.reduce((s, line) => s + calculateLineTVA(line), 0) * 100) / 100;
}
function calculateTotalTTC(lines: QuotePrepItem[]): number {
  return Math.round(lines.reduce((s, line) => s + calculateLineTTC(line), 0) * 100) / 100;
}

// Budget matériel uniquement (economic.items). Batteries exclues des totaux (options scénario).
function computeTotals(data: EconomicData): { ht: number; tva: number; ttc: number; net: number } {
  const itemsHt = calculateTotalHT(data.items);
  const itemsTva = calculateTotalTVA(data.items);
  const totalHtGross = Math.round(itemsHt * 100) / 100;
  const totalTvaGross = Math.round(itemsTva * 100) / 100;
  const discountPct = Math.max(0, Math.min(100, data.conditions.discount_percent ?? 0));
  const discountAmt = Math.max(0, data.conditions.discount_amount ?? 0);
  let ht = Math.round((totalHtGross * (1 - discountPct / 100) - discountAmt) * 100) / 100;
  ht = Math.max(0, ht);
  // Répartition proportionnelle de la TVA après remise
  const tva = totalHtGross > 0
    ? Math.round(totalTvaGross * (ht / totalHtGross) * 100) / 100
    : 0;
  const ttc = Math.round((ht + tva) * 100) / 100;
  return { ht, tva, ttc, net: ttc };
}

function studyMaterialMarginBundle(
  data: EconomicData,
  pvBatteriesList: PvBattery[]
): {
  sans: ReturnType<typeof computeMaterialMarginFromLines>;
  avec: ReturnType<typeof computeMaterialMarginFromLines>;
  batteryMaterialEligible: boolean;
  internalWithBatteryReady: boolean;
} {
  const sans = computeMaterialMarginFromLines(
    data.items.map((it) => ({
      quantity: it.quantity,
      unit_price_ht: it.unit_price,
      purchase_price_ht_cents: it.purchase_price_ht_cents,
    }))
  );
  const physicalBat = data.batteries.physical;
  const physicalUnitHt = physicalBat.price ?? 0;
  const qtyBat = physicalBat.qty ?? 1;
  const catalogBatteryForInternal =
    physicalBat.batteryId != null
      ? pvBatteriesList.find((b) => b.id === physicalBat.batteryId)
      : undefined;
  const batteryPurchaseUnitHt = physicalBatteryPurchaseUnitHtFromSnapshot(
    physicalBat,
    catalogBatteryForInternal
  );
  const internalWithBatteryReady = physicalBat.enabled && physicalUnitHt > 0;
  const batteryMaterialEligible =
    physicalBat.enabled && physicalUnitHt > 0 && batteryPurchaseUnitHt > 0;
  const avec = batteryMaterialEligible
    ? (() => {
        const ev = round2(sans.venteMaterialHt + round2(qtyBat * physicalUnitHt));
        const ea = round2(sans.achatMaterialHt + round2(qtyBat * batteryPurchaseUnitHt));
        const m = round2(ev - ea);
        const t = ea > 0 ? round2((m / ea) * 100) : null;
        return {
          venteMaterialHt: ev,
          achatMaterialHt: ea,
          margeHt: m,
          tauxMargeSurAchatPct: t,
        };
      })()
    : sans;
  return { sans, avec, batteryMaterialEligible, internalWithBatteryReady };
}

type StudyQuoteToastOptions = { variant?: "premium"; durationMs?: number };

function showToast(message: string, success: boolean, options?: StudyQuoteToastOptions) {
  const toast = document.createElement("div");
  toast.setAttribute("role", success ? "status" : "alert");
  toast.setAttribute("aria-live", success ? "polite" : "assertive");
  const premium = Boolean(success && options?.variant === "premium");
  toast.className = premium
    ? "study-quote-toast study-quote-toast-success-premium"
    : success
      ? "study-quote-toast study-quote-toast-success"
      : "study-quote-toast study-quote-toast-error";
  toast.textContent = message;
  document.body.appendChild(toast);
  const durationMs = options?.durationMs ?? 4000;
  setTimeout(() => toast.remove(), durationMs);
}

const CATEGORY_LABELS: Record<string, string> = {
  PANEL: "Modules PV",
  INVERTER: "Onduleur / Micro",
  MOUNTING: "Rails",
  CABLE: "Câbles",
  PROTECTION_BOX: "Coffret de protection",
  INSTALL: "Main d'œuvre",
  SERVICE: "Étude / Administratif",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
  PACK: "Pack",
  DISCOUNT: "Remise",
  OTHER: "Autre",
};

/** Construit un product_snapshot à partir d'un item catalogue API */
function catalogItemToProductSnapshot(item: CatalogItemApi) {
  return {
    id: item.id,
    label: item.name,
    description: item.description ?? undefined,
    default_price_ht: item.sale_price_ht_cents / 100,
    default_vat_percent: item.default_vat_rate_bps / 100,
    category: item.category,
    type: item.pricing_mode,
  };
}

/** Modal de sélection batterie physique depuis le catalogue PV (pv_batteries) */
function ModalPvBatterySelector({
  open,
  onClose,
  batteries,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  batteries: PvBattery[];
  onSelect: (b: PvBattery) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = batteries.filter((b) =>
    !q.trim() || [b.name, b.brand, b.model_ref].some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase()))
  );
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-pv-battery-title"
      className="sqb-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sn-card sqb-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sqb-modal-header">
          <h2 id="modal-pv-battery-title" className="sqb-h2">Choisir batterie physique</h2>
          <input
            type="search"
            className="sn-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Recherche (marque, modèle…)"
          />
        </div>
        <div className="sqb-modal-body sqb-modal-body--scroll">
          {filtered.length === 0 ? (
            <div className="sqb-modal-empty">Aucune batterie.</div>
          ) : (
            <ul className="sqb-modal-list">
              {filtered.map((b) => (
                <li key={b.id} className="sqb-modal-list-item">
                  <button
                    type="button"
                    className="sn-btn sn-btn-ghost sqb-modal-battery-btn"
                    onClick={() => onSelect(b)}
                  >
                    <span className="sqb-text">{b.name ?? `${b.brand} ${b.model_ref}`}</span>
                    {b.default_price_ht != null && (
                      <span className="sqb-helper sqb-modal-battery-price">{Number(b.default_price_ht).toLocaleString("fr-FR")} € HT</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Modal de sélection dans le catalogue (endpoint existant GET /api/admin/quote-catalog) */
function ModalCatalogSelector({
  open,
  onClose,
  categoryFilter,
  title = "Choisir un produit",
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  categoryFilter?: string | null;
  title?: string;
  onSelect: (item: CatalogItemApi) => void;
}) {
  const [items, setItems] = useState<CatalogItemApi[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>(categoryFilter ?? "");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setItems([]);
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (categoryFilter) params.set("category", categoryFilter);
    else if (category) params.set("category", category);
    if (q.trim()) params.set("q", q.trim());
    apiFetch(`${API_BASE}/api/admin/quote-catalog?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) return res.json().then((body: { error?: string }) => { setError(body.error || `Erreur ${res.status}`); });
        return res.json().then((data: { items: CatalogItemApi[] }) => { setItems(data.items ?? []); });
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Erreur"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, categoryFilter, category, q]);

  if (!open) return null;

  const effectiveTitle = categoryFilter
    ? categoryFilter === "BATTERY_PHYSICAL"
      ? "Choisir batterie physique"
      : categoryFilter === "BATTERY_VIRTUAL"
        ? "Choisir batterie virtuelle"
        : categoryFilter === "PACK"
          ? "Choisir un pack"
          : categoryFilter === "PROTECTION_BOX"
            ? "Choisir un coffret de protection"
            : title
    : title;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-catalog-title"
      className="sqb-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sn-card sqb-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sqb-modal-header">
          <h2 id="modal-catalog-title" className="sqb-h2">{effectiveTitle}</h2>
          <div className="sqb-modal-stack">
            {!categoryFilter && (
              <label className="sqb-label">
                Catégorie
                <select
                  className="sn-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Toutes</option>
                  {Object.entries(CATEGORY_LABELS).map(([val, lab]) => (
                    <option key={val} value={val}>{lab}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="sqb-label">
              Recherche
              <input
                type="search"
                className="sn-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nom du produit…"
              />
            </label>
          </div>
        </div>
        <div className="sqb-modal-body">
          {error && <p className="sqb-modal-error">{error}</p>}
          {loading && <p className="sqb-text">Chargement…</p>}
          {!loading && !error && items.length === 0 && <p className="sqb-helper">Aucun produit trouvé.</p>}
          {!loading && items.length > 0 && (
            <ul className="sqb-modal-catalog-list">
              {items.map((item) => (
                <li key={item.id} className="sqb-modal-catalog-row">
                  <div>
                    <span className="sqb-modal-product-name">{item.name}</span>
                    {item.description && <div className="sqb-helper sqb-modal-desc">{item.description}</div>}
                    <span className="sqb-helper">
                      {(item.sale_price_ht_cents / 100).toLocaleString("fr-FR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      € HT · {CATEGORY_LABELS[item.category] ?? item.category}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sn-btn sn-btn-primary"
                    onClick={() => { onSelect(item); onClose(); }}
                  >
                    Sélectionner
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="sqb-modal-footer">
          <button type="button" className="sn-btn sn-btn-ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

/** Payload du snapshot calpinage actif (calpinage_snapshots.snapshot_json.payload). Résumé technique lu exclusivement depuis cette source. */
interface CalpinageSnapshotPayload {
  totals?: { panels_count?: number; total_power_kwc?: number };
  frozenBlocks?: Array<{ panels?: unknown[] }>;
  panel?: { brand?: string; model?: string; model_ref?: string; power_wc?: number; power_w?: number };
  inverter?: { brand?: string; name?: string };
  inverter_totals?: { units_required?: number };
  /** Métriques étude (quote-prep) : affichage commercial uniquement, sans recalcul. */
  study_metrics?: {
    production_annual_kwh: number | null;
    shading_loss_pct: number | null;
  };
}

function fmtShadingPctFr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const rounded = Math.round(Number(v) * 10) / 10;
  const s = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
  return `${s} %`;
}

/** Résumé technique minimal — source unique : snapshot calpinage actif (payload). */
function QuoteTechnicalSummary({ payload }: { payload: CalpinageSnapshotPayload | null | undefined }) {
  if (payload == null || typeof payload !== "object") {
    return (
      <div className="sqb-text sqb-muted study-quote-kpi-empty">
        Aucun calpinage validé. Veuillez valider le calpinage avant de préparer le devis.
      </div>
    );
  }

  const panelsCount =
    payload.totals?.panels_count ??
    (Array.isArray(payload.frozenBlocks)
      ? payload.frozenBlocks.reduce((s, b) => s + (b.panels?.length ?? 0), 0)
      : 0) ??
    0;

  const panelPowerW = payload.panel?.power_wc ?? payload.panel?.power_w;
  const powerKwc =
    payload.totals?.total_power_kwc ??
    (typeof panelPowerW === "number" && Number.isFinite(panelPowerW) && panelsCount > 0
      ? (panelsCount * panelPowerW) / 1000
      : null);

  const panelBrand =
    payload.panel?.brand != null && String(payload.panel.brand).trim() !== ""
      ? String(payload.panel.brand).trim()
      : null;
  const panelModel =
    payload.panel?.model ?? payload.panel?.model_ref;
  const panelModelStr =
    panelModel != null && String(panelModel).trim() !== "" ? String(panelModel).trim() : null;
  const panelLabel = [panelBrand, panelModelStr].filter(Boolean).join(" — ") || "—";

  const hasInverter = payload.inverter != null && typeof payload.inverter === "object";
  const inverterCount =
    payload.inverter_totals?.units_required ??
    (hasInverter ? 1 : 0);

  const inverterBrand =
    payload.inverter?.brand != null && String(payload.inverter.brand).trim() !== ""
      ? String(payload.inverter.brand).trim()
      : null;
  const inverterName =
    payload.inverter?.name != null && String(payload.inverter.name).trim() !== ""
      ? String(payload.inverter.name).trim()
      : null;
  const inverterLabel = [inverterBrand, inverterName].filter(Boolean).join(" — ") || "—";

  const shadingPct = payload.study_metrics?.shading_loss_pct ?? null;
  const shadingHelpTitle =
    shadingPct == null
      ? "Non renseigné sur ce snapshot — terminer le calpinage, vérifier la localisation du toit ou regénérer l’étude."
      : "Même synthèse que l’« Impact global estimé » du PDF « Analyse d’ombrage » (obstacles proches + horizon). Estimation annuelle par modèle : ordre de grandeur comparable entre projets, pas une mesure sur site ni une production garantie.";

  return (
    <div className="study-quote-kpis">
      <div className="study-quote-kpi">
        <span className="study-quote-kpi-value">{panelsCount}</span>
        <span className="study-quote-kpi-label">Panneaux</span>
        <span className="study-quote-kpi-detail">{panelLabel}</span>
      </div>
      <div className="study-quote-kpi">
        <span className="study-quote-kpi-value">{inverterCount}</span>
        <span className="study-quote-kpi-label">Onduleurs</span>
        <span className="study-quote-kpi-detail">{inverterLabel}</span>
      </div>
      <div className="study-quote-kpi">
        <span className="study-quote-kpi-value">{fmtKwc3(powerKwc)} kWc</span>
        <span className="study-quote-kpi-label">Puissance</span>
      </div>
      <div className="study-quote-kpi study-quote-kpi--shading">
        <span className="study-quote-kpi-value">{fmtShadingPctFr(shadingPct)}</span>
        <div className="study-quote-kpi-label-row">
          <span className="study-quote-kpi-label">Impact d’ombrage global</span>
          <span
            className="study-quote-kpi-help"
            title={shadingHelpTitle}
            tabIndex={0}
            aria-label={shadingHelpTitle}
          >
            ?
          </span>
        </div>
      </div>
    </div>
  );
}

/** Dérive un payload minimal pour QuoteTechnicalSummary à partir du résumé technique API */
function technicalSummaryToPayload(summary: QuotePrepResponse["technical_snapshot_summary"] | null | undefined): CalpinageSnapshotPayload | null {
  if (!summary || typeof summary !== "object") return null;
  const s = summary as {
    nb_panels?: number;
    power_kwc?: number;
    total_panels?: number;
    total_power_kwc?: number;
    production_annual_kwh?: number | null;
    shading_pct?: number | null;
    total_loss_pct?: number | null;
    panel?: { brand?: string; model?: string; power_wc?: number };
    inverter?: { brand?: string; name?: string };
    inverter_totals?: { units_required?: number };
  };
  const panels = s.total_panels ?? s.nb_panels ?? 0;
  const powerKwc = s.total_power_kwc ?? s.power_kwc ?? 0;
  const shadingRaw = s.total_loss_pct ?? s.shading_pct;
  const shadingLossPct =
    shadingRaw != null && Number.isFinite(Number(shadingRaw)) ? Number(shadingRaw) : null;
  const prodRaw = s.production_annual_kwh;
  const productionAnnualKwh =
    prodRaw != null && Number.isFinite(Number(prodRaw)) ? Number(prodRaw) : null;
  return {
    totals: { panels_count: panels, total_power_kwc: powerKwc },
    frozenBlocks: [],
    panel: s.panel && typeof s.panel === "object" ? { brand: s.panel.brand, model: s.panel.model, model_ref: s.panel.model, power_wc: s.panel.power_wc } : {},
    inverter: s.inverter && typeof s.inverter === "object" ? { brand: s.inverter.brand, name: s.inverter.name } : {},
    inverter_totals: s.inverter_totals,
    study_metrics: {
      production_annual_kwh: productionAnnualKwh,
      shading_loss_pct: shadingLossPct,
    },
  };
}

export default function StudyQuoteBuilder() {
  const { studyId, versionId } = useParams<{ studyId: string; versionId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSnapshotPayload, setActiveSnapshotPayload] = useState<CalpinageSnapshotPayload | null>(null);
  const [economic, setEconomic] = useState<EconomicData>(DEFAULT_ECONOMIC_DATA);
  const [status, setStatus] = useState<"DRAFT" | "READY_FOR_STUDY">("DRAFT");
  const [snapshotVersion, setSnapshotVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSaveRef = useRef(false);
  const [catalogModalMode, setCatalogModalMode] = useState<"material" | "battery_physical" | null>(null);
  // Catalogue batteries PV (pour sélection batterie physique + pré-remplissage prix)
  const [pvBatteriesList, setPvBatteriesList] = useState<PvBattery[]>([]);

  // Contexte quote-prep : kVA lead + type client + grilles org (batterie virtuelle)
  const [leadMeterPowerKva, setLeadMeterPowerKva] = useState(9);
  const [leadCustomerType, setLeadCustomerType] = useState<"PERSON" | "PRO">("PERSON");
  const [orgPvVirtualBattery, setOrgPvVirtualBattery] = useState<PvVirtualBatterySettings | null>(null);

  const locked = status === "READY_FOR_STUDY";
  const catalogModalOpen = catalogModalMode !== null;
  const [negativeMarginConfirmOpen, setNegativeMarginConfirmOpen] = useState(false);
  const [commercialQuoteBusy, setCommercialQuoteBusy] = useState(false);
  /** Après changement de compteur d’étude : rappel de recalcul (pas de run auto). */
  const [studyRecalcRecommended, setStudyRecalcRecommended] = useState(false);

  useEffect(() => {
    setStudyRecalcRecommended(false);
  }, [studyId]);

  const handleStudyMeterKvaResolved = useCallback((kva: number) => {
    setLeadMeterPowerKva(kva);
  }, []);

  const handleStudyMeterContextInvalidated = useCallback(() => {
    setStudyRecalcRecommended(true);
  }, []);

  const loadQuotePrep = useCallback(async () => {
    if (!studyId || !versionId) {
      setLoading(false);
      setError("Paramètres d’URL manquants (studyId, versionId).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const prepRes = await apiFetch(
        `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/quote-prep`
      );
      if (prepRes.status === 404) {
        setError("Version non trouvée ou calpinage non validé pour cette version.");
        setLoading(false);
        return;
      }
      if (!prepRes.ok) {
        const body = await prepRes.json().catch(() => ({})) as { error?: string };
        setError(body.error || `Erreur ${prepRes.status}`);
        setLoading(false);
        return;
      }
      const prep = await prepRes.json() as QuotePrepResponse;
      setActiveSnapshotPayload(
        technicalSummaryToPayload(prep.technical_snapshot_summary)
      );
      setLeadMeterPowerKva(prep.lead_meter_power_kva ?? 9);
      const resolvedCustomerType = prep.lead_customer_type ?? "PERSON";
      setLeadCustomerType(resolvedCustomerType);
      setOrgPvVirtualBattery(prep.organization_pv_virtual_battery ?? null);
      if (prep.economic_state) {
        const rawData = prep.economic_state.data?.items != null
          ? prep.economic_state.data
          : { ...DEFAULT_ECONOMIC_DATA, ...prep.economic_state.data };
        const normalizedItems = (rawData.items ?? []).map((item: QuotePrepItem) => ({
          ...item,
          // PRO : TVA 20% forcée sur toutes les lignes (régime professionnel, pas de taux réduit)
          vat_rate: resolvedCustomerType === "PRO"
            ? 20
            : (typeof item.vat_rate === "number" && Number.isFinite(item.vat_rate) ? item.vat_rate : DEFAULT_VAT_RATE),
        }));
        const rawCond = rawData.conditions ?? DEFAULT_ECONOMIC_DATA.conditions;
        const conditions = {
          discount_percent: rawCond.discount_percent ?? 0,
          discount_amount: rawCond.discount_amount ?? 0,
        };
        const virtualBattery = rawData.virtualBattery ?? (() => {
          const legacy = (rawData as unknown as Record<string, unknown>).virtualBatteryConfig as { providerCode?: string; segmentCode?: string } | undefined;
          if (!legacy?.providerCode) return null;
          const segmentCode = legacy.segmentCode ?? "";
          const contractType = (segmentCode === "PART_HPHC" || segmentCode === "PRO_HPHC_MU") ? "HPHC" as const : "BASE" as const;
          const provider = (legacy.providerCode === "MYLIGHT_MYBATTERY" || legacy.providerCode === "MYLIGHT_MYSMARTBATTERY" || legacy.providerCode === "URBAN_SOLAR")
            ? legacy.providerCode
            : "MYLIGHT_MYBATTERY";
          return { provider, contractType, capacityKwh: undefined } as VirtualBatteryConfig;
        })();
        const merged: EconomicData = {
          ...rawData,
          items: normalizedItems,
          conditions,
          virtualBattery: virtualBattery ?? null,
          batteries: {
            ...rawData.batteries,
            virtual: {
              ...rawData.batteries?.virtual,
              enabled: !!virtualBattery?.provider,
            },
          },
        };
        const tLoad = computeTotals(merged);
        setEconomic({
          ...merged,
          financing: mergeFinancing(rawData.financing, tLoad.ttc),
        });
        setStatus(prep.economic_state.status);
        setSnapshotVersion(prep.economic_state.snapshot_version);
      } else {
        setEconomic(DEFAULT_ECONOMIC_DATA);
        setStatus("DRAFT");
        setSnapshotVersion(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [studyId, versionId]);

  useEffect(() => {
    loadQuotePrep();
  }, [loadQuotePrep]);

  // Catalogue batteries PV (prix d’achat catalogue pour l’analyse interne + modal)
  useEffect(() => {
    let cancelled = false;
    listBatteries()
      .then((list) => { if (!cancelled) setPvBatteriesList(list); })
      .catch(() => { if (!cancelled) setPvBatteriesList([]); });
    return () => { cancelled = true; };
  }, []);

  const persistDraft = useCallback(
    async (data: EconomicData) => {
      if (!studyId || !versionId || locked) return;
      setSaving(true);
      setSaveStatus("saving");
      try {
        const totalsComputed = computeTotals(data);
        const payload = {
          ...data,
          virtualBattery: data.virtualBattery ?? null,
          batteries: {
            ...data.batteries,
            virtual: { ...data.batteries.virtual, enabled: !!data.virtualBattery?.provider },
          },
          totals: totalsComputed,
          financing: mergeFinancing(data.financing, totalsComputed.ttc),
        };
        const res = await apiFetch(
          `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/quote-prep`,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        );
        const body = await res.json().catch(() => ({})) as { error?: string; version_number?: number };
        if (!res.ok) {
          setSaveStatus("error");
          showToast(body.error || `Erreur ${res.status}`, false);
          return;
        }
        setSnapshotVersion(body.version_number ?? snapshotVersion ?? null);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (e) {
        setSaveStatus("error");
        showToast(e instanceof Error ? e.message : "Erreur sauvegarde", false);
      } finally {
        setSaving(false);
      }
    },
    [studyId, versionId, locked, snapshotVersion]
  );

  const handleCreateCommercialQuoteFromStudy = useCallback(async () => {
    if (!studyId || !versionId) return;
    setCommercialQuoteBusy(true);
    try {
      const studyRes = await apiFetch(`${API_BASE}/api/studies/${encodeURIComponent(studyId)}`);
      if (!studyRes.ok) {
        const err = await studyRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${studyRes.status}`);
      }
      const data = (await studyRes.json()) as { study?: { lead_id?: string; client_id?: string | null } };
      const leadId = data.study?.lead_id;
      if (!leadId) {
        window.alert("Aucun lead associé à cette étude pour créer un devis commercial.");
        return;
      }
      const studyImportOnly = {
        study_import: {
          last_at: new Date().toISOString(),
          study_version_id: versionId,
        },
      };
      const body: Parameters<typeof createQuoteDraft>[0] = {
        lead_id: leadId,
        client_id: data.study?.client_id || undefined,
        study_id: studyId,
        study_version_id: versionId,
        items: [],
        metadata: studyImportOnly,
      };
      try {
        const prep = await fetchQuotePrepEconomicItems(studyId, versionId);
        const { items, metadata } = buildQuoteCreatePayloadFromQuotePrep(versionId, prep);
        body.items = items;
        body.metadata = metadata;
      } catch {
        /* devis créé sans lignes si quote-prep indisponible — metadata minimal ci-dessus */
      }
      const { quote } = await createQuoteDraft(body);
      navigate(`/quotes/${quote.id}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Impossible de créer le devis");
    } finally {
      setCommercialQuoteBusy(false);
    }
  }, [studyId, versionId, navigate]);

  useEffect(() => {
    if (!loading && versionId) canSaveRef.current = true;
  }, [loading, versionId]);

  useEffect(() => {
    if (!canSaveRef.current || locked || !versionId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistDraft(economic);
      debounceRef.current = null;
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [economic, locked, versionId, persistDraft]);

  const totalsForSync = computeTotals(economic);
  useEffect(() => {
    if (locked) return;
    const f = economic.financing ?? DEFAULT_FINANCING;
    const active = (f.duration_months ?? 0) > 0 && (f.interest_rate_annual ?? 0) > 0;
    if (!active || totalsForSync.ttc <= 0) return;
    if ((f.amount ?? 0) > 0) return;
    setEconomic((d) => ({
      ...d,
      financing: { ...DEFAULT_FINANCING, ...d.financing, amount: totalsForSync.ttc },
    }));
  }, [locked, economic.financing?.duration_months, economic.financing?.interest_rate_annual, economic.financing?.amount, totalsForSync.ttc]);

  /**
   * Valide le devis technique — avec gate marge négative si applicable.
   * Appelé directement par le bouton "Valider" ET par la confirmation modale.
   */
  const doValidateDevisTechnique = useCallback(async () => {
    if (!studyId || !versionId || locked) return;
    setSaving(true);
    try {
      const res = await apiFetch(
        `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/validate-devis-technique`,
        { method: "POST", headers: { "Content-Type": "application/json" } }
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: string;
        scenarios?: { ids?: string[]; count?: number };
      };
      if (!res.ok) {
        if (body.error === "LOCKED_VERSION") {
          showToast("Version déjà verrouillée.", false);
        } else {
          showToast(body.error || `Erreur ${res.status}`, false);
        }
        return;
      }
      if (body.status === "SCENARIOS_GENERATED") {
        const count = body.scenarios?.count ?? body.scenarios?.ids?.length ?? 0;
        const confirmationMessage =
          count <= 1
            ? "Votre scénario est prêt. Les options de stockage ne sont pas activées dans le devis."
            : `${count} scénarios sont prêts à comparer.`;
        showToast(confirmationMessage, true, { variant: "premium", durationMs: 5200 });
        navigate(`/studies/${studyId}`);
      }
    } finally {
      setSaving(false);
    }
  }, [studyId, versionId, locked, navigate]);

  /**
   * Gate marge négative : calcule la marge courante et affiche la confirmation
   * si elle est négative, sinon valide directement.
   * Calcul inline (marge matériel) sans dépendre des valeurs d’affichage du rendu.
   */
  const handleValidateDevisTechnique = useCallback(() => {
    const { sans, avec, batteryMaterialEligible } = studyMaterialMarginBundle(economic, pvBatteriesList);
    const gateMargeHt = batteryMaterialEligible ? avec.margeHt : sans.margeHt;
    if (gateMargeHt < 0) {
      setNegativeMarginConfirmOpen(true);
    } else {
      doValidateDevisTechnique();
    }
  }, [economic, doValidateDevisTechnique, pvBatteriesList]);

  const handleFork = useCallback(async () => {
    if (!studyId || !versionId) return;
    setSaving(true);
    try {
      const res = await apiFetch(
        `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/quote-prep/fork`,
        { method: "POST", headers: { "Content-Type": "application/json" } }
      );
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        showToast(body.error || `Erreur ${res.status}`, false);
        return;
      }
      showToast("Nouvelle version brouillon créée (v+1)", true);
      loadQuotePrep();
    } finally {
      setSaving(false);
    }
  }, [studyId, versionId, loadQuotePrep]);

  const updateEconomic = useCallback((updater: (prev: EconomicData) => EconomicData) => {
    if (locked) return;
    setEconomic(updater);
  }, [locked]);

  const addItemFromCatalog = useCallback((item: CatalogItemApi) => {
    const defaultPrice = item.sale_price_ht_cents / 100;
    const qty = 1;
    // PRO : TVA 20% forcée (taux réduit interdit pour les clients professionnels)
    const vatRate = leadCustomerType === "PRO"
      ? 20
      : (item.default_vat_rate_bps != null ? item.default_vat_rate_bps / 100 : DEFAULT_VAT_RATE);
    const total = Math.round(defaultPrice * qty * 100) / 100;
    updateEconomic((d) => ({
      ...d,
      items: [
        ...d.items,
        {
          catalog_item_id: item.id,
          label: item.name,
          category: item.category,
          quantity: qty,
          unit_price: defaultPrice,
          vat_rate: vatRate,
          total,
          product_snapshot: catalogItemToProductSnapshot(item),
          purchase_price_ht_cents: item.purchase_price_ht_cents,
        },
      ],
    }));
  }, [updateEconomic, leadCustomerType]);

  const handleSelectPvBattery = useCallback(
    (battery: PvBattery) => {
      const defaultPrice = battery.default_price_ht != null && battery.default_price_ht >= 0 ? battery.default_price_ht : 0;
      const purchaseHt =
        battery.purchase_price_ht != null && Number.isFinite(Number(battery.purchase_price_ht)) && Number(battery.purchase_price_ht) >= 0
          ? Number(battery.purchase_price_ht)
          : null;
      const product_snapshot = {
        id: battery.id,
        usable_kwh: battery.usable_kwh,
        max_charge_kw: battery.max_charge_kw,
        max_discharge_kw: battery.max_discharge_kw,
        roundtrip_efficiency_pct: battery.roundtrip_efficiency_pct ?? 90,
        // Champs V2 power-scaling — utilisés pour prévisualisation puissance dans le devis technique
        scalable: battery.scalable,
        max_system_charge_kw: battery.max_system_charge_kw ?? null,
        max_system_discharge_kw: battery.max_system_discharge_kw ?? null,
        ...(purchaseHt != null ? { purchase_price_ht: purchaseHt } : {}),
      };
      updateEconomic((d) => ({
        ...d,
        batteries: {
          ...d.batteries,
          physical: {
            enabled: true,
            batteryId: battery.id,
            label: battery.name,
            price: defaultPrice,
            purchase_price_ht: purchaseHt,
            qty: 1,
            batteryPriceEdited: false,
            capacity_kwh: battery.usable_kwh,
            product_snapshot,
          },
        },
      }));
      setCatalogModalMode(null);
    },
    [updateEconomic]
  );

  const handleCatalogSelect = useCallback(
    (item: CatalogItemApi) => {
      if (catalogModalMode === "material") {
        addItemFromCatalog(item);
      }
      setCatalogModalMode(null);
    },
    [catalogModalMode, addItemFromCatalog]
  );

  const handleVirtualBatteryChange = useCallback(
    (config: VirtualBatteryConfig | null) => {
      updateEconomic((d) => ({
        ...d,
        virtualBattery: config,
        batteries: {
          ...d.batteries,
          virtual: { ...d.batteries.virtual, enabled: !!config?.provider },
        },
      }));
    },
    [updateEconomic]
  );

  const updateItem = useCallback(
    (index: number, field: keyof QuotePrepItem, value: string | number) => {
      updateEconomic((d) => {
        const next = [...d.items];
        if (!next[index]) return d;
        const item = { ...next[index], [field]: value };
        item.total = calculateLineHT(item);
        next[index] = item;
        return { ...d, items: next };
      });
    },
    [updateEconomic]
  );

  const removeItem = useCallback(
    (index: number) => {
      updateEconomic((d) => ({
        ...d,
        items: d.items.filter((_, i) => i !== index),
      }));
    },
    [updateEconomic]
  );

  const applyVat20ToAllLines = useCallback(() => {
    updateEconomic((d) => ({
      ...d,
      items: d.items.map((it) => ({ ...it, vat_rate: 20 })),
    }));
  }, [updateEconomic]);

  const allLinesAt20Vat =
    economic.items.length > 0 &&
    economic.items.every((it) => (it.vat_rate ?? DEFAULT_VAT_RATE) === 20);

  const totals = computeTotals(economic);

  const {
    sans: materialSansBattery,
    avec: materialAvecBattery,
    batteryMaterialEligible,
    internalWithBatteryReady,
  } = studyMaterialMarginBundle(economic, pvBatteriesList);
  const finRaw = { ...DEFAULT_FINANCING, ...economic.financing };

  const physicalBat = economic.batteries.physical;
  const physicalUnitHt = physicalBat.price ?? 0;
  const physicalLineTtc =
    physicalBat.enabled && physicalUnitHt > 0
      ? Math.round(physicalBatteryUnitHtToTtc(physicalUnitHt) * (physicalBat.qty ?? 1) * 100) / 100
      : null;

  const materialMarginNegative =
    materialSansBattery.margeHt < 0 ||
    (batteryMaterialEligible && internalWithBatteryReady && materialAvecBattery.margeHt < 0);
  const materialWarnTauxPct =
    batteryMaterialEligible && internalWithBatteryReady && materialAvecBattery.margeHt < 0
      ? materialAvecBattery.tauxMargeSurAchatPct
      : materialSansBattery.tauxMargeSurAchatPct;

  if (loading) {
    return (
      <div className="study-quote-page">
        <p className="sqb-text sqb-muted">Chargement…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="study-quote-page study-quote-page--narrow">
        <p className="sqb-text sqb-margin-bottom">{error}</p>
        <button
          type="button"
          className="sn-btn sn-btn-outline-gold"
          onClick={() => navigate(studyId && versionId ? `/studies/${studyId}/versions/${versionId}` : "/leads")}
        >
          Retour à l'étude
        </button>
      </div>
    );
  }

  return (
    <div className="study-quote-page">
      <header className="study-quote-page-header">
        <h1 className="sqb-h1">Préparation du devis technique</h1>
        <div className="study-quote-page-header__meta">
          {saveStatus === "saving" && <span className="sqb-helper">Enregistrement…</span>}
          {saveStatus === "saved" && (
            <span className="sqb-helper sn-badge sn-badge-success">Sauvegardé</span>
          )}
          {saveStatus === "error" && (
            <span className="sqb-helper sn-badge sn-badge-danger">Non sauvegardé</span>
          )}
          {locked && <span className="sn-badge sn-badge-success">READY_FOR_STUDY</span>}
        </div>
      </header>

      <div className="sqb-workbench sn-card">
        {studyId && versionId && (
          <>
            <StudyMeterSelector
              studyId={studyId}
              versionId={versionId}
              locked={locked}
              apiBase={API_BASE}
              onMeterPowerKvaResolved={handleStudyMeterKvaResolved}
              onCalcContextInvalidated={handleStudyMeterContextInvalidated}
            />
            <div className="sqb-divider" role="presentation" />
          </>
        )}

        {studyRecalcRecommended && (
          <div className="sqb-study-recalc-banner" role="status">
            <strong>Recalcul recommandé.</strong> Le compteur de référence de cette étude a changé : lancez un
            calcul depuis la fiche lead ou le flux étude pour mettre à jour les scénarios et indicateurs.
          </div>
        )}

        <section className="sqb-section sqb-section--technical-summary">
          <h2 className="sqb-h2 sqb-h2--technical-summary">Résumé technique</h2>
          <QuoteTechnicalSummary payload={activeSnapshotPayload} />
        </section>

        <div className="sqb-divider" role="presentation" />

        <section className="sqb-section sqb-section--material">
          <div className="sqb-section-head">
            <h2 className="sqb-h2 sqb-h2--inline">Matériel principal</h2>
            {leadCustomerType === "PRO" ? (
              <span className="sn-badge sn-badge-info" title="Clients professionnels : TVA 20% appliquée sur toutes les lignes">
                TVA 20% — régime professionnel
              </span>
            ) : (
              !locked && economic.items.length > 0 && (
                <button
                  type="button"
                  className="sn-btn sn-btn-ghost sn-btn-sm sqb-btn-compact"
                  onClick={applyVat20ToAllLines}
                  disabled={allLinesAt20Vat}
                >
                  20% toutes lignes
                </button>
              )
            )}
          </div>
          <div className="sn-table-wrapper">
            <table className="sn-ui-table sn-ui-table--editable sn-table-finance">
              <thead>
                <tr>
                  <th className="col-designation">Désignation</th>
                  <th className="col-qty">Qté</th>
                  <th className="col-price">Prix unit. (€)</th>
                  <th className="col-vat">TVA (%)</th>
                  <th className="col-total">Total TTC (€)</th>
                  {!locked && <th className="col-actions" />}
                </tr>
              </thead>
              <tbody>
                {economic.items.map((item, i) => (
                  <tr key={i}>
                    <td className="col-designation">
                      <input
                        type="text"
                        className="sn-input"
                        value={item.label}
                        onChange={(e) => updateItem(i, "label", e.target.value)}
                        placeholder="Libellé"
                        disabled={locked}
                      />
                    </td>
                    <td className="col-qty">
                      <LocaleNumberInput
                        className="sn-input"
                        min={0}
                        disabled={locked}
                        value={item.quantity}
                        onChange={(n) => updateItem(i, "quantity", n)}
                        displayEmptyWhenZero
                        maximumFractionDigits={2}
                        aria-label="Quantité"
                      />
                    </td>
                    <td className="col-price">
                      <LocaleNumberInput
                        className="sn-input"
                        min={0}
                        disabled={locked}
                        value={item.unit_price}
                        onChange={(n) => updateItem(i, "unit_price", n)}
                        displayEmptyWhenZero
                        minimumFractionDigits={2}
                        maximumFractionDigits={2}
                        aria-label="Prix unitaire"
                      />
                    </td>
                    <td className="col-vat">
                      <LocaleNumberInput
                        className="sn-input"
                        min={0}
                        max={100}
                        disabled={locked || leadCustomerType === "PRO"}
                        value={item.vat_rate ?? DEFAULT_VAT_RATE}
                        onChange={(n) => updateItem(i, "vat_rate", Math.max(0, Math.min(100, n)))}
                        maximumFractionDigits={2}
                        aria-label="TVA %"
                        title={leadCustomerType === "PRO" ? "TVA 20% fixe pour les clients professionnels" : undefined}
                      />
                    </td>
                    <td className="col-total">{fmtAmount2(calculateLineTTC(item))}</td>
                    {!locked && (
                      <td className="col-actions">
                        <button type="button" className="sn-btn sn-btn-ghost sn-table-finance-action" onClick={() => removeItem(i)} aria-label="Supprimer">✕</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!locked && (
            <div className="sqb-toolbar">
              <button type="button" className="sn-btn sn-btn-outline-gold sn-btn-sm" onClick={() => setCatalogModalMode("material")}>
                Ajouter depuis le catalogue
              </button>
            </div>
          )}
        </section>

        <div className="sqb-divider" role="presentation" />

        <section className="sqb-section sqb-section--pricing">
          <h2 className="sqb-h2 sqb-h2--pricing">Prix & conditions</h2>
          <div className="sqb-pricing-panel">
          <div className="sqb-price-stack sqb-pricing-section">
            <div className="sqb-subzone">
              <div className="sqb-subzone-title">Ajustements prix</div>
              <div className="sqb-grid-2 sqb-grid-2--dense">
                <span className="sqb-label sqb-muted sqb-label--compact">Remise (%)</span>
                <LocaleNumberInput
                  className="sn-input sqb-input-narrow"
                  min={0}
                  max={100}
                  disabled={locked}
                  value={economic.conditions.discount_percent}
                  onChange={(n) =>
                    updateEconomic((d) => ({
                      ...d,
                      conditions: { ...d.conditions, discount_percent: n },
                    }))
                  }
                  maximumFractionDigits={2}
                  aria-label="Remise en pourcent"
                />
                <span className="sqb-label sqb-muted sqb-label--compact">Remise (€)</span>
                <LocaleNumberInput
                  className="sn-input sqb-input-narrow"
                  min={0}
                  disabled={locked}
                  value={economic.conditions.discount_amount}
                  onChange={(n) =>
                    updateEconomic((d) => ({
                      ...d,
                      conditions: { ...d.conditions, discount_amount: n },
                    }))
                  }
                  minimumFractionDigits={2}
                  maximumFractionDigits={2}
                  aria-label="Remise en euros"
                />
              </div>
            </div>

            <div className="sqb-subzone">
              <div className="sqb-subzone-title">Totaux</div>
              <div className="sqb-rows sqb-rows--dense">
                <div className="sqb-row">
                  <span className="sqb-text sqb-muted">Total HT</span>
                  <span className="sqb-text sqb-row__val">{fmtEur2(totals.ht)}</span>
                </div>
                <div className="sqb-row">
                  <span className="sqb-text sqb-muted">TVA</span>
                  <span className="sqb-text sqb-row__val">{fmtEur2(totals.tva)}</span>
                </div>
                <div className="sqb-row sqb-ttc-highlight sqb-total">
                  <span className="sqb-total-ttc">TOTAL TTC</span>
                  <span className="sqb-total-ttc sqb-total-ttc__amount sqb-row__val">{fmtEur2(totals.ttc)}</span>
                </div>
              </div>
            </div>
          </div>
          </div>
        </section>

        <div className="sqb-divider" role="presentation" />

        <section className="sqb-section sqb-scenarios-section">
          <div className="sqb-section-heading">
            <h2 className="sqb-h2">Options scénario</h2>
            <p className="sqb-helper sqb-scenario-hint">
              Calcul des scénarios — hors prix matériel.
            </p>
          </div>
          <h3 className="sqb-h3 sqb-scenario-subtitle">Batterie physique</h3>
          <div className="sn-table-wrapper">
            <table className="sn-ui-table sn-ui-table--editable sn-table-finance">
              <thead>
                <tr>
                  <th className="col-actif">Actif</th>
                  <th className="col-designation">Produit</th>
                  <th className="col-price">Prix TTC (€)</th>
                  <th className="col-qty">Qté</th>
                  <th className="col-total">Total TTC (€)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="col-actif">
                    <label className="sqb-checkbox-label">
                      <input
                        type="checkbox"
                        checked={economic.batteries.physical.enabled}
                        onChange={(e) => updateEconomic((d) => ({
                          ...d,
                          batteries: { ...d.batteries, physical: { ...d.batteries.physical, enabled: e.target.checked } },
                        }))}
                        disabled={locked}
                      />
                      <span className="sqb-label sqb-label--inline sqb-label--compact">Physique</span>
                    </label>
                  </td>
                  <td className="col-designation">
                    {!locked && (
                      <button type="button" className="sn-btn sn-btn-ghost sn-btn-sm" onClick={() => setCatalogModalMode("battery_physical")}>
                        Catalogue
                      </button>
                    )}
                    {economic.batteries.physical.label && (
                      <span className={`sqb-text sqb-battery-label ${economic.batteries.physical.enabled && !locked ? "sqb-battery-label--spaced" : ""}`}>
                        {economic.batteries.physical.label}
                      </span>
                    )}
                  </td>
                  <td className="col-price">
                    {economic.batteries.physical.enabled && (
                      <LocaleNumberInput
                        className="sn-input"
                        min={0}
                        disabled={locked}
                        displayEmptyWhenZero
                        placeholder="TTC"
                        value={physicalUnitHt > 0 ? physicalBatteryUnitHtToTtc(physicalUnitHt) : 0}
                        onChange={(ttc) => {
                          const ht =
                            Number.isFinite(ttc) && ttc > 0 ? physicalBatteryUnitTtcToHt(ttc) : 0;
                          updateEconomic((d) => ({
                            ...d,
                            batteries: {
                              ...d.batteries,
                              physical: {
                                ...d.batteries.physical,
                                price: ht,
                                batteryPriceEdited: true,
                              },
                            },
                          }));
                        }}
                        minimumFractionDigits={2}
                        maximumFractionDigits={2}
                        aria-label="Prix batterie physique TTC unitaire"
                      />
                    )}
                  </td>
                  <td className="col-qty">
                    {economic.batteries.physical.enabled && (
                      <LocaleNumberInput
                        className="sn-input"
                        min={1}
                        max={5}
                        disabled={locked}
                        integer
                        value={economic.batteries.physical.qty ?? 1}
                        onChange={(n) =>
                          updateEconomic((d) => ({
                            ...d,
                            batteries: {
                              ...d.batteries,
                              physical: { ...d.batteries.physical, qty: Math.max(1, Math.min(5, n)) },
                            },
                          }))
                        }
                        emptyCommitValue={1}
                        aria-label="Quantité batterie"
                      />
                    )}
                  </td>
                  <td className="col-total">
                    {economic.batteries.physical.enabled &&
                      (physicalLineTtc != null ? fmtEur2(physicalLineTtc) : "—")}
                  </td>
                </tr>
              </tbody>
            </table>
            {/* Capacité et puissance totales — aperçu V2 avant calcul */}
            {(() => {
              const phys = economic.batteries.physical;
              if (!phys.enabled) return null;
              const qty = Math.max(1, phys.qty ?? 1);
              type BatterySnap = {
                usable_kwh?: number;
                max_charge_kw?: number;
                max_discharge_kw?: number;
                scalable?: boolean;
                max_system_charge_kw?: number | null;
                max_system_discharge_kw?: number | null;
              };
              const snap = phys.product_snapshot as BatterySnap | undefined;
              const unitKwh =
                phys.capacity_kwh != null && Number.isFinite(Number(phys.capacity_kwh)) && Number(phys.capacity_kwh) > 0
                  ? Number(phys.capacity_kwh)
                  : snap?.usable_kwh ?? null;
              if (unitKwh == null) return null;
              const totalKwh = qty * unitKwh;

              // Puissance système V2
              const unitCharge = snap?.max_charge_kw != null ? Number(snap.max_charge_kw) : null;
              const scalable = snap?.scalable !== false; // défaut true = compat legacy
              const capCharge = snap?.max_system_charge_kw != null ? Number(snap.max_system_charge_kw) : null;

              let systemChargeKw: number | null = null;
              let powerCapped = false;
              if (unitCharge != null && Number.isFinite(unitCharge) && unitCharge > 0) {
                if (!scalable) {
                  systemChargeKw = unitCharge; // ne scale jamais
                  powerCapped = qty > 1;
                } else {
                  const rawCharge = unitCharge * qty;
                  if (capCharge != null && Number.isFinite(capCharge) && capCharge > 0 && rawCharge > capCharge) {
                    systemChargeKw = capCharge;
                    powerCapped = true;
                  } else {
                    systemChargeKw = rawCharge;
                    powerCapped = false;
                  }
                }
              }

              const fmtKw = (v: number) =>
                v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

              return (
                <div className="sqb-battery-capacity-hint">
                  {/* Capacité */}
                  {qty > 1 ? (
                    <span>
                      <strong>{qty}</strong> × {unitKwh} kWh
                      {" = "}
                      <strong>{totalKwh} kWh</strong> utiles
                    </span>
                  ) : (
                    <span><strong>{unitKwh} kWh</strong> utiles</span>
                  )}
                  {/* Puissance système */}
                  {systemChargeKw != null && (
                    <>
                      <span className="sqb-battery-sep">·</span>
                      <span className={powerCapped ? "sqb-battery-power sqb-battery-power--capped" : "sqb-battery-power"}>
                        Puissance : <strong>{fmtKw(systemChargeKw)} kW</strong>
                        {powerCapped && (
                          <span className="sqb-battery-cap-warn" title={
                            !scalable
                              ? "Puissance figée par l'onduleur hybride ou le BMS — ne s'additionne pas avec plusieurs unités."
                              : `Puissance limitée à ${fmtKw(capCharge!)} kW par le système (onduleur hybride ou BMS).`
                          }> ⚠ limitée</span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="sqb-scenario-virtual">
            <VirtualBatteryConfigurator
              orgSettings={orgPvVirtualBattery}
              meterPowerKva={leadMeterPowerKva}
              pvPowerKwc={activeSnapshotPayload?.totals?.total_power_kwc ?? 0}
              value={economic.virtualBattery ?? null}
              onChange={handleVirtualBatteryChange}
              locked={locked}
            />
          </div>

          <section className="sqb-section sqb-section--financing sqb-financing">
          <h2 className="sqb-h2">Financement</h2>
          <div className="sqb-financing-panel">
          <div className="sqb-financing-inline">
            <label className="sqb-label sqb-field-inline">
              Montant (€)
              <LocaleNumberInput
                className="sn-input"
                min={0}
                disabled={locked}
                displayEmptyWhenZero
                value={finRaw.amount}
                placeholder={totals.ttc > 0 ? fmtAmount2(totals.ttc) : "—"}
                onChange={(n) =>
                  updateEconomic((d) => ({
                    ...d,
                    financing: { ...DEFAULT_FINANCING, ...d.financing, amount: Math.max(0, n) },
                  }))
                }
                minimumFractionDigits={2}
                maximumFractionDigits={2}
                aria-label="Montant financement"
              />
            </label>
            <label className="sqb-label sqb-field-inline">
              Durée (mois)
              <LocaleNumberInput
                className="sn-input"
                min={0}
                disabled={locked}
                integer
                displayEmptyWhenZero
                value={finRaw.duration_months}
                placeholder="180"
                onChange={(n) =>
                  updateEconomic((d) => {
                    const months = Math.max(0, Math.floor(n));
                    const next = { ...DEFAULT_FINANCING, ...d.financing, duration_months: months };
                    const ttc = computeTotals(d).ttc;
                    const active = months > 0 && (next.interest_rate_annual ?? 0) > 0;
                    if (active && (next.amount ?? 0) <= 0 && ttc > 0) next.amount = ttc;
                    return { ...d, financing: next };
                  })
                }
                aria-label="Durée financement en mois"
              />
            </label>
            <label className="sqb-label sqb-field-inline">
              Taux (%)
              <LocaleNumberInput
                className="sn-input"
                min={0}
                disabled={locked}
                displayEmptyWhenZero
                value={finRaw.interest_rate_annual}
                maximumFractionDigits={4}
                placeholder="4"
                onChange={(n) =>
                  updateEconomic((d) => {
                    const next = {
                      ...DEFAULT_FINANCING,
                      ...d.financing,
                      interest_rate_annual: Math.max(0, n),
                    };
                    const ttc = computeTotals(d).ttc;
                    const active = (next.duration_months ?? 0) > 0 && (next.interest_rate_annual ?? 0) > 0;
                    if (active && (next.amount ?? 0) <= 0 && ttc > 0) next.amount = ttc;
                    return { ...d, financing: next };
                  })
                }
                aria-label="Taux d'intérêt annuel %"
              />
            </label>
            </div>
          </div>
          </section>

          {/* ⚠️ Bandeau marge négative — visible dès que la marge passe sous 0 */}
          {materialMarginNegative && !locked && (
            <div className="sqb-negative-margin-banner" role="alert">
              <span className="sqb-negative-margin-banner__icon">⚠️</span>
              <span className="sqb-negative-margin-banner__text">
                <strong>
                  Attention — marge matériel négative (
                  {materialWarnTauxPct != null ? `${fmtPctFr(materialWarnTauxPct, 1, 1)} %` : "—"}
                  )
                </strong>
                <span> : ce devis est vendu en dessous du prix de revient. Une confirmation sera demandée avant validation.</span>
              </span>
            </div>
          )}

          <section className="sqb-section sqb-section--internal-analysis sqb-internal-analysis" aria-label="Analyse interne">
            <h2 className="sqb-h2 sqb-h2--internal-analysis">Analyse interne</h2>
            <p className="sqb-helper sqb-internal-analysis-hint">
              Marge matériel HT : uniquement les lignes avec prix d&apos;achat &gt; 0 ; % = marge HT / prix de vente matériel HT.
              « Avec batterie » : + vente / coût batterie physique si coût d&apos;achat catalogue &gt; 0.
            </p>
            <div className="sqb-internal-compare">
              <div className="sqb-internal-compare__grid sqb-internal-compare__grid--head">
                <div />
                <div className="sqb-internal-compare__col-title">Sans batterie</div>
                <div className="sqb-internal-compare__col-title">Avec batterie</div>
              </div>
              <div className="sqb-internal-compare__grid">
                <span className="sqb-text sqb-muted sqb-text--small">Coût achat HT</span>
                <span className="sqb-text sqb-internal-compare__val">{fmtEur2(materialSansBattery.achatMaterialHt)}</span>
                <span className="sqb-text sqb-internal-compare__val">
                  {internalWithBatteryReady ? fmtEur2(materialAvecBattery.achatMaterialHt) : "—"}
                </span>
              </div>
              <div className="sqb-internal-compare__grid">
                <span className="sqb-text sqb-muted sqb-text--small">Marge HT</span>
                <span className="sqb-text sqb-internal-compare__val">{fmtEur2(materialSansBattery.margeHt)}</span>
                <span className="sqb-text sqb-internal-compare__val">
                  {internalWithBatteryReady ? fmtEur2(materialAvecBattery.margeHt) : "—"}
                </span>
              </div>
              <div className="sqb-internal-compare__grid">
                <span className="sqb-text sqb-muted sqb-text--small">% marge</span>
                <span
                  className={`sqb-text sqb-internal-compare__val ${
                    materialSansBattery.margeHt < 0 ? "sqb-text--danger" : ""
                  }`}
                >
                  {materialSansBattery.tauxMargeSurAchatPct != null
                    ? `${fmtPctFr(materialSansBattery.tauxMargeSurAchatPct, 2, 2)} %`
                    : "—"}
                </span>
                <span
                  className={`sqb-text sqb-internal-compare__val ${
                    internalWithBatteryReady && materialAvecBattery.margeHt < 0 ? "sqb-text--danger" : ""
                  }`}
                >
                  {internalWithBatteryReady
                    ? materialAvecBattery.tauxMargeSurAchatPct != null
                      ? `${fmtPctFr(materialAvecBattery.tauxMargeSurAchatPct, 2, 2)} %`
                      : "—"
                    : "—"}
                </span>
              </div>
            </div>
          </section>
        </section>

        <div className="sqb-divider" role="presentation" />

        <section className="sqb-section" aria-label="Devis commercial">
          <h2 className="sqb-h2">Devis commercial (optionnel)</h2>
          <p className="sqb-helper" style={{ marginBottom: 12 }}>
            Raccourci : créer un devis commercial pré-rempli avec les lignes du chiffrage technique actuel. Le devis reste
            autonome et modifiable ; aucune synchronisation automatique avec l&apos;étude.
          </p>
          <button
            type="button"
            className="sn-btn sn-btn-outline-gold sn-btn-sm"
            onClick={() => void handleCreateCommercialQuoteFromStudy()}
            disabled={commercialQuoteBusy || !studyId || !versionId}
          >
            {commercialQuoteBusy ? "Création…" : "Créer un devis depuis cette étude"}
          </button>
        </section>

        <div className="sqb-workbench-footer">
          <button
            type="button"
            className="sn-btn sn-btn-ghost sn-btn-sm"
            onClick={() => navigate(studyId && versionId ? `/studies/${studyId}/versions/${versionId}` : "/leads")}
          >
            Retour à l&apos;étude
          </button>
          <div className="sqb-workbench-footer__actions">
            {locked ? (
              <button type="button" className="sn-btn sn-btn-outline-gold sn-btn-sm" onClick={handleFork} disabled={saving}>
                Nouvelle version (v+1)
              </button>
            ) : (
              <button
                type="button"
                className="sn-btn sn-btn-primary sn-btn-sm"
                onClick={handleValidateDevisTechnique}
                disabled={saving}
              >
                {saving ? "Calcul…" : "Valider le devis technique"}
              </button>
            )}
          </div>
        </div>
      </div>

      {catalogModalMode === "battery_physical" ? (
        <ModalPvBatterySelector
          open={catalogModalOpen}
          onClose={() => setCatalogModalMode(null)}
          batteries={pvBatteriesList}
          onSelect={handleSelectPvBattery}
        />
      ) : (
        <ModalCatalogSelector
          open={catalogModalOpen}
          onClose={() => setCatalogModalMode(null)}
          categoryFilter={undefined}
          title={catalogModalMode === "material" ? "Ajouter depuis le catalogue" : undefined}
          onSelect={handleCatalogSelect}
        />
      )}

      <ConfirmModal
        open={negativeMarginConfirmOpen}
        title="Marge négative"
        message={`Ce devis présente une marge matériel de ${
          materialWarnTauxPct != null ? `${fmtPctFr(materialWarnTauxPct, 1, 1)} %` : "—"
        } (taux sur prix de vente matériel HT).\n\nVous vendez en dessous du prix de revient.\n\nVoulez-vous valider quand même ?`}
        confirmLabel="Valider malgré tout"
        cancelLabel="Annuler"
        variant="warning"
        elevation="base"
        onCancel={() => setNegativeMarginConfirmOpen(false)}
        onConfirm={() => {
          setNegativeMarginConfirmOpen(false);
          doValidateDevisTechnique();
        }}
      />
    </div>
  );
}
