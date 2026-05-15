/**
 * Page Leads — shell outil unifié (Kanban + liste : même viewport, même zone données)
 */

import { useEffect, useState, useCallback } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { LeadsKanbanView } from "../components/leads/LeadsKanbanView";
import {
  LeadsListView,
  leadsListColumnToApiSort,
  apiSortToLeadsListColumn,
  type LeadsListSortColumn,
} from "../components/leads/LeadsListView";
import { LeadFilters } from "../components/leads/LeadFilters";
import { BulkEmailModal } from "../components/leads/BulkEmailModal";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import {
  fetchLeadsWithTotal,
  fetchKanban,
  fetchLeadsMeta,
  archiveLead,
  unarchiveLead,
  isLeadArchivedRecord,
  type Lead,
  type LeadsFilters,
  type LeadsMeta,
  type KanbanFetchFilters,
} from "../services/leads.service";
import { getUserPermissions } from "../services/auth.service";
import { useSuperAdminReadOnly } from "../contexts/OrganizationContext";

function kanbanQueryFromFilters(f: LeadsFilters): KanbanFetchFilters {
  return {
    search: f.search,
    stage: f.stage,
    assigned_to: f.assigned_to,
  };
}

type ViewMode = "kanban" | "list";

const LEADS_VIEW_STORAGE_KEY = "leads_view_mode";
const LEADS_FILTERS_STORAGE_KEY = "solarnext_leads_filters_v1";

function readStoredLeadsFilters(): LeadsFilters {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LEADS_FILTERS_STORAGE_KEY);
    if (!raw) return { archive_scope: "active" };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { archive_scope: "active" };
    }
    const f = { ...(parsed as LeadsFilters) };
    if (f.include_archived === true && !f.archive_scope) {
      f.archive_scope = "all";
      delete f.include_archived;
    }
    if (!f.archive_scope) f.archive_scope = "active";
    if (f.page == null || f.page < 1) f.page = 1;
    if (f.limit == null || f.limit < 1) f.limit = 25;
    if (!f.sort) f.sort = "updated_at";
    if (!f.order) f.order = "desc";
    return f;
  } catch {
    return {
      archive_scope: "active",
      page: 1,
      limit: 25,
      sort: "updated_at",
      order: "desc",
    };
  }
}

function readStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "list";
  try {
    const raw = localStorage.getItem(LEADS_VIEW_STORAGE_KEY);
    if (raw === "kanban" || raw === "list") return raw;
  } catch {
    /* ignore */
  }
  return "list";
}

