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
  type QuoteInvoiceBillingContext,
  type QuoteListRow,
} from "../services/financial.api";
import { billingRoleParamToApi } from "../modules/invoices/invoiceBillingLabels";
import QuoteBillingUxPanel from "../modules/quotes/QuoteBillingUxPanel";
import "../modules/invoices/invoice-builder.css";

function roundMoney2(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
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

  const isFreeContext = billingUiMode === "FREE";

  const apiRole = useMemo(
    () => billingRoleParamToApi(billingRoleParam?.trim() || "") ?? "STANDARD",
    [billingRoleParam]
  );

  const amtRaw = (billingAmountParam ?? "").trim().replace(",", ".");
  const billingAmountFromUrl = amtRaw ? Number(amtRaw) : undefined;
  const hasValidUrlAmount =
    billingAmountFromUrl != null && Number.isFinite(billingAmountFromUrl) && billingAmountFromUrl >= 0.01;

  const needsDepositForm =
    Boolean(fromQuote) && apiRole === "DEPOSIT" && !hasValidUrlAmount;

  const [billCtx, setBillCtx] = useState<QuoteInvoiceBillingContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [depositTtcInput, setDepositTtcInput] = useState("");
  const [depositPctInput, setDepositPctInput] = useState("");

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
    if (!fromQuote || !needsDepositForm) return;
    let cancelled = false;
    setCtxLoading(true);
    void fetchQuoteInvoiceBillingContext(fromQuote)
      .then((ctx) => {
        if (!cancelled) {
          setBillCtx(ctx);
          if (ctx?.has_structured_deposit && ctx.deposit_ttc != null && ctx.remaining_ttc != null) {
            const hint = roundMoney2(Math.min(ctx.deposit_ttc, ctx.remaining_ttc));
            setDepositTtcInput(hint >= 0.01 ? String(hint) : "");
          }
        }
      })
      .catch(() => {
        if (!cancelled) setBillCtx(null);
      })
      .finally(() => {
        if (!cancelled) setCtxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromQuote, needsDepositForm]);

  useEffect(() => {
    if (!fromQuote) return;
    if (needsDepositForm) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const billingAmountTtc = hasValidUrlAmount ? billingAmountFromUrl : undefined;
    void createInvoiceFromQuote(
      fromQuote,
      {
        ...(billingRoleParam?.trim() ? { billingRole: billingRoleParam.trim() } : {}),
        ...(billingAmountTtc != null ? { billingAmountTtc } : {}),
      }
    )
      .then((inv) => {
        if (!cancelled && inv?.id) navigate(`/invoices/${inv.id}`, { replace: true });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    fromQuote,
    billingRoleParam,
    billingAmountParam,
    needsDepositForm,
    hasValidUrlAmount,
    billingAmountFromUrl,
    navigate,
  ]);

  const computedDepositTtc = useMemo(() => {
    const rem = billCtx?.remaining_ttc ?? 0;
    const qTot = billCtx?.quote_total_ttc ?? 0;
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
  }, [depositTtcInput, depositPctInput, billCtx]);

  const onChangeDepositTtc = useCallback(
    (raw: string) => {
      setDepositTtcInput(raw);
      if (!billCtx) {
        setDepositPctInput("");
        return;
      }
      const v = Number(String(raw).trim().replace(",", "."));
      const q = billCtx.quote_total_ttc ?? 0;
      const rem = billCtx.remaining_ttc ?? 0;
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
    [billCtx]
  );

  const onChangeDepositPct = useCallback(
    (raw: string) => {
      setDepositPctInput(raw);
      if (!billCtx) {
        setDepositTtcInput("");
        return;
      }
      const p = Number(String(raw).trim().replace(",", "."));
      const q = billCtx.quote_total_ttc ?? 0;
      const rem = billCtx.remaining_ttc ?? 0;
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
    [billCtx]
  );

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
    const outClient = (urlClientId || clientId || "").trim() || null;
    const outLead = (urlLeadId || leadId || "").trim() || null;
    if (!outClient && !outLead) {
      setError("Sélectionnez au minimum un client ou un lead.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const inv = await createInvoiceDraft({
        client_id: outClient,
        lead_id: outLead,
        ...(optionalQuoteId.trim() ? { quote_id: optionalQuoteId.trim() } : {}),
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

  if (fromQuote && needsDepositForm) {
    return (
      <div className="qb-page" style={{ maxWidth: 520 }}>
        <h1 className="sg-title">Acompte sur devis</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
          Saisissez le montant TTC à facturer (plafonné au reste à facturer sur le devis). Le devis n&apos;est pas modifié.
        </p>
        {ctxLoading ? (
          <p className="qb-muted">Chargement du contexte devis…</p>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <QuoteBillingUxPanel
              quoteId={fromQuote}
              billCtx={billCtx}
              billLoading={false}
              showActions={false}
              balanceHref={`/invoices/new?fromQuote=${encodeURIComponent(fromQuote)}&billingRole=solde`}
              standardFullHref={`/invoices/new?fromQuote=${encodeURIComponent(fromQuote)}&billingRole=STANDARD`}
            />
          </div>
        )}

        <label style={{ display: "block", marginBottom: 12 }}>
          <span className="qb-muted" style={{ display: "block", marginBottom: 4 }}>
            Montant TTC de l&apos;acompte
          </span>
          <input
            className="sn-input"
            type="text"
            inputMode="decimal"
            value={depositTtcInput}
            onChange={(e) => onChangeDepositTtc(e.target.value)}
            placeholder="ex. 3000"
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 16 }}>
          <span className="qb-muted" style={{ display: "block", marginBottom: 4 }}>
            Ou % du total devis TTC
          </span>
          <input
            className="sn-input"
            type="text"
            inputMode="decimal"
            value={depositPctInput}
            onChange={(e) => onChangeDepositPct(e.target.value)}
            placeholder="ex. 30"
            style={{ width: "100%" }}
          />
        </label>
        {computedDepositTtc != null && computedDepositTtc >= 0.01 ? (
          <p className="qb-muted" style={{ marginTop: 0 }}>
            Montant retenu (après plafond reste) :{" "}
            <strong>
              {computedDepositTtc.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € TTC
            </strong>
          </p>
        ) : null}
        {error ? <p className="qb-error-inline">{error}</p> : null}
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <Button type="button" variant="primary" disabled={loading} onClick={() => void submitDepositFromForm()}>
            {loading ? "Création…" : "Créer la facture d'acompte"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Annuler
          </Button>
        </div>
      </div>
    );
  }

  if (fromQuote) {
    return (
      <div className="ib-page-loading">
        <p className="qb-muted">{error || "Création de la facture depuis le devis…"}</p>
        {error ? (
          <Button type="button" variant="primary" onClick={() => navigate("/invoices")}>
            Retour
          </Button>
        ) : null}
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
                    {(q.quote_number || q.id) + (q.status ? ` — ${q.status}` : "")}
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
