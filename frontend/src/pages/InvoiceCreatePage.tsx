/**
 * Création facture — rattachement client et/ou lead, option depuis devis (query).
 */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { fetchClients, type Client } from "../services/clients.service";
import { fetchLeads } from "../services/leads.service";
import { createInvoiceDraft, createInvoiceFromQuote } from "../services/financial.api";
import "../modules/invoices/invoice-builder.css";

function formatClientLabel(c: Pick<Client, "company_name" | "first_name" | "last_name" | "email" | "id">): string {
  const name = c.company_name || [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (c.email) return c.email;
  return c.id;
}

export default function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [leads, setLeads] = useState<{ id: string; label: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromQuote = searchParams.get("fromQuote");
  const billingRoleParam = searchParams.get("billingRole") || searchParams.get("billing_role");

  const urlClientId = useMemo(() => (searchParams.get("clientId") ?? "").trim(), [searchParams]);
  const urlLeadId = useMemo(() => (searchParams.get("leadId") ?? "").trim(), [searchParams]);
  const clientLockedFromUrl = Boolean(urlClientId);
  const leadLockedFromUrl = Boolean(urlLeadId);

  useEffect(() => {
    void fetchClients()
      .then(setClients)
      .catch(() => setClients([]));
    void fetchLeads({ limit: 400 })
      .then((rows) =>
        setLeads(
          rows.map((l) => ({
            id: l.id,
            label: l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || l.id,
          }))
        )
      )
      .catch(() => setLeads([]));
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
    void createInvoiceFromQuote(
      fromQuote,
      billingRoleParam?.trim() ? { billingRole: billingRoleParam.trim() } : undefined
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
  }, [fromQuote, billingRoleParam, navigate]);

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

      {clientLockedFromUrl ? (
        <div className="ib-quote-billing-hint" style={{ marginBottom: 16, maxWidth: 560 }}>
          <strong style={{ color: "var(--text, #e2e8f0)" }}>Facture rattachée à ce client</strong>
          <div style={{ marginTop: 6 }}>
            {clientRowForSummary ? formatClientLabel(clientRowForSummary) : `Identifiant client : ${urlClientId}`}
          </div>
          {!clientInList ? (
            <p style={{ margin: "10px 0 0", fontSize: 13 }}>
              Client déjà fourni par le dossier, la facture sera rattachée à ce client. Il peut ne pas apparaître dans la liste
              complète chargée ici.
            </p>
          ) : null}
        </div>
      ) : null}

      {leadLockedFromUrl ? (
        <div className="ib-quote-billing-hint" style={{ marginBottom: 16, maxWidth: 560 }}>
          <strong style={{ color: "var(--text, #e2e8f0)" }}>Facture rattachée à ce lead</strong>
          <div style={{ marginTop: 6 }}>{leadRowForSummary ? leadRowForSummary.label : `Identifiant lead : ${urlLeadId}`}</div>
          {!leadInList ? (
            <p style={{ margin: "10px 0 0", fontSize: 13 }}>
              Lead déjà fourni par le dossier : la facture sera rattachée à ce lead (il peut ne pas figurer dans les 400
              premiers leads du pipeline chargés ici).
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
                  {formatClientLabel(c)}
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
                  {l.label}
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
