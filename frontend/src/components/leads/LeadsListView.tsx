/**
 * Vue liste Leads — tableau dense type SaaS (tri serveur + pagination serveur).
 */

import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../ui/Card";
import type { Lead, LeadsFilters } from "../../services/leads.service";
import {
  getLeadName,
  getLeadListLocation,
  getLeadFullAddress,
  getLeadPhoneDisplay,
  isLeadArchivedRecord,
} from "../../services/leads.service";
import {
  inactivityLabelHybrid,
  stageIndexFromStageName,
  listRowScoreClass,
  listRowStageClass,
  listRowInactivityClass,
} from "./leadBadgeClasses";
import { CrmLeadStatusBadge } from "../crm/CrmLeadStatusBadge";
import { LeadMairieListBadge } from "./LeadMairieListBadge";

export type LeadsListSortColumn =
  | "name"
  | "location"
  | "phone"
  | "score"
  | "stage"
  | "inactivity"
  | "assigned"
  | "date";

export function leadsListColumnToApiSort(
  col: LeadsListSortColumn
): NonNullable<LeadsFilters["sort"]> {
  switch (col) {
    case "name":
    case "location":
    case "phone":
      return "full_name";
    case "score":
      return "score";
    case "stage":
      return "stage_name";
    case "inactivity":
      return "inactivity_level";
    case "assigned":
      return "assigned_user_id";
    case "date":
      return "created_at";
  }
}

export function apiSortToLeadsListColumn(
  api: string | undefined
): LeadsListSortColumn {
  switch (api) {
    case "full_name":
      return "name";
    case "score":
      return "score";
    case "stage_name":
      return "stage";
    case "inactivity_level":
      return "inactivity";
    case "assigned_user_id":
    case "assigned_salesperson_user_id":
      return "assigned";
    case "created_at":
      return "date";
    case "updated_at":
      return "date";
    default:
      return "date";
  }
}

