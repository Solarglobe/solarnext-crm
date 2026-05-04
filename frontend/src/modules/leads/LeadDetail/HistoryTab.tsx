/**
 * CP-LEAD-V2 — Onglet Historique système
 * Activités non-NOTE (changements statut, stage, etc.) ou data.history si disponible
 */

import React from "react";
import { ACTIVITY_TYPE_LABELS, type Activity } from "../../../services/activities.service";
import LeadEmptyState from "./LeadEmptyState";

const formatDate = (s: string) =>
  new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface HistoryTabProps {
  historyItems: Activity[];
  loading: boolean;
}

export default function HistoryTab({ historyItems, loading }: HistoryTabProps) {
  return (
    <section className="crm-lead-card">
      <div className="crm-lead-card-head">
        <h2 className="crm-lead-card-title">Historique système</h2>
      </div>
      <div className="crm-lead-tab-intro">
        <p className="crm-lead-tab-intro-title">Journal automatique</p>
        <p className="crm-lead-tab-intro-desc">
          Événements enregistrés par l&apos;application : changements de statut, d&apos;étape, validation
          d&apos;adresse, signatures, etc. Lecture seule pour assurer la traçabilité.
        </p>
      </div>
      <div className="crm-lead-timeline-wrap">
        {loading ? (
          <p className="crm-lead-empty">Chargement…</p>
        ) : (
          <div className="crm-lead-timeline">
            {historyItems.length === 0 ? (
              <LeadEmptyState
                title="Aucun événement système pour l’instant"
                description="Les changements de statut, d’étape, validations et signatures apparaîtront ici automatiquement."
              />
            ) : (
              historyItems.map((a, i) => (
                <div key={a.id} className="crm-lead-timeline-item">
                  <div className="crm-lead-timeline-dot" />
                  {i < historyItems.length - 1 && <div className="crm-lead-timeline-line" />}
                  <div className="crm-lead-timeline-content">
                    <span className="crm-lead-timeline-badge sn-badge sn-badge-info">
                      {ACTIVITY_TYPE_LABELS[a.type]}
                    </span>
                    <span className="crm-lead-timeline-date">{formatDate(a.occurred_at)}</span>
                    {a.title && (
                      <span className="crm-lead-timeline-title">{a.title}</span>
                    )}
                    {a.content && (
                      <span className="crm-lead-timeline-body">{a.content}</span>
                    )}
                    {a.type === "STATUS_CHANGE" && a.payload && (
                      <span className="crm-lead-timeline-body">
                        {String((a.payload as { from?: string }).from)} →{" "}
                        {String((a.payload as { to?: string }).to)}
                      </span>
                    )}
                    {a.type === "STAGE_CHANGE" && a.payload && (
                      <span className="crm-lead-timeline-body">Étape modifiée</span>
                    )}
                    {a.type === "ADDRESS_VERIFIED" && (
                      <span className="crm-lead-timeline-body">
                        Emplacement validé sur parcelle
                      </span>
                    )}
                    {a.type === "PROJECT_STATUS_CHANGE" && a.payload && (
                      <span className="crm-lead-timeline-body">
                        {String((a.payload as { from?: string }).from)} →{" "}
                        {String((a.payload as { to?: string }).to)}
                      </span>
                    )}
                    {a.type === "DEVIS_SIGNE" && (
                      <span className="crm-lead-timeline-body">Devis signé</span>
                    )}
                    {a.type === "INSTALLATION_TERMINEE" && (
                      <span className="crm-lead-timeline-body">Installation terminée</span>
                    )}
                    {a.created_by?.name && (
                      <span className="crm-lead-timeline-by">
                        par {a.created_by.name || a.created_by.email}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
