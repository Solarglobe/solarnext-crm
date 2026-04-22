import React from "react";
import { useNavigate } from "react-router-dom";
import type { Quote } from "../../../../services/quotes.service";
import type { Study } from "../../../../services/studies.service";
import { apiFetch, getAuthToken } from "../../../../services/api";
import { Button } from "../../../../components/ui/Button";
import { QuoteStatusBadge } from "./financialStatusBadges";
import {
  duplicateQuote,
  postGenerateQuotePdf,
  createInvoiceFromQuote,
} from "../../../../services/financial.api";
import {
  canOfferOfficialQuotePdfFromListRow,
  pickLatestSignedQuotePdf,
  type QuoteDocumentListRow,
} from "../../../quotes/quoteWorkflow";
import { formatQuoteNumberDisplay } from "../../../finance/documentDisplay";

const API_BASE = import.meta.env?.VITE_API_URL || "";
function eur(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €" : "—";
}

function fmtDate(s: string | undefined | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("fr-FR", { dateStyle: "medium" });
  } catch {
    return "—";
  }
}

function heroContextLine(status: string, hasSignedPdf?: boolean): string {
  const u = String(status).toUpperCase();
  if (u === "DRAFT") return "Brouillon — complétez les lignes et les conditions avant envoi.";
  if (u === "READY_TO_SEND")
    return "Prêt à envoyer — vous pouvez figer l’offre (« Envoyé ») pour générer un PDF ; le numéro officiel n’apparaît qu’après signature.";
  if (u === "SENT") return "Devis envoyé — en attente de validation client.";
  if (u === "ACCEPTED")
    return hasSignedPdf
      ? "Devis accepté — PDF signé enregistré ; facturation disponible (acompte / solde / complète)."
      : "Devis accepté — facturation disponible (acompte / solde / complète).";
  if (u === "REJECTED") return "Devis refusé — vous pouvez dupliquer ou créer une nouvelle offre.";
  if (u === "EXPIRED") return "Devis expiré — renouvelez ou dupliquez si besoin.";
  if (u === "CANCELLED") return "Devis annulé.";
  return "Suivez le document depuis le builder.";
}

interface FinancialHeroQuoteProps {
  primary: Quote;
  studies: Study[];
  isLead: boolean;
  clientId: string | null | undefined;
  onRefresh: () => void;
}

