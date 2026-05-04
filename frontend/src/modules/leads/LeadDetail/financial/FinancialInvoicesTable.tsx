import React from "react";
import { Link } from "react-router-dom";
import type { InvoiceListRow } from "../../../../services/financial.api";
import { InvoiceStatusBadge } from "./financialStatusBadges";
import { postGenerateInvoicePdf } from "../../../../services/financial.api";
import { formatInvoiceNumberDisplay } from "../../../finance/documentDisplay";

function eur(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €" : "—";
}

function fmtDate(s: string | undefined | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("fr-FR");
  } catch {
    return "—";
  }
}

function isOverdueRow(row: InvoiceListRow): boolean {
  const st = String(row.status).toUpperCase();
  if (["PAID", "CANCELLED", "DRAFT"].includes(st)) return false;
  const ad = Number(row.amount_due);
  if (ad <= 0) return false;
  if (!row.due_date) return false;
  const d = String(row.due_date).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return d < today;
}

/** Lien « Nouvelle facture » depuis l’onglet Financier : propage le contexte dossier. */
export function buildManualInvoiceNewHref(clientId?: string | null, leadId?: string | null): string {
  const c = (clientId ?? "").trim();
  const l = (leadId ?? "").trim();
  if (c && l) return `/invoices/new?clientId=${encodeURIComponent(c)}`;
  if (c) return `/invoices/new?clientId=${encodeURIComponent(c)}`;
  if (l) return `/invoices/new?leadId=${encodeURIComponent(l)}`;
  return "/invoices/new";
}

/** Création facture rattachée au client CRM uniquement (pas de select client sur /invoices/new). */
export function buildClientOnlyInvoiceNewHref(clientId: string): string {
  return `/invoices/new?clientId=${encodeURIComponent(clientId.trim())}`;
}

interface FinancialInvoicesTableProps {
  invoices: InvoiceListRow[];
  loading: boolean;
  onOpenDetail: (invoiceId: string) => void;
  onRefresh: () => void;
  /** Contexte fiche (préremplissage création facture manuelle). */
  clientId?: string | null;
  leadId?: string | null;
}

export default function FinancialInvoicesTable({
  invoices,
  loading,
  onOpenDetail,
  onRefresh,
  clientId = null,
  leadId = null,
}: FinancialInvoicesTableProps) {
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const newInvoiceHref = buildManualInvoiceNewHref(clientId, leadId);
  const clientOnlyInvoiceHref =
    clientId && String(clientId).trim() !== "" ? buildClientOnlyInvoiceNewHref(String(clientId)) : null;

  const pdf = async (id: string) => {
    setBusyId(id);
    try {
      await postGenerateInvoicePdf(id);
      onRefresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur PDF");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="fin-section fin-section--invoices">
      <div className="fin-section-head">
        <div>
          <h3 className="fin-section-title">Facturation & documents</h3>
          <p className="fin-section-sub">Factures émises et PDF — le détail se pilote dans le builder.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {clientOnlyInvoiceHref ? (
            <Link to={clientOnlyInvoiceHref} className="fin-link-btn fin-link-btn--nav" style={{ fontSize: 13 }}>
              Créer une facture
            </Link>
          ) : null}
          <Link to={newInvoiceHref} className="fin-link-btn fin-link-btn--nav" style={{ fontSize: 13 }}>
            Nouvelle facture
          </Link>
          <Link to="/invoices" className="fin-link-btn fin-link-btn--nav" style={{ fontSize: 13 }}>
            Toutes les factures
          </Link>
        </div>
      </div>
      {loading ? (
        <p className="crm-lead-empty">Chargement des factures…</p>
      ) : invoices.length === 0 ? (
        <div className="fin-empty-state fin-empty-state--invoice">
          <p className="fin-empty-title">Aucune facture émise sur ce dossier</p>
          <p className="fin-empty-desc">
            La facturation s&apos;active après acceptation du devis (acompte / solde / complète depuis le builder devis), ou via
            une facture manuelle sans lien devis.
          </p>
          <div className="fin-empty-actions">
            {clientOnlyInvoiceHref ? (
              <Link
                to={clientOnlyInvoiceHref}
                className="sn-btn sn-btn-outline-gold sn-btn-sm fin-empty-invoice-cta"
                style={{ textDecoration: "none" }}
              >
                Créer une facture
              </Link>
            ) : null}
            <Link
              to={newInvoiceHref}
              className="sn-btn sn-btn-outline-gold sn-btn-sm fin-empty-invoice-cta"
              style={{ textDecoration: "none" }}
            >
              Nouvelle facture manuelle
            </Link>
          </div>
        </div>
      ) : (
        <div className="fin-table-wrap fin-table-wrap--compact">
          <table className="sn-ui-table fin-table fin-table--compact">
            <thead>
              <tr>
                <th>N°</th>
                <th>Statut</th>
                <th className="fin-num">TTC</th>
                <th className="fin-num">Reste dû</th>
                <th>Échéance</th>
                <th className="fin-table-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const od = isOverdueRow(inv);
                return (
                  <tr key={inv.id}>
                    <td className="fin-mono">{formatInvoiceNumberDisplay(inv.invoice_number, inv.status)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <InvoiceStatusBadge status={inv.status} />
                        {od ? (
                          <span className="sn-badge sn-badge-danger" title="Échéance dépassée">
                            Retard
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="fin-num">{eur(inv.total_ttc)}</td>
                    <td className="fin-num">{eur(inv.amount_due)}</td>
                    <td>{fmtDate(inv.due_date)}</td>
                    <td>
                      <div className="fin-row-actions">
                        <button
                          type="button"
                          className="fin-link-btn fin-link-btn--accent"
                          onClick={() => onOpenDetail(inv.id)}
                        >
                          Ouvrir
                        </button>
                        <button
                          type="button"
                          className="fin-link-btn"
                          onClick={() => pdf(inv.id)}
                          disabled={busyId === inv.id}
                        >
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
