/**
 * Page Leads — shell outil unifié (Kanban + liste : même viewport, même zone données)
 */

import React, { useEffect, useState, useCallback } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { LeadsKanbanView } from "../components/leads/LeadsKanbanView";
import { LeadsListView } from "../components/leads/LeadsListView";
import { LeadFilters } from "../components/leads/LeadFilters";
import {
  fetchLeads,
  fetchKanban,
  fetchLeadsMeta,
  archiveLead,
  unarchiveLead,
  deleteLead,
  type Lead,
  type LeadsFilters,
  type LeadsMeta,
  type KanbanFetchFilters,
} from "../services/leads.service";
import { getUserPermissions } from "../services/auth.service";

function kanbanQueryFromFilters(f: LeadsFilters): KanbanFetchFilters {
  return {
    search: f.search,
    stage: f.stage,
    assigned_to: f.assigned_to,
  };
}

type ViewMode = "kanban" | "list";

export default function LeadsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [meta, setMeta] = useState<LeadsMeta | null>(null);
  const [filters, setFilters] = useState<LeadsFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canDeleteLead, setCanDeleteLead] = useState(false);

  useEffect(() => {
    getUserPermissions()
      .then((p) => setCanDeleteLead(p.permissions?.includes("lead.delete") ?? false))
      .catch(() => setCanDeleteLead(false));
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (viewMode === "kanban") {
        const [columns, metaData] = await Promise.all([
          fetchKanban(),
          fetchLeadsMeta(),
        ]);
        setMeta(metaData);
        const allLeads = columns.flatMap((c) => c.leads);
        setLeads(allLeads);
      } else {
        const [leadsData, metaData] = await Promise.all([
          fetchLeads({ ...filters, view: "leads" }),
          fetchLeadsMeta(),
        ]);
        setLeads(leadsData);
        setMeta(metaData);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [
    viewMode,
    filters.search,
    filters.stage,
    filters.assigned_to,
    filters.date_from,
    filters.date_to,
    filters.include_archived,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleArchiveLead = useCallback(
    async (leadId: string) => {
      if (!window.confirm("Archiver ce lead ?")) return;
      setError(null);
      try {
        await archiveLead(leadId);
        await loadData();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    },
    [loadData]
  );

  const handleUnarchiveLead = useCallback(
    async (leadId: string) => {
      if (!window.confirm("Restaurer ce lead dans le pipeline ?")) return;
      setError(null);
      try {
        await unarchiveLead(leadId);
        await loadData();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    },
    [loadData]
  );

  const handleDeleteLead = useCallback(
    async (leadId: string) => {
      if (
        !window.confirm(
          "Supprimer définitivement ce lead ? Cette action est irréversible."
        )
      ) {
        return;
      }
      setError(null);
      try {
        await deleteLead(leadId);
        await loadData();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    },
    [loadData]
  );

  const handleLeadMoved = useCallback(
    async (leadId: string, newStageId: string) => {
      setLeads((prev) =>
        prev.map((l) =>
          l.id === leadId ? { ...l, stage_id: newStageId } : l
        )
      );
      if (viewMode !== "kanban") return;
      try {
        const columns = await fetchKanban(kanbanQueryFromFilters(filters));
        setLeads(columns.flatMap((c) => c.leads));
      } catch {
        /* garde l’état optimiste */
      }
    },
    [viewMode, filters]
  );

  if (loading && !leads.length) {
    return (
      <div className="sn-leads-page">
        <Card padding="lg" variant="default" className="sn-leads-page__loading-card">
          <div className="sn-leads-page__hero">
            <h1 className="sn-leads-page__title">Leads</h1>
            <p className="sn-leads-page__subtitle">
              Chargement du pipeline…
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
            <h1 className="sn-leads-page__title">Leads</h1>
            <p className="sn-leads-page__error">{error}</p>
          </div>
        </Card>
      </div>
    );
  }

  const stages = meta?.stages ?? [];

  return (
    <div className="sn-leads-page sn-leads-page--shell">
      <header className="sn-leads-page__header sn-leads-page__header--compact">
        <div className="sn-leads-page__title-block">
          <h1 className="sn-leads-page__title">Leads</h1>
          <span className="sn-leads-page__subtitle-inline">
            Pipeline commercial
          </span>
        </div>
        <div
          className="sn-leads-view-toggle"
          role="group"
          aria-label="Mode d'affichage"
        >
          <Button
            variant={viewMode === "kanban" ? "primary" : "ghost"}
            size="sm"
            type="button"
            aria-pressed={viewMode === "kanban"}
            onClick={() => setViewMode("kanban")}
          >
            Kanban
          </Button>
          <Button
            variant={viewMode === "list" ? "primary" : "ghost"}
            size="sm"
            type="button"
            aria-pressed={viewMode === "list"}
            onClick={() => setViewMode("list")}
          >
            Liste
          </Button>
        </div>
      </header>

      <LeadFilters
        filters={filters}
        onFiltersChange={setFilters}
        stages={stages}
        users={meta?.users ?? []}
        showArchivedToggle={viewMode === "list"}
      />

      <section
        className="sn-leads-page__main sn-leads-page__data-pane"
        aria-label="Contenu leads"
      >
        {viewMode === "kanban" ? (
          <LeadsKanbanView
            leads={leads}
            stages={stages}
            onLeadMoved={handleLeadMoved}
            onArchiveLead={handleArchiveLead}
            onDeleteLead={handleDeleteLead}
            canDeleteLead={canDeleteLead}
          />
        ) : (
          <LeadsListView
            leads={leads}
            onUnarchive={handleUnarchiveLead}
            onDelete={handleDeleteLead}
            canDelete={canDeleteLead}
          />
        )}
      </section>
    </div>
  );
}
