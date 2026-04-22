/**
 * Filtres Clients — barre compacte : Recherche → Statut → Responsable → Tri → Période → Reset
 */

import React, { useMemo } from "react";
import type { LeadsFilters, ProjectStatus } from "../../services/leads.service";

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  SIGNE: "Signé",
  DP_A_DEPOSER: "DP à déposer",
  DP_DEPOSE: "DP déposé",
  DP_ACCEPTE: "DP accepté",
  INSTALLATION_PLANIFIEE: "Installation planifiée",
  INSTALLATION_REALISEE: "Installation réalisée",
  CONSUEL_EN_ATTENTE: "Consuel en attente",
  CONSUEL_OBTENU: "Consuel obtenu",
  MISE_EN_SERVICE: "Mise en service",
  FACTURATION_TERMINEE: "Facturation terminée",
  CLOTURE: "Clôturé",
};

type SortPreset = `${NonNullable<LeadsFilters["sort"]>}|${NonNullable<LeadsFilters["order"]>}`;

const SORT_PRESETS: { value: SortPreset; label: string }[] = [
  { value: "updated_at|desc", label: "Activité (récent)" },
  { value: "updated_at|asc", label: "Activité (ancien)" },
  { value: "full_name|asc", label: "Nom A → Z" },
  { value: "full_name|desc", label: "Nom Z → A" },
  { value: "project_status|asc", label: "Statut A → Z" },
  { value: "project_status|desc", label: "Statut Z → A" },
];

interface ClientsFiltersProps {
  filters: LeadsFilters;
  onFiltersChange: (f: LeadsFilters) => void;
  users: { id: string; email?: string }[];
  onReset: () => void;
  /** Nombre de dossiers après filtres (liste courante) */
  resultCount?: number;
}

export function ClientsFilters({
  filters,
  onFiltersChange,
  users,
  onReset,
  resultCount,
}: ClientsFiltersProps) {
  const marketingVal =
    filters.marketing_opt_in === true
      ? "yes"
      : filters.marketing_opt_in === false
        ? "no"
        : "";

  const archiveScope: "active" | "archived" | "all" =
    filters.archive_scope ??
    (filters.include_archived === true ? "all" : "active");

  const sortValue = useMemo((): SortPreset => {
    const s = filters.sort ?? "updated_at";
    const o = filters.order ?? "desc";
    const key = `${s}|${o}` as SortPreset;
    if (SORT_PRESETS.some((p) => p.value === key)) return key;
    return "updated_at|desc";
  }, [filters.sort, filters.order]);

  const applySort = (value: SortPreset) => {
    const [sort, order] = value.split("|") as [
      NonNullable<LeadsFilters["sort"]>,
      NonNullable<LeadsFilters["order"]>,
    ];
    onFiltersChange({ ...filters, sort, order, page: 1 });
  };

  return (
    <div className="clients-filters-wrap-inner">
    <div
      className="clients-filters-bar"
      role="search"
      aria-label="Filtres des dossiers"
    >
      <input
        id="sn-clients-search"
        className="clients-filters-bar__search"
        type="search"
        placeholder="Rechercher un client, une ville…"
        title="Recherche"
        aria-label="Recherche"
        value={filters.search ?? ""}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            search: e.target.value || undefined,
            page: 1,
          })
        }
        autoComplete="off"
      />

      <select
        id="sn-clients-project"
        className="clients-filters-bar__select clients-filters-bar__select--status"
        title="Filtrer par statut projet"
        aria-label="Statut projet"
        value={filters.project_status ?? ""}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            project_status: (e.target.value ||
              undefined) as ProjectStatus | undefined,
            page: 1,
          })
        }
      >
        <option value="">Statut projet</option>
        {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((k) => (
          <option key={k} value={k}>
            {PROJECT_STATUS_LABELS[k]}
          </option>
        ))}
      </select>

      <select
        id="sn-clients-owner"
        className="clients-filters-bar__select clients-filters-bar__select--owner"
        title="Filtrer par responsable"
        aria-label="Responsable"
        value={filters.assigned_to ?? ""}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            assigned_to: e.target.value || undefined,
            page: 1,
          })
        }
      >
        <option value="">Responsable</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.email ?? u.id}
          </option>
        ))}
      </select>

      <select
        id="sn-clients-sort"
        className="clients-filters-bar__select clients-filters-bar__select--sort"
        title="Ordre de tri"
        aria-label="Tri"
        value={sortValue}
        onChange={(e) => applySort(e.target.value as SortPreset)}
      >
        {SORT_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <div
        className="filter-period"
        title="Période d’activité (mises à jour du dossier)"
      >
        <input
          id="sn-clients-from"
          className="clients-filters-bar__date"
          type="date"
          aria-label="Activité à partir du"
          value={filters.from_date ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              from_date: e.target.value || undefined,
              page: 1,
            })
          }
        />
        <span className="filter-period__sep" aria-hidden>
          –
        </span>
        <input
          id="sn-clients-to"
          className="clients-filters-bar__date"
          type="date"
          aria-label="Activité jusqu’au"
          value={filters.to_date ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              to_date: e.target.value || undefined,
              page: 1,
            })
          }
        />
      </div>

      <div
        className="filter-period"
        title="Date de création du dossier (lead converti / fiche client)"
      >
        <input
          id="sn-clients-created-from"
          className="clients-filters-bar__date"
          type="date"
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
        <span className="filter-period__sep" aria-hidden>
          –
        </span>
        <input
          id="sn-clients-created-to"
          className="clients-filters-bar__date"
          type="date"
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

      <select
        id="sn-clients-marketing"
        className="clients-filters-bar__select clients-filters-bar__select--marketing"
        title="Filtrer par opt-in marketing"
        aria-label="Marketing opt-in"
        value={marketingVal}
        onChange={(e) => {
          const v = e.target.value;
          onFiltersChange({
            ...filters,
            marketing_opt_in:
              v === "yes" ? true : v === "no" ? false : undefined,
            page: 1,
          });
        }}
      >
        <option value="">Marketing</option>
        <option value="yes">Opt-in oui</option>
        <option value="no">Opt-in non</option>
      </select>

      <select
        id="sn-clients-archive-scope"
        className="clients-filters-bar__select"
        title="Actifs, archivés ou tous les dossiers"
        aria-label="Archivage"
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

      <button
        type="button"
        className="filter-reset"
        onClick={onReset}
        title="Réinitialiser tous les filtres"
      >
        Réinitialiser
      </button>
    </div>
    {typeof resultCount === "number" ? (
      <div className="clients-filters-footer" role="status">
        <p className="clients-filters-footer__count">
          <strong>{resultCount}</strong> résultat{resultCount !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          className="sn-btn sn-btn-outline sn-btn-sm clients-filters-footer__reset"
          onClick={onReset}
        >
          Réinitialiser les filtres
        </button>
      </div>
    ) : null}
    </div>
  );
}
