/**
 * Dérivés purement front pour le cockpit Financier (lead) — pas d’appel API supplémentaire.
 */

import type { Quote } from "../../../../services/quotes.service";
import type { InvoiceListRow } from "../../../../services/financial.api";
import { formatQuoteStatusFr } from "../../../finance/financialLabels";
import { formatQuoteNumberDisplay } from "../../../finance/documentDisplay";

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export interface FinancialKpiDerived {
  quotesCount: number;
  quotesStatusHint: string;
  toInvoiceTtc: number;
  encoursTtc: number;
  overdueCount: number;
  followupCount: number;
}

export function deriveFinancialKpi(quotes: Quote[], invoices: InvoiceListRow[]): FinancialKpiDerived {
  const quotesCount = quotes.length;
  const accepted = quotes.filter((q) => String(q.status).toUpperCase() === "ACCEPTED");
  const toInvoiceTtc = accepted.reduce((s, q) => s + num(q.total_ttc), 0);

  const openInv = invoices.filter((inv) => {
    const st = String(inv.status).toUpperCase();
    return !["PAID", "CANCELLED", "DRAFT"].includes(st);
  });
  const encoursTtc = openInv.reduce((s, inv) => s + num(inv.amount_due), 0);

  const today = new Date().toISOString().slice(0, 10);
  let overdueCount = 0;
  for (const inv of openInv) {
    const ad = num(inv.amount_due);
    if (ad <= 0) continue;
    const st = String(inv.status).toUpperCase();
    if (st === "DRAFT") continue;
    if (inv.due_date && String(inv.due_date).slice(0, 10) < today) overdueCount += 1;
  }

  const statusBuckets = new Map<string, number>();
  for (const q of quotes) {
    const k = String(q.status || "—").toUpperCase();
    statusBuckets.set(k, (statusBuckets.get(k) || 0) + 1);
  }
  const top = [...statusBuckets.entries()].sort((a, b) => b[1] - a[1])[0];
  const quotesStatusHint = top ? `${top[1]} × ${formatQuoteStatusFr(top[0])}` : "—";

  return {
    quotesCount,
    quotesStatusHint,
    toInvoiceTtc,
    encoursTtc,
    overdueCount,
    followupCount: overdueCount,
  };
}

/** Priorité : accepté > envoyé > prêt > brouillon > autres ; puis plus récent. */
export function pickPrimaryQuote(quotes: Quote[]): Quote | null {
  if (quotes.length === 0) return null;
  const rank = (s: string) => {
    const u = String(s).toUpperCase();
    if (u === "ACCEPTED") return 0;
    if (u === "SENT") return 1;
    if (u === "READY_TO_SEND") return 2;
    if (u === "DRAFT") return 3;
    return 4;
  };
  return [...quotes].sort((a, b) => {
    const ra = rank(String(a.status));
    const rb = rank(String(b.status));
    if (ra !== rb) return ra - rb;
    const da = new Date(a.updated_at || a.created_at || 0).getTime();
    const db = new Date(b.updated_at || b.created_at || 0).getTime();
    return db - da;
  })[0];
}

export interface QuotePortfolioSummary {
  headline: string;
  subline: string;
}

export function deriveQuotePortfolioSummary(quotes: Quote[]): QuotePortfolioSummary {
  if (quotes.length === 0) {
    return { headline: "Aucun devis", subline: "Créez un devis pour chiffrer l’offre" };
  }
  const primary = pickPrimaryQuote(quotes);
  const st = String(primary?.status ?? "").toUpperCase();
  const label = formatQuoteStatusFr(st);
  if (quotes.length === 1) {
    const numLine = primary ? formatQuoteNumberDisplay(primary.quote_number, primary.status) : "Document central du dossier";
    return {
      headline: `1 devis — ${label}`,
      subline: numLine,
    };
  }
  return {
    headline: `${quotes.length} devis`,
    subline: `Principal : ${label} · ${primary ? formatQuoteNumberDisplay(primary.quote_number, primary.status) : "—"}`,
  };
}

export interface NextActionModel {
  title: string;
  subtitle: string;
  ctaLabel: string;
}

export function deriveNextFinancialAction(
  quotes: Quote[],
  primary: Quote | null,
  hasInvoices: boolean
): NextActionModel {
  if (!primary || quotes.length === 0) {
    return {
      title: "Créer un devis commercial",
      subtitle: "Aucun devis sur ce dossier — démarrez le chiffrage (étude facultative).",
      ctaLabel: "Créer un devis",
    };
  }
  const st = String(primary.status).toUpperCase();
  if (st === "DRAFT") {
    return {
      title: "Compléter le devis",
      subtitle: "Ajoutez les lignes, l’acompte si besoin, puis passez en prêt à envoyer.",
      ctaLabel: "Ouvrir le devis",
    };
  }
  if (st === "READY_TO_SEND") {
    return {
      title: "Finaliser l’offre",
      subtitle: "Envoi classique (statut Envoyé) ou signature terrain depuis « Présenter » — les deux figent l’offre.",
      ctaLabel: "Ouvrir le devis",
    };
  }
  if (st === "SENT") {
    return {
      title: "En attente de réponse",
      subtitle: "Devis envoyé — relancez le client ou attendez la décision.",
      ctaLabel: "Ouvrir le devis",
    };
  }
  if (st === "ACCEPTED") {
    return {
      title: hasInvoices ? "Poursuivre la facturation" : "Facturer le dossier",
      subtitle:
        "Acompte, solde ou facture complète depuis le builder devis (liens Facturation lorsque le devis est accepté).",
      ctaLabel: "Ouvrir le devis",
    };
  }
  if (st === "REJECTED" || st === "EXPIRED" || st === "CANCELLED") {
    return {
      title: "Nouveau cycle commercial",
      subtitle: "Ce devis est clos — dupliquez ou créez un nouveau devis si besoin.",
      ctaLabel: "Ouvrir le devis",
    };
  }
  return {
    title: "Suivre le devis",
    subtitle: "Consultez le document et les prochaines actions.",
    ctaLabel: "Ouvrir le devis",
  };
}
