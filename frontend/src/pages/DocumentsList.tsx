/**
 * Document Center — vue globale des documents organisation (GET /api/documents).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, getAuthToken } from "../services/api";
import { getCrmApiBase } from "../config/crmApiBase";
import {
  fetchOrganizationDocuments,
  type OrganizationDocumentListItem,
} from "../services/documentsList.api";
import type { MailComposerInitialPrefill } from "./mail/MailComposer";
import { assertDocumentDownloadOk } from "../utils/documentDownload";
import "./documents-page.css";

const PAGE_SIZE = 50;

const CATEGORY_LABELS: Record<string, string> = {
  QUOTE: "Devis",
  INVOICE: "Facture",
  COMMERCIAL_PROPOSAL: "Proposition commerciale",
  DP: "Déclaration préalable",
  DP_MAIRIE: "DP Mairie",
  ADMINISTRATIVE: "Contrat / administratif",
  OTHER: "Autre",
};

const TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all",     label: "Tous" },
  { value: "quote",   label: "Devis" },
  { value: "invoice", label: "Factures" },
  { value: "study",   label: "Propositions" },
  { value: "dp",      label: "DP" },
  { value: "admin",   label: "Contrats" },
  { value: "other",   label: "Autre" },
];

/** Maps document to dp-{key} CSS modifier */
function resolveTypeKey(doc: OrganizationDocumentListItem): string {
  const cat = doc.documentCategory ?? doc.document_category ?? "";
  const dt  = (doc.document_type || "").toLowerCase();
  if (cat === "QUOTE"    || dt.startsWith("quote"))                                               return "devis";
  if (cat === "INVOICE"  || dt.includes("invoice") || doc.entity_type === "invoice")             return "facture";
  if (cat === "COMMERCIAL_PROPOSAL" || dt.includes("study") ||
      doc.entity_type === "study"   || doc.entity_type === "study_version")                       return "proposal";
  if (cat === "DP" || cat === "DP_MAIRIE" || dt === "dp_pdf" || dt.includes("dp"))               return "dp";
  if (cat === "ADMINISTRATIVE")                                                                    return "admin";
  return "other";
}

function apiBase(): string {
  const b = getCrmApiBase();
  return b ? b.replace(/\/$/, "") : "";
}

function formatDocDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch { return "—"; }
}

function resolveDisplayName(doc: OrganizationDocumentListItem): string {
  const dn = doc.displayName ?? doc.display_name;
  if (dn?.trim()) return dn.trim();
  return doc.file_name || "—";
}

function resolveTypeLabel(doc: OrganizationDocumentListItem): string {
  const cat = doc.documentCategory ?? doc.document_category;
  if (cat && CATEGORY_LABELS[cat]) return CATEGORY_LABELS[cat];
  const dt = (doc.document_type || "").toLowerCase();
  if (dt.startsWith("quote"))                                                    return "Devis";
  if (dt.includes("invoice") || doc.entity_type === "invoice")                  return "Facture";
  if (dt.includes("study") || doc.entity_type === "study" ||
      doc.entity_type === "study_version")                                       return "Proposition";
  if (dt === "dp_pdf" || dt.includes("dp"))                                      return "DP";
  if (doc.document_type) return doc.document_type;
  return "—";
}

function resolveContactCell(doc: OrganizationDocumentListItem): string {
  if (doc.lead_name?.trim())   return doc.lead_name.trim();
  if (doc.client_name?.trim()) return doc.client_name.trim();
  return "—";
}

/* ── SVG icons ─────────────────────────────────────────────────────────────── */
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

const IconReset = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
  </svg>
);

const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const IconSend = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const IconExternalLink = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

const IconSpinner = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

const IconAlert = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

const IconDocFile = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
    <polyline points="13 2 13 9 20 9"/>
  </svg>
);

function DocTypeIcon({ typeKey }: { typeKey: string }) {
  switch (typeKey) {
    case "devis":
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
      </svg>;
    case "facture":
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
      </svg>;
    case "proposal":
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>;
    case "dp":
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="12" x2="15" y2="12"/>
        <line x1="9" y1="15" x2="11" y2="15"/>
      </svg>;
    case "admin":
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>;
    default:
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>;
  }
}