export default function FinancialHeroQuote({
  primary,
  studies,
  isLead,
  clientId,
  onRefresh,
}: FinancialHeroQuoteProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);

  const studyLabel = (sid: string | null | undefined) => {
    if (!sid) return null;
    const s = studies.find((x) => x.id === sid);
    return s ? s.study_number || s.title || sid.slice(0, 8) : sid.slice(0, 8);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const sl = studyLabel(primary.study_id);
  const pdfAllowed = canOfferOfficialQuotePdfFromListRow(primary);
  const hasSignedPdf = Boolean(primary.has_signed_pdf);

  const downloadSignedPdfFromDetail = async () => {
    if (!getAuthToken()) throw new Error("Session requise");
    const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(primary.id)}`);
    if (!res.ok) throw new Error("Impossible de charger le devis");
    const data = (await res.json()) as { documents?: QuoteDocumentListRow[] };
    const signed = pickLatestSignedQuotePdf(data.documents ?? []);
    if (!signed) throw new Error("Aucun PDF signé disponible.");
    const res2 = await apiFetch(`${API_BASE}/api/documents/${encodeURIComponent(signed.id)}/download`);
    if (!res2.ok) throw new Error("Téléchargement du PDF signé impossible");
    const blob = await res2.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = signed.file_name || "devis-signé.pdf";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <section className="fin-hero" aria-labelledby="fin-hero-title">
      <div className="fin-hero-glow" aria-hidden />
      <div className="fin-hero-inner">
        <div className="fin-hero-top">
          <div>
            <p id="fin-hero-title" className="fin-hero-kicker">
              Document principal
            </p>
            <div className="fin-hero-number-row">
              <span className="fin-hero-number">
                {formatQuoteNumberDisplay(primary.quote_number, primary.status)}
              </span>
              <QuoteStatusBadge status={primary.status} />
            </div>
            <p className="fin-hero-context">{heroContextLine(String(primary.status), hasSignedPdf)}</p>
          </div>
          <div className="fin-hero-amount-block">
            <span className="fin-hero-amount-label">Montant TTC</span>
            <span className="fin-hero-amount">{eur(primary.total_ttc)}</span>
          </div>
        </div>
        <dl className="fin-hero-meta">
          <div>
            <dt>Validité</dt>
            <dd>{fmtDate(primary.valid_until)}</dd>
          </div>
          <div>
            <dt>Mis à jour</dt>
            <dd>{fmtDate(primary.updated_at || primary.created_at)}</dd>
          </div>
          {sl ? (
            <div>
              <dt>Étude liée</dt>
              <dd>{sl}</dd>
            </div>
          ) : (
            <div>
              <dt>Étude</dt>
              <dd className="fin-hero-meta-muted">Aucune (devis autonome)</dd>
            </div>
          )}
        </dl>
        <div className="fin-hero-actions">
          <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => navigate(`/quotes/${primary.id}`)}>
            Ouvrir le devis
          </Button>
          <Button
            type="button"
            variant="outlineGold"
            size="sm"
            disabled={busy}
            onClick={() => navigate(`/quotes/${primary.id}/present`)}
          >
            Présenter
          </Button>
          {hasSignedPdf ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy}
              title="Télécharger le PDF signé enregistré sur le devis"
              onClick={() => void run(downloadSignedPdfFromDetail)}
            >
              PDF signé
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || !pdfAllowed}
            title={
              pdfAllowed
                ? undefined
                : "Génération PDF possible après figement (envoi ou validation signée). Numéro officiel visible seulement après signature."
            }
            onClick={() => void run(async () => {
              await postGenerateQuotePdf(primary.id);
            })}
          >
            PDF
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(async () => {
              await duplicateQuote(primary.id);
            })}
          >
            Dupliquer
          </Button>
          {!isLead && clientId && String(primary.status).toUpperCase() === "ACCEPTED" ? (
            <Button
              type="button"
              variant="outlineGold"
              size="sm"
              disabled={busy}
              onClick={() => void run(async () => {
                await createInvoiceFromQuote(primary.id);
              })}
            >
              Facture depuis devis
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

interface FinancialHeroEmptyProps {
  latestStudy: Study | null;
  onCreateQuote: () => void;
  onCreateFromStudy: (study: Study) => void;
}

export function FinancialHeroEmpty({ latestStudy, onCreateQuote, onCreateFromStudy }: FinancialHeroEmptyProps) {
  return (
    <section className="fin-hero fin-hero--empty" aria-labelledby="fin-hero-empty-title">
      <div className="fin-hero-glow fin-hero-glow--empty" aria-hidden />
      <div className="fin-hero-inner">
        <p id="fin-hero-empty-title" className="fin-hero-kicker">
          Document principal
        </p>
        <h3 className="fin-hero-empty-title">Aucun devis commercial pour ce dossier</h3>
        <p className="fin-hero-empty-desc">
          Créez un devis pour chiffrer l&apos;offre — le devis est autonome, l&apos;étude reste un assistant optionnel pour
          pré-remplir le technique.
        </p>
        <div className="fin-hero-actions fin-hero-actions--center">
          <Button type="button" variant="primary" size="sm" onClick={onCreateQuote}>
            Créer un devis
          </Button>
          {latestStudy ? (
            <Button type="button" variant="outlineGold" size="sm" onClick={() => onCreateFromStudy(latestStudy)}>
              Créer depuis l&apos;étude
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