export default function LeadsPage() {
  const superAdminReadOnly = useSuperAdminReadOnly();
  const [viewMode, setViewMode] = useState<ViewMode>(() => readStoredViewMode());

  useEffect(() => {
    try {
      localStorage.setItem(LEADS_VIEW_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [meta, setMeta] = useState<LeadsMeta | null>(null);
  const [filters, setFilters] = useState<LeadsFilters>(() => readStoredLeadsFilters());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canUpdateLead, setCanUpdateLead] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState<string[] | null>(null);
  const [canBulkEmail, setCanBulkEmail] = useState(false);
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    getUserPermissions()
      .then((p) => {
        const perms = p.permissions ?? [];
        const star = perms.includes("*");
        setCanUpdateLead(
          star ||
            perms.includes("lead.update.all") ||
            perms.includes("lead.update.self")
        );
        setCanBulkEmail(
          (star || perms.includes("org.settings.manage")) && (star || perms.includes("mail.use"))
        );
      })
      .catch(() => {
        setCanUpdateLead(false);
        setCanBulkEmail(false);
      });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LEADS_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  const resetFilters = useCallback(() => {
    setFilters({
      archive_scope: "active",
      page: 1,
      limit: 25,
      sort: "updated_at",
      order: "desc",
    });
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (viewMode === "kanban") {
        const [columns, metaData] = await Promise.all([
          fetchKanban(kanbanQueryFromFilters(filters)),
          fetchLeadsMeta(),
        ]);
        setMeta(metaData);
        const allLeads = columns.flatMap((c) => c.leads);
        setLeads(allLeads);
      } else {
        const listFilters: LeadsFilters = {
          ...filters,
          view: "leads",
          page: filters.page ?? 1,
          limit: filters.limit ?? 25,
        };
        const [pageRes, metaData] = await Promise.all([
          fetchLeadsWithTotal(listFilters),
          fetchLeadsMeta(),
        ]);
        const limitNum = listFilters.limit ?? 25;
        let pageToUse = Math.max(1, listFilters.page ?? 1);
        let pack = pageRes;
        const maxPage = Math.max(1, Math.ceil(pack.total / limitNum));
        if (pageToUse > maxPage) {
          pageToUse = maxPage;
          pack = await fetchLeadsWithTotal({ ...listFilters, page: pageToUse, limit: limitNum });
        }
        setLeads(pack.leads);
        setLeadsTotal(pack.total);
        setMeta(metaData);
        if (pageToUse !== (listFilters.page ?? 1)) {
          setFilters((prev) => ({ ...prev, page: pageToUse }));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [viewMode, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const ids = new Set(leads.map((l) => String(l.id)));
    setSelectedIds((prev) => prev.filter((id) => ids.has(id)));
  }, [leads]);

  const toggleBulkSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const s = String(id);
      if (prev.includes(s)) return prev.filter((x) => x !== s);
      return [...prev, s];
    });
  }, []);

  const selectAllOnPage = useCallback(() => {
    const pageIds = leads.map((l) => String(l.id));
    setSelectedIds((prev) => {
      const set = new Set(prev);
      const allOnPage = pageIds.length > 0 && pageIds.every((id) => set.has(id));
      if (allOnPage) {
        pageIds.forEach((id) => set.delete(id));
      } else {
        pageIds.forEach((id) => set.add(id));
      }
      return Array.from(set);
    });
  }, [leads]);

  const clearBulkSelection = useCallback(() => setSelectedIds([]), []);

  const handleListSortChange = useCallback((col: LeadsListSortColumn) => {
    const nextApi = leadsListColumnToApiSort(col);
    setFilters((prev) => {
      const prevCol = apiSortToLeadsListColumn(prev.sort);
      let order: "asc" | "desc" = "desc";
      if (prevCol === col) {
        order = prev.order === "desc" ? "asc" : "desc";
      }
      return { ...prev, sort: nextApi, order, page: 1 };
    });
  }, []);

  const handleListPageChange = useCallback((p: number) => {
    setFilters((prev) => ({ ...prev, page: Math.max(1, p) }));
  }, []);

  const handleListPageSizeChange = useCallback((size: number) => {
    setFilters((prev) => ({ ...prev, limit: size, page: 1 }));
  }, []);

  const handleRequestEmailForLead = useCallback((leadId: string) => {
    setSelectedIds([String(leadId)]);
    setBulkEmailOpen(true);
  }, []);

  const handleBulkArchive = useCallback(() => {
    if (!canUpdateLead || selectedIds.length === 0) return;
    const toArchive = selectedIds.filter((id) => {
      const lead = leads.find((l) => String(l.id) === String(id));
      return Boolean(lead && !isLeadArchivedRecord(lead));
    });
    if (toArchive.length === 0) return;
    setArchiveDialog(toArchive);
  }, [canUpdateLead, selectedIds, leads]);

  const requestArchiveLeads = useCallback((leadIds: string[]) => {
    if (leadIds.length === 0) return;
    setArchiveDialog(leadIds);
  }, []);

  const confirmArchiveDialog = useCallback(async () => {
    if (!archiveDialog?.length) return;
    setError(null);
    try {
      for (const id of archiveDialog) {
        await archiveLead(id);
      }
      setArchiveDialog(null);
      await loadData();
      clearBulkSelection();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }, [archiveDialog, loadData, clearBulkSelection]);

  const handleBulkUnarchive = useCallback(async () => {
    if (!canUpdateLead || selectedIds.length === 0) return;
    const toRestore = selectedIds.filter((id) => {
      const lead = leads.find((l) => String(l.id) === String(id));
      return Boolean(lead && isLeadArchivedRecord(lead));
    });
    if (toRestore.length === 0) return;
    if (!window.confirm(`Restaurer ${toRestore.length} dossier(s) ?`)) return;
    setError(null);
    try {
      for (const id of toRestore) {
        await unarchiveLead(id);
      }
      await loadData();
      clearBulkSelection();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }, [canUpdateLead, selectedIds, leads, loadData, clearBulkSelection]);

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
        <div className="sn-leads-header-actions">
          <div
            className="sn-leads-view-toggle"
            role="group"
            aria-label="Mode d'affichage"
          >
            <Button
              variant={viewMode === "list" ? "primary" : "ghost"}
              size="sm"
              type="button"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              Liste
            </Button>
            <Button
              variant={viewMode === "kanban" ? "primary" : "ghost"}
              size="sm"
              type="button"
              aria-pressed={viewMode === "kanban"}
              onClick={() => setViewMode("kanban")}
            >
              Kanban
            </Button>
          </div>
        </div>
      </header>

      <LeadFilters
        filters={filters}
        onFiltersChange={setFilters}
        stages={stages}
        users={meta?.users ?? []}
        sources={meta?.sources ?? []}
        showArchivedToggle={viewMode === "list"}
        showSegmentationFilters={viewMode === "list"}
        resultCount={viewMode === "list" ? leadsTotal : undefined}
        onReset={resetFilters}
      />

      <BulkEmailModal
        open={bulkEmailOpen}
        onClose={() => setBulkEmailOpen(false)}
        filters={filters}
        selectedLeadIds={selectedIds.length > 0 ? selectedIds : null}
      />

      <section
        className="sn-leads-page__main sn-leads-page__data-pane"
        aria-label="Contenu leads"
      >
        <div key={viewMode} className="sn-leads-page__view-root">
          {viewMode === "kanban" ? (
            <LeadsKanbanView
              leads={leads}
              stages={stages}
              readOnly={superAdminReadOnly}
              onLeadMoved={handleLeadMoved}
              onArchiveLead={
                superAdminReadOnly || !canUpdateLead
                  ? undefined
                  : (id) => requestArchiveLeads([id])
              }
            />
          ) : (
            <LeadsListView
              leads={leads}
              onUnarchive={superAdminReadOnly ? undefined : handleUnarchiveLead}
              onArchive={
                superAdminReadOnly || !canUpdateLead
                  ? undefined
                  : (id) => requestArchiveLeads([id])
              }
              canArchive={canUpdateLead}
              selectedIds={selectedIds}
              onToggleBulkSelect={toggleBulkSelect}
              onSelectAllOnPage={selectAllOnPage}
              onResetFilters={resetFilters}
              sortColumn={apiSortToLeadsListColumn(filters.sort)}
              sortOrder={filters.order === "asc" ? "asc" : "desc"}
              onSortChange={handleListSortChange}
              page={filters.page ?? 1}
              pageSize={filters.limit ?? 25}
              totalCount={leadsTotal}
              onPageChange={handleListPageChange}
              onPageSizeChange={handleListPageSizeChange}
              canBulkEmail={canBulkEmail}
              onRequestEmailForLead={
                superAdminReadOnly || !canBulkEmail ? undefined : handleRequestEmailForLead
              }
            />
          )}
        </div>
      </section>

      {viewMode === "list" && !superAdminReadOnly && selectedIds.length > 0 ? (
        <div
          className="sn-bulk-selection-bar sn-bulk-selection-bar--floating"
          role="region"
          aria-label="Actions sur la sélection"
        >
          <div className="sn-bulk-selection-bar__inner">
            <p className="sn-bulk-selection-bar__count-line">
              {selectedIds.length === 1 ? (
                <>1 lead sélectionné</>
              ) : (
                <>{selectedIds.length} leads sélectionnés</>
              )}
            </p>
            <div className="sn-bulk-selection-bar__actions">
              <Button type="button" variant="ghost" size="sm" onClick={clearBulkSelection}>
                Effacer la sélection
              </Button>
              {canUpdateLead ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleBulkArchive}
                  >
                    Archiver
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleBulkUnarchive()}
                  >
                    Restaurer
                  </Button>
                </>
              ) : null}
              {canBulkEmail ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setBulkEmailOpen(true)}
                >
                  Envoyer un email
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={archiveDialog !== null && archiveDialog.length > 0}
        title={
          archiveDialog && archiveDialog.length === 1
            ? "Archiver ce lead ?"
            : `Archiver ${archiveDialog?.length ?? 0} dossiers ?`
        }
        message={
          archiveDialog && archiveDialog.length === 1
            ? "Le lead sera retiré des actifs mais restera accessible dans les archives."
            : "Les dossiers sélectionnés seront retirés des actifs mais resteront accessibles dans les archives."
        }
        confirmLabel="Archiver"
        cancelLabel="Annuler"
        variant="default"
        onCancel={() => setArchiveDialog(null)}
        onConfirm={() => void confirmArchiveDialog()}
      />
    </div>
  );
}
