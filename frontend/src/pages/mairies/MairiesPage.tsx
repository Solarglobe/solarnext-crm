/**
 * Mairies / Portails DP — liste + création en overlay ; édition /mairies/:id.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { ModalShell } from "../../components/ui/ModalShell";
import { useMairiesPermissions } from "../../hooks/useMairiesPermissions";
import { useSuperAdminReadOnly } from "../../contexts/OrganizationContext";
import {
  fetchMairieById,
  createMairie,
  updateMairie,
  deleteMairie,
  type MairieAccountStatus,
  type MairieDto,
  type MairieWritePayload,
} from "../../services/mairies.api";
import { MairieForm, type MairieDuplicateDisplay } from "./MairieForm";
import {
  formatMairiePortalTypeLabel,
  formatMairieStatusBadgeText,
  getOpenPortalTooltip,
  isLastUsedWithinDays,
  resolveOpenHref,
  statusBadgeClass,
} from "./mairiesUi";
import { showMairieToast } from "./mairiesToast";
import { PAGE_LIMIT, useMairies } from "./hooks/useMairies";
import { useMairiesActions } from "./hooks/useMairiesActions";
import "./mairies-page.css";

const ROW_NAV_DELAY_MS = 260;

type Mode = "list" | "edit";

function routeMode(idParam: string | undefined): Mode {
  if (idParam) return "edit";
  return "list";
}

export default function MairiesPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const mode = routeMode(params.id);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalKey, setCreateModalKey] = useState(0);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createDuplicateInfo, setCreateDuplicateInfo] = useState<MairieDuplicateDisplay | null>(null);

  const { loading: permsLoading, canRead, canManage } = useMairiesPermissions();
  const superAdminReadOnly = useSuperAdminReadOnly();
  const canWrite = canManage && !superAdminReadOnly;

  const listMode = mode === "list";
  const {
    list,
    total,
    page,
    setPage,
    listLoading,
    listError,
    searchInput,
    setSearchInput,
    accountStatus,
    setAccountStatus,
    portalType,
    setPortalType,
    postalFilter,
    setPostalFilter,
    cityFilter,
    setCityFilter,
    loadList,
    patchRow,
    hasActiveFilters,
    resetFilters,
  } = useMairies(listMode);

  const { openPortalTab, patchAccountStatusInline } = useMairiesActions(patchRow);

  const [detail, setDetail] = useState<MairieDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<MairieDuplicateDisplay | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MairieDto | null>(null);

  const [busyStatusId, setBusyStatusId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const rowNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableKbRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editId = params.id;
    if (mode !== "edit" || !editId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setFormError(null);
      setDuplicateInfo(null);
      try {
        const row = await fetchMairieById(editId);
        if (!cancelled) setDetail(row);
      } catch (e) {
        if (!cancelled) {
          setFormError(e instanceof Error ? e.message : "Erreur");
          setDetail(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, params.id]);

  useEffect(() => {
    if (mode !== "list") {
      setCreateModalOpen(false);
    }
  }, [mode]);

  useEffect(() => {
    if (list.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((prev) => {
      if (prev < 0) return 0;
      return Math.min(prev, list.length - 1);
    });
  }, [list]);

  useEffect(() => {
    if (highlightedIndex < 0 || !tableKbRef.current) return;
    const tr = tableKbRef.current.querySelector(`tr[data-mairie-index="${highlightedIndex}"]`);
    tr?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlightedIndex]);

  const cancelScheduledRowNav = useCallback(() => {
    if (rowNavTimerRef.current != null) {
      clearTimeout(rowNavTimerRef.current);
      rowNavTimerRef.current = null;
    }
  }, []);

  const scheduleNavigateEdit = useCallback(
    (row: MairieDto) => {
      cancelScheduledRowNav();
      rowNavTimerRef.current = setTimeout(() => {
        rowNavTimerRef.current = null;
        navigate(`/mairies/${row.id}`);
      }, ROW_NAV_DELAY_MS);
    },
    [cancelScheduledRowNav, navigate]
  );

  const openCreateModal = useCallback(() => {
    setCreateModalKey((k) => k + 1);
    setCreateError(null);
    setCreateDuplicateInfo(null);
    setCreateModalOpen(true);
  }, []);

  const closeCreateModal = useCallback(() => {
    if (createSaving) return;
    setCreateModalOpen(false);
    setCreateError(null);
    setCreateDuplicateInfo(null);
  }, [createSaving]);

  const focusTableKb = useCallback(() => {
    tableKbRef.current?.focus({ preventScroll: true });
  }, []);

  const onTableKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (list.length === 0) return;

      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };

      if (e.key === "ArrowDown") {
        run(() => setHighlightedIndex((i) => Math.min(list.length - 1, i < 0 ? 0 : i + 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        run(() => setHighlightedIndex((i) => Math.max(0, i < 0 ? 0 : i - 1)));
        return;
      }

      const idx = highlightedIndex >= 0 ? highlightedIndex : 0;
      const row = list[idx];
      if (!row) return;

      if (e.key === "Enter") {
        const href = resolveOpenHref(row);
        if (!href) return;
        run(() => openPortalTab(row.id, href));
        return;
      }
      if (e.key === "e" || e.key === "E") {
        run(() => navigate(`/mairies/${row.id}`));
        return;
      }
      if ((e.key === "n" || e.key === "N") && canWrite) {
        run(openCreateModal);
      }
    },
    [list, highlightedIndex, openPortalTab, navigate, canWrite, openCreateModal]
  );

  const copyBitwardenRef = async (e: React.MouseEvent, ref: string) => {
    e.stopPropagation();
    cancelScheduledRowNav();
    try {
      await navigator.clipboard.writeText(ref);
      showMairieToast("Référence copiée", "ok");
    } catch {
      showMairieToast("Copie impossible", "err");
    }
  };

  const handleCreateSubmit = async (payload: MairieWritePayload) => {
    setCreateSaving(true);
    setCreateError(null);
    setCreateDuplicateInfo(null);
    try {
      await createMairie(payload);
      showMairieToast("Mairie créée", "ok");
      setCreateModalOpen(false);
      void loadList();
    } catch (e: unknown) {
      const err = e as Error & { status?: number; payload?: Record<string, unknown> };
      setCreateError(err.message || "Erreur");
      if (err.status === 409) {
        const p = err.payload ?? {};
        const code = String(p.code ?? "");
        if (code === "MAIRIE_ALREADY_EXISTS" || code === "DUPLICATE_MAIRIE" || String(p.legacy_code) === "DUPLICATE_MAIRIE") {
          const sug = p.suggestion as MairieDuplicateDisplay["suggestion"] | undefined;
          setCreateDuplicateInfo({ message: "Cette mairie existe déjà", suggestion: sug ?? null });
        }
      }
    } finally {
      setCreateSaving(false);
    }
  };

  const handleEditSubmit = async (payload: MairieWritePayload) => {
    if (!params.id) return;
    setFormSaving(true);
    setFormError(null);
    setDuplicateInfo(null);
    try {
      await updateMairie(params.id, payload);
      showMairieToast("Mairie mise à jour", "ok");
      navigate("/mairies");
    } catch (e: unknown) {
      const err = e as Error & { status?: number; payload?: Record<string, unknown> };
      setFormError(err.message || "Erreur");
      if (err.status === 409) {
        const p = err.payload ?? {};
        const code = String(p.code ?? "");
        if (code === "MAIRIE_ALREADY_EXISTS" || code === "DUPLICATE_MAIRIE") {
          const sug = p.suggestion as MairieDuplicateDisplay["suggestion"] | undefined;
          setDuplicateInfo({ message: "Cette mairie existe déjà", suggestion: sug ?? null });
        }
      }
    } finally {
      setFormSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMairie(deleteTarget.id);
      showMairieToast("Mairie supprimée", "ok");
      setDeleteTarget(null);
      void loadList();
    } catch (e) {
      showMairieToast(e instanceof Error ? e.message : "Erreur suppression", "err");
    }
  };

  const goList = () => {
    navigate("/mairies");
  };

  if (permsLoading) {
    return (
      <div className="mairies-page">
        <p className="qb-muted">Chargement…</p>
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="mairies-page">
        <Card variant="app">
          <p className="qb-error-inline">Vous n’avez pas accès au module Mairies.</p>
        </Card>
      </div>
    );
  }

  if (mode === "edit") {
    return (
      <div className="mairies-page">
        <Card variant="app" padding="lg">
          <MairieForm
            mode="edit"
            initial={detail}
            loading={detailLoading}
            saving={formSaving}
            canEdit={canWrite}
            error={formError}
            duplicateInfo={duplicateInfo}
            onSubmit={handleEditSubmit}
            onCancel={goList}
          />
        </Card>
      </div>
    );
  }

  const maxPage = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div className="mairies-page">
      <div className="mairies-page__hero">
        <div>
          <h1 className="mairies-page__title">Mairies / Portails DP</h1>
          <p className="qb-muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
            {total} mairie{total !== 1 ? "s" : ""} répertoriée{total !== 1 ? "s" : ""}
            <span className="mairies-page__kbd-hint" aria-hidden>
              {" "}
              · Tab puis ↑↓ Enter E
              {canWrite ? " N" : ""}
            </span>
          </p>
        </div>
        {canWrite ? (
          <Button type="button" variant="primary" onClick={openCreateModal}>
            + Ajouter une mairie
          </Button>
        ) : null}
      </div>

      <div className="mairies-page__filters" aria-label="Filtres mairies">
        <label>
          Recherche
          <input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            placeholder="Nom, ville, CP…"
            style={{ minWidth: 180 }}
          />
        </label>
        <label>
          Statut compte
          <select
            value={accountStatus}
            onChange={(e) => {
              setAccountStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous</option>
            <option value="none">Non créé</option>
            <option value="to_create">À créer</option>
            <option value="created">OK</option>
          </select>
        </label>
        <label>
          Type portail
          <select
            value={portalType}
            onChange={(e) => {
              setPortalType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous</option>
            <option value="online">Online</option>
            <option value="email">Email</option>
            <option value="paper">Papier</option>
          </select>
        </label>
        <label>
          Code postal
          <input
            value={postalFilter}
            onChange={(e) => {
              setPostalFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: 100 }}
          />
        </label>
        <label>
          Ville
          <input
            value={cityFilter}
            onChange={(e) => {
              setCityFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: 140 }}
          />
        </label>
        <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>
          Réinitialiser
        </Button>
      </div>

      {listError ? <p className="qb-error-inline">{listError}</p> : null}

      {listLoading && !listError ? (
        <div className="mairies-page__skeleton-wrap" aria-busy="true" aria-label="Chargement de la liste">
          <table className="qb-table qb-table--list-saas mairies-page__skeleton-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Ville</th>
                <th>CP</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Compte</th>
                <th className="qb-num">Leads</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j}>
                      <div
                        className="mairies-page__sk-line"
                        style={{ width: j === 7 ? "90%" : j === 0 ? "85%" : "70%" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!listLoading && !listError && list.length === 0 && hasActiveFilters ? (
        <Card variant="app" padding="lg">
          <p className="mairies-page__empty-title">Aucune mairie ne correspond aux filtres.</p>
          <p className="qb-muted" style={{ marginTop: 8, fontSize: 14 }}>
            Élargissez la recherche ou réinitialisez les filtres.
          </p>
        </Card>
      ) : null}

      {!listLoading && !listError && list.length === 0 && !hasActiveFilters ? (
        <Card variant="app" padding="lg" className="mairies-page__empty-card">
          <h2 className="mairies-page__empty-title">Aucune mairie enregistrée</h2>
          <p className="qb-muted" style={{ marginTop: 8, marginBottom: 20, fontSize: 15, maxWidth: 420 }}>
            Ajoutez votre première mairie pour éviter de recréer des comptes
          </p>
          {canWrite ? (
            <Button type="button" variant="primary" size="lg" onClick={openCreateModal}>
              + Ajouter une mairie
            </Button>
          ) : null}
        </Card>
      ) : null}

      {!listLoading && list.length > 0 ? (
        <div
          ref={tableKbRef}
          className="mairies-page__table-kb"
          tabIndex={0}
          role="region"
          aria-label="Liste des mairies — raccourcis : flèches, Entrée pour ouvrir le portail, E éditer"
          onKeyDown={onTableKeyDown}
        >
          <div className="mairies-page__table-wrap qb-table-wrap qb-table-wrap--list-saas">
            <table className="qb-table qb-table--list-saas">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Ville</th>
                  <th>CP</th>
                  <th>Type</th>
                  <th>Statut</th>
                  <th>Compte</th>
                  <th className="qb-num">Leads</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody
                onMouseDown={(e) => {
                  const t = e.target as HTMLElement;
                  if (t.closest("button, a, input, select, textarea")) return;
                  focusTableKb();
                  const tr = t.closest("tr[data-mairie-index]");
                  const ix = tr?.getAttribute("data-mairie-index");
                  if (ix != null) setHighlightedIndex(parseInt(ix, 10));
                }}
              >
                {list.map((row, index) => {
                  const openHref = resolveOpenHref(row);
                  const kbdActive = highlightedIndex === index;
                  return (
                    <tr
                      key={row.id}
                      data-mairie-index={index}
                      className={
                        "mairies-page__row-click" + (kbdActive ? " mairies-page__row--kbd" : "")
                      }
                      onClick={() => scheduleNavigateEdit(row)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        cancelScheduledRowNav();
                        if (!openHref) return;
                        openPortalTab(row.id, openHref);
                      }}
                    >
                      <td>
                        <span className="mairies-page__name-cell">
                          {isLastUsedWithinDays(row.last_used_at, 7) ? (
                            <span
                              className="mairie-recent-dot"
                              title="Utilisé dans les 7 derniers jours"
                              aria-label="Récent"
                            />
                          ) : null}
                          <span>{row.name}</span>
                        </span>
                      </td>
                      <td>{row.city ?? "—"}</td>
                      <td className="mairies-page__cp-cell">{row.postal_code}</td>
                      <td>{formatMairiePortalTypeLabel(row.portal_type)}</td>
                      <td onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                        {canWrite ? (
                          <select
                            className="mairies-page__status-inline"
                            aria-label={`Statut ${row.name}`}
                            value={row.account_status}
                            disabled={busyStatusId === row.id}
                            onChange={async (e) => {
                              const v = e.target.value as MairieAccountStatus;
                              setBusyStatusId(row.id);
                              try {
                                await patchAccountStatusInline(row, v);
                              } finally {
                                setBusyStatusId(null);
                              }
                            }}
                          >
                            <option value="none">Non créé</option>
                            <option value="to_create">À créer</option>
                            <option value="created">OK</option>
                          </select>
                        ) : (
                          <span className={statusBadgeClass(row.account_status)}>
                            {formatMairieStatusBadgeText(row.account_status)}
                          </span>
                        )}
                      </td>
                      <td style={{ maxWidth: 220, wordBreak: "break-all" }}>
                        <div className="mairies-page__compte-cell">
                          <span>{row.account_email ?? "—"}</span>
                          {row.bitwarden_ref?.trim() ? (
                            <button
                              type="button"
                              className="mairies-page__bw-copy"
                              title="Copier la référence Bitwarden"
                              aria-label="Copier la référence Bitwarden"
                              onClick={(e) => copyBitwardenRef(e, row.bitwarden_ref!.trim())}
                            >
                              📋
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="qb-num">
                        {(row.linked_leads_count ?? 0) > 0 ? (
                          <span className="mairie-leads-badge" title="Leads liés à cette mairie">
                            {row.linked_leads_count ?? 0}
                          </span>
                        ) : (
                          <span className="qb-muted">0</span>
                        )}
                      </td>
                      <td className="mairies-page__actions-cell">
                        <div className="mairies-page__actions-row">
                          {openHref ? (
                            <button
                              type="button"
                              className="mairies-page__open-portal-btn"
                              title={getOpenPortalTooltip(openHref)}
                              aria-label={getOpenPortalTooltip(openHref)}
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelScheduledRowNav();
                                openPortalTab(row.id, openHref);
                              }}
                            >
                              <span className="mairies-page__open-icon" aria-hidden>
                                →
                              </span>
                              Ouvrir
                            </button>
                          ) : (
                            <span className="qb-muted" style={{ fontSize: 13 }}>
                              —
                            </span>
                          )}
                          {canWrite ? (
                            <button
                              type="button"
                              className="mairies-page__action-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelScheduledRowNav();
                                navigate(`/mairies/${row.id}`);
                              }}
                            >
                              Modifier
                            </button>
                          ) : null}
                          {canWrite ? (
                            <button
                              type="button"
                              className="mairies-page__action-link mairies-page__action-link--danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelScheduledRowNav();
                                setDeleteTarget(row);
                              }}
                            >
                              Supprimer
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {total > PAGE_LIMIT ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Précédent
          </Button>
          <span className="qb-muted" style={{ fontSize: 14 }}>
            Page {page} / {maxPage}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= maxPage}
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          >
            Suivant
          </Button>
        </div>
      ) : null}

      <ModalShell
        open={createModalOpen}
        onClose={closeCreateModal}
        title="Nouvelle mairie"
        subtitle="Portail déclaration préalable — évitez les doublons de comptes."
        size="lg"
        closeOnBackdropClick={!createSaving}
      >
        <MairieForm
          key={createModalKey}
          mode="create"
          variant="modal"
          initial={null}
          loading={false}
          saving={createSaving}
          canEdit={canWrite}
          error={createError}
          duplicateInfo={createDuplicateInfo}
          onSubmit={handleCreateSubmit}
          onCancel={closeCreateModal}
        />
      </ModalShell>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Supprimer cette mairie ?"
        message={
          deleteTarget
            ? `Les leads liés restent actifs. Le lien vers cette mairie sera retiré sur les dossiers concernés (${deleteTarget.name}).`
            : ""
        }
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