interface LeadsListViewProps {
  leads: Lead[];
  onUnarchive?: (id: string) => void;
  onArchive?: (id: string) => void;
  canArchive?: boolean;
  selectedIds?: string[];
  onToggleBulkSelect?: (id: string) => void;
  onSelectAllOnPage?: () => void;
  onResetFilters?: () => void;
  /** Tri aligné sur GET /api/leads */
  sortColumn: LeadsListSortColumn;
  sortOrder: "asc" | "desc";
  onSortChange: (col: LeadsListSortColumn) => void;
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  canBulkEmail?: boolean;
  onRequestEmailForLead?: (leadId: string) => void;
}

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function LeadsListView({
  leads,
  onUnarchive,
  onArchive,
  canArchive = false,
  selectedIds = [],
  onToggleBulkSelect,
  onSelectAllOnPage,
  onResetFilters,
  sortColumn,
  sortOrder,
  onSortChange,
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  canBulkEmail = false,
  onRequestEmailForLead,
}: LeadsListViewProps) {
  const navigate = useNavigate();
  const [menuLeadId, setMenuLeadId] = useState<string | null>(null);

  const bulkEnabled = Boolean(onToggleBulkSelect && onSelectAllOnPage);
  const idSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);

  const pageIds = useMemo(() => leads.map((l) => String(l.id)), [leads]);
  const allOnPageSelected =
    bulkEnabled && pageIds.length > 0 && pageIds.every((id) => idSet.has(id));
  const someOnPageSelected =
    bulkEnabled && pageIds.some((id) => idSet.has(id)) && !allOnPageSelected;

  useEffect(() => {
    if (!menuLeadId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".sn-leads-row-menu")) return;
      setMenuLeadId(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuLeadId]);

  const SortIcon = ({ column }: { column: LeadsListSortColumn }) =>
    sortColumn === column ? (
      <span className="sn-leads-sort-icon" aria-hidden>
        {sortOrder === "asc" ? "↑" : "↓"}
      </span>
    ) : null;

  const openLead = (id: string) => navigate(`/leads/${id}`);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const fromIdx = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toIdx = totalCount === 0 ? 0 : Math.min(safePage * pageSize, totalCount);

  const pageNumbers = useMemo(() => {
    const max = totalPages;
    if (max <= 7) return Array.from({ length: max }, (_, i) => i + 1);
    const cur = safePage;
    const set = new Set<number>([1, max, cur, cur - 1, cur + 1]);
    const arr = [...set].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
    const out: (number | "gap")[] = [];
    for (let i = 0; i < arr.length; i++) {
      if (i > 0 && arr[i] - arr[i - 1] > 1) out.push("gap");
      out.push(arr[i]);
    }
    return out;
  }, [totalPages, safePage]);

  if (leads.length === 0 && totalCount === 0) {
    return (
      <div className="sn-leads-list-host sn-leads-list-host--empty">
        <Card padding="lg" variant="elevated" className="sn-leads-empty-card">
          <p className="sn-leads-empty-title">Aucun dossier trouvé</p>
          <p className="sn-leads-empty-text">
            Ajustez les filtres ou créez un nouveau lead depuis le flux commercial.
          </p>
          {onResetFilters ? (
            <button
              type="button"
              className="sn-btn sn-btn-outline sn-btn-sm sn-leads-empty-reset"
              onClick={onResetFilters}
            >
              Réinitialiser les filtres
            </button>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="sn-leads-list-host">
      <Card
        padding="none"
        variant="elevated"
        className="sn-leads-list-card sn-leads-list-card--fill sn-leads-list-card--v2"
      >
        <div className="sn-leads-premium-scroll sn-leads-scrollbar">
          <div
            className={`sn-leads-premium sn-leads-premium--list-v2${
              bulkEnabled ? " sn-leads-premium--selectable" : ""
            }`}
            aria-label="Liste des leads"
          >
            <div className="sn-leads-premium__head">
              <div className="sn-leads-premium__row sn-leads-premium__row--header">
                {bulkEnabled ? (
                  <div
                    className="sn-leads-premium__cell sn-leads-premium__cell--select"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="sn-leads-premium__bulk-check sn-leads-premium__bulk-check--subtle"
                      checked={allOnPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPageSelected;
                      }}
                      onChange={() => onSelectAllOnPage?.()}
                      aria-label="Tout sélectionner sur cette page"
                      title="Tout sélectionner sur cette page"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                ) : null}
                <div className="sn-leads-premium__cell sn-leads-premium__cell--lead-v2">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => onSortChange("name")}
                  >
                    Lead
                    <SortIcon column="name" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--phone">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => onSortChange("phone")}
                  >
                    Tél.
                    <SortIcon column="phone" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--score">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => onSortChange("score")}
                  >
                    Score
                    <SortIcon column="score" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--stage">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => onSortChange("stage")}
                  >
                    Stage
                    <SortIcon column="stage" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--inact">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => onSortChange("inactivity")}
                  >
                    Inactivité
                    <SortIcon column="inactivity" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--owner">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => onSortChange("assigned")}
                  >
                    Commercial
                    <SortIcon column="assigned" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--date">
                  <button
                    type="button"
                    className="sn-leads-premium__sort"
                    onClick={() => onSortChange("date")}
                  >
                    Création
                    <SortIcon column="date" />
                  </button>
                </div>
                <div className="sn-leads-premium__cell sn-leads-premium__cell--actions-head sn-leads-premium__sort--static">
                  <span className="sn-leads-premium__sort sn-leads-premium__sort--static-inner">
                    Actions
                  </span>
                </div>
              </div>
            </div>
            <div className="sn-leads-premium__body">
              {leads.map((lead) => {
                const st = stageIndexFromStageName(lead.stage_name);
                const name = getLeadName(lead);
                const loc = getLeadListLocation(lead);
                const fullAddrHint = getLeadFullAddress(lead);
                const tel = getLeadPhoneDisplay(lead);
                const archived = isLeadArchivedRecord(lead);

                return (
                  <div
                    key={lead.id}
                    className={`sn-leads-premium__row sn-leads-premium__row--data sn-leads-premium__row--list-v2${
                      archived ? " lead-archived" : ""
                    }${idSet.has(String(lead.id)) ? " sn-leads-premium__row--selected" : ""}`}
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
                    {bulkEnabled ? (
                      <div
                        className="sn-leads-premium__cell sn-leads-premium__cell--select"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="sn-leads-premium__bulk-check sn-leads-premium__bulk-check--subtle"
                          checked={idSet.has(String(lead.id))}
                          onChange={() => onToggleBulkSelect?.(String(lead.id))}
                          aria-label={`Sélectionner ${name}`}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    ) : null}
                    <div
                      className="sn-leads-premium__cell sn-leads-premium__cell--lead-v2"
                      title={loc ? `${name} — ${loc}` : name}
                    >
                      <div className="sn-leads-premium__title-line-v2">
                        <span className="sn-leads-premium__name sn-leads-premium__name--v2">{name}</span>
                        <CrmLeadStatusBadge status={lead.status} stageName={lead.stage_name} />
                        <LeadMairieListBadge lead={lead} />
                      </div>
                      {archived ? (
                        <span className="sn-leads-archive-badge sn-leads-archive-badge--subtle" title="Dossier archivé">
                          Archivé
                        </span>
                      ) : null}
                      {loc ? (
                        <span className="sn-leads-premium__subline">{loc}</span>
                      ) : null}
                    </div>
                    <div
                      className="sn-leads-premium__cell sn-leads-premium__cell--phone"
                      title={tel || undefined}
                    >
                      <span className="sn-leads-premium__tel">{tel || "—"}</span>
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--score">
                      <span className={listRowScoreClass(lead.score ?? 0)}>{lead.score ?? 0}</span>
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--stage">
                      <span className={listRowStageClass(st)} title={lead.stage_name ?? undefined}>
                        {lead.stage_name ?? "—"}
                      </span>
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--inact">
                      {lead.last_activity_at || lead.inactivity_level ? (
                        <span
                          className={listRowInactivityClass(lead.inactivity_level ?? "none")}
                          title={fullAddrHint || undefined}
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
                      <span className="sn-leads-premium__truncate">{lead.assigned_to_email ?? "—"}</span>
                    </div>
                    <div className="sn-leads-premium__cell sn-leads-premium__cell--date sn-leads-premium__muted">
                      {formatDate(lead.created_at)}
                    </div>
                    <div
                      className="sn-leads-premium__cell sn-leads-premium__cell--crm-actions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <div className="sn-leads-list-row-actions">
                        <div className="sn-leads-row-menu">
                          <button
                            type="button"
                            className="sn-leads-row-menu__trigger"
                            aria-label={`Actions pour ${name}`}
                            aria-expanded={menuLeadId === String(lead.id)}
                            aria-haspopup="menu"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuLeadId((id) =>
                                id === String(lead.id) ? null : String(lead.id)
                              );
                            }}
                          >
                            <span aria-hidden>⋯</span>
                          </button>
                          {menuLeadId === String(lead.id) ? (
                            <ul className="sn-leads-row-menu__list" role="menu">
                              <li role="none">
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="sn-leads-row-menu__item"
                                  onClick={() => {
                                    setMenuLeadId(null);
                                    openLead(lead.id);
                                  }}
                                >
                                  Ouvrir la fiche
                                </button>
                              </li>
                              {canBulkEmail && onRequestEmailForLead ? (
                                <li role="none">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="sn-leads-row-menu__item"
                                    onClick={() => {
                                      setMenuLeadId(null);
                                      onRequestEmailForLead(String(lead.id));
                                    }}
                                  >
                                    Envoyer un email
                                  </button>
                                </li>
                              ) : null}
                              {archived && onUnarchive ? (
                                <li role="none">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="sn-leads-row-menu__item"
                                    onClick={() => {
                                      setMenuLeadId(null);
                                      onUnarchive(lead.id);
                                    }}
                                  >
                                    Restaurer
                                  </button>
                                </li>
                              ) : null}
                            </ul>
                          ) : null}
                        </div>
                        {!archived && canArchive && onArchive ? (
                          <button
                            type="button"
                            className="sn-leads-row-icon-btn sn-leads-row-icon-btn--archive"
                            aria-label={`Archiver le lead ${name}`}
                            title="Archiver"
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchive(lead.id);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none">
                              <path
                                d="M4 7h16v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7zm3-4h10l1 2H6l1-2z"
                                fill="currentColor"
                                opacity="0.88"
                              />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {totalCount > 0 ? (
          <footer className="sn-leads-list-pagination" aria-label="Pagination">
            <p className="sn-leads-list-pagination__range">
              Affichage{" "}
              <strong>
                {fromIdx}–{toIdx}
              </strong>{" "}
              sur <strong>{totalCount}</strong>
            </p>
            <div className="sn-leads-list-pagination__controls">
              <label className="sn-leads-list-pagination__pagesize">
                <span className="sn-visually-hidden">Lignes par page</span>
                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  aria-label="Nombre de lignes par page"
                >
                  <option value={10}>10 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
              </label>
              <div className="sn-leads-list-pagination__nav" role="group" aria-label="Pages">
                <button
                  type="button"
                  className="sn-leads-page-btn"
                  disabled={safePage <= 1}
                  onClick={() => onPageChange(safePage - 1)}
                  aria-label="Page précédente"
                >
                  Précédent
                </button>
                <div className="sn-leads-list-pagination__nums">
                  {pageNumbers.map((p, i) =>
                    p === "gap" ? (
                      <span key={`g-${i}`} className="sn-leads-list-pagination__gap" aria-hidden>
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        className={`sn-leads-page-num${p === safePage ? " sn-leads-page-num--current" : ""}`}
                        onClick={() => onPageChange(p)}
                        aria-label={`Page ${p}`}
                        aria-current={p === safePage ? "page" : undefined}
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>
                <button
                  type="button"
                  className="sn-leads-page-btn"
                  disabled={safePage >= totalPages}
                  onClick={() => onPageChange(safePage + 1)}
                  aria-label="Page suivante"
                >
                  Suivant
                </button>
              </div>
            </div>
          </footer>
        ) : null}
      </Card>
    </div>
  );
}
