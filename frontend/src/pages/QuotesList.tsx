/**
 * Liste des devis - surface SaaS standardisee, logique API conservee.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ActionBar,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from "../components/ui";
import {
  deleteQuote,
  duplicateQuote,
  fetchQuotesList,
  postGenerateQuotePdf,
  type QuoteListRow,
} from "../services/financial.api";
import { quoteDisplayTotals } from "../services/quotes.service";
import { formatQuoteNumberDisplay } from "../modules/finance/documentDisplay";
import { canOfferOfficialQuotePdfFromListRow } from "../modules/quotes/quoteWorkflow";
import { QuoteStatusBadge } from "../modules/leads/LeadDetail/financial/financialStatusBadges";
import "../modules/quotes/quote-builder.css";
import "../modules/leads/LeadDetail/financial/financial-tab.css";
import "../modules/finance/financial-list-saas.css";

function eur(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n)
    ? `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} EUR`
    : "-";
}

function fmtDate(s: string | undefined | null) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleDateString("fr-FR", { dateStyle: "short" });
  } catch {
    return "-";
  }
}

function rowDateMs(r: QuoteListRow): number {
  const raw = r.updated_at || r.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatQuoteContact(row: QuoteListRow): string {
  if (row.company_name?.trim()) return row.company_name.trim();
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  if (row.lead_full_name?.trim()) return row.lead_full_name.trim();
  if (row.lead_id) return "Lead (dossier)";
  return "-";
}

function QuoteRowActions({
  row,
  canGeneratePdf,
  pdfBusy,
  duplicateBusy,
  deleteBusy,
  onGeneratePdf,
  onDuplicate,
  onDelete,
}: {
  row: QuoteListRow;
  canGeneratePdf: boolean;
  pdfBusy: boolean;
  duplicateBusy: boolean;
  deleteBusy: boolean;
  onGeneratePdf: (e: React.MouseEvent, id: string) => void;
  onDuplicate: (e: React.MouseEvent, id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}) {
  return (
    <div className="fin-actions-cell fin-actions-cell--visible">
      <Link className="sn-btn sn-btn-ghost sn-btn-sm" to={`/quotes/${row.id}`}>
        Ouvrir
      </Link>
      <details className="fin-actions-menu">
        <summary aria-label={`Actions secondaires pour le devis ${row.quote_number || row.id}`}>Actions</summary>
        <div className="fin-actions-menu__panel">
          <Link className="fin-actions-menu__item" to={`/quotes/${row.id}/present`}>
            Présenter
          </Link>
          <button
            type="button"
            className="fin-actions-menu__item"
            title={canGeneratePdf ? "Générer PDF" : PDF_OFFICIAL_HINT}
            disabled={!canGeneratePdf || pdfBusy}
            onClick={(e) => onGeneratePdf(e, row.id)}
          >
            {pdfBusy ? "PDF..." : "Générer PDF"}
          </button>
          <button
            type="button"
            className="fin-actions-menu__item"
            disabled={duplicateBusy}
            onClick={(e) => onDuplicate(e, row.id)}
          >
            {duplicateBusy ? "Copie..." : "Dupliquer"}
          </button>
          {isQuoteDeletable(row.status) ? (
            <button
              type="button"
              className="fin-actions-menu__item fin-actions-menu__item--danger"
              disabled={deleteBusy}
              onClick={(e) => onDelete(e, row.id)}
            >
              Supprimer
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}

type QuoteStatusFilter = "ALL" | "DRAFT" | "SENT" | "ACCEPTED" | "REFUSED";
type PeriodFilter = "ALL" | "TODAY" | "7D" | "30D";
type QuoteDateRangeBasis = "CREATED" | "UPDATED" | "EITHER";

function normStatus(s: string | undefined) {
  return String(s || "").trim().toUpperCase();
}

function matchesQuoteStatusFilter(row: QuoteListRow, f: QuoteStatusFilter): boolean {
  if (f === "ALL") return true;
  const st = normStatus(row.status);
  if (f === "DRAFT") return st === "DRAFT";
  if (f === "SENT") return st === "SENT" || st === "READY_TO_SEND";
  if (f === "ACCEPTED") return st === "ACCEPTED";
  if (f === "REFUSED") return st === "REJECTED";
  return true;
}

function isQuoteDeletable(status: string | undefined): boolean {
  return normStatus(status) === "DRAFT";
}

function matchesPeriod(row: QuoteListRow, f: PeriodFilter): boolean {
  if (f === "ALL") return true;
  const ms = rowDateMs(row);
  if (!ms) return true;
  const now = new Date();
  const startToday = startOfLocalDay(now);
  if (f === "TODAY") return ms >= startToday;
  const day = 86400000;
  if (f === "7D") return ms >= Date.now() - 7 * day;
  if (f === "30D") return ms >= Date.now() - 30 * day;
  return true;
}

function parseIsoToMs(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

function localYmdStartMs(ymd: string): number | null {
  const t = ymd.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function matchesQuoteDateRange(row: QuoteListRow, fromYmd: string, toYmd: string, basis: QuoteDateRangeBasis): boolean {
  const hasFrom = Boolean(fromYmd.trim());
  const hasTo = Boolean(toYmd.trim());
  if (!hasFrom && !hasTo) return true;

  const a = hasFrom ? localYmdStartMs(fromYmd) : null;
  const b = hasTo ? localYmdStartMs(toYmd) : null;
  if (hasFrom && a == null) return true;
  if (hasTo && b == null) return true;

  const low = a != null && b != null ? Math.min(a, b) : a ?? -Infinity;
  const highExclusive = a != null && b != null ? Math.max(a, b) + 86400000 : b != null ? b + 86400000 : Infinity;
  const inRange = (ts: number) => ts >= low && ts < highExclusive;

  if (basis === "CREATED") {
    const ts = parseIsoToMs(row.created_at);
    return ts != null && inRange(ts);
  }
  if (basis === "UPDATED") {
    const ts = parseIsoToMs(row.updated_at ?? row.created_at);
    return ts != null && inRange(ts);
  }
  const c = parseIsoToMs(row.created_at);
  const u = parseIsoToMs(row.updated_at);
  return (c != null && inRange(c)) || (u != null && inRange(u));
}

const PDF_OFFICIAL_HINT =
  "Un PDF peut etre genere une fois le document fige. Le numero officiel apparait apres signature du devis.";

export default function QuotesList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<QuoteListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<QuoteStatusFilter>("ALL");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateRangeBasis, setDateRangeBasis] = useState<QuoteDateRangeBasis>("EITHER");
  const [search, setSearch] = useState("");
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);
  const [dupBusyId, setDupBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchQuotesList({ limit: 500 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const raw = searchParams.get("status");
    if (!raw) return;
    const map: Record<string, QuoteStatusFilter> = {
      ALL: "ALL",
      DRAFT: "DRAFT",
      SENT: "SENT",
      ACCEPTED: "ACCEPTED",
      REFUSED: "REFUSED",
      REJECTED: "REFUSED",
    };
    const next = map[raw.trim().toUpperCase()];
    if (next) setStatusFilter(next);
  }, [searchParams]);

  const useCustomDateRange = Boolean(dateFrom.trim() || dateTo.trim());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const custom = Boolean(dateFrom.trim() || dateTo.trim());
    return rows
      .filter((r) => matchesQuoteStatusFilter(r, statusFilter))
      .filter((r) => (custom ? matchesQuoteDateRange(r, dateFrom, dateTo, dateRangeBasis) : matchesPeriod(r, periodFilter)))
      .filter((r) => {
        if (!q) return true;
        const num = String(r.quote_number || "").toLowerCase();
        const contact = formatQuoteContact(r).toLowerCase();
        const id = String(r.id || "").toLowerCase();
        return num.includes(q) || contact.includes(q) || id.includes(q);
      })
      .sort((a, b) => rowDateMs(b) - rowDateMs(a));
  }, [rows, statusFilter, periodFilter, dateFrom, dateTo, dateRangeBasis, search]);

  const onGeneratePdf = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setPdfBusyId(id);
    try {
      await postGenerateQuotePdf(id);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erreur PDF");
    } finally {
      setPdfBusyId(null);
    }
  };

  const onDuplicate = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDupBusyId(id);
    try {
      const res = await duplicateQuote(id);
      const newId = res?.quote?.id;
      if (newId) navigate(`/quotes/${newId}`);
      else await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erreur duplication");
    } finally {
      setDupBusyId(null);
    }
  };

  const handleResetFilters = useCallback(() => {
    setStatusFilter("ALL");
    setPeriodFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setDateRangeBasis("EITHER");
    setSearch("");
  }, []);

  const requestDeleteQuote = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const performDeleteQuote = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteBusyId(id);
    try {
      await deleteQuote(id);
      setDeleteConfirmId(null);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erreur suppression");
    } finally {
      setDeleteBusyId(null);
    }
  };

  const columns = useMemo<DataTableColumn<QuoteListRow>[]>(
    () => [
      {
        id: "number",
        header: "Numero",
        width: "18%",
        render: (r) => (
          <span className="fin-row-main">
            <span className="qb-mono">{formatQuoteNumberDisplay(r.quote_number, r.status)}</span>
            <span className="fin-row-sub">{fmtDate(r.updated_at || r.created_at)}</span>
          </span>
        ),
      },
      { id: "client", header: "Client", width: "24%", render: (r) => <span className="fin-standard-truncate">{formatQuoteContact(r)}</span> },
      { id: "amount", header: "TTC", align: "right", width: "13%", render: (r) => eur(quoteDisplayTotals(r).total_ttc) },
      { id: "status", header: "Statut", width: "14%", render: (r) => <QuoteStatusBadge status={r.status} /> },
      {
        id: "pdf",
        header: "PDF",
        width: "13%",
        render: (r) => (
          <span className={`sn-badge ${r.has_pdf || r.has_signed_pdf ? "sn-badge-success" : "sn-badge-neutral"}`}>
            {r.has_pdf || r.has_signed_pdf ? "Disponible" : "Non genere"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        width: "18%",
        render: (r) => (
          <QuoteRowActions
            row={r}
            canGeneratePdf={canOfferOfficialQuotePdfFromListRow(r)}
            pdfBusy={pdfBusyId === r.id}
            duplicateBusy={dupBusyId === r.id}
            deleteBusy={deleteBusyId === r.id}
            onGeneratePdf={(e, id) => void onGeneratePdf(e, id)}
            onDuplicate={(e, id) => void onDuplicate(e, id)}
            onDelete={requestDeleteQuote}
          />
        ),
      },
    ],
    [deleteBusyId, dupBusyId, navigate, pdfBusyId]
  );

  return (
    <div className="qb-page fin-pole-shell fin-standard-page">
      <PageHeader
        eyebrow="Finance"
        title="Devis"
        description="Liste de pilotage des devis, exports PDF et actions commerciales."
        actions={
          <>
            <Link to="/finance" className="sn-btn sn-btn-ghost sn-btn-sm">Vue d'ensemble</Link>
            <Link to="/invoices" className="sn-btn sn-btn-ghost sn-btn-sm">Factures</Link>
            <Link to="/leads" className="sn-btn sn-btn-primary sn-btn-sm">Creer depuis un dossier</Link>
          </>
        }
        meta={<span className="sn-badge sn-badge-neutral">{filtered.length} devis affiches</span>}
      />

      <ActionBar
        className="fin-standard-filters"
        primary={
          <>
            <label className="fin-standard-field fin-standard-field--search">
              <span>Recherche</span>
              <input
                id="fin-quotes-search"
                type="search"
                className="sn-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Numero, client, contact"
                autoComplete="off"
              />
            </label>
            <label className="fin-standard-field">
              <span>Statut</span>
              <select className="sn-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as QuoteStatusFilter)}>
                <option value="ALL">Tous</option>
                <option value="DRAFT">Brouillon</option>
                <option value="SENT">Envoye</option>
                <option value="ACCEPTED">Accepte</option>
                <option value="REFUSED">Refuse</option>
              </select>
            </label>
            <label className="fin-standard-field">
              <span>Periode</span>
              <select
                className="sn-input"
                value={periodFilter}
                disabled={useCustomDateRange}
                onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
              >
                <option value="ALL">Toutes</option>
                <option value="TODAY">Aujourd'hui</option>
                <option value="7D">7 jours</option>
                <option value="30D">30 jours</option>
              </select>
            </label>
          </>
        }
        secondary={
          <>
            <label className="fin-standard-field">
              <span>Du</span>
              <input type="date" className="sn-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="fin-standard-field">
              <span>Au</span>
              <input type="date" className="sn-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="fin-standard-field fin-standard-field--wide">
              <span>Filtrer sur</span>
              <select className="sn-input" value={dateRangeBasis} onChange={(e) => setDateRangeBasis(e.target.value as QuoteDateRangeBasis)}>
                <option value="EITHER">Creation ou modification</option>
                <option value="CREATED">Creation</option>
                <option value="UPDATED">Modification</option>
              </select>
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={handleResetFilters}>Reinitialiser</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Actualiser</Button>
          </>
        }
      />

      {error ? <p className="qb-error-inline">{error}</p> : null}

      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title="Aucun devis"
          description="Le devis se cree depuis une fiche lead ou client afin de conserver le rattachement commercial."
          actions={<Link to="/leads" className="sn-btn sn-btn-primary">Choisir un dossier</Link>}
        />
      ) : (
        <DataTable
          dense
          loading={loading}
          columns={columns}
          rows={filtered}
          getRowKey={(row) => row.id}
          emptyTitle="Aucun devis ne correspond aux filtres"
          emptyDescription="Elargissez la periode, changez le statut ou effacez la recherche."
          className="fin-standard-table"
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteConfirmId)}
        title="Supprimer ce devis brouillon ?"
        description="Cette action est definitive. Les PDFs et factures associees ne sont pas modifies."
        confirmLabel={deleteBusyId ? "Suppression..." : "Supprimer"}
        cancelLabel="Annuler"
        variant="danger"
        loading={Boolean(deleteBusyId)}
        onCancel={() => {
          if (!deleteBusyId) setDeleteConfirmId(null);
        }}
        onConfirm={() => void performDeleteQuote()}
      />
    </div>
  );
}
