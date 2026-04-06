/**
 * Barre filtres Leads — Kanban et Liste (même toolbar)
 */

import React from "react";
import type { LeadsFilters } from "../../services/leads.service";

interface LeadFiltersProps {
  filters: LeadsFilters;
  onFiltersChange: (f: LeadsFilters) => void;
  stages: { id: string; name: string }[];
  users: { id: string; email?: string }[];
  /** Vue liste : afficher le toggle « Voir archivés » */
  showArchivedToggle?: boolean;
}

export function LeadFilters({
  filters,
  onFiltersChange,
  stages,
  users,
  showArchivedToggle = false,
}: LeadFiltersProps) {
  return (
    <div
      className="sn-leads-toolbar"
      role="search"
      aria-label="Filtres des leads"
    >
      <div className="sn-filter-group sn-filter-group--search">
        <label htmlFor="sn-leads-search" className="sn-filter-label">
          Recherche
        </label>
        <div className="sn-filter-control">
          <input
            id="sn-leads-search"
            type="search"
            placeholder="Nom, ville, e-mail…"
            value={filters.search ?? ""}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value || undefined })
            }
            autoComplete="off"
          />
        </div>
      </div>
      <div className="sn-filter-group sn-filter-group--stage">
        <label htmlFor="sn-leads-stage" className="sn-filter-label">
          Stage
        </label>
        <div className="sn-filter-control">
          <select
            id="sn-leads-stage"
            value={filters.stage ?? ""}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                stage: e.target.value || undefined,
              })
            }
          >
            <option value="">Tous</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="sn-filter-group sn-filter-group--commercial">
        <label htmlFor="sn-leads-owner" className="sn-filter-label">
          Commercial
        </label>
        <div className="sn-filter-control">
          <select
            id="sn-leads-owner"
            value={filters.assigned_to ?? ""}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                assigned_to: e.target.value || undefined,
              })
            }
          >
            <option value="">Tous</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email ?? u.id}
              </option>
            ))}
          </select>
        </div>
      </div>
      {showArchivedToggle ? (
        <div className="sn-filter-group sn-filter-group--archived">
          <label className="sn-leads-archived-toggle">
            <input
              type="checkbox"
              checked={Boolean(filters.include_archived)}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  include_archived: e.target.checked ? true : undefined,
                })
              }
            />
            <span>Voir archivés</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
