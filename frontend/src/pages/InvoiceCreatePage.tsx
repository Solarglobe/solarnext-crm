/**
 * Création facture — rattachement client et/ou lead, option depuis devis (query).
 * Listes : GET /api/clients/select et GET /api/leads/select (tables strictes).
 *
 * Contextes UI (hors flux `fromQuote` géré en amont = QUOTE_CONTEXT) :
 * - CLIENT_CONTEXT : `clientId` en query
 * - LEAD_CONTEXT : `leadId` seul en query
 * - CLIENT_AND_LEAD : les deux en query (pas de selects ; devis filtrés sur client_id)
 * - FREE_CONTEXT : aucun paramètre — choix exclusif client ou lead, devis après choix
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import {
  fetchClientsBillingSelect,
  fetchLeadsBillingSelect,
  type BillingSelectRow,
} from "../services/billingContacts.api";
import {
  createInvoiceDraft,
  createInvoiceFromQuote,
  fetchQuoteInvoiceBillingContext,
  fetchQuotesList,
  getQuoteDocumentViewModel,
  type QuoteInvoiceBillingContext,
  type QuoteListRow,
} from "../services/financial.api";
import { billingRoleParamToApi } from "../modules/invoices/invoiceBillingLabels";
import QuoteBillingUxPanel from "../modules/quotes/QuoteBillingUxPanel";
import "../modules/invoices/invoice-builder.css";
import "./InvoiceCreatePage.premium.css";
import {
  aggregatePreparedTotals,
  getDiscountPercent,
  getPreparedLineMoneyTotals,
  normalizePreparedLines,
  patchTriggersComputedTotals,
  roundMoney2,
  type PreparedInvoiceLine,
} from "./invoicePreparationTotals";

function fmtDateFrShort(input: string | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
}

/** Libellé option « Devis optionnel » : numéro + statut + contact si connu. */
function quoteOptionalSelectLabel(q: QuoteListRow): string {
  const num = q.quote_number || q.id;
  const statusPart = q.status ? ` — ${q.status}` : "";
  const base = `${num}${statusPart}`;

  const clientDisp =
    (typeof q.client_name === "string" && q.client_name.trim()) ||
    (typeof q.company_name === "string" && q.company_name.trim()) ||
    [q.first_name, q.last_name].filter(Boolean).join(" ").trim() ||
    "";

  const leadDisp =
    (typeof q.lead_name === "string" && q.lead_name.trim()) ||
    (typeof q.lead_full_name === "string" && q.lead_full_name.trim()) ||
    "";

  if (q.client_id && clientDisp) return `${base} — ${clientDisp}`;
  if (q.lead_id && leadDisp) return `${base} — ${leadDisp}`;
  return base;
}

