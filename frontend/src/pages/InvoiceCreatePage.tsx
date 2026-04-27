/**
 * Création facture — rattachement client et/ou lead, option depuis devis (query).
 * Listes : GET /api/clients/select et GET /api/leads/select (tables strictes).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import {
  fetchClientsBillingSelect,
  fetchLeadsBillingSelect,
  type BillingSelectRow,
} from "../services/billingContacts.api";
import { createInvoiceDraft, createInvoiceFromQuote } from "../services/financial.api";
import "../modules/invoices/invoice-builder.css";

export default function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState<BillingSelectRow[]>([]);
  const [leads, setLeads] = useState<BillingSelectRow[]>([]);
  const [listsError, setListsError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromQuote = searchParams.get("fromQuote");
  const billingRoleParam = searchParams.get("billingRole") || searchParams.get("billing_role");
  const billingAmountParam = searchParams.get("amountTtc") || searchParams.get("billing_amount_ttc");

  const urlClientId = useMemo(() => (searchParams.get("clientId") ?? "").trim(), [searchParams]);
  const urlLeadId = useMemo(() => (searchParams.get("leadId") ?? "").trim(), [searchParams]);
  const clientLockedFromUrl = Boolean(urlClientId);
  const leadLockedFromUrl = Boolean(urlLeadId);

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
    if (urlLeadId) setLeadId(urlLeadId);
    if (urlClientId) setClientId(urlClientId);
  }, [urlClientId, urlLeadId]);

  useEffect(() => {
    if (!fromQuote) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const amtRaw = (billingAmountParam ?? "").trim().replace(",", ".");
    const billingAmountTtc = amtRaw ? Number(amtRaw) : undefined;
    void createInvoiceFromQuote(
      fromQuote,
      {
        ...(billingRoleParam?.trim() ? { billingRole: billingRoleParam.trim() } : {}),
        ...(billingAmountTtc != null && Number.isFinite(billingAmountTtc) ? { billingAmountTtc } : {}),
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
  }, [fromQuote, billingRoleParam, billingAmountParam, navigate]);

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

  const generalMode = !clientLockedFromUrl && !leadLockedFromUrl;

  return (
    <div className="qb-page">
      <h1 className="sg-title">Nouvelle facture</h1>
      {generalMode ? (
        <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>
          Rattachez la facture à un client et/ou un lead (au moins un des deux). Les lignes et conditions se saisissent ensuite
          dans l&apos;éditeur.
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

      {clientLockedFromUrl ? (
        <div className="ib-quote-billing-hint" style={{ marginBottom: 16, maxWidth: 560 }}>
          <strong style={{ color: "var(--text, #e2e8f0)" }}>Facture rattachée à ce client</strong>
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

      {leadLockedFromUrl ? (
        <div className="ib-quote-billing-hint" style={{ marginBottom: 16, maxWidth: 560 }}>
          <strong style={{ color: "var(--text, #e2e8f0)" }}>Facture rattachée à ce lead</strong>
          <div style={{ marginTop: 6 }}>
            {leadRowForSummary ? leadRowForSummary.full_name : "Lead fourni par l’URL (hors liste affichée)"}
          </div>
          {!leadInList ? (
            <p style={{ margin: "10px 0 0", fontSize: 13 }}>
              Lead déjà fourni par le dossier ; il peut être absent de la liste (périmètre commercial ou libellé non éligible).
            </p>
          ) : null}
          {!clientLockedFromUrl ? (
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

      <div className="ib-links-bar" style={{ maxWidth: 560 }}>
        {!clientLockedFromUrl ? (
          <label>
            Client
            <select className="sn-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!leadLockedFromUrl ? (
          <label>
            Lead
            <select className="sn-input" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">—</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.full_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

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
