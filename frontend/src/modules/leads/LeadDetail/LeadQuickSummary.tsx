/**
 * CP-LEAD-V3 — Résumé instantané + score de complétude (bandeau compact)
 */

import React from "react";
import { formatEnergyKwhPerYear, formatPowerKva } from "./leadEnergyFormat";

export interface LeadQuickSummaryLeadSlice {
  customer_type?: "PERSON" | "PRO";
  full_name?: string;
  company_name?: string;
  phone?: string;
  phone_mobile?: string;
  phone_landline?: string;
  roof_type?: string;
  meter_power_kva?: number;
}

interface LeadQuickSummaryProps {
  lead: LeadQuickSummaryLeadSlice;
  /** Adresse géocodée considérée comme renseignée */
  hasSiteAddress: boolean;
  /** Parcelle / précision validée */
  addressValidated: boolean;
  annualKwh: number | null;
  studiesCount: number;
  lastActivity: { label: string; at: string } | null;
}

function pctFromScore(score: number): number {
  return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;
}

export function computeLeadCompleteness(input: {
  lead: LeadQuickSummaryLeadSlice;
  hasSiteAddress: boolean;
  annualKwh: number | null;
}): { percent: number; labelKey: "incomplete" | "usable" | "ready" } {
  let pts = 0;
  const { lead } = input;
  const isPro = lead.customer_type === "PRO";
  const nameOk = isPro
    ? Boolean(lead.company_name?.trim())
    : Boolean(lead.full_name?.trim());
  if (nameOk) pts += 20;
  const phoneOk = Boolean(
    (lead.phone_mobile || lead.phone_landline || lead.phone || "").trim()
  );
  if (phoneOk) pts += 20;
  if (input.hasSiteAddress) pts += 20;
  const consoOk =
    input.annualKwh != null &&
    Number.isFinite(input.annualKwh) &&
    input.annualKwh > 0;
  if (consoOk) pts += 20;
  if (Boolean(lead.roof_type?.trim())) pts += 20;

  const percent = pctFromScore(pts);
  let labelKey: "incomplete" | "usable" | "ready" = "incomplete";
  if (percent >= 80) labelKey = "ready";
  else if (percent >= 40) labelKey = "usable";

  return { percent, labelKey };
}

function completenessLabelFr(key: "incomplete" | "usable" | "ready"): string {
  switch (key) {
    case "ready":
      return "Fiche prête pour étude";
    case "usable":
      return "Fiche exploitable";
    default:
      return "Fiche incomplète";
  }
}

function Metric({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="lead-quick-summary-metric">
      <span className="lead-quick-summary-k">{k}</span>
      <span className="lead-quick-summary-v">{v}</span>
    </div>
  );
}

export default function LeadQuickSummary({
  lead,
  hasSiteAddress,
  addressValidated,
  annualKwh,
  studiesCount,
  lastActivity,
}: LeadQuickSummaryProps) {
  const typeLabel = lead.customer_type === "PRO" ? "Pro" : "Particulier";
  const { percent, labelKey } = computeLeadCompleteness({
    lead,
    hasSiteAddress,
    annualKwh,
  });

  const consoDisplay =
    annualKwh != null && Number.isFinite(annualKwh) && annualKwh > 0
      ? formatEnergyKwhPerYear(annualKwh)
      : "—";

  const kvaRaw = lead.meter_power_kva;
  const kvaDisplay =
    kvaRaw != null && Number.isFinite(kvaRaw) ? formatPowerKva(kvaRaw) : "—";

  const addrLabel = !hasSiteAddress
    ? "Non renseignée"
    : addressValidated
      ? "Validée"
      : "À confirmer";

  return (
    <section className="lead-quick-summary" aria-label="Résumé du lead">
      <div className="lead-quick-summary-r1">
        <span className="lead-quick-summary-h">Résumé instantané</span>
        <div className="lead-quick-summary-r1-metrics">
          <Metric k="Type" v={typeLabel} />
          <Metric k="Adresse" v={addrLabel} />
          <Metric k="Conso annuelle" v={consoDisplay} />
          <Metric k="kVA" v={kvaDisplay} />
          <Metric k="Études" v={studiesCount} />
        </div>
      </div>
      <div className="lead-quick-summary-r2">
        <div className="lead-quick-summary-last">
          <span className="lead-quick-summary-k">Dernière activité</span>
          <span className="lead-quick-summary-v">
            {lastActivity
              ? `${lastActivity.label} · ${lastActivity.at}`
              : "—"}
          </span>
        </div>
        <div
          className="lead-quick-summary-complete-compact"
          aria-label={`Complétude ${percent} pour cent`}
        >
          <div className="lead-quick-summary-complete-compact-head">
            <span className="lead-quick-summary-k">Complétude</span>
            <span className="lead-quick-summary-complete-pct">{percent}%</span>
          </div>
          <div
            className="lead-quick-summary-bar"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="lead-quick-summary-bar-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="lead-quick-summary-complete-status">
            {completenessLabelFr(labelKey)}
          </span>
        </div>
      </div>
    </section>
  );
}
