/**
 * Barre filtres Leads — toolbar SaaS (Kanban + Liste), logique métier inchangée.
 */

import type { LeadsFilters, LeadsMeta } from "../../services/leads.service";

interface LeadFiltersProps {
  filters: LeadsFilters;
  onFiltersChange: (f: LeadsFilters) => void;
  stages: { id: string; name: string }[];
  users: { id: string; email?: string }[];
  sources?: LeadsMeta["sources"];
  showArchivedToggle?: boolean;
  showSegmentationFilters?: boolean;
  resultCount?: number;
  onReset?: () => void;
}

function IconSearch(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function LeadFilters({
  filters,
  onFiltersChange,
  stages,
  users,
  sources = [],
  showArchivedToggle = false,
  showSegmentationFilters = true,
  resultCount,
  onReset,
}: LeadFiltersProps) {
  const signedVal =
    filters.has_signed_quote === true ? "yes" : filters.has_signed_quote === false ? "no" : "";
  const marketingVal =
    filters.marketing_opt_in === true ? "yes" : filters.marketing_opt_in === false ? "no" : "";

  const archiveScope: "active" | "archived" | "all" =
    filters.archive_scope ?? (filters.include_archived === true ? "all" : "active");

  const hasSecondary = showArchivedToggle || showSegmentationFilters;

  return (
    <div className="sn-leads-toolbar-wrap">
      <div className="sn-leads-filters-card" role="search" aria-label="Filtres des leads">
        <div className="sn-leads-filters-primary">
          <div className="sn-leads-filters-search">
            <IconSearch className="sn-leads-filters-search__icon" />
            <input
              id="sn-leads-search"
              type="search"
              className="sn-leads-filters-search__input"
              placeholder="Rechercher un lead, email, téléphone…"
              value={filters.search ?? ""}
              onChange={(e) =>
                onFiltersChange({ ...filters, search: e.target.value || undefined, page: 1 })
              }
              autoComplete="off"
              aria-label="Rechercher un lead, email, téléphone"
            />
          </div>

          <div className="sn-leads-filters-field">
            <label htmlFor="sn-leads-stage" className="sn-leads-filters-field__label">
              Stage
            </label>
            <select
              id="sn-leads-stage"
              className="sn-leads-filters-select"
              value={filters.stage ?? ""}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  stage: e.target.value || undefined,
                  page: 1,
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

          <div className="sn-leads-filters-field">
            <label htmlFor="sn-leads-owner" className="sn-leads-filters-field__label">
              Commercial
            </label>
            <select
              id="sn-leads-owner"
              className="sn-leads-filters-select"
              value={filters.assigned_to ?? ""}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  assigned_to: e.target.value || undefined,
                  page: 1,
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

          {showSegmentationFilters ? (
            <div className="sn-leads-filters-field">
              <label htmlFor="sn-leads-source" className="sn-leads-filters-field__label">
                Source
              </label>
              <select
                id="sn-leads-source"
                className="sn-leads-filters-select"
                value={filters.source_id ?? ""}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    source_id: e.target.value || undefined,
                    page: 1,
                  })
                }
              >
                <option value="">Toutes</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {showSegmentationFilters ? (
            <div
              className="sn-leads-filters-field sn-leads-filters-field--daterange"
              title="Date de création du dossier"
            >
              <span className="sn-leads-filters-field__label">Plage de dates</span>
              <div className="sn-leads-filters-daterange">
                <input
                  type="date"
                  className="sn-leads-filters-input sn-leads-filters-input--date"
                  aria-label="Créé à partir du"
                  value={filters.created_from ?? ""}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      created_from: e.target.value || undefined,
                      page: 1,
                    })
                  }
                />
                <span className="sn-leads-filters-daterange__sep" aria-hidden>
                  –
                </span>
                <input
                  type="date"
                  className="sn-leads-filters-input sn-leads-filters-input--date"
                  aria-label="Créé jusqu’au"
                  value={filters.created_to ?? ""}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      created_to: e.target.value || undefined,
                      page: 1,
                    })
                  }
                />
              </div>
            </div>
          ) : null}

          {onReset ? (
            <div className="sn-leads-filters-primary__reset">
              <button type="button" className="sn-leads-filters-reset" onClick={onReset}>
                Réinitialiser
              </button>
            </div>
          ) : null}
        </div>

        {hasSecondary ? (
          <div className="sn-leads-filters-secondary" aria-label="Filtres secondaires">
            {showArchivedToggle ? (
              <div className="sn-leads-filters-field sn-leads-filters-field--subtle">
                <label htmlFor="sn-leads-archive-scope" className="sn-leads-filters-field__label">
                  Dossiers
                </label>
                <select
                  id="sn-leads-archive-scope"
                  className="sn-leads-filters-select sn-leads-filters-select--subtle"
                  value={archiveScope}
                  onChange={(e) => {
                    const v = e.target.value as "active" | "archived" | "all";
                    onFiltersChange({
                      ...filters,
                      archive_scope: v,
                      include_archived: undefined,
                      page: 1,
                    });
                  }}
                >
                  <option value="active">Actifs</option>
                  <option value="archived">Archivés</option>
                  <option value="all">Tous</option>
                </select>
              </div>
            ) : null}

            {showSegmentationFilters ? (
              <div className="sn-leads-filters-field sn-leads-filters-field--subtle">
                <label htmlFor="sn-leads-signed" className="sn-leads-filters-field__label">
                  Devis signé
                </label>
                <select
                  id="sn-leads-signed"
                  className="sn-leads-filters-select sn-leads-filters-select--subtle"
                  value={signedVal}
                  onChange={(e) => {
                    const v = e.target.value;
                    onFiltersChange({
                      ...filters,
                      has_signed_quote: v === "yes" ? true : v === "no" ? false : undefined,
                      page: 1,
                    });
                  }}
                >
                  <option value="">Tous</option>
                  <option value="yes">Signé</option>
                  <option value="no">Non signé</option>
                </select>
              </div>
            ) : null}

            {showSegmentationFilters ? (
              <div className="sn-leads-filters-field sn-leads-filters-field--subtle">
                <label htmlFor="sn-leads-mkt" className="sn-leads-filters-field__label">
                  Marketing
                </label>
                <select
                  id="sn-leads-mkt"
                  className="sn-leads-filters-select sn-leads-filters-select--subtle"
                  value={marketingVal}
                  onChange={(e) => {
                    const v = e.target.value;
                    onFiltersChange({
                      ...filters,
                      marketing_opt_in: v === "yes" ? true : v === "no" ? false : undefined,
                      page: 1,
                    });
                  }}
                >
                  <option value="">Tous</option>
                  <option value="yes">Opt-in oui</option>
                  <option value="no">Opt-in non</option>
                </select>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {typeof resultCount === "number" && showSegmentationFilters ? (
        <div className="sn-leads-toolbar-footer sn-leads-toolbar-footer--minimal" role="status">
          <p className="sn-leads-toolbar-meta">
            <strong>{resultCount}</strong> résultat{resultCount !== 1 ? "s" : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
