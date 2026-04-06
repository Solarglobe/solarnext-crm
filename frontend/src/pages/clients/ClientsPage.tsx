/**
 * Page Clients — split liste + détail, suivi projet PV (données API existantes).
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { ClientsPortfolioList } from "../../components/clients/ClientsPortfolioList";
import { ClientsDetailPanel } from "../../components/clients/ClientsDetailPanel";
import { ClientsFilters } from "../../components/clients/ClientsFilters";
import {
  fetchLeads,
  fetchLeadsMeta,
  archiveLead,
  type Lead,
  type LeadsFilters,
  type ProjectStatus,
} from "../../services/leads.service";
import { getUserPermissions } from "../../services/auth.service";
import { computeProjectKpis } from "../../components/clients/projectPvTracking";
import "./clients-page.css";

/** IDs API parfois number — tout normaliser en string pour sélection / find. */
function normalizeClientId(
  id: string | number | undefined | null
): string | null {
  if (id === undefined || id === null || id === "") return null;
  return String(id);
}

function filtersAreActive(f: LeadsFilters): boolean {
  return Boolean(
    (f.search && f.search.trim() !== "") ||
      f.assigned_to ||
      f.project_status ||
      (f.from_date && f.from_date !== "") ||
      (f.to_date && f.to_date !== "")
  );
}

export default function ClientsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<{ id: string; email?: string }[]>([]);
  /** Même garde que le PATCH lead (statut projet, archivage) — aligné API + auth/permissions. */
  const [canUpdateLead, setCanUpdateLead] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadsFilters>({
    view: "clients",
    search: "",
    assigned_to: "",
    project_status: undefined,
    from_date: "",
    to_date: "",
    sort: "updated_at",
    order: "desc",
    page: 1,
    limit: 25,
  });

  const filtersActive = useMemo(() => filtersAreActive(filters), [filters]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const f: LeadsFilters = { view: "clients", limit: filters.limit ?? 25 };
      if (filters.search) f.search = filters.search;
      if (filters.assigned_to) f.assigned_to = filters.assigned_to;
      if (filters.project_status) {
        f.project_status = filters.project_status as ProjectStatus;
      }
      if (filters.from_date) f.from_date = filters.from_date;
      if (filters.to_date) f.to_date = filters.to_date;
      if (filters.sort) f.sort = filters.sort;
      if (filters.order) f.order = filters.order;
      if (filters.page) f.page = filters.page;
      const data = await fetchLeads(f);
      setLeads(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (leads.length === 0) {
      setSelectedClientId(null);
      return;
    }
    setSelectedClientId((prev) => {
      if (prev && leads.some((l) => l.id === prev)) return prev;
      return null;
    });
  }, [leads]);

  useEffect(() => {
    fetchLeadsMeta()
      .then((m) => setUsers(m.users || []))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    getUserPermissions()
      .then((p) => {
        const perms = p.permissions ?? [];
        const superAdmin = p.superAdmin === true;
        const can =
          superAdmin ||
          perms.includes("*") ||
          perms.includes("lead.update.all") ||
          perms.includes("lead.update.self");
        setCanUpdateLead(can);
      })
      .catch(() => setCanUpdateLead(false));
  }, []);

  const handleArchiveLead = useCallback(
    async (id: string) => {
      if (
        !window.confirm(
          "Archiver ce dossier ? Il disparaîtra des listes actives."
        )
      ) {
        return;
      }
      setError(null);
      try {
        await archiveLead(id);
        await loadData();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Erreur lors de l'archivage"
        );
      }
    },
    [loadData]
  );

  const kpi = useMemo(() => computeProjectKpis(leads), [leads]);

  const selectedLead = useMemo(() => {
    if (selectedClientId == null) return null;
    const sid = String(selectedClientId);
    return leads.find((l) => String(l.id) === sid) ?? null;
  }, [leads, selectedClientId]);

  const handleLeadUpdated = useCallback((updated: Lead) => {
    setLeads((prev) =>
      prev.map((l) =>
        String(l.id) === String(updated.id) ? { ...l, ...updated } : l
      )
    );
  }, []);

  const resetFilters = () => {
    setFilters({
      view: "clients",
      search: "",
      assigned_to: "",
      project_status: undefined,
      from_date: "",
      to_date: "",
      sort: "updated_at",
      order: "desc",
      page: 1,
      limit: 25,
    });
  };

  const openFull = useCallback(
    (id: string) => {
      navigate(`/leads/${id}`);
    },
    [navigate]
  );

  if (loading && !leads.length) {
    return (
      <div className="sn-leads-page">
        <Card
          padding="lg"
          variant="default"
          className="sn-leads-page__loading-card"
        >
          <div className="sn-leads-page__hero">
            <h1 className="sn-leads-page__title">Clients</h1>
            <p className="sn-leads-page__subtitle-inline">
              Chargement de la liste…
            </p>
          </div>
          <div className="sn-leads-skeleton" aria-hidden>
            <div className="sn-leads-skeleton__line" />
            <div className="sn-leads-skeleton__line sn-leads-skeleton__line--short" />
          </div>
        </Card>
      </div>
    );
  }

  if (error && !leads.length) {
    return (
      <div className="sn-leads-page">
        <Card padding="lg" variant="default">
          <div className="sn-leads-page__hero">
            <h1 className="sn-leads-page__title">Clients</h1>
            <p className="sn-leads-page__error">{error}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="sn-leads-page sn-leads-page--shell clients-page">
      <header className="clients-page-header clients-page-header--split">
        <div className="clients-page-header-row">
          <h1 className="sn-leads-page__title clients-page__title">Clients</h1>
          <p
            className="clients-kpi-strip"
            title="Indicateurs calculés sur les dossiers de cette page uniquement (échantillon API)."
          >
            <span className="clients-kpi-strip__n">{leads.length}</span> dossiers
            affichés ·{" "}
            <span className="clients-kpi-strip__n">{kpi.enCours}</span> en cours ·{" "}
            <span className="clients-kpi-strip__n">{kpi.attenteMairie}</span>{" "}
            attente admin. ·{" "}
            <span className="clients-kpi-strip__n">{kpi.termines}</span> terminés
            {filtersActive ? (
              <span className="clients-kpi-strip__filter"> · filtres actifs</span>
            ) : null}
          </p>
        </div>
      </header>

      <div className="clients-page-filters-wrap">
        <ClientsFilters
          filters={filters}
          onFiltersChange={setFilters}
          users={users}
          onReset={resetFilters}
        />
      </div>

      {error ? (
        <p className="sn-leads-page__error sn-leads-page__error--inline">
          {error}
        </p>
      ) : null}

      <section
        className="sn-leads-page__main sn-leads-page__data-pane clients-page__split-main"
        aria-label="Portefeuille et détail dossier"
      >
        <div className={`clients-split-layout${selectedClientId ? " clients-split-layout--open" : ""}`}>
          <div className="clients-split-list-pane">
            <ClientsPortfolioList
              leads={leads}
              selectedId={selectedClientId}
              onSelect={(id) => setSelectedClientId(normalizeClientId(id))}
              onOpenFull={openFull}
            />
          </div>
          {selectedClientId && (
            <div className="clients-split-detail-pane">
              <ClientsDetailPanel
                lead={selectedLead}
                canArchive={canUpdateLead}
                canEditProjectStatus={canUpdateLead}
                onOpenFull={openFull}
                onArchive={handleArchiveLead}
                onLeadUpdated={handleLeadUpdated}
                onClose={() => setSelectedClientId(null)}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
