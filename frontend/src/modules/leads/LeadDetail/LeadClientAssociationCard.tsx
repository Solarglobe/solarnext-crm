/**
 * Bloc « client CRM » sur la fiche lead — fiche créée via étape pipeline Signé uniquement.
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

  if (clientId) {
    return (
      <section
        data-lead-id={leadId}
        className="lead-client-assoc"
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 10,
          border: "1px solid var(--border, rgba(148, 163, 184, 0.25))",
          background: "var(--surface-elevated, rgba(15, 23, 42, 0.35))",
        }}
      >
        <h3 className="lead-client-assoc__title" style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>
          Client associé
        </h3>
        {loadingClient ? (
          <p className="crm-lead-muted" style={{ margin: 0 }}>
            Chargement…
          </p>
        ) : loadErr ? (
          <p className="qb-error-inline" style={{ margin: 0 }}>
            {loadErr}
          </p>
        ) : (
          <>
            {client?.client_number ? (
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-muted)" }}>N° {client.client_number}</p>
            ) : null}
            <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{client ? formatClientName(client) : "—"}</p>
            <p style={{ margin: "4px 0", fontSize: 14 }}>{client?.email || "—"}</p>
            <p style={{ margin: "4px 0 0", fontSize: 14 }}>{client?.phone || client?.mobile || "—"}</p>
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
              <Link to="/clients" style={{ color: "var(--accent, #eab308)" }}>
                Liste des clients
              </Link>
            </p>
          </>
        )}
      </section>
    );
  }

  return (
    <section
      data-lead-id={leadId}
      className="lead-client-assoc lead-client-assoc--pending"
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 10,
        border: "1px dashed var(--border, rgba(148, 163, 184, 0.35))",
      }}
    >
      <p style={{ margin: "0 0 10px", color: "var(--text-muted)", fontSize: 14 }}>
        Ce dossier n&apos;est pas encore un client CRM.
      </p>
      {!readOnly ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>
          La fiche client est créée lorsque vous placez le dossier sur l&apos;étape <strong>Signé</strong> du pipeline
          (barre d&apos;actions ou vue Kanban). Un devis accepté seul ne crée pas la fiche client.
        </p>
      ) : null}
    </section>
  );
}