/* ── Skeleton rows ─────────────────────────────────────────────────────────── */
function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="dp-skeleton-row">
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div className="dp-skel dp-skel--icon" />
            <div>
              <div className="dp-skel dp-skel--name" />
              <div className="dp-skel dp-skel--sub" />
            </div>
          </div>
          <div className="dp-skel dp-skel--badge" />
          <div className="dp-skel dp-skel--contact" />
          <div className="dp-skel dp-skel--date" />
          <div className="dp-skel dp-skel--acts" />
        </div>
      ))}
    </>
  );
}

/* ── Main component ────────────────────────────────────────────────────────── */
export default function DocumentsList() {
  const navigate = useNavigate();
  const [items,        setItems]        = useState<OrganizationDocumentListItem[]>([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [searchInput,  setSearchInput]  = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter,   setTypeFilter]   = useState("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  /* debounce search */
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  /* fetch on filter change */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      setLoading(true);
      try {
        const res = await fetchOrganizationDocuments({
          search: debouncedSearch || undefined,
          type: typeFilter,
          limit: PAGE_SIZE,
          offset: 0,
        });
        if (cancelled) return;
        const docs = Array.isArray(res.documents) ? res.documents : [];
        setTotal(typeof res.total === "number" ? res.total : docs.length);
        setItems(docs);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erreur de chargement");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch, typeFilter]);

  const listItems = items ?? [];
  const hasMore   = listItems.length < total;

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetchOrganizationDocuments({
        search: debouncedSearch || undefined,
        type: typeFilter,
        limit: PAGE_SIZE,
        offset: items.length,
      });
      const docs = Array.isArray(res.documents) ? res.documents : [];
      if (typeof res.total === "number") setTotal(res.total);
      setItems((prev) => [...prev, ...docs]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedSearch, typeFilter, items.length, hasMore, loadingMore]);

  const handleSendDocument = useCallback((doc: OrganizationDocumentListItem) => {
    const fileName = doc.file_name?.trim() || resolveDisplayName(doc);
    const prefill: MailComposerInitialPrefill = {
      crmLeadId:   doc.lead_id || null,
      crmClientId: doc.entity_type === "client" ? doc.entity_id : null,
      subject:     `Document : ${resolveDisplayName(doc)}`,
      documents:   [{ id: doc.id, filename: fileName }],
    };
    navigate("/mail", { state: { mailComposePrefill: prefill } });
  }, [navigate]);

  const handleDownload = useCallback(async (doc: OrganizationDocumentListItem) => {
    if (!getAuthToken()) return;
    setDownloadingId(doc.id);
    setError(null);
    try {
      const url  = `${apiBase()}/api/documents/${encodeURIComponent(doc.id)}/download`;
      const res  = await apiFetch(url);
      assertDocumentDownloadOk(res, doc.id);
      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = href;
      a.download = resolveDisplayName(doc);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Téléchargement impossible");
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const resetFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setTypeFilter("all");
  }, []);

  const hasActiveFilters = debouncedSearch !== "" || typeFilter !== "all";

  const countLabel = useMemo(() => {
    if (loading || error) return null;
    return `${total} document${total !== 1 ? "s" : ""}`;
  }, [loading, error, total]);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="dp-page">

      {/* Header */}
      <div className="dp-header">
        <div className="dp-header__left">
          <h1 className="dp-title">Documents</h1>
          <p className="dp-subtitle">Tous les documents de l&apos;organisation</p>
          {countLabel && (
            <span className="dp-count-badge">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
              {countLabel}
            </span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="dp-toolbar">
        <div className="dp-search-wrap">
          <span className="dp-search-icon"><IconSearch /></span>
          <input
            type="search"
            className="dp-search"
            placeholder="Rechercher un document, contact…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Rechercher un document"
          />
        </div>

        <div className="dp-filters">
          {TYPE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`dp-chip${typeFilter === opt.value ? " dp-chip--active" : ""}`}
              onClick={() => setTypeFilter(opt.value)}
            >
              {typeFilter === opt.value && opt.value !== "all" && (
                <span className="dp-chip__dot" />
              )}
              {opt.label}
            </button>
          ))}
        </div>

        {hasActiveFilters && (
          <button type="button" className="dp-reset" onClick={resetFilters}>
            <IconReset />
            Réinitialiser
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="dp-error" role="alert">
          <IconAlert />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="dp-table-wrap">

        {/* Column header */}
        <div className="dp-thead">
          <span className="dp-th">Document</span>
          <span className="dp-th">Type</span>
          <span className="dp-th">Lead / Client</span>
          <span className="dp-th">Date</span>
          <span className="dp-th dp-th--right">Actions</span>
        </div>

        {/* Loading skeleton */}
        {loading && <SkeletonRows />}

        {/* Empty state */}
        {!loading && !error && listItems.length === 0 && (
          <div className="dp-empty">
            <div className="dp-empty__icon"><IconDocFile /></div>
            <p className="dp-empty__title">Aucun document trouvé</p>
            <p className="dp-empty__sub">
              {hasActiveFilters
                ? "Essayez de modifier vos filtres ou votre recherche."
                : "Les documents générés depuis vos études et devis apparaîtront ici."}
            </p>
          </div>
        )}

        {/* Data rows */}
        {!loading && listItems.map((doc) => {
          const typeKey        = resolveTypeKey(doc);
          const displayName    = resolveDisplayName(doc);
          const isDownloading  = downloadingId === doc.id;
          const isClientVisible = doc.is_visible_to_client || doc.isClientVisible;

          return (
            <div key={doc.id} className="dp-row">

              {/* Doc cell */}
              <div className="dp-doc-cell">
                <div className={`dp-doc-icon dp-doc-icon--${typeKey}`}>
                  <DocTypeIcon typeKey={typeKey} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="dp-doc-name">
                    {displayName}
                    {isClientVisible && (
                      <span className="dp-client-dot" title="Visible client" />
                    )}
                  </div>
                  {doc.file_name && doc.file_name !== displayName && (
                    <div className="dp-doc-filename">{doc.file_name}</div>
                  )}
                </div>
              </div>

              {/* Type badge */}
              <span className={`dp-badge dp-badge--${typeKey}`}>
                {resolveTypeLabel(doc)}
              </span>

              {/* Contact */}
              <span className="dp-contact">{resolveContactCell(doc)}</span>

              {/* Date */}
              <span className="dp-date">{formatDocDate(doc.created_at)}</span>

              {/* Actions */}
              <div className="dp-actions">
                <button
                  type="button"
                  className={`dp-action-btn${isDownloading ? " dp-action-btn--spin" : ""}`}
                  title="Télécharger"
                  disabled={isDownloading}
                  onClick={() => void handleDownload(doc)}
                >
                  {isDownloading ? <IconSpinner /> : <IconDownload />}
                </button>
                <button
                  type="button"
                  className="dp-action-btn"
                  title="Envoyer par email"
                  onClick={() => handleSendDocument(doc)}
                >
                  <IconSend />
                </button>
                {doc.lead_id && (
                  <Link
                    className="dp-action-btn"
                    to={`/leads/${doc.lead_id}`}
                    title="Ouvrir le lead"
                  >
                    <IconExternalLink />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Load more */}
      {hasMore && !loading && (
        <div className="dp-footer">
          <button
            type="button"
            className="dp-action-btn"
            style={{
              width: "auto",
              padding: "0 20px",
              height: 36,
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "inherit",
              gap: 6,
              display: "inline-flex",
              alignItems: "center",
            }}
            disabled={loadingMore}
            onClick={() => void handleLoadMore()}
          >
            {loadingMore && <span className="dp-action-btn--spin" style={{ display: "inline-flex" }}><IconSpinner /></span>}
            {loadingMore ? "Chargement…" : `Charger plus (${total - listItems.length} restants)`}
          </button>
        </div>
      )}
    </div>
  );
}
