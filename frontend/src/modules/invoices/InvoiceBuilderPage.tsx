/**
 * Builder facture — workbench (toolbar, lignes, résumé, notes / conditions).
 * Route : /invoices/:id
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../../services/api";
import { adminGetQuoteCatalog, type QuoteCatalogItem } from "../../services/admin.api";
import {
  fetchClientsBillingSelect,
  fetchLeadsBillingSelect,
  type BillingSelectRow,
} from "../../services/billingContacts.api";
import {
  duplicateInvoiceApi,
  patchInvoice,
  patchInvoiceStatus,
  postGenerateInvoicePdf,
  fetchInvoiceDetail,
  fetchQuoteInvoiceBillingContext,
  type InvoiceDetail,
  type QuoteInvoiceBillingContext,
} from "../../services/financial.api";
import { Button } from "../../components/ui/Button";
import { ModalShell } from "../../components/ui/ModalShell";
import { computeInvoiceTotalsFromLines } from "./invoiceCalc";
import {
  invoiceBuilderReducer,
  mapApiLinesToInvoiceLines,
  invoiceLinesToSavePayload,
  createEmptyMeta,
  type InvoiceBuilderState,
} from "./InvoiceBuilderStore";
import InvoiceToolbar from "./InvoiceToolbar";
import InvoiceHeaderCard from "./InvoiceHeaderCard";
import InvoicePaymentSituationCard from "./InvoicePaymentSituationCard";
import InvoiceDocumentBlock, { type InvoiceDocumentRow } from "./InvoiceDocumentBlock";
import InvoiceBillingOriginSection, { type QuoteSummary } from "./InvoiceBillingOriginSection";
import InvoiceLinesTable from "./InvoiceLinesTable";
import InvoiceSummaryPanel from "./InvoiceSummaryPanel";
import InvoiceNotes from "./InvoiceNotes";
import { toInvoiceStatusUi } from "./invoiceStatusUi";
import InvoicePaymentsPanel from "./InvoicePaymentsPanel";
import InvoiceCreditsPanel from "./InvoiceCreditsPanel";
import InvoiceRemindersPanel from "./InvoiceRemindersPanel";
import { InvoiceBillingEntityCombobox } from "./InvoiceBillingEntityCombobox";
import "../quotes/quote-builder.css";
import "./invoice-builder.css";
import "./invoice-financial.css";
import { formatInvoiceNumberDisplay } from "../finance/documentDisplay";
import { getCrmApiBase } from "@/config/crmApiBase";

const API_BASE = getCrmApiBase();

/** Aligné sur la comparaison backend : null si vide / absent après trim. */
function normalizeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function buildStateFromApi(inv: InvoiceDetail & Record<string, unknown>): InvoiceBuilderState {
  const clientLabel = inv.company_name
    ? String(inv.company_name)
    : [inv.first_name, inv.last_name].filter(Boolean).join(" ").trim() || null;
  const leadLabel = [inv.lead_first_name, inv.lead_last_name].filter(Boolean).join(" ").trim() || null;
  return {
    header: {
      id: String(inv.id),
      invoice_number: String(inv.invoice_number ?? ""),
      lead_id: (inv.lead_id as string) ?? null,
      client_id: (inv.client_id as string) ?? null,
      quote_id: (inv.quote_id as string) ?? null,
      issue_date: inv.issue_date ? String(inv.issue_date).slice(0, 10) : null,
      due_date: inv.due_date ? String(inv.due_date).slice(0, 10) : null,
      status: String(inv.status ?? "DRAFT"),
      currency: String(inv.currency ?? "EUR"),
      client_label: clientLabel,
      lead_label: leadLabel,
    },
    lines: mapApiLinesToInvoiceLines((inv.lines as Record<string, unknown>[]) || []),
    meta: {
      notes: String(inv.notes ?? ""),
      payment_terms: String(inv.payment_terms ?? ""),
    },
    dirty: false,
  };
}