export default function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState<BillingSelectRow[]>([]);
  const [leads, setLeads] = useState<BillingSelectRow[]>([]);
  const [listsError, setListsError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [optionalQuoteId, setOptionalQuoteId] = useState("");
  const [quoteRows, setQuoteRows] = useState<QuoteListRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  /** Faux au chargement initial : évite un flash « Création… » sur le formulaire acompte. */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromQuote = searchParams.get("fromQuote");
  const billingRoleParam = searchParams.get("billingRole") || searchParams.get("billing_role");
  const billingAmountParam = searchParams.get("amountTtc") || searchParams.get("billing_amount_ttc");

  const urlClientId = useMemo(() => (searchParams.get("clientId") ?? "").trim(), [searchParams]);
  const urlLeadId = useMemo(() => (searchParams.get("leadId") ?? "").trim(), [searchParams]);

  /** Contexte formulaire manuel (QUOTE_CONTEXT = `fromQuote`, traité plus haut). */
  const billingUiMode = useMemo(() => {
    const c = Boolean(urlClientId);
    const l = Boolean(urlLeadId);
    if (c && l) return "CLIENT_AND_LEAD" as const;
    if (c) return "CLIENT" as const;
    if (l) return "LEAD" as const;
    return "FREE" as const;
  }, [urlClientId, urlLeadId]);

  /** Picks client/lead : uniquement sans `clientId` ni `leadId` en URL (= !clientLockedFromUrl && !leadLockedFromUrl). */
  const isFreeContext = billingUiMode === "FREE";

  const apiRole = useMemo(
    () => billingRoleParamToApi(billingRoleParam?.trim() || "") ?? "STANDARD",
    [billingRoleParam]
  );

  const amtRaw = (billingAmountParam ?? "").trim().replace(",", ".");
  const billingAmountFromUrl = amtRaw ? Number(amtRaw) : undefined;
  const hasValidUrlAmount =
    billingAmountFromUrl != null && Number.isFinite(billingAmountFromUrl) && billingAmountFromUrl >= 0.01;

  const [billCtx, setBillCtx] = useState<QuoteInvoiceBillingContext | null>(null);
  const [depositTtcInput, setDepositTtcInput] = useState("");
  const [depositPctInput, setDepositPctInput] = useState("");
  const [preparedLines, setPreparedLines] = useState<PreparedInvoiceLine[]>([]);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepReady, setPrepReady] = useState(false);
  const [prepValidated, setPrepValidated] = useState(false);

  useEffect(() => {
    setListsError(null);
    void Promise.all([fetchClientsBillingSelect(), fetchLeadsBillingSelect()])
      .then(([cRows, lRows]) => {
        setClients(cRows);
        setLeads(lRows);
      })
      .catch((e: unknown) => {
        setClients([]);
        setLeads([]);
        setListsError(e instanceof Error ? e.message : "Impossible de charger les listes client / lead.");
      });
  }, []);

  useEffect(() => {
    console.log("VERSION PREP INVOICE V2");
  }, []);

  useEffect(() => {
    setClientId(urlClientId || "");
    setLeadId(urlLeadId || "");
  }, [urlClientId, urlLeadId]);

  /** Filtre liste devis : une seule dimension (client_id ou lead_id), jamais mélangée. */
  const quoteListFilter = useMemo((): { type: "client" | "lead"; id: string } | null => {
    if (fromQuote) return null;
    if (billingUiMode === "FREE") {
      const c = clientId.trim();
      const l = leadId.trim();
      if (c && l) return { type: "client", id: c };
      if (c) return { type: "client", id: c };
      if (l) return { type: "lead", id: l };
      return null;
    }
    if (billingUiMode === "CLIENT_AND_LEAD") {
      return { type: "client", id: urlClientId };
    }
    if (billingUiMode === "CLIENT") {
      return { type: "client", id: urlClientId };
    }
    if (billingUiMode === "LEAD") {
      return { type: "lead", id: urlLeadId };
    }
    return null;
  }, [fromQuote, billingUiMode, clientId, leadId, urlClientId, urlLeadId]);

  useEffect(() => {
    if (!quoteListFilter) {
      setQuoteRows([]);
      setOptionalQuoteId("");
      setQuotesError(null);
      setQuotesLoading(false);
      return;
    }
    let cancelled = false;
    setQuotesLoading(true);
    setQuotesError(null);
    const params =
      quoteListFilter.type === "client"
        ? { client_id: quoteListFilter.id, limit: 200 }
        : { lead_id: quoteListFilter.id, limit: 200 };
    void fetchQuotesList(params)
      .then((rows) => {
        if (!cancelled) {
          setQuoteRows(rows);
          setOptionalQuoteId((prev) => (rows.some((r) => r.id === prev) ? prev : ""));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setQuoteRows([]);
          setOptionalQuoteId("");
          setQuotesError(e instanceof Error ? e.message : "Impossible de charger les devis.");
        }
      })
      .finally(() => {
        if (!cancelled) setQuotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quoteListFilter]);

  useEffect(() => {
    if (!fromQuote) return;
    let cancelled = false;
    setPrepLoading(true);
    setPrepReady(false);
    setError(null);
    setPrepValidated(false);
    void Promise.all([
      getQuoteDocumentViewModel(fromQuote, { forInvoicePrep: true }),
      fetchQuoteInvoiceBillingContext(fromQuote),
    ])
      .then(([vm, ctx]) => {
        if (cancelled) return;
        const vmLines = Array.isArray(vm?.payload?.lines) ? vm.payload.lines : [];
        const normalizedLines = normalizePreparedLines(vmLines);
        setPreparedLines(normalizedLines);
        setBillCtx(ctx);
        if (ctx?.has_structured_deposit && ctx.deposit_ttc != null) {
          const preparedTotalsFromVm = aggregatePreparedTotals(normalizedLines);
          const currentPreparedTotal = ctx.billing_is_locked
            ? roundMoney2(Number(ctx.billing_total_ttc ?? preparedTotalsFromVm.total_ttc))
            : preparedTotalsFromVm.total_ttc;
          const baseTotalTtc = roundMoney2(
            Number(ctx.billing_total_ttc ?? ctx.quote_total_ttc ?? currentPreparedTotal)
          );
          const remainingOnPrepared = roundMoney2(
            Math.max(0, currentPreparedTotal - Number(ctx.invoiced_ttc ?? 0))
          );
          const depositFromPreparedBase =
            baseTotalTtc > 0
              ? roundMoney2((currentPreparedTotal * Number(ctx.deposit_ttc ?? 0)) / baseTotalTtc)
              : 0;
          const hint = roundMoney2(Math.min(depositFromPreparedBase, remainingOnPrepared));
          setDepositTtcInput(hint >= 0.01 ? String(hint) : "");
        }
        setPrepReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Impossible de charger le devis pour préparation facture.");
        }
      })
      .finally(() => {
        if (!cancelled) setPrepLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromQuote]);

  const preparedTotals = useMemo(() => aggregatePreparedTotals(preparedLines), [preparedLines]);
  const billingLocked = Boolean(billCtx?.billing_is_locked);
  const projectGlobalTotal = billingLocked
    ? roundMoney2(Number(billCtx?.billing_total_ttc ?? preparedTotals.total_ttc))
    : preparedTotals.total_ttc;
  const effectivePreparedTotals = {
    total_ttc: projectGlobalTotal,
    total_ht: billingLocked
      ? roundMoney2(Number(billCtx?.billing_total_ht ?? preparedTotals.total_ht))
      : preparedTotals.total_ht,
    total_vat: billingLocked
      ? roundMoney2(Number(billCtx?.billing_total_vat ?? preparedTotals.total_vat))
      : preparedTotals.total_vat,
  };
  const displayedInvoicedTtc = roundMoney2(Number(billCtx?.invoiced_ttc ?? 0));
  const displayedRemainingTtc = roundMoney2(Math.max(0, projectGlobalTotal - displayedInvoicedTtc));

  const computedDepositTtc = useMemo(() => {
    const rem = projectGlobalTotal;
    const qTot = projectGlobalTotal;
    const ttcStr = depositTtcInput.trim().replace(",", ".");
    if (ttcStr) {
      const v = Number(ttcStr);
      if (!Number.isFinite(v) || v < 0) return null;
      return roundMoney2(Math.min(v, rem));
    }
    const pctStr = depositPctInput.trim().replace(",", ".");
    if (pctStr && qTot > 0) {
      const p = Number(pctStr);
      if (!Number.isFinite(p) || p <= 0) return null;
      const raw = roundMoney2((qTot * Math.min(100, p)) / 100);
      return roundMoney2(Math.min(raw, rem));
    }
    return null;
  }, [depositTtcInput, depositPctInput, projectGlobalTotal]);

  const onChangeDepositTtc = useCallback(
    (raw: string) => {
      setDepositTtcInput(raw);
      if (!prepReady) {
        setDepositPctInput("");
        return;
      }
      const v = Number(String(raw).trim().replace(",", "."));
      const q = projectGlobalTotal;
      const rem = projectGlobalTotal;
      if (!String(raw).trim() || !Number.isFinite(v) || v < 0) {
        setDepositPctInput("");
        return;
      }
      const clamped = roundMoney2(Math.min(Math.max(0, v), rem));
      if (q > 0.0001) {
        const pct = roundMoney2((clamped / q) * 100);
        setDepositPctInput(pct > 0 && pct <= 100 ? String(pct) : "");
      } else setDepositPctInput("");
    },
    [prepReady, projectGlobalTotal]
  );

  const onChangeDepositPct = useCallback(
    (raw: string) => {
      setDepositPctInput(raw);
      if (!prepReady) {
        setDepositTtcInput("");
        return;
      }
      const p = Number(String(raw).trim().replace(",", "."));
      const q = projectGlobalTotal;
      const rem = projectGlobalTotal;
      if (!String(raw).trim() || !Number.isFinite(p) || p <= 0) {
        setDepositTtcInput("");
        return;
      }
      const fromPct = roundMoney2(Math.min((q * Math.min(100, p)) / 100, rem));
      setDepositTtcInput(
        fromPct >= 0.01
          ? fromPct.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : ""
      );
    },
    [prepReady, projectGlobalTotal]
  );

  const updatePreparedLine = useCallback(
    (id: string, patch: Partial<Omit<PreparedInvoiceLine, "id">>) => {
      setPreparedLines((prev) =>
        prev.map((line) => {
          if (line.id !== id) return line;
          const next = { ...line, ...patch };
          if (patchTriggersComputedTotals(patch)) next.totalsSource = "computed";
          return next;
        })
      );
    },
    []
  );

  const removePreparedLine = useCallback((id: string) => {
    setPreparedLines((prev) => prev.filter((line) => line.id !== id));
  }, []);

  const submitPreparedStandard = async () => {
    if (!fromQuote) return;
    if (billingLocked) {
      setError("Le montant global est déjà figé. Utilisez les flux acompte/solde basés sur ce montant.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const inv = await createInvoiceFromQuote(fromQuote, {
        billingRole: "STANDARD",
      });
      if (inv?.id) navigate(`/invoices/${inv.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const submitDepositFromForm = async () => {
    if (!fromQuote) return;
    const amt = computedDepositTtc;
    if (amt == null || amt < 0.01) {
      setError("Indiquez un montant TTC (> 0) ou un pourcentage du total devis.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const inv = await createInvoiceFromQuote(fromQuote, {
        billingRole: "DEPOSIT",
        billingAmountTtc: amt,
        preparedTotalTtc: effectivePreparedTotals.total_ttc,
        preparedTotalHt: effectivePreparedTotals.total_ht,
        preparedTotalVat: effectivePreparedTotals.total_vat,
      });
      if (inv?.id) navigate(`/invoices/${inv.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const submitPreparedBalance = async () => {
    if (!fromQuote) return;
    setLoading(true);
    setError(null);
    try {
      const inv = await createInvoiceFromQuote(fromQuote, {
        billingRole: "BALANCE",
        preparedTotalTtc: effectivePreparedTotals.total_ttc,
        preparedTotalHt: effectivePreparedTotals.total_ht,
        preparedTotalVat: effectivePreparedTotals.total_vat,
      });
      if (inv?.id) navigate(`/invoices/${inv.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const clientRowForSummary = useMemo(
    () => (urlClientId ? clients.find((c) => c.id === urlClientId) : undefined),
    [clients, urlClientId]
  );
  const leadRowForSummary = useMemo(() => (urlLeadId ? leads.find((l) => l.id === urlLeadId) : undefined), [leads, urlLeadId]);

  const clientInList = Boolean(urlClientId && clients.some((c) => c.id === urlClientId));
  const leadInList = Boolean(urlLeadId && leads.some((l) => l.id === urlLeadId));

  const submit = async () => {
    let outClient = (urlClientId || clientId || "").trim() || null;
    let outLead = (urlLeadId || leadId || "").trim() || null;
    if (outClient && outLead) {
      outLead = null;
    }
    if (!outClient && !outLead) {
      setError("Sélectionnez au minimum un client ou un lead.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const quoteId = optionalQuoteId.trim();
      if (quoteId) {
        navigate(
          `/invoices/new?fromQuote=${encodeURIComponent(quoteId)}&billingRole=STANDARD`,
          { replace: true }
        );
        return;
      }
      const inv = await createInvoiceDraft({
            client_id: outClient,
            lead_id: outLead,
            lines: [],
            notes: "",
            payment_terms: "",
          });
      if (inv?.id) navigate(`/invoices/${inv.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  if (fromQuote) {
    const canSubmitPrep = preparedLines.length > 0 && projectGlobalTotal > 0;
    const editingDisabled = billingLocked || apiRole === "STANDARD";
    return (
      <div className="icp-page">
        <div className="icp-header">
          <div className="icp-step-badge">Étape 1 · Préparation</div>
          <h1 className="icp-title">Préparation de la facture</h1>
          <p className="icp-subtitle">
            Modifiez les lignes du devis avant validation. Le devis original ne sera jamais modifié.
          </p>
        </div>
        {prepLoading ? (
          <p className="qb-muted">Chargement de la préparation…</p>
        ) : (
          <div className="icp-workbench">
            <section className="icp-table-card" aria-label="Lignes du devis">
              <div className="icp-table-wrap" data-scroll-region="invoice-prep-lines">
                <table className="icp-table">
                  <thead>
                    <tr>
                      <th className="icp-col-label">Libellé / Description</th>
                      <th>Quantité</th>
                      <th>PU HT</th>
                      <th>Remise %</th>
                      <th>TVA %</th>
                      <th>Total HT</th>
                      <th>Total TTC</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preparedLines.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="icp-empty-state">
                          Aucune ligne. Ajoutez ou revenez au devis.
                        </td>
                      </tr>
                    ) : preparedLines.map((line) => {
                      const cellTotals = getPreparedLineMoneyTotals(line);
                      const discountPercent = getDiscountPercent(line);
                      return (
                        <tr
                          key={line.id}
                          className={activeLineId === line.id ? "icp-row-active" : undefined}
                        >
                          <td className="icp-cell-label">
                            <div className="icp-label-primary">{line.label}</div>
                            <div className="icp-label-secondary">{line.description || "Sans description"}</div>
                          </td>
                          <td>
                            <input
                              className="icp-input"
                              type="number"
                              step="0.01"
                              value={line.quantity === 0 ? "" : line.quantity}
                              disabled={editingDisabled}
                              placeholder="0"
                              onFocus={() => setActiveLineId(line.id)}
                              onChange={(e) => updatePreparedLine(line.id, { quantity: Number(e.target.value) })}
                            />
                          </td>
                          <td>
                            <input
                              className="icp-input"
                              type="number"
                              step="0.01"
                              value={line.unit_price_ht === 0 ? "" : line.unit_price_ht}
                              disabled={editingDisabled}
                              placeholder="0"
                              onFocus={() => setActiveLineId(line.id)}
                              onChange={(e) =>
                                updatePreparedLine(line.id, { unit_price_ht: Number(e.target.value) })
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="icp-input"
                              type="number"
                              step="0.01"
                              value={discountPercent === 0 ? "" : discountPercent}
                              disabled={editingDisabled}
                              placeholder="0"
                              onFocus={() => setActiveLineId(line.id)}
                              onChange={(e) => {
                                const pct = Math.max(0, Number(e.target.value) || 0);
                                updatePreparedLine(line.id, { discount_percent: Math.min(100, pct) });
                              }}
                            />
                          </td>
                          <td>
                            <input
                              className="icp-input"
                              type="number"
                              step="0.01"
                              value={line.vat_rate === 0 ? "" : line.vat_rate}
                              disabled={editingDisabled}
                              placeholder="0"
                              onFocus={() => setActiveLineId(line.id)}
                              onChange={(e) => updatePreparedLine(line.id, { vat_rate: Number(e.target.value) })}
                            />
                          </td>
                          <td className="icp-amount">
                            {cellTotals.discountHt > 0.0001 ? (
                              <span className="icp-old-amount">
                                {cellTotals.baseHt.toLocaleString("fr-FR", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{" "}
                                €
                              </span>
                            ) : null}
                            {cellTotals.totalHt.toLocaleString("fr-FR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            €
                          </td>
                          <td className="icp-amount icp-amount-strong">
                            {cellTotals.totalTtc.toLocaleString("fr-FR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            €
                          </td>
                          <td>
                            {!editingDisabled ? (
                              <button
                                type="button"
                                className="icp-delete-btn"
                                aria-label="Supprimer la ligne"
                                title="Supprimer la ligne"
                                onClick={() => removePreparedLine(line.id)}
                              >
                                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                                  <path
                                    d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 10h2v8H7v-8z"
                                    fill="currentColor"
                                  />
                                </svg>
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="icp-summary-card">
              <h2 className="icp-summary-title">Récapitulatif</h2>
              <dl className="icp-kv">
                <dt>Total HT</dt>
                <dd>
                  {preparedTotals.total_ht.toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  €
                </dd>
                <dt>TVA</dt>
                <dd>
                  {preparedTotals.total_vat.toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  €
                </dd>
                <dt className="icp-kv-strong">Total TTC</dt>
                <dd className="icp-kv-strong">
                  {preparedTotals.total_ttc.toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  €
                </dd>
              </dl>

              <div className="icp-divider" />

              <p className="icp-contract-line">
                Montant contractuel :{" "}
                <strong>
                  {projectGlobalTotal.toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  €
                </strong>
              </p>
              {billingLocked ? (
                <>
                  <span
                    className="icp-lock-badge"
                    title="Ce montant correspond au total validé lors de la première facturation. Il ne peut plus être modifié."
                  >
                    Verrouille
                  </span>
                  <p className="qb-muted" style={{ marginTop: 8 }}>
                    Verrouillé le : {fmtDateFrShort(billCtx?.billing_locked_at)}
                  </p>
                </>
              ) : (
                <p className="qb-muted" style={{ marginTop: 8 }}>
                  Non encore validé
                </p>
              )}
              {apiRole === "STANDARD" ? (
                <p className="qb-muted" style={{ marginTop: 8 }}>
                  Facture STANDARD: les lignes et remises sont reprises à l&apos;identique depuis le snapshot officiel du devis.
                </p>
              ) : null}

              {apiRole === "DEPOSIT" && prepValidated ? (
                <div className="icp-deposit-box">
                  <div style={{ marginBottom: 12 }}>
                    <QuoteBillingUxPanel
                      quoteId={fromQuote}
                      billCtx={billCtx}
                      billLoading={false}
                      totalsOverride={{
                        totalTtc: projectGlobalTotal,
                        invoicedTtc: displayedInvoicedTtc,
                        remainingTtc: displayedRemainingTtc,
                      }}
                      showActions={false}
                      balanceHref={`/invoices/new?fromQuote=${encodeURIComponent(fromQuote)}&billingRole=solde`}
                      standardFullHref={`/invoices/new?fromQuote=${encodeURIComponent(fromQuote)}&billingRole=STANDARD`}
                    />
                  </div>
                  <label className="icp-field">
                    <span>Montant TTC de l&apos;acompte</span>
                    <input
                      className="icp-input"
                      type="text"
                      inputMode="decimal"
                      value={depositTtcInput}
                      onChange={(e) => onChangeDepositTtc(e.target.value)}
                      placeholder="ex. 3000"
                    />
                  </label>
                  <label className="icp-field">
                    <span>Ou % du total préparé TTC</span>
                    <input
                      className="icp-input"
                      type="text"
                      inputMode="decimal"
                      value={depositPctInput}
                      onChange={(e) => onChangeDepositPct(e.target.value)}
                      placeholder="ex. 30"
                    />
                  </label>
                  {computedDepositTtc != null && computedDepositTtc >= 0.01 ? (
                    <p className="qb-muted" style={{ marginTop: 8 }}>
                      Montant retenu :{" "}
                      <strong>
                        {computedDepositTtc.toLocaleString("fr-FR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        € TTC
                      </strong>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </aside>
          </div>
        )}

        {error ? <p className="qb-error-inline">{error}</p> : null}
        <div className="icp-actions">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Annuler
          </Button>
          {apiRole === "STANDARD" ? (
            <Button type="button" variant="primary" disabled={loading || !canSubmitPrep} onClick={() => void submitPreparedStandard()}>
              {loading ? <span className="icp-btn-loading">Validation…</span> : "Valider et continuer"}
            </Button>
          ) : apiRole === "DEPOSIT" && !prepValidated ? (
            <Button
              type="button"
              variant="primary"
              disabled={loading || !canSubmitPrep}
              onClick={() => {
                setPrepValidated(true);
                if (hasValidUrlAmount && billingAmountFromUrl != null) {
                  setDepositTtcInput(String(roundMoney2(Math.min(billingAmountFromUrl, preparedTotals.total_ttc))));
                }
              }}
            >
              {loading ? <span className="icp-btn-loading">Validation…</span> : "Valider et continuer"}
            </Button>
          ) : apiRole === "BALANCE" ? (
            <Button type="button" variant="primary" disabled={loading || !canSubmitPrep} onClick={() => void submitPreparedBalance()}>
              {loading ? <span className="icp-btn-loading">Validation…</span> : "Valider et continuer"}
            </Button>
          ) : (
            <Button type="button" variant="primary" disabled={loading || !canSubmitPrep} onClick={() => void submitDepositFromForm()}>
              {loading ? <span className="icp-btn-loading">Validation…</span> : "Valider et continuer"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="qb-page">
      <h1 className="sg-title">Nouvelle facture</h1>
      {isFreeContext ? (
        <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>
          Choisissez <strong>un client</strong> <em>ou</em> <strong>un lead</strong> (un seul à la fois). Les lignes et
          conditions se saisissent ensuite dans l&apos;éditeur.
        </p>
      ) : (
        <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>
          Contexte dossier : la facture sera créée avec le rattachement indiqué ci-dessous. Les lignes et conditions se
          saisissent ensuite dans l&apos;éditeur.
        </p>
      )}

      {error ? <p className="qb-error-inline">{error}</p> : null}
      {listsError ? (
        <p className="qb-error-inline" role="alert">
          {listsError}
        </p>
      ) : null}

      {urlClientId ? (
        <div className="ib-quote-billing-hint" style={{ marginBottom: 16, maxWidth: 560 }}>
          <strong style={{ color: "var(--text, #e2e8f0)" }}>Facture rattachée au client :</strong>
          <div style={{ marginTop: 6 }}>
            {clientRowForSummary ? clientRowForSummary.full_name : "Client fourni par l’URL (hors liste affichée)"}
          </div>
          {!clientInList ? (
            <p style={{ margin: "10px 0 0", fontSize: 13 }}>
              Client déjà fourni par le dossier ; la facture sera rattachée à ce client. Il peut être absent de la liste si
              les champs CRM ne permettent pas un libellé facturation.
            </p>
          ) : null}
        </div>
      ) : null}

      {urlLeadId ? (
        <div className="ib-quote-billing-hint" style={{ marginBottom: 16, maxWidth: 560 }}>
          <strong style={{ color: "var(--text, #e2e8f0)" }}>Facture rattachée au lead :</strong>
          <div style={{ marginTop: 6 }}>
            {leadRowForSummary ? leadRowForSummary.full_name : "Lead fourni par l’URL (hors liste affichée)"}
          </div>
          {!leadInList ? (
            <p style={{ margin: "10px 0 0", fontSize: 13 }}>
              Lead déjà fourni par le dossier ; il peut être absent de la liste (périmètre commercial ou libellé non éligible).
            </p>
          ) : null}
          {!urlClientId ? (
            <p style={{ margin: "14px 0 0", fontSize: 13, lineHeight: 1.45 }}>
              Pour disposer d&apos;une fiche client CRM (recommandé pour devis / acomptes), ouvrez le dossier et placez-le sur
              l&apos;étape <strong>Signé</strong> du pipeline.{" "}
              <Link to={`/leads/${encodeURIComponent(urlLeadId)}`} style={{ color: "var(--accent, #eab308)" }}>
                Ouvrir le dossier
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      {isFreeContext ? (
        <div className="ib-links-bar" style={{ maxWidth: 560 }}>
          <label>
            Choisir un client
            <select
              className="sn-input"
              value={clientId}
              onChange={(e) => {
                const v = e.target.value;
                setClientId(v);
                setLeadId("");
                setOptionalQuoteId("");
              }}
            >
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ou choisir un lead
            <select
              className="sn-input"
              value={leadId}
              onChange={(e) => {
                const v = e.target.value;
                setLeadId(v);
                setClientId("");
                setOptionalQuoteId("");
              }}
            >
              <option value="">—</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {quoteListFilter ? (
        <div style={{ maxWidth: 560, marginTop: 16 }}>
          <label style={{ display: "block" }}>
            <span className="qb-muted" style={{ display: "block", marginBottom: 6 }}>
              Devis optionnel (filtré sur le dossier — {quoteListFilter.type === "client" ? "client" : "lead"})
            </span>
            {quotesLoading ? (
              <p className="qb-muted">Chargement des devis…</p>
            ) : quotesError ? (
              <p className="qb-error-inline">{quotesError}</p>
            ) : (
              <select
                className="sn-input"
                style={{ width: "100%" }}
                value={optionalQuoteId}
                onChange={(e) => setOptionalQuoteId(e.target.value)}
              >
                <option value="">— Aucun —</option>
                {quoteRows.map((q) => (
                  <option key={q.id} value={q.id}>
                    {quoteOptionalSelectLabel(q)}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <Button type="button" variant="primary" disabled={loading} onClick={() => void submit()}>
          {loading ? "Création…" : "Créer la facture"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => navigate("/invoices")}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
