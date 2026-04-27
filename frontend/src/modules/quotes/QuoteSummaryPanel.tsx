import React from "react";
import type { QuoteDeposit, QuoteTotals } from "./quote.types";
import { computeExpectedDepositTtc } from "./quoteCalc";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function formatValidUntilIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export interface QuoteSummaryPanelProps {
  totals: QuoteTotals;
  validityDays: number;
  deposit: QuoteDeposit;
  linesCount?: number;
  studyLinked?: boolean;
  studyLabel?: string | null;
  validUntil?: string | null;
  /** Marge matériel HT (lignes avec coût d'achat &gt; 0 uniquement). */
  materialMarginMargeHt?: number;
  /** % = marge / prix de vente matériel HT ; null si aucune vente matériel sur lignes avec achat. */
  materialMarginTauxSurAchatPct?: number | null;
}

/**
 * Panneau synthèse type « pricing » : montants hiérarchisés, lisibles, proches de l’esprit devis technique.
 */
export default function QuoteSummaryPanel({
  totals,
  validityDays,
  deposit,
  linesCount = 0,
  studyLinked = false,
  studyLabel = null,
  validUntil = null,
  materialMarginMargeHt = 0,
  materialMarginTauxSurAchatPct = null,
}: QuoteSummaryPanelProps) {
  const expectedTtc = computeExpectedDepositTtc(deposit, totals.total_ttc);
  const hasDeposit = deposit.value > 0 && Number.isFinite(deposit.value);
  const untilLabel = formatValidUntilIso(validUntil);

  return (
    <section className="qb-pricing-panel qb-pricing-panel--commercial" aria-labelledby="qb-pricing-title">
      <h2 id="qb-pricing-title" className="qb-section-title">
        Synthèse & totaux
      </h2>
      <p className="qb-section-hint">
        Totaux calculés à partir des lignes du devis (y compris remises en ligne négative).
      </p>

      <div className="qb-pricing-panel__body">
        <div className="qb-pricing-panel__detail">
          <dl className="qb-pricing-dl">
            <div className="qb-pricing-row qb-pricing-row--sep">
              <dt>Total HT</dt>
              <dd>{eur(totals.total_ht)}</dd>
            </div>
            <div className="qb-pricing-row">
              <dt>Total TVA</dt>
              <dd>{eur(totals.total_tva)}</dd>
            </div>
          </dl>
          <p className="qb-pricing-material-margin-line" role="status">
            Marge matériel : {eur(materialMarginMargeHt)} (
            {materialMarginTauxSurAchatPct != null
              ? `${materialMarginTauxSurAchatPct.toLocaleString("fr-FR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })} %`
              : "— %"}
            )
          </p>
        </div>

        <div className="qb-pricing-panel__hero">
          <div className="qb-pricing-hero-card">
            <p className="qb-pricing-hero-label">Total TTC</p>
            <p className="qb-pricing-hero-value">{eur(totals.total_ttc)}</p>
            {hasDeposit ? (
              <div className="qb-pricing-hero-deposit">
                <span className="qb-pricing-hero-deposit-label">Acompte estimé (TTC)</span>
                <span className="qb-pricing-hero-deposit-value">
                  {deposit.type === "PERCENT" ? (
                    <>
                      {deposit.value} % · {expectedTtc > 0 ? eur(expectedTtc) : "—"}
                    </>
                  ) : expectedTtc > 0 ? (
                    eur(expectedTtc)
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            ) : (
              <p className="qb-pricing-hero-note">Acompte non défini (voir conditions commerciales)</p>
            )}
          </div>
        </div>
      </div>

      <div className="qb-pricing-meta" role="status">
        <span>
          Validité {validityDays} j
          {untilLabel ? <> · fin {untilLabel}</> : null}
        </span>
        <span className="qb-pricing-meta-sep" aria-hidden>
          ·
        </span>
        <span>
          {linesCount > 0 ? `${linesCount} ligne${linesCount > 1 ? "s" : ""}` : "Aucune ligne"}
        </span>
        <span className="qb-pricing-meta-sep" aria-hidden>
          ·
        </span>
        <span>{studyLinked ? (studyLabel ? `Étude ${studyLabel}` : "Étude liée") : "Sans étude"}</span>
      </div>
    </section>
  );
}