export default function InvoiceBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(invoiceBuilderReducer, {
    header: null,
    lines: [],
    meta: createEmptyMeta(),
    dirty: false,
  } as InvoiceBuilderState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<QuoteCatalogItem[]>([]);
  const [catalogQ, setCatalogQ] = useState("");
  const [billingClients, setBillingClients] = useState<BillingSelectRow[]>([]);
  const [billingLeads, setBillingLeads] = useState<BillingSelectRow[]>([]);
  const [contactsSelectError, setContactsSelectError] = useState<string | null>(null);
  const [detailExtras, setDetailExtras] = useState<{
    total_paid: number;
    amount_due: number;
    is_overdue: boolean;
    total_ht: number;
    total_vat: number;
    total_ttc: number;
  }>({ total_paid: 0, amount_due: 0, is_overdue: false, total_ht: 0, total_vat: 0, total_ttc: 0 });
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const [quoteBillCtx, setQuoteBillCtx] = useState<QuoteInvoiceBillingContext | null>(null);
  /** Valeurs DB après dernier chargement — pour n’envoyer client_id / lead_id au PATCH que si modifiés. */
  const initialClientIdRef = useRef<string | null>(null);
  const initialLeadIdRef = useRef<string | null>(null);

  const canEdit = state.header ? String(state.header.status).toUpperCase() === "DRAFT" : false;

  const isClientLocked = useMemo(
    () => Boolean(state.header?.client_id) || Boolean(state.header?.quote_id),
    [state.header?.client_id, state.header?.quote_id]
  );
  const isLeadLocked = useMemo(
    () => Boolean(state.header?.lead_id) || Boolean(state.header?.quote_id),
    [state.header?.lead_id, state.header?.quote_id]
  );

  const computedTotals = useMemo(() => computeInvoiceTotalsFromLines(state.lines), [state.lines]);

  const statusUi = useMemo(() => {
    if (!state.header) return toInvoiceStatusUi("DRAFT", {});
    return toInvoiceStatusUi(state.header.status, { isOverdue: detailExtras.is_overdue });
  }, [state.header, detailExtras.is_overdue]);

  const totalPaid = detailExtras.total_paid;
  const useLive = canEdit;
  const displayHt = useLive ? computedTotals.total_ht : detailExtras.total_ht;
  const displayTva = useLive ? computedTotals.total_tva : detailExtras.total_vat;
  const displayTtc = useLive ? computedTotals.total_ttc : detailExtras.total_ttc;
  const totalDue = useLive ? Math.max(0, computedTotals.total_ttc - totalPaid) : detailExtras.amount_due;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const inv = await fetchInvoiceDetail(id);
      initialClientIdRef.current = normalizeId(inv.client_id as string | null | undefined);
      initialLeadIdRef.current = normalizeId(inv.lead_id as string | null | undefined);
      setInvoiceDetail(inv);
      dispatch({ type: "HYDRATE", payload: buildStateFromApi(inv) });
      const bal = inv.balance as { amount_due?: number; total_paid?: number } | undefined;
      setDetailExtras({
        total_paid: Number(bal?.total_paid ?? inv.total_paid ?? 0) || 0,
        amount_due: Number(bal?.amount_due ?? inv.amount_due ?? 0) || 0,
        is_overdue: !!inv.is_overdue,
        total_ht: Number(inv.total_ht ?? 0) || 0,
        total_vat: Number(inv.total_vat ?? 0) || 0,
        total_ttc: Number(inv.total_ttc ?? 0) || 0,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur";
      setError(msg);
      dispatch({ type: "CLEAR" });
      setInvoiceDetail(null);
      initialClientIdRef.current = null;
      initialLeadIdRef.current = null;
      setDetailExtras({
        total_paid: 0,
        amount_due: 0,
        is_overdue: false,
        total_ht: 0,
        total_vat: 0,
        total_ttc: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (saveSuccessTimerRef.current) clearTimeout(saveSuccessTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setContactsSelectError(null);
    void Promise.all([fetchClientsBillingSelect(), fetchLeadsBillingSelect()])
      .then(([cRows, lRows]) => {
        setBillingClients(cRows);
        setBillingLeads(lRows);
      })
      .catch((e: unknown) => {
        setBillingClients([]);
        setBillingLeads([]);
        setContactsSelectError(e instanceof Error ? e.message : "Impossible de charger les listes client / lead.");
      });
  }, []);

  const save = useCallback(async () => {
    if (!id || !state.header || !canEdit) return;
    if (!state.header.client_id && !state.header.lead_id) {
      setError("Rattachez au moins un client ou un lead.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    if (saveSuccessTimerRef.current) {
      clearTimeout(saveSuccessTimerRef.current);
      saveSuccessTimerRef.current = null;
    }
    try {
      const body: Record<string, unknown> = {
        lines: invoiceLinesToSavePayload(state.lines),
        notes: state.meta.notes,
        payment_terms: state.meta.payment_terms,
        issue_date: state.header.issue_date || null,
        due_date: state.header.due_date || null,
      };
      const curClient = normalizeId(state.header.client_id);
      const curLead = normalizeId(state.header.lead_id);
      if (curClient !== initialClientIdRef.current) {
        body.client_id = state.header.client_id ?? null;
      }
      if (curLead !== initialLeadIdRef.current) {
        body.lead_id = state.header.lead_id ?? null;
      }
      if (state.header.quote_id) body.quote_id = state.header.quote_id;

      await patchInvoice(id, body);
      dispatch({ type: "MARK_CLEAN" });
      await load();
      setSaveSuccess(true);
      if (saveSuccessTimerRef.current) clearTimeout(saveSuccessTimerRef.current);
      saveSuccessTimerRef.current = setTimeout(() => {
        setSaveSuccess(false);
        saveSuccessTimerRef.current = null;
      }, 2000);
    } catch (e) {
      setSaveSuccess(false);
      if (saveSuccessTimerRef.current) {
        clearTimeout(saveSuccessTimerRef.current);
        saveSuccessTimerRef.current = null;
      }
      const msg = e instanceof Error ? e.message : "Erreur enregistrement";
      setError(msg);
      if (/facture non trouvée/i.test(msg)) {
        dispatch({ type: "CLEAR" });
        setInvoiceDetail(null);
        initialClientIdRef.current = null;
        initialLeadIdRef.current = null;
        setDetailExtras({
          total_paid: 0,
          amount_due: 0,
          is_overdue: false,
          total_ht: 0,
          total_vat: 0,
          total_ttc: 0,
        });
      }
    } finally {
      setSaving(false);
    }
  }, [id, state, canEdit, load]);

  const openCatalog = async () => {
    setCatalogOpen(true);
    try {
      const { items } = await adminGetQuoteCatalog({ q: catalogQ || undefined });
      setCatalogItems(items.filter((x) => x.is_active));
    } catch {
      setCatalogItems([]);
    }
  };

  const addCatalogLine = (c: QuoteCatalogItem) => {
    const unitHt = (Number(c.sale_price_ht_cents) || 0) / 100;
    const vat = (Number(c.default_vat_rate_bps) || 2000) / 100;
    const snapId = c.id;
    dispatch({
      type: "ADD_LINE",
      line: {
        id: crypto.randomUUID(),
        type: "catalog",
        catalog_item_id: snapId,
        label: c.name,
        quantity: 1,
        unit_price_ht: unitHt,
        tva_percent: vat,
        line_discount_percent: 0,
        position: state.lines.length + 1,
      },
    });
    setCatalogOpen(false);
  };

  const addFreeLine = () => {
    dispatch({
      type: "ADD_LINE",
      line: {
        id: crypto.randomUUID(),
        type: "custom",
        label: "Prestation",
        quantity: 1,
        unit_price_ht: 0,
        tva_percent: 20,
        line_discount_percent: 0,
        position: state.lines.length + 1,
      },
    });
  };

  const duplicate = async () => {
    if (!id) return;
    try {
      const data = await duplicateInvoiceApi(id);
      const newId = data?.id;
      if (newId) navigate(`/invoices/${newId}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Duplication impossible");
    }
  };

  const genPdf = async () => {
    if (!id) return;
    try {
      const data = await postGenerateInvoicePdf(id);
      await load();
      const base = API_BASE.replace(/\/$/, "");
      if (data.downloadUrl) {
        window.open(`${base}${data.downloadUrl}`, "_blank", "noopener,noreferrer");
      }
      window.alert("PDF facture généré. Téléchargement ouvert dans un nouvel onglet si votre navigateur l’autorise.");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur PDF");
    }
  };

  const markInvoiceIssued = async () => {
    if (!id) return;
    if (!window.confirm("Émettre la facture (statut officiel) ? Un numéro définitif peut être attribué.")) return;
    try {
      await patchInvoiceStatus(id, "ISSUED");
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur statut");
    }
  };

  const removeInvoice = async () => {
    if (!id || !window.confirm("Supprimer définitivement cette facture ?")) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status === 204) navigate("/invoices");
      else {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur");
    }
  };

  const isTestInvoice = useMemo(() => {
    const m = invoiceDetail?.metadata_json as { is_test?: unknown } | undefined;
    return Boolean(m && typeof m === "object" && m.is_test === true);
  }, [invoiceDetail?.metadata_json]);

  const quoteBillingRole = (invoiceDetail?.metadata_json as { quote_billing_role?: string } | undefined)
    ?.quote_billing_role;

  const finBalance = useMemo(() => {
    if (!invoiceDetail) {
      return { total_ttc: 0, total_paid: 0, total_credited: 0, amount_due: 0 };
    }
    const b = invoiceDetail.balance;
    return {
      total_ttc: Number(b?.total_ttc ?? invoiceDetail.total_ttc ?? 0) || 0,
      total_paid: Number(b?.total_paid ?? invoiceDetail.total_paid ?? 0) || 0,
      total_credited: Number(b?.total_credited ?? invoiceDetail.total_credited ?? 0) || 0,
      amount_due: Number(b?.amount_due ?? invoiceDetail.amount_due ?? 0) || 0,
    };
  }, [invoiceDetail]);

  const invoiceStatusUpper = state.header ? String(state.header.status).toUpperCase() : "";

  useEffect(() => {
    const qid = state.header?.quote_id;
    if (!qid || invoiceStatusUpper === "CANCELLED") {
      setQuoteBillCtx(null);
      return;
    }
    let cancelled = false;
    void fetchQuoteInvoiceBillingContext(qid)
      .then((ctx) => {
        if (!cancelled) setQuoteBillCtx(ctx);
      })
      .catch(() => {
        if (!cancelled) setQuoteBillCtx(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state.header?.quote_id, invoiceStatusUpper]);

  const paymentsList = invoiceDetail?.payments ?? [];
  const creditNotesList = invoiceDetail?.credit_notes ?? [];
  const remindersList = invoiceDetail?.reminders ?? invoiceDetail?.invoice_reminders ?? [];

  const paymentCountActive = useMemo(
    () =>
      paymentsList.filter(
        (p) => !p.cancelled_at && String(p.status || "").toUpperCase() !== "CANCELLED"
      ).length,
    [paymentsList]
  );

  const clientDisplayLine = useMemo(() => {
    if (!state.header) return "—";
    if (state.header.client_label?.trim()) return state.header.client_label.trim();
    if (state.header.lead_label?.trim()) return `Lead : ${state.header.lead_label.trim()}`;
    return "Non renseigné";
  }, [state.header]);

  const situationDraft = invoiceStatusUpper === "DRAFT";
  const situationTtc = situationDraft ? computedTotals.total_ttc : finBalance.total_ttc || 0;
  const situationPaid = situationDraft ? 0 : finBalance.total_paid || 0;
  const situationDue = situationDraft ? Math.max(0, computedTotals.total_ttc) : finBalance.amount_due || 0;

  const quoteSnap = (invoiceDetail as { quote?: QuoteSummary | null })?.quote ?? null;

  const payAddReason =
    invoiceStatusUpper === "DRAFT"
      ? "Émettez la facture pour enregistrer des paiements."
      : invoiceStatusUpper === "CANCELLED"
        ? "Facture annulée."
        : invoiceStatusUpper === "PAID"
          ? "Facture soldée."
          : null;

  const canAddPayment =
    (invoiceStatusUpper === "ISSUED" || invoiceStatusUpper === "PARTIALLY_PAID") && finBalance.amount_due > 0.0001;

  const creditBlockReason =
    invoiceStatusUpper === "DRAFT"
      ? "Émettez la facture pour gérer les avoirs."
      : invoiceStatusUpper === "CANCELLED"
        ? "Facture annulée."
        : !state.header?.client_id
          ? "Les avoirs requièrent un client rattaché à la facture."
          : null;

  const canCreateCredit =
    invoiceStatusUpper !== "DRAFT" &&
    invoiceStatusUpper !== "CANCELLED" &&
    !!state.header?.client_id &&
    finBalance.amount_due > 0.0001;

  const remindBlockReason =
    invoiceStatusUpper === "DRAFT" ? "Émettez la facture pour activer le suivi des relances." : invoiceStatusUpper === "CANCELLED" ? "Facture annulée." : null;

  const canRelaunch = invoiceStatusUpper !== "DRAFT" && invoiceStatusUpper !== "CANCELLED";

  const setDueFromIssue = (days: number) => {
    const iss = state.header?.issue_date;
    if (!iss) return;
    const d = new Date(iss + "T12:00:00");
    d.setDate(d.getDate() + days);
    const iso = d.toISOString().slice(0, 10);
    dispatch({ type: "SET_HEADER", payload: { due_date: iso } });
  };

  if (loading && !state.header) {
    return (
      <div className="ib-page-loading">
        <p className="qb-muted">Chargement de la facture…</p>
      </div>
    );
  }

  if (error && !state.header) {
    return (
      <div className="qb-page">
        <p className="qb-error">{error}</p>
        <Button type="button" variant="primary" onClick={() => navigate("/finance")}>
          Vue d&apos;ensemble
        </Button>
      </div>
    );
  }

  if (!state.header) return null;

  return (
    <div className="qb-page">
      <InvoiceToolbar
        invoiceNumber={formatInvoiceNumberDisplay(state.header.invoice_number, state.header.status)}
        invoiceNumberTitle={
          String(state.header.status).toUpperCase() === "DRAFT" ? state.header.invoice_number || undefined : undefined
        }
        statusUi={statusUi}
        canEdit={canEdit}
        saving={saving}
        saveSuccess={saveSuccess}
        linkHint={null}
        onBack={() => navigate(-1)}
        onSave={() => void save()}
        onDuplicate={() => void duplicate()}
        onPdf={() => void genPdf()}
        onMarkIssued={() => void markInvoiceIssued()}
        onDelete={() => void removeInvoice()}
      />

      {error ? <p className="qb-error-inline">{error}</p> : null}

      <div className="ib-page-hero-stack">
        <InvoiceHeaderCard
          invoiceNumberDisplay={formatInvoiceNumberDisplay(state.header.invoice_number, state.header.status)}
          statusUi={statusUi}
          statusRaw={state.header.status}
          clientLine={clientDisplayLine}
          issueDate={state.header.issue_date}
          dueDate={state.header.due_date}
          currency={state.header.currency}
          quoteBillingRole={quoteBillingRole}
          hasQuote={!!state.header.quote_id}
          isOverdue={!!detailExtras.is_overdue}
          isTestInvoice={isTestInvoice}
        />

        <InvoicePaymentSituationCard
          draftMode={situationDraft}
          totalTtc={situationTtc}
          totalPaid={situationPaid}
          amountDue={situationDue}
          dueDate={state.header.due_date}
          isOverdue={!situationDraft && !!detailExtras.is_overdue}
          paymentCountActive={paymentCountActive}
          currency={state.header.currency}
        />

        {quoteBillCtx && !quoteBillCtx.quote_zero_total ? (
          <div className="ib-quote-billing-hint" style={{ marginTop: "0.5rem" }}>
            <p className="ib-muted-title" style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>
              Synthèse devis (facturation)
            </p>
            <p className="qb-muted" style={{ margin: 0 }}>
              Total devis{" "}
              {(quoteBillCtx.quote_total_ttc ?? 0).toLocaleString("fr-FR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {state.header.currency} · Déjà engagé{" "}
              {(quoteBillCtx.invoiced_ttc ?? 0).toLocaleString("fr-FR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {state.header.currency} · Reste à facturer{" "}
              {(quoteBillCtx.remaining_ttc ?? 0).toLocaleString("fr-FR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {state.header.currency}
            </p>
          </div>
        ) : null}

        <div className="ib-doc-origin-row">
          <InvoiceDocumentBlock
            apiBase={API_BASE}
            documents={(invoiceDetail?.documents as InvoiceDocumentRow[]) || []}
            onGeneratePdf={() => void genPdf()}
            canGenerate={invoiceStatusUpper !== "CANCELLED"}
            generateDisabledReason={invoiceStatusUpper === "CANCELLED" ? "Facture annulée — génération PDF désactivée." : null}
          />
          <InvoiceBillingOriginSection
            quoteId={state.header.quote_id}
            quote={quoteSnap}
            quoteBillingRole={quoteBillingRole}
          />
        </div>
      </div>

      <nav className="fin-entity-links" aria-label="Navigation contextuelle">
        {state.header.lead_id ? <Link to={`/leads/${state.header.lead_id}`}>Dossier lead</Link> : null}
        {state.header.client_id ? <Link to={`/clients/${state.header.client_id}`}>Fiche client</Link> : null}
        {state.header.quote_id ? (
          <Link to={`/quotes/${state.header.quote_id}`}>Devis source</Link>
        ) : null}
        <Link to="/finance">Vue d&apos;ensemble</Link>
        <Link to="/invoices">Liste des factures</Link>
      </nav>

      <section className="ib-links-bar">
        {contactsSelectError ? (
          <p className="qb-error-inline" role="alert" style={{ width: "100%", marginBottom: 8 }}>
            {contactsSelectError}
          </p>
        ) : null}
        <InvoiceBillingEntityCombobox
          label="Client"
          disabled={!canEdit || isClientLocked}
          value={state.header.client_id}
          rows={billingClients}
          onChange={(id) => dispatch({ type: "SET_HEADER", payload: { client_id: id } })}
          fallbackId={
            state.header!.client_id && !billingClients.some((c) => c.id === state.header!.client_id)
              ? state.header!.client_id
              : null
          }
          fallbackLabel={
            state.header!.client_id && !billingClients.some((c) => c.id === state.header!.client_id)
              ? state.header!.client_label || "Rattachement actuel (hors liste)"
              : null
          }
        />
        <InvoiceBillingEntityCombobox
          label="Lead"
          disabled={!canEdit || isLeadLocked}
          value={state.header.lead_id}
          rows={billingLeads}
          onChange={(id) => dispatch({ type: "SET_HEADER", payload: { lead_id: id } })}
          fallbackId={
            state.header!.lead_id && !billingLeads.some((l) => l.id === state.header!.lead_id)
              ? state.header!.lead_id
              : null
          }
          fallbackLabel={
            state.header!.lead_id && !billingLeads.some((l) => l.id === state.header!.lead_id)
              ? state.header!.lead_label || "Rattachement actuel (hors liste)"
              : null
          }
        />
      </section>

      <div className="qb-workbench ib-workbench">
        <div className="qb-main ib-main">
          <div className="qb-section qb-lines-section ib-lines-section">
            <div className="qb-lines-head">
              <div>
                <h2 className="qb-section-title">Lignes de facture</h2>
                <p className="qb-section-hint ib-lines-hint">
                  Détail comptable : libellé, quantités, PU HT, TVA et montants par ligne.
                </p>
              </div>
              <div className="qb-lines-actions">
                <Button type="button" variant="ghost" size="sm" disabled={!canEdit} onClick={() => void openCatalog()}>
                  Ajouter depuis catalogue
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!canEdit} onClick={addFreeLine}>
                  Ligne libre
                </Button>
              </div>
            </div>
            <InvoiceLinesTable
              lines={state.lines}
              canEdit={canEdit}
              onChangeLine={(lid, patch) => dispatch({ type: "UPDATE_LINE", id: lid, patch })}
              onRemoveLine={(lid) => dispatch({ type: "REMOVE_LINE", id: lid })}
              onReorder={(a, b) => dispatch({ type: "REORDER", activeId: a, overId: b })}
            />
          </div>

          <div className="ib-notes-shell">
            <InvoiceNotes
              canEdit={canEdit}
              notes={state.meta.notes}
              paymentTerms={state.meta.payment_terms}
              issueDate={state.header.issue_date}
              dueDate={state.header.due_date}
              onChange={(field, value) => {
                if (field === "notes") dispatch({ type: "SET_META", payload: { notes: value } });
                else if (field === "payment_terms") dispatch({ type: "SET_META", payload: { payment_terms: value } });
                else if (field === "issue_date") dispatch({ type: "SET_HEADER", payload: { issue_date: value || null } });
                else if (field === "due_date") dispatch({ type: "SET_HEADER", payload: { due_date: value || null } });
              }}
              onDuePreset={setDueFromIssue}
            />
          </div>
        </div>

        <InvoiceSummaryPanel
          panelTitle="Synthèse comptable"
          totalHt={displayHt}
          totalTva={displayTva}
          totalTtc={displayTtc}
          totalPaid={totalPaid}
          totalDue={totalDue}
          issueDate={state.header.issue_date}
          dueDate={state.header.due_date}
          statusUi={statusUi}
          currency={state.header.currency}
        />
      </div>

      <ModalShell
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        title="Catalogue"
        subtitle="Sélectionnez un module à ajouter"
        size="lg"
        footer={
          <Button type="button" variant="ghost" onClick={() => setCatalogOpen(false)}>
            Fermer
          </Button>
        }
      >
        <input
          className="sn-input"
          placeholder="Rechercher…"
          value={catalogQ}
          onChange={(e) => setCatalogQ(e.target.value)}
          style={{ marginBottom: 12, width: "100%" }}
        />
        <div className="qb-catalog-list">
          {catalogItems
            .filter((c) => !catalogQ || c.name.toLowerCase().includes(catalogQ.toLowerCase()))
            .map((c) => (
              <button key={c.id} type="button" className="qb-catalog-row" onClick={() => addCatalogLine(c)}>
                <span className="qb-catalog-name">{c.name}</span>
                <span className="qb-muted">{(c.sale_price_ht_cents / 100).toFixed(2)} € HT</span>
              </button>
            ))}
        </div>
      </ModalShell>

      {invoiceDetail && state.header ? (
        <section className="if-suite" aria-label="Suivi financier">
          <h2 className="ib-suite-title">Encaissements, avoirs & relances</h2>
          <p className="ib-suite-lead">
            Opérations après émission : enregistrez les paiements, gérez les avoirs et planifiez les relances.
          </p>
          <div className="if-grid">
            <InvoicePaymentsPanel
              invoiceId={state.header.id}
              payments={paymentsList}
              canAdd={canAddPayment}
              addDisabledReason={payAddReason}
              maxPaymentAmount={finBalance.amount_due}
              onRefresh={() => void load()}
            />
            <InvoiceCreditsPanel
              invoiceId={state.header.id}
              credits={creditNotesList}
              totalCredited={finBalance.total_credited}
              canCreate={canCreateCredit}
              createBlockedReason={creditBlockReason}
              maxCreditTtc={finBalance.amount_due}
              onRefresh={() => void load()}
            />
            <InvoiceRemindersPanel
              invoiceId={state.header.id}
              reminders={remindersList}
              canRelaunch={canRelaunch}
              relaunchDisabledReason={remindBlockReason}
              onRefresh={() => void load()}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
