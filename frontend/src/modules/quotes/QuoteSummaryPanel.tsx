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
  totalDiscountFromLines?: number;
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
  totalDiscountFromLines = 0,
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
  /** Bloc B/C : visible uniquement si une estimation pose installateur RGE est présente. */
  const installerTtc = Number(totals.total_installer_ttc) || 0;
  const hasInstaller = installerTtc > 0.0001;
  const projectIndicativeTtc = Number(totals.total_project_indicative_ttc) || totals.total_ttc;
  /** Échéancier SolarGlobe : calculé UNIQUEMENT sur le Total SolarGlobe TTC (jamais le coût global indicatif). */
  const sgTtc = Number(totals.total_ttc) || 0;
  const echeancierAcompteTtc = hasDeposit && expectedTtc > 0 ? expectedTtc : 0;
  const echeancierSoldeTtc = Math.max(0, Math.round((sgTtc - echeancierAcompteTtc) * 100) / 100);

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
            {totalDiscountFromLines > 0.0001 ? (
              <div className="qb-pricing-row">
                <dt>Remise</dt>
                <dd>− {eur(totalDiscountFromLines)}</dd>
              </div>
            ) : null}
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
            <p className="qb-pricing-hero-label">{hasInstaller ? "Total SolarGlobe TTC" : "Total TTC"}</p>
            <p className="qb-pricing-hero-value qb-pricing-hero-value--primary">{eur(totals.total_ttc)}</p>
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

      {hasInstaller ? (
        <div
          className="qb-pricing-billing-split"
          style={{ marginTop: 12, padding: "10px 12px", border: "1px solid #e2e2e2", borderRadius: 8, background: "#fafafa" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>Total SolarGlobe (facturé par SolarGlobe)</span>
            <strong>{eur(totals.total_ttc)} TTC</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4, color: "#6b5300" }}>
            <span>Estimation pose installateur RGE (hors total SolarGlobe)</span>
            <strong>{eur(installerTtc)} TTC</strong>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px dashed #ccc",
              color: "#555",
            }}
          >
            <span>Coût global indicatif du projet</span>
            <strong>{eur(projectIndicativeTtc)} TTC</strong>
          </div>
          <p style={{ fontSize: 11, color: "#777", margin: "6px 0 0", fontStyle: "italic" }}>
            Le coût global est indicatif et ne constitue pas le montant facturé par SolarGlobe.
          </p>
        </div>
      ) : null}

      <div
        className="qb-pricing-echeancier"
        style={{ marginTop: 12, padding: "10px 12px", border: "1px solid #e2e2e2", borderRadius: 8 }}
      >
        <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13 }}>
          Échéancier SolarGlobe (sur Total SolarGlobe TTC)
        </p>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span>Acompte à la commande</span>
          <strong>{echeancierAcompteTtc > 0 ? `${eur(echeancierAcompteTtc)} TTC` : "à définir"}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
          <span>Solde après Consuel</span>
          <strong>{eur(echeancierSoldeTtc)} TTC</strong>
        </div>
        {hasInstaller ? (
          <p style={{ fontSize: 11, color: "#6b5300", margin: "6px 0 0", fontStyle: "italic" }}>
            Pose installateur : réglée séparément, directement à l’installateur RGE après intervention, selon son
            devis (hors échéancier SolarGlobe).
          </p>
        ) : null}
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
