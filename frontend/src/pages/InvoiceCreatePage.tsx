/**
 * Création facture — rattachement client et/ou lead, option depuis devis (query).
 */

import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { fetchClients, type Client } from "../services/clients.service";
import { fetchLeads } from "../services/leads.service";
import { createInvoiceDraft, createInvoiceFromQuote } from "../services/financial.api";
import "../modules/invoices/invoice-builder.css";

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
    const lc = searchParams.get("leadId");
    const cc = searchParams.get("clientId");
    if (lc) setLeadId(lc);
    if (cc) setClientId(cc);
  }, [searchParams]);

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

  const submit = async () => {
    if (!clientId && !leadId) {
      setError("Sélectionnez au minimum un client ou un lead.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const inv = await createInvoiceDraft({
        client_id: clientId || null,
        lead_id: leadId || null,
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

  return (
    <div className="qb-page">
      <h1 className="sg-title">Nouvelle facture</h1>
      <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>
        Rattachez la facture à un client et/ou un lead (au moins un des deux). Les lignes et conditions se saisissent ensuite
        dans l&apos;éditeur.
      </p>
      {error ? <p className="qb-error-inline">{error}</p> : null}
      <div className="ib-links-bar" style={{ maxWidth: 560 }}>
        <label>
          Client
          <select className="sn-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">—</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.id}
              </option>
            ))}
          </select>
        </label>
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
