/**
 * Bloc « client CRM » sur la fiche lead — chip compact inline.
 */

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchClientById, type Client } from "../../../services/clients.service";

function formatClientName(c: Client): string {
  const n = (c.company_name || "").trim();
  if (n) return n;
  const p = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (p) return p;
  return c.email || c.id;
}

interface LeadClientAssociationCardProps {
  leadId: string;
  clientId: string | null | undefined;
  readOnly?: boolean;
}

export default function LeadClientAssociationCard({
  leadId,
  clientId,
  readOnly = false,
}: LeadClientAssociationCardProps) {
  const [client, setClient] = useState<Client | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadingClient, setLoadingClient] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      setLoadErr(null);
      return;
    }
    let cancelled = false;
    setLoadingClient(true);
    setLoadErr(null);
    void fetchClientById(clientId)
      .then((row) => {
        if (!cancelled) setClient(row);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : "Erreur chargement client");
          setClient(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingClient(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) {
    if (readOnly) return null;
    return (
      <div className="crm-lead-assoc-row" data-lead-id={leadId}>
        <span className="crm-lead-assoc-chip" style={{ cursor: "default" }}>
          <span className="crm-lead-assoc-chip__dot" style={{ background: "var(--text-muted)", opacity: 0.4 }} />
          <span className="crm-lead-assoc-chip__label">Client</span>
          <span className="crm-lead-assoc-chip__meta">Pas encore client — étape Signé requise</span>
        </span>
      </div>
    );
  }

  if (loadingClient) {
    return (
      <div className="crm-lead-assoc-row" data-lead-id={leadId}>
        <span className="crm-lead-assoc-chip" style={{ cursor: "default" }}>
          <span className="crm-lead-assoc-chip__dot" />
          <span className="crm-lead-assoc-chip__label">Client</span>
          <span className="crm-lead-assoc-chip__meta">Chargement…</span>
        </span>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="crm-lead-assoc-row" data-lead-id={leadId}>
        <span className="crm-lead-assoc-chip" style={{ cursor: "default", borderColor: "var(--error)" }}>
          <span className="crm-lead-assoc-chip__dot" style={{ background: "var(--error)" }} />
          <span className="crm-lead-assoc-chip__label">Client</span>
          <span className="crm-lead-assoc-chip__meta" style={{ color: "var(--error)" }}>{loadErr}</span>
        </span>
      </div>
    );
  }

  const name = client ? formatClientName(client) : "—";
  const meta = [
    client?.client_number ? `N° ${client.client_number}` : null,
    client?.email || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="crm-lead-assoc-row" data-lead-id={leadId}>
      <Link to="/clients" className="crm-lead-assoc-chip" title="Voir la fiche client">
        <span className="crm-lead-assoc-chip__dot" />
        <span className="crm-lead-assoc-chip__label">Client</span>
        <span className="crm-lead-assoc-chip__name">{name}</span>
        {meta ? <span className="crm-lead-assoc-chip__meta">{meta}</span> : null}
        <span className="crm-lead-assoc-chip__arrow">↗</span>
      </Link>
    </div>
  );
}
