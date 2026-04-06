/**
 * Vue liste Leads — grille terrain (nom | adresse | tel | …)
 */

import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../ui/Card";
import type { Lead } from "../../services/leads.service";
import {
  getLeadName,
  getLeadFullAddress,
  getLeadPhoneDisplay,
} from "../../services/leads.service";
import {
  scoreBadgeClass,
  inactivityBadgeClass,
  inactivityLabelHybrid,
  stageIndexFromStageName,
  stagePillClass,
} from "./leadBadgeClasses";

interface LeadsListViewProps {
  leads: Lead[];
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
}

type SortKey =
  | "name"
  | "address"
  | "phone"
  | "score"
  | "stage"
  | "inactivity"
  | "assigned"
  | "date";
type SortDir = "asc" | "desc";

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isLeadArchived(lead: Lead): boolean {
  return lead.status === "ARCHIVED" || Boolean(lead.archived_at);
}

export function LeadsListView({
  leads,
  onUnarchive,
  onDelete,
  canDelete = false,
}: LeadsListViewProps) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedLeads = useMemo(() => {
    const arr = [...leads];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = getLeadName(a).localeCompare(getLeadName(b));
          break;
        case "address":
          cmp = getLeadFullAddress(a).localeCompare(getLeadFullAddress(b));
          break;
        case "phone":
          cmp = getLeadPhoneDisplay(a).localeCompare(getLeadPhoneDisplay(b));
          break;
        case "score":
          cmp = (a.score ?? 0) - (b.score ?? 0);
          break;
        case "stage":
          cmp = (a.stage_name ?? "").localeCompare(b.stage_name ?? "");
          break;
        case "inactivity": {
          const order = { none: 0, warning: 1, danger: 2, critical: 3 };
          cmp =
            (order[a.inactivity_level as keyof typeof order] ?? 0) -
            (order[b.inactivity_level as keyof typeof order] ?? 0);
          break;
        }
        case "assigned":
          cmp = (a.assigned_to_email ?? "").localeCompare(
            b.assigned_to_email ?? ""
          );
          break;
        case "date":
        default:
          cmp =
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [leads, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) =>
    sortKey === column ? (
      <span className="sn-leads-sort-icon" aria-hidden>
        {sortDir === "asc" ? "↑" : "↓"}
      </span>
    ) : null;

  const openLead = (id: string) => navigate(`/leads/${id}`);

  if (leads.length === 0) {
    return (
      <div className="sn-leads-list-host sn-leads-list-host--empty">
        <Card padding="lg" variant="elevated" className="sn-leads-empty-card">
          <p className="sn-leads-empty-title">Aucun lead</p>
          <p className="sn-leads-empty-text">
            Ajustez les filtres ou créez un nouveau lead depuis le flux
            commercial.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="sn-leads-list-host">
      <Card
        padding="none"
        variant="elevated"
        className="sn-leads-list-card sn-leads-list-card--fill"
      >
        <div className="sn-leads-premium-scroll sn-leads-scrollbar">
          <div className="sn-leads-premium" aria-label="Liste des leads">
            <div className="sn-leads-premium__head">
              <div className="sn-leads-premium__row sn-leads-premium__row--header">
                <div className="sn-leads-premium__cell sn-leads-premium__cell--lead">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => handleSort("name")}
                  >
                    Nom
                    <SortIcon column="name" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--address">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => handleSort("address")}
                  >
                    Adresse
                    <SortIcon column="address" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--phone">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => handleSort("phone")}
                  >
                    Téléphone
                    <SortIcon column="phone" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--score">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => handleSort("score")}
                  >
                    Score
                    <SortIcon column="score" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--stage">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => handleSort("stage")}
                  >
                    Stage
                    <SortIcon column="stage" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--inact">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => handleSort("inactivity")}
                  >
                    Inactivité
                    <SortIcon column="inactivity" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--owner">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => handleSort("assigned")}
                  >
                    Commercial
                    <SortIcon column="assigned" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--date">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => handleSort("date")}
                  >
                    Création
                    <SortIcon column="date" />
                  </button>
                </div>
              </div>
            </div>
            <div className="sn-leads-premium__body">
              {sortedLeads.map((lead) => {
                const st = stageIndexFromStageName(lead.stage_name);
                const name = getLeadName(lead);
                const addr = getLeadFullAddress(lead);
                const tel = getLeadPhoneDisplay(lead);
                const archived = isLeadArchived(lead);

                return (
                  <div
                    key={lead.id}
                    className={`sn-leads-premium__row sn-leads-premium__row--data sn-leads-premium__row--stage-${st}${
                      archived ? " lead-archived" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => openLead(lead.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openLead(lead.id);
                      }
                    }}
                    aria-label={`Lead ${name}, ouvrir la fiche`}
                  >
                    <span className="sn-leads-premium__accent" aria-hidden />
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--lead">
                      <span className="sn-leads-premium__name">{name}</span>
                    </div>
                    <div
                      className="sn-leads-premium__cell sn-leads-premium__cell--address"
                      title={addr || undefined}
                    >
                      <span className="sn-leads-premium__truncate">
                        {addr || "—"}
                      </span>
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--phone">
                      <span className="sn-leads-premium__tel">
                        {tel || "—"}
                      </span>
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--score">
                      <span className={scoreBadgeClass(lead.score ?? 0)}>
                        {lead.score ?? 0}
                      </span>
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--stage">
                      <span className={stagePillClass(st)}>
                        {lead.stage_name ?? "—"}
                      </span>
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--inact">
                      {lead.last_activity_at || lead.inactivity_level ? (
                        <span
                          className={inactivityBadgeClass(lead.inactivity_level ?? "none")}
                        >
                          {inactivityLabelHybrid(
                            lead.inactivity_level ?? "none",
                            lead.last_activity_at
                          )}
                        </span>
                      ) : (
                        <span className="sn-leads-premium__muted">—</span>
                      )}
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--owner sn-leads-premium__muted">
                      {lead.assigned_to_email ?? "—"}
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--date sn-leads-premium__muted">
                      {formatDate(lead.created_at)}
                    </div>
                    <div
                      className="sn-leads-premium__cell sn-leads-premium__cell--crm-actions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <div className="sn-leads-list-crm-actions">
                        {archived ? (
                          onUnarchive ? (
                            <button
                              type="button"
                              className="sn-btn sn-btn-ghost sn-btn-sm"
                              onClick={() => onUnarchive(lead.id)}
                            >
                              Restaurer
                            </button>
                          ) : null
                        ) : (
                          <>
                            {canDelete && onDelete ? (
                              <button
                                type="button"
                                className="sn-btn sn-btn-danger sn-btn-sm"
                                onClick={() => onDelete(lead.id)}
                              >
                                Supprimer
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
