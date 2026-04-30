/**
 * Comparateur scénarios — 3 colonnes cartes (BASE, BATTERIE PHYSIQUE, BATTERIE VIRTUELLE).
 * Données : GET scenarios → scenarios_v2 (lecture seule, aucun recalcul).
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";

const GOLD = "#C39847";

export interface ScenarioV2Finance {
  capex_ttc?: number | null;
  capex_net?: number | null;
  roi_years?: number | null;
  irr_pct?: number | null;
  /** Alias possible scenarios_v2 (sinon irr_pct) */
  tri?: number | null;
  economie_year_1?: number | null;
  economie_total?: number | null;
  /** Alias possible scenarios_v2 (sinon economie_total) */
  total_savings_25y?: number | null;
  annual_cashflows?: unknown;
  lcoe?: number | null;
  virtual_battery_cost_annual?: number | null;
  residual_bill_eur?: number | null;
  /** Alias possible scenarios_v2 (sinon residual_bill_eur) */
  remaining_bill_eur?: number | null;
  surplus_revenue_eur?: number | null;
  /** Alias possible scenarios_v2 (sinon surplus_revenue_eur) */
  revenue_export?: number | null;
  /** Présent si le moteur expose une note (ex. skip virtuel) */
  note?: string | null;
  estimated_annual_bill_eur?: number | null;
}

export interface ScenarioV2Energy {
  production_kwh?: number | null;
  consumption_kwh?: number | null;
  autoconsumption_kwh?: number | null;
  surplus_kwh?: number | null;
  import_kwh?: number | null;
  billable_import_kwh?: number | null;
  credited_kwh?: number | null;
  used_credit_kwh?: number | null;
  remaining_credit_kwh?: number | null;
  monthly?: unknown;
  /** Autoconsommation (%) — alias poss. ; sinon self_consumption_pct */
  autoconsumption_pct?: number | null;
  self_consumption_pct?: number | null;
  self_production_pct?: number | null;
  energy_independence_pct?: number | null;
  autoproduction_kwh?: number | null;
  battery_losses_kwh?: number | null;
  virtual_battery_overflow_export_kwh?: number | null;
  /** Alias normalisé mapper V2 (restitution crédit) */
  restored_kwh?: number | null;
  /** Surplus non stocké virtuellement */
  overflow_export_kwh?: number | null;
  grid_import_kwh?: number | null;
  grid_export_kwh?: number | null;
  energy_solar_used_kwh?: number | null;
  energy_grid_import_kwh?: number | null;
}

export interface ScenarioV2Costs {
  battery_physical_price_ttc?: number | null;
  battery_virtual_annual_cost?: number | null;
}

export interface ScenarioV2Hardware {
  panels_count?: number | null;
  kwc?: number | null;
  battery_capacity_kwh?: number | null;
}

export interface ScenarioV2 {
  id?: string;
  type?: string;
  label?: string;
  energy?: ScenarioV2Energy;
  finance?: ScenarioV2Finance;
  costs?: ScenarioV2Costs;
  hardware?: ScenarioV2Hardware;
  /** Métriques moteur batterie physique (mapper V2) */
  battery_cycles_per_year?: number | null;
  battery_daily_cycles?: number | null;
  battery_utilization_pct?: number | null;
  battery_throughput_kwh?: number | null;
  battery_charge_kwh?: number | null;
  battery_discharge_kwh?: number | null;
  /** Champs optionnels non normalisés par le mapper (affichage only si présents) */
  virtual_battery_finance?: {
    hphc_allocation_status?: string | null;
  } | null;
  provider_tier_status?: string | null;
  _p2_skip_reason?: string | null;
  _virtualBatteryP2?: {
    required_capacity_kwh?: number | null;
    simulation_capacity_kwh?: number | null;
    provider_tier_status?: string | null;
  } | null;
  battery_virtual?: {
    capacity_simulated_kwh?: number | null;
    annual_charge_kwh?: number | null;
    annual_discharge_kwh?: number | null;
    annual_throughput_kwh?: number | null;
    cycles_equivalent?: number | null;
    overflow_export_kwh?: number | null;
  } | null;
  [key: string]: unknown;
}

const COLUMN_LABELS_DEFAULT: Record<string, string> = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
};

const COLUMN_SUBTITLES: Record<string, string> = {
  BASE: "Photovoltaïque seul, sans stockage.",
  BATTERY_PHYSICAL: "Stockage local + gestion du surplus.",
  BATTERY_VIRTUAL: "Crédit de votre surplus, utilisé plus tard",
};

function formatCurrency(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatPercent(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Number(v).toFixed(1)} %`;
}

function formatKwh(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Number(v).toLocaleString("fr-FR")} kWh`;
}

function formatYears(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v} ans`;
}

function finiteNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Affichage uniquement : alias API puis champs déjà utilisés dans le comparatif. */
function getResidualBillEurForDisplay(finance: ScenarioV2Finance): number | null {
  const est = finiteNumberOrNull(finance.estimated_annual_bill_eur);
  if (est != null) return est;
  const rem = finiteNumberOrNull(finance.remaining_bill_eur);
  if (rem != null) return rem;
  return finiteNumberOrNull(finance.residual_bill_eur);
}

const SCENARIO_IDS = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL"] as const;
export type ScenarioColumnId = (typeof SCENARIO_IDS)[number];

export type ScenarioSelectContext = { addToDocuments: boolean };

interface ScenarioComparisonTableProps {
  orderedScenarios: (ScenarioV2 | null)[];
  columnLabels?: Record<string, string>;
  studyId?: string;
  versionId?: string;
  onSelectScenario?: (scenarioKey: ScenarioColumnId, ctx: ScenarioSelectContext) => void;
  /** Désactive les boutons « Choisir » (ex. génération PDF en cours) — hors état verrouillé + colonne sélectionnée */
  selectionDisabled?: boolean;
  selectingId?: ScenarioColumnId | null;
  versionLocked?: boolean;
  selectedScenarioId?: ScenarioColumnId | null;
  pdfFlowBusy?: boolean;
  onRedownloadPdf?: () => void;
  redownloading?: boolean;
  className?: string;
}

const INITIAL_ADD_TO_DOCS: Record<ScenarioColumnId, boolean> = {
  BASE: false,
  BATTERY_PHYSICAL: false,
  BATTERY_VIRTUAL: false,
};

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="scenario-col-tip" title={text}>
      {children}
    </span>
  );
}

function EnergyFlowBar({
  autoKwh,
  importKwh,
  consoKwh,
}: {
  autoKwh: number | null;
  importKwh: number | null;
  consoKwh: number | null;
}) {
  if (consoKwh == null || !Number.isFinite(consoKwh) || consoKwh <= 0) {
    return <div className="scenario-energy-bar scenario-energy-bar-empty">—</div>;
  }
  const auto = autoKwh != null && Number.isFinite(autoKwh) ? Math.max(0, autoKwh) : 0;
  const imp = importKwh != null && Number.isFinite(importKwh) ? Math.max(0, importKwh) : 0;
  const autoPct = Math.min(100, (auto / consoKwh) * 100);
  const impPct = Math.min(100 - autoPct, (imp / consoKwh) * 100);
  const rest = Math.max(0, 100 - autoPct - impPct);
  return (
    <div className="scenario-energy-bar" aria-hidden>
      <div className="scenario-energy-bar-track">
        {autoPct > 0 && (
          <div
            className="scenario-energy-bar-seg scenario-energy-bar-auto"
            style={{ width: `${autoPct}%` }}
          />
        )}
        {impPct > 0 && (
          <div
            className="scenario-energy-bar-seg scenario-energy-bar-import"
            style={{ width: `${impPct}%` }}
          />
        )}
        {rest > 0.5 && (
          <div
            className="scenario-energy-bar-seg scenario-energy-bar-rest"
            style={{ width: `${rest}%` }}
          />
        )}
      </div>
      <div className="scenario-energy-bar-legend">
        <span>
          <i className="scenario-dot scenario-dot-auto" /> Auto
        </span>
        <span>
          <i className="scenario-dot scenario-dot-import" /> Réseau
        </span>
      </div>
    </div>
  );
}

type BadgeKind = "available" | "incomplete" | "unsuitable" | "missing";

function resolveColumnBadge(
  columnId: ScenarioColumnId,
  scenario: ScenarioV2 | null
): { kind: BadgeKind; detail?: string } {
  if (scenario == null) return { kind: "missing" };

  const tier =
    scenario.provider_tier_status ??
    (scenario._virtualBatteryP2?.provider_tier_status as string | undefined);
  const skip = scenario._p2_skip_reason ?? scenario.finance?.note;
  if (
    columnId === "BATTERY_VIRTUAL" &&
    (tier === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY" ||
      skip === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY" ||
      scenario.finance?.note === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY")
  ) {
    return {
      kind: "unsuitable",
      detail: "MySmart : capacité hors catalogue",
    };
  }

  const energy = scenario.energy ?? {};
  const hasEnergyCore =
    [energy.production_kwh, energy.consumption_kwh, energy.autoconsumption_kwh].some(
      (v) => v != null && Number.isFinite(Number(v))
    );

  if (!hasEnergyCore) {
    return { kind: "incomplete" };
  }

  if (columnId === "BATTERY_VIRTUAL") {
    if (scenario.finance?.note === "virtual_battery_skipped") {
      return { kind: "unsuitable", detail: "Simulation non disponible pour cette configuration" };
    }
  }

  const fin = scenario.finance ?? {};
  const financeEmpty =
    fin.economie_year_1 == null &&
    fin.economie_total == null &&
    fin.total_savings_25y == null &&
    fin.roi_years == null &&
    fin.irr_pct == null &&
    fin.tri == null;
  if (financeEmpty && hasEnergyCore) {
    return { kind: "incomplete" };
  }

  return { kind: "available" };
}

interface RowProps {
  label: string;
  tip?: string;
  value: React.ReactNode;
  /** Emoji / symbole affiché juste avant la valeur (ex. distinctions comparateur). */
  valueLead?: string;
  /** Mise en avant légère (ligne « gagnante »). */
  highlight?: boolean;
}

function MiniRow({ label, tip, value, valueLead, highlight }: RowProps) {
  const rowClass = [
    "scenario-mini-row",
    highlight ? "scenario-mini-row--highlight" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rowClass}>
      <span className="scenario-mini-label">
        {tip ? <Tip text={tip}>{label}</Tip> : label}
      </span>
      <span className="scenario-mini-value">
        <span className="scenario-mini-value-cluster">
          {valueLead ? (
            <span className="scenario-value-lead" aria-hidden>
              {valueLead}
            </span>
          ) : null}
          <span className="scenario-mini-value-text">{value}</span>
        </span>
      </span>
    </div>
  );
}

/** Masque le détail technique (refonte closing) — logique conservée dans les branches ci‑dessous. */
const SHOW_LEGACY_TECH_DETAIL = false;

function ctaLabel(id: ScenarioColumnId): string {
  if (id === "BASE") return "Choisir sans stockage";
  if (id === "BATTERY_PHYSICAL") return "Choisir batterie physique";
  return "Choisir batterie virtuelle";
}

const IMPACT_LINES: Record<
  ScenarioColumnId,
  readonly { icon: string; text: string }[]
> = {
  BASE: [
    { icon: "⚡", text: "Production partiellement utilisée" },
    { icon: "💸", text: "Dépendance réseau élevée" },
  ],
  BATTERY_PHYSICAL: [
    { icon: "🔋", text: "Stockage réel jour / nuit" },
    { icon: "🏡", text: "Autonomie énergétique" },
  ],
  BATTERY_VIRTUAL: [
    { icon: "💰", text: "Réutilisation du surplus" },
    { icon: "📈", text: "Rentabilité optimisée" },
  ],
};

/** Libellé contexte impact (closing) — affichage seulement, pas de calcul. */
const IMPACT_SCENE_HEADLINE: Record<ScenarioColumnId, string> = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
};

export default function ScenarioComparisonTable({
  orderedScenarios,
  columnLabels = COLUMN_LABELS_DEFAULT,
  studyId,
  versionId,
  onSelectScenario,
  selectionDisabled = false,
  selectingId = null,
  versionLocked = false,
  selectedScenarioId = null,
  pdfFlowBusy = false,
  onRedownloadPdf,
  redownloading = false,
  className = "",
}: ScenarioComparisonTableProps) {
  const scenarios =
    orderedScenarios.length >= 3
      ? orderedScenarios.slice(0, 3)
      : [...orderedScenarios, ...Array(3 - orderedScenarios.length).fill(null)];

  const baseEconomieY1 =
    scenarios[0]?.finance?.economie_year_1 != null &&
    Number.isFinite(Number(scenarios[0]?.finance?.economie_year_1))
      ? Number(scenarios[0]!.finance!.economie_year_1)
      : null;

  const quoteHref =
    studyId && versionId
      ? `/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/quote-builder`
      : null;

  const [addToDocumentsByScenario, setAddToDocumentsByScenario] =
    useState<Record<ScenarioColumnId, boolean>>(INITIAL_ADD_TO_DOCS);

  return (
    <div className={`scenario-comparison-premium ${className}`}>
      <div className="scenario-comparison-grid">
        {SCENARIO_IDS.map((id, index) => {
          const scenario = scenarios[index] as ScenarioV2 | null;
          const title = columnLabels[id] ?? COLUMN_LABELS_DEFAULT[id];
          const subtitle = COLUMN_SUBTITLES[id];
          const badge = resolveColumnBadge(id, scenario);

          const energy = scenario?.energy ?? {};
          const finance = scenario?.finance ?? {};
          const costs = scenario?.costs ?? {};
          const hardware = scenario?.hardware ?? {};
          const billableImportKwh =
            scenario?.energy?.energy_grid_import_kwh ??
            scenario?.energy?.billable_import_kwh ??
            scenario?.energy?.grid_import_kwh ??
            0;

          const autoKwh =
            energy.energy_solar_used_kwh != null && Number.isFinite(Number(energy.energy_solar_used_kwh))
              ? Number(energy.energy_solar_used_kwh)
              : energy.autoconsumption_kwh != null && Number.isFinite(Number(energy.autoconsumption_kwh))
                ? Number(energy.autoconsumption_kwh)
                : null;
          const importKwh =
            energy.import_kwh != null && Number.isFinite(Number(energy.import_kwh))
              ? Number(energy.import_kwh)
              : energy.billable_import_kwh != null && Number.isFinite(Number(energy.billable_import_kwh))
                ? Number(energy.billable_import_kwh)
                : null;
          const consoKwh =
            energy.consumption_kwh != null && Number.isFinite(Number(energy.consumption_kwh))
              ? Number(energy.consumption_kwh)
              : null;

          const vbFinance = scenario?.virtual_battery_finance;
          const partialHphc =
            vbFinance?.hphc_allocation_status === "PARTIAL_HPHC_ALLOCATION";

          const p2Cap = scenario?._virtualBatteryP2?.simulation_capacity_kwh;
          const bvCap = scenario?.battery_virtual?.capacity_simulated_kwh;
          const capacityVirt =
            bvCap != null && Number.isFinite(Number(bvCap))
              ? Number(bvCap)
              : p2Cap != null && Number.isFinite(Number(p2Cap))
                ? Number(p2Cap)
                : hardware.battery_capacity_kwh != null &&
                    Number.isFinite(Number(hardware.battery_capacity_kwh))
                  ? Number(hardware.battery_capacity_kwh)
                  : null;

          const overflowKwh =
            energy.overflow_export_kwh ?? energy.virtual_battery_overflow_export_kwh;

          const subscriptionAnnual =
            costs.battery_virtual_annual_cost ??
            finance.virtual_battery_cost_annual ??
            null;

          const mySmartBlocked =
            id === "BATTERY_VIRTUAL" &&
            (scenario?.provider_tier_status === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY" ||
              scenario?._p2_skip_reason === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY" ||
              scenario?.finance?.note === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY");

          const residualBillEur = getResidualBillEurForDisplay(finance);
          const solarUsedKwh =
            energy.energy_solar_used_kwh != null && Number.isFinite(Number(energy.energy_solar_used_kwh))
              ? Number(energy.energy_solar_used_kwh)
              : autoKwh;
          const gridToBuyKwh =
            energy.energy_grid_import_kwh != null && Number.isFinite(Number(energy.energy_grid_import_kwh))
              ? Number(energy.energy_grid_import_kwh)
              : billableImportKwh;
          const solarCoveragePct =
            solarUsedKwh != null && consoKwh != null && consoKwh > 0
              ? (solarUsedKwh / consoKwh) * 100
              : null;

          const isSelectedLocked =
            versionLocked && selectedScenarioId != null && selectedScenarioId === id;
          const isOtherLocked =
            versionLocked && selectedScenarioId != null && selectedScenarioId !== id;
          const lockBlocksAll = versionLocked && selectedScenarioId == null;

          return (
            <article
              key={id}
              className={`scenario-col-card${scenario == null ? " scenario-col-card--empty" : ""}${
                isSelectedLocked ? " scenario-col-card--selected" : ""
              }`}
            >
              <div className="scenario-col-top">
                <header className="scenario-col-head">
                  <div className="scenario-col-title-block">
                    <h3 className="scenario-col-title">{title}</h3>
                    <p className="scenario-col-sub">{subtitle}</p>
                  </div>
                  {badge.kind === "missing" && (
                    <span className="scenario-pill scenario-pill-muted">Non configuré</span>
                  )}
                  {badge.kind === "available" && (
                    <span className="scenario-pill scenario-pill-ok">DISPONIBLE</span>
                  )}
                  {badge.kind === "incomplete" && (
                    <span className="scenario-pill scenario-pill-warn">Données incomplètes</span>
                  )}
                  {badge.kind === "unsuitable" && (
                    <span className="scenario-pill scenario-pill-bad">Non adapté</span>
                  )}
                </header>

                {partialHphc && (
                  <p className="scenario-col-banner">
                    Répartition HP/HC partielle — estimation limitée.
                  </p>
                )}

                {mySmartBlocked && (
                  <p className="scenario-col-banner scenario-col-banner-strong">
                    Capacité requise supérieure aux offres actuelles (MySmart).
                  </p>
                )}
              </div>

              {scenario == null ? (
                <div className="scenario-col-body scenario-col-empty">
                  <p className="scenario-col-empty-msg">
                    Activez ou complétez cette option dans le devis technique pour comparer.
                  </p>
                  {quoteHref && (
                    <Link className="sg-btn sg-btn-secondary scenario-col-link" to={quoteHref}>
                      Ouvrir le devis technique
                    </Link>
                  )}
                </div>
              ) : (
                <>
                  <section className="scenario-row-hero scenario-block scenario-hero scenario-hero-prominent">
                    <p className="scenario-hero-label">
                      <Tip text="Économie estimée sur la première année, selon le scénario et les hypothèses du devis.">
                        Économie annuelle (année 1)
                      </Tip>
                    </p>
                    <p className="scenario-hero-value">{formatCurrency(finance.economie_year_1)}</p>
                  </section>

                  <div className="scenario-row-delta">
                    {id === "BATTERY_PHYSICAL" || id === "BATTERY_VIRTUAL" ? (
                      badge.kind === "available" &&
                      baseEconomieY1 != null &&
                      finance.economie_year_1 != null &&
                      Number.isFinite(Number(finance.economie_year_1)) ? (
                        <div className="scenario-vs-base">
                          <span className="scenario-vs-base-label">Gain vs sans batterie</span>
                          <span className="scenario-vs-base-value">
                            {(() => {
                              const d = Number(finance.economie_year_1) - baseEconomieY1;
                              const sign = d >= 0 ? "+" : "";
                              return (
                                <>
                                  {sign}
                                  {formatCurrency(d)} / an
                                </>
                              );
                            })()}
                          </span>
                        </div>
                      ) : (
                        <div className="scenario-vs-base scenario-vs-base--placeholder" aria-hidden />
                      )
                    ) : (
                      <div className="scenario-vs-base scenario-vs-base--placeholder" aria-hidden />
                    )}
                  </div>

                  <section className="scenario-block scenario-block-decision scenario-row-decision">
                    <h4 className="scenario-block-title">Décision</h4>
                    <MiniRow
                      label="Énergie solaire utilisée"
                      tip="Énergie solaire utilisée = autoconsommation directe + énergie restituée par la batterie."
                      value={
                        solarUsedKwh != null && Number.isFinite(Number(solarUsedKwh))
                          ? `Vous utiliserez environ ${formatKwh(solarUsedKwh)} de votre production solaire`
                          : "—"
                      }
                    />
                    <MiniRow
                      label="Énergie restante à acheter"
                      tip="Énergie réseau résiduelle (import facturé prioritaire)."
                      value={
                        gridToBuyKwh != null && Number.isFinite(Number(gridToBuyKwh))
                          ? `Il vous restera environ ${formatKwh(gridToBuyKwh)} à acheter au réseau`
                          : "—"
                      }
                    />
                    <MiniRow
                      label="Facture annuelle estimée"
                      tip="Montant annuel estimé du scénario sélectionné."
                      value={
                        residualBillEur != null && Number.isFinite(Number(residualBillEur))
                          ? `Votre facture d’électricité sera d’environ ${formatCurrency(residualBillEur)} par an`
                          : "—"
                      }
                    />
                    <MiniRow
                      label="Couverture solaire"
                      tip="% couverture solaire = énergie solaire utilisée / consommation."
                      value={
                        solarCoveragePct != null && Number.isFinite(Number(solarCoveragePct))
                          ? Number(solarCoveragePct) >= 50
                            ? "Plus de la moitié de votre consommation est couverte par votre installation solaire"
                            : `Vous couvrez environ ${formatPercent(solarCoveragePct)} de vos besoins avec votre installation solaire`
                          : "—"
                      }
                    />
                  </section>

                  <section className="scenario-block scenario-block-comprehension scenario-row-comprehension">
                    <h4 className="scenario-block-title">Message client</h4>
                    <p className="scenario-block-muted">
                      {id !== "BASE"
                        ? "Une partie de votre production solaire peut ne pas être utilisée à certains moments de l’année si la capacité de stockage est atteinte. Sans système de stockage, une partie importante de votre production solaire ne pourrait pas être utilisée."
                        : "Une partie de votre production solaire peut ne pas être utilisée à certains moments de l’année si la capacité de stockage est atteinte."}
                    </p>
                  </section>

                  <section className="scenario-block scenario-block-impact scenario-row-impact">
                    <h4 className="scenario-block-title">Impact</h4>
                    <p className="scenario-impact-scene">{IMPACT_SCENE_HEADLINE[id]}</p>
                    <ul className="scenario-impact-list">
                      {IMPACT_LINES[id].map((line) => (
                        <li key={line.text}>
                          <span className="scenario-impact-icon">{line.icon}</span>
                          <span>{line.text}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  {SHOW_LEGACY_TECH_DETAIL && (
                  <>
                  <section className="scenario-block">
                    <h4 className="scenario-block-title">Flux énergie</h4>
                    <EnergyFlowBar autoKwh={autoKwh} importKwh={importKwh} consoKwh={consoKwh} />
                    <MiniRow
                      label="Autoconsommation totale"
                      tip="Énergie solaire consommée sur place (directe et via stockage / crédit si applicable)."
                      value={formatKwh(energy.autoconsumption_kwh)}
                    />
                    {id === "BASE" && (
                      <>
                        <MiniRow
                          label="Énergie injectée (surplus)"
                          tip="Production PV non consommée immédiatement, envoyée sur le réseau."
                          value={formatKwh(energy.surplus_kwh)}
                        />
                        <MiniRow
                          label="Énergie prélevée au réseau"
                          tip="Électricité importée pour la consommation."
                          value={formatKwh(energy.import_kwh)}
                        />
                      </>
                    )}
                    {id === "BATTERY_PHYSICAL" && (
                      <>
                        <MiniRow
                          label="Énergie chargée (stockage)"
                          tip="Somme annuelle des flux entrants dans la batterie simulés (8760 h)."
                          value={formatKwh(scenario?.battery_charge_kwh)}
                        />
                        <MiniRow
                          label="Énergie déchargée (vers la maison)"
                          tip="Somme annuelle de l’énergie fournie par la batterie à la consommation (8760 h)."
                          value={formatKwh(scenario?.battery_discharge_kwh)}
                        />
                        <MiniRow
                          label="Throughput annuel"
                          tip="Charge + décharge annuelles agrégées (double comptage volontaire des flux, indicateur d’activité)."
                          value={formatKwh(scenario?.battery_throughput_kwh)}
                        />
                        <MiniRow
                          label="Injection réseau (surplus)"
                          tip="Surplus PV après stockage."
                          value={formatKwh(energy.surplus_kwh)}
                        />
                        <MiniRow
                          label="Prélèvement réseau"
                          tip="Import pour la consommation après pilotage batterie."
                          value={formatKwh(energy.import_kwh)}
                        />
                      </>
                    )}
                    {id === "BATTERY_VIRTUAL" && (
                      <>
                        <MiniRow
                          label="Énergie créditée (stock virtualisé)"
                          tip="Surplus transformé en kWh disponibles sur votre contrat virtuel."
                          value={formatKwh(energy.credited_kwh)}
                        />
                        <MiniRow
                          label="Énergie restituée"
                          tip="Crédits kWh utilisés pour réduire la facturation des imports."
                          value={formatKwh(energy.restored_kwh ?? energy.used_credit_kwh)}
                        />
                        <MiniRow
                          label="Import facturé après crédit"
                          tip="Volume résiduel payé au fournisseur après application du crédit."
                          value={formatKwh(energy.billable_import_kwh ?? energy.import_kwh)}
                        />
                        <MiniRow
                          label="Overflow export"
                          tip="Part du surplus réinjectée sans être stockée virtuellement, selon le moteur."
                          value={
                            overflowKwh != null && Number.isFinite(Number(overflowKwh))
                              ? formatKwh(Number(overflowKwh))
                              : "—"
                          }
                        />
                      </>
                    )}
                  </section>

                  <section className="scenario-block">
                    <h4 className="scenario-block-title">
                      {id === "BATTERY_PHYSICAL"
                        ? "Batterie physique"
                        : id === "BATTERY_VIRTUAL"
                          ? "Batterie virtuelle"
                          : "Équipement"}
                    </h4>
                    {id === "BATTERY_PHYSICAL" && (
                      <>
                        <MiniRow
                          label="Capacité utile"
                          tip="Capacité configurée dans le devis pour ce scénario."
                          value={
                            hardware.battery_capacity_kwh != null &&
                            Number.isFinite(Number(hardware.battery_capacity_kwh))
                              ? `${Number(hardware.battery_capacity_kwh)} kWh`
                              : "—"
                          }
                        />
                        <MiniRow
                          label="Cycles équivalents / an"
                          tip="Décharge annuelle / capacité nominale (équivalent cycles complets 0 → nominal)."
                          value={
                            scenario?.battery_cycles_per_year != null &&
                            Number.isFinite(Number(scenario.battery_cycles_per_year))
                              ? Number(scenario.battery_cycles_per_year).toLocaleString("fr-FR", {
                                  maximumFractionDigits: 2,
                                })
                              : "—"
                          }
                        />
                        <MiniRow
                          label="Cycles / jour (moy.)"
                          tip="Cycles équivalents divisés par 365."
                          value={
                            scenario?.battery_daily_cycles != null &&
                            Number.isFinite(Number(scenario.battery_daily_cycles))
                              ? Number(scenario.battery_daily_cycles).toLocaleString("fr-FR", {
                                  maximumFractionDigits: 3,
                                })
                              : "—"
                          }
                        />
                        <MiniRow
                          label="Taux d’utilisation"
                          tip="Décharge annuelle / (capacité nominale × 365 jours) — intensité d’usage."
                          value={
                            scenario?.battery_utilization_pct != null &&
                            Number.isFinite(Number(scenario.battery_utilization_pct))
                              ? formatPercent(Number(scenario.battery_utilization_pct))
                              : "—"
                          }
                        />
                      </>
                    )}
                    {id === "BATTERY_VIRTUAL" && (
                      <>
                        <MiniRow
                          label="Capacité (simulation / palier)"
                          tip="Capacité retenue par la simulation ou le palier fournisseur si présent dans les données."
                          value={
                            capacityVirt != null && capacityVirt > 0 ? `${capacityVirt} kWh` : "—"
                          }
                        />
                        <MiniRow
                          label="Énergie stockée annuelle"
                          tip="Synonyme du crédit annuel : kWh crédités sur le contrat."
                          value={formatKwh(energy.credited_kwh)}
                        />
                        <MiniRow
                          label="Énergie restituée"
                          tip="kWh de crédit effectivement utilisés sur l’année."
                          value={formatKwh(energy.restored_kwh ?? energy.used_credit_kwh)}
                        />
                        <MiniRow
                          label="Cycles équivalents / an"
                          tip="Décharge annuelle simulée / capacité virtuelle (kWh)."
                          value={
                            scenario?.battery_virtual?.cycles_equivalent != null &&
                            Number.isFinite(Number(scenario.battery_virtual.cycles_equivalent))
                              ? Number(scenario.battery_virtual.cycles_equivalent).toLocaleString(
                                  "fr-FR",
                                  { maximumFractionDigits: 2 },
                                )
                              : "—"
                          }
                        />
                        <MiniRow
                          label="Throughput annuel (charge + décharge)"
                          tip="Activité du stockage virtuel agrégée sur l’année."
                          value={formatKwh(scenario?.battery_virtual?.annual_throughput_kwh)}
                        />
                      </>
                    )}
                    {id === "BASE" && (
                      <p className="scenario-block-muted">
                        Pas de stockage : les indicateurs batterie ne s’appliquent pas.
                      </p>
                    )}
                  </section>

                  <section className="scenario-block">
                    <h4 className="scenario-block-title">Coûts</h4>
                    <MiniRow
                      label="Abonnement / service batterie virtuelle"
                      tip="Coût récurrent TTC du service stockage virtuel si présent."
                      value={
                        id === "BATTERY_VIRTUAL"
                          ? formatCurrency(subscriptionAnnual)
                          : "—"
                      }
                    />
                    <MiniRow
                      label="Coût énergie (résiduel)"
                      tip="Estimation de facture électricité résiduelle après solaire, selon le moteur."
                      value={formatCurrency(finance.residual_bill_eur)}
                    />
                    <MiniRow
                      label="Coût réseau"
                      tip="Poste non ventilé dans l’export scénario actuel."
                      value="—"
                    />
                    <MiniRow
                      label="Revenu export"
                      tip="Revenus de revente du surplus (hors batterie virtuelle crédit kWh)."
                      value={formatCurrency(finance.surplus_revenue_eur)}
                    />
                    <MiniRow
                      label="Investissement (CAPEX TTC)"
                      tip="Montant d’investissement issu du devis, utilisé pour le financement du scénario."
                      value={formatCurrency(finance.capex_ttc)}
                    />
                  </section>
                  </>
                  )}

                  {onSelectScenario || (isSelectedLocked && onRedownloadPdf) ? (
                    <footer className="scenario-col-footer scenario-row-footer">
                      {isSelectedLocked && onRedownloadPdf ? (
                        <div className="scenario-col-selected-footer">
                          <div className="scenario-selected-pill" role="status">
                            ✔ Solution sélectionnée
                          </div>
                          <button
                            type="button"
                            className="sg-btn sg-btn-primary scenario-col-cta"
                            disabled={redownloading || pdfFlowBusy || selectionDisabled}
                            onClick={() => onRedownloadPdf()}
                          >
                            {redownloading ? "Génération…" : "Télécharger à nouveau"}
                          </button>
                        </div>
                      ) : (
                        <>
                          {onSelectScenario ? (
                            <label className="scenario-add-docs">
                              <input
                                type="checkbox"
                                checked={addToDocumentsByScenario[id]}
                                disabled={
                                  selectionDisabled ||
                                  pdfFlowBusy ||
                                  badge.kind === "missing" ||
                                  badge.kind === "unsuitable" ||
                                  isOtherLocked ||
                                  lockBlocksAll
                                }
                                onChange={(e) =>
                                  setAddToDocumentsByScenario((prev) => ({
                                    ...prev,
                                    [id]: e.target.checked,
                                  }))
                                }
                              />
                              <span>Ajouter cette proposition aux documents</span>
                            </label>
                          ) : null}
                          <button
                            type="button"
                            className={`sg-btn sg-btn-primary scenario-col-cta${
                              isOtherLocked || lockBlocksAll ? " scenario-col-cta--blocked" : ""
                            }`}
                            disabled={
                              selectionDisabled ||
                              pdfFlowBusy ||
                              badge.kind === "missing" ||
                              badge.kind === "unsuitable" ||
                              isOtherLocked ||
                              lockBlocksAll
                            }
                            onClick={() =>
                              onSelectScenario?.(id, {
                                addToDocuments: addToDocumentsByScenario[id],
                              })
                            }
                          >
                            {selectingId === id ? "Enregistrement…" : ctaLabel(id)}
                          </button>
                        </>
                      )}
                    </footer>
                  ) : (
                    <div className="scenario-row-footer scenario-row-footer--inert" aria-hidden />
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>

      <style>{`
        .scenario-comparison-premium {
          --sg-gold: var(--gold, ${GOLD});
          border-radius: 1rem;
          border: 1px solid var(--sn-border-soft);
          background: var(--surface-app);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow: var(--shadow-card);
          padding: 1.25rem;
        }
        .scenario-comparison-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1rem;
          align-items: stretch;
        }
        @media (max-width: 1024px) {
          .scenario-comparison-grid {
            grid-template-columns: 1fr;
          }
        }
        .scenario-col-card {
          display: grid;
          grid-template-rows: auto auto auto 1fr auto auto auto;
          align-content: start;
          row-gap: 0.35rem;
          border-radius: 1rem;
          border: 1px solid var(--sn-border-soft);
          background: var(--sn-bg-surface);
          padding: 1.5rem 1.35rem 1.35rem;
          min-height: 100%;
          min-width: 0;
          box-shadow: var(--shadow-sm);
        }
        .scenario-col-card--empty {
          grid-template-rows: auto 1fr;
          row-gap: 0;
        }
        .scenario-col-card--selected {
          border-color: color-mix(in srgb, var(--gold) 42%, var(--sn-border-soft));
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--gold) 22%, transparent),
            var(--shadow-sm);
        }
        .theme-light .scenario-col-card--selected {
          border-color: color-mix(in srgb, var(--gold) 50%, var(--border-soft));
        }
        .scenario-col-selected-footer {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          width: 100%;
        }
        .scenario-selected-pill {
          text-align: center;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--success, #22c55e);
          padding: 0.35rem 0.5rem;
          border-radius: 8px;
          background: rgba(34, 197, 94, 0.14);
          border: 1px solid rgba(34, 197, 94, 0.28);
        }
        .theme-light .scenario-selected-pill {
          color: #15803d;
          background: rgba(34, 197, 94, 0.12);
          border-color: rgba(34, 197, 94, 0.35);
        }
        .scenario-col-cta--blocked {
          opacity: 0.5;
          pointer-events: none;
        }
        .scenario-col-card:not(.scenario-col-card--empty) > .scenario-row-hero,
        .scenario-col-card:not(.scenario-col-card--empty) > .scenario-row-decision,
        .scenario-col-card:not(.scenario-col-card--empty) > .scenario-row-comprehension,
        .scenario-col-card:not(.scenario-col-card--empty) > .scenario-row-impact {
          margin-bottom: 0;
        }
        .scenario-col-card:not(.scenario-col-card--empty) > .scenario-row-hero.scenario-hero {
          margin-bottom: 0;
        }
        .scenario-col-top {
          min-width: 0;
        }
        .scenario-col-head {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .scenario-col-title {
          margin: 0;
          font-size: 1.05rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--sg-gold);
        }
        .scenario-col-sub {
          margin: 0.35rem 0 0;
          font-size: 0.8rem;
          line-height: 1.35;
          color: var(--sn-text-secondary, #9FA8C7);
        }
        .scenario-pill {
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.2rem 0.5rem;
          border-radius: 999px;
          white-space: nowrap;
        }
        .scenario-pill-ok {
          background: rgba(39, 174, 96, 0.2);
          color: #6ee7a8;
          border: 1px solid rgba(39, 174, 96, 0.35);
        }
        .scenario-pill-warn {
          background: rgba(230, 126, 34, 0.2);
          color: #f5b041;
          border: 1px solid rgba(230, 126, 34, 0.35);
        }
        .scenario-pill-bad {
          background: rgba(192, 57, 43, 0.18);
          color: #f1948a;
          border: 1px solid rgba(192, 57, 43, 0.35);
        }
        .scenario-pill-muted {
          background: rgba(255,255,255,0.06);
          color: var(--sn-text-muted, #7d86a8);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .scenario-col-banner {
          margin: 0 0 0.75rem;
          padding: 0.5rem 0.65rem;
          border-radius: 0.5rem;
          font-size: 0.78rem;
          line-height: 1.35;
          background: rgba(230, 126, 34, 0.12);
          border: 1px solid rgba(230, 126, 34, 0.35);
          color: var(--sn-text-primary);
        }
        .scenario-col-banner-strong {
          background: rgba(192, 57, 43, 0.15);
          border-color: rgba(192, 57, 43, 0.4);
        }
        .scenario-col-body { min-height: 0; flex: 1; display: flex; flex-direction: column; }
        .scenario-col-empty { justify-content: center; align-items: center; text-align: center; min-height: 180px; gap: 0.75rem; }
        .scenario-col-empty-msg {
          margin: 0;
          font-size: 0.88rem;
          color: var(--sn-text-secondary, #9FA8C7);
          max-width: 22ch;
        }
        .scenario-col-link { text-decoration: none; }
        .scenario-block {
          margin-bottom: 1rem;
        }
        .scenario-block-title {
          margin: 0 0 0.5rem;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--sg-gold);
        }
        .scenario-block-muted {
          margin: 0;
          font-size: 0.8rem;
          color: var(--sn-text-muted, #7d86a8);
        }
        .scenario-hero {
          background: linear-gradient(145deg, rgba(195, 152, 71, 0.12), rgba(255,255,255,0.02));
          border: 1px solid rgba(195, 152, 71, 0.25);
          border-radius: 0.75rem;
          padding: 1rem;
          margin-bottom: 1rem;
        }
        .scenario-hero-prominent {
          padding: 1.2rem 1.1rem 1.15rem;
          margin-bottom: 1.1rem;
          border-width: 1.5px;
          border-color: rgba(195, 152, 71, 0.4);
          background: linear-gradient(155deg, rgba(195, 152, 71, 0.2), rgba(255,255,255,0.03));
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
        }
        .scenario-vs-base {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.15rem;
          font-size: 0.84rem;
          font-weight: 700;
          color: var(--sg-gold);
          letter-spacing: 0.02em;
          padding: 0.35rem 0 0.5rem;
          text-align: center;
        }
        .scenario-vs-base-label {
          font-size: 0.68rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--sn-text-secondary, #9FA8C7);
        }
        .scenario-vs-base-value {
          font-size: 0.9rem;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          color: var(--sg-gold);
        }
        .scenario-vs-base--placeholder {
          visibility: hidden;
          min-height: 1px;
          padding: 0;
        }
        .scenario-row-delta {
          min-height: 2.85rem;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 0;
        }
        .scenario-row-decision {
          min-height: 0;
          padding-top: 0.25rem;
          margin-top: 0.15rem;
          border-top: 1px solid rgba(255,255,255,0.07);
        }
        .scenario-mini-row--highlight {
          background: linear-gradient(
            90deg,
            rgba(195, 152, 71, 0.14),
            rgba(195, 152, 71, 0.04)
          );
          margin-left: -0.35rem;
          margin-right: -0.35rem;
          padding-left: 0.35rem;
          padding-right: 0.35rem;
          border-radius: 0.35rem;
          border-bottom-color: transparent;
        }
        .scenario-mini-row--highlight .scenario-mini-value-text {
          font-weight: 800;
          color: var(--sg-gold);
        }
        .scenario-value-lead {
          font-weight: 800;
          line-height: 1;
        }
        .scenario-block-comprehension {
          padding-top: 0.35rem;
          margin-top: 0.2rem;
          border-top: 1px solid rgba(255,255,255,0.07);
        }
        .scenario-block-impact {
          padding-top: 0.35rem;
          margin-top: 0.2rem;
          border-top: 1px solid rgba(255,255,255,0.07);
        }
        .scenario-impact-scene {
          margin: 0 0 0.55rem;
          font-size: 0.68rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--sn-text-primary);
        }
        .scenario-impact-list {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .scenario-impact-list li {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.8rem;
          line-height: 1.4;
          color: var(--sn-text-secondary, #9FA8C7);
          padding: 0.35rem 0;
          border-bottom: 1px solid rgba(255,255,255, 0.05);
        }
        .scenario-impact-list li:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .scenario-impact-icon {
          flex-shrink: 0;
          line-height: 1.4;
        }
        .scenario-hero-label {
          margin: 0;
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--sn-text-secondary, #9FA8C7);
        }
        .scenario-hero-value {
          margin: 0.35rem 0 0;
          font-size: 1.85rem;
          font-weight: 800;
          line-height: 1.1;
          color: var(--sn-text-primary);
        }
        .scenario-hero-prominent .scenario-hero-value {
          font-size: 2.15rem;
          color: var(--sn-text-primary);
        }
        .theme-light .scenario-hero-prominent {
          background: linear-gradient(
            155deg,
            rgba(195, 152, 71, 0.22),
            rgba(195, 152, 71, 0.06)
          );
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.06);
        }
        .scenario-mini-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.65rem;
          font-size: 0.82rem;
          padding: 0.32rem 0;
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .scenario-mini-label {
          color: var(--sn-text-secondary, #9FA8C7);
          flex: 1;
          min-width: 0;
        }
        .scenario-mini-value {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          font-weight: 600;
          color: var(--sn-text-primary);
          text-align: right;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
        .scenario-mini-value-cluster {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.22rem;
          max-width: 100%;
        }
        .scenario-mini-value-text {
          font-variant-numeric: tabular-nums;
        }
        .scenario-col-tip {
          cursor: help;
          border-bottom: 1px dotted rgba(195, 152, 71, 0.45);
        }
        .scenario-energy-bar { margin-bottom: 0.35rem; }
        .scenario-energy-bar-empty {
          height: 8px;
          background: rgba(255,255,255,0.06);
          border-radius: 4px;
        }
        .scenario-energy-bar-track {
          display: flex;
          height: 8px;
          border-radius: 4px;
          overflow: hidden;
          background: rgba(255,255,255,0.06);
        }
        .scenario-energy-bar-seg { min-width: 2px; }
        .scenario-energy-bar-auto { background: linear-gradient(90deg, #27ae60, #52d689); }
        .scenario-energy-bar-import { background: linear-gradient(90deg, #4a90e2, #7ab8ff); }
        .scenario-energy-bar-rest { background: rgba(255,255,255,0.12); }
        .scenario-energy-bar-legend {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.35rem;
          font-size: 0.65rem;
          color: var(--sn-text-muted, #7d86a8);
        }
        .scenario-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          margin-right: 4px;
          vertical-align: middle;
        }
        .scenario-dot-auto { background: #52d689; }
        .scenario-dot-import { background: #7ab8ff; }
        .scenario-add-docs {
          display: flex;
          align-items: flex-start;
          gap: 0.45rem;
          margin: 0 0 0.65rem 0;
          font-size: 0.72rem;
          line-height: 1.35;
          color: var(--sn-text-secondary, rgba(255, 255, 255, 0.72));
          cursor: pointer;
          user-select: none;
        }
        .scenario-add-docs input {
          margin-top: 0.12rem;
          flex-shrink: 0;
          accent-color: var(--gold, #c39847);
        }
        .scenario-add-docs span {
          font-weight: 500;
        }
        .theme-light .scenario-add-docs {
          color: var(--text-secondary, #57534e);
        }
        .scenario-col-footer {
          margin-top: 0;
          padding-top: 1rem;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .scenario-row-footer--inert {
          min-height: 0;
          padding-top: 0;
        }
        .scenario-col-cta { width: 100%; }
        @media (max-width: 640px) {
          .scenario-comparison-premium { padding: 0.75rem; }
          .scenario-hero-value { font-size: 1.55rem; }
          .scenario-hero-prominent .scenario-hero-value { font-size: 1.75rem; }
        }
      `}</style>
    </div>
  );
}
