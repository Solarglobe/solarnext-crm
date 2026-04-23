/**
 * Document Center — vue globale des documents organisation (GET /api/documents).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { apiFetch, getAuthToken } from "../services/api";
import { getCrmApiBase } from "../config/crmApiBase";
import {
  fetchOrganizationDocuments,
  type OrganizationDocumentListItem,
} from "../services/documentsList.api";
import type { MailComposerInitialPrefill } from "./mail/MailComposer";
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
  { value: "all", label: "Tous" },
  { value: "quote", label: "Devis" },
  { value: "invoice", label: "Factures" },
  { value: "study", label: "Études" },
  { value: "dp", label: "Déclaration préalable" },
  { value: "admin", label: "Contrats" },
  { value: "other", label: "Autre" },
];

function apiBase(): string {
  const b = getCrmApiBase();
  return b ? b.replace(/\/$/, "") : "";
}

function formatDocDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
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
  if (dt.startsWith("quote")) return "Devis";
  if (dt.includes("invoice") || doc.entity_type === "invoice") return "Facture";
  if (dt.includes("study") || doc.entity_type === "study" || doc.entity_type === "study_version") {
    return "Étude";
  }
  if (dt === "dp_pdf" || dt.includes("dp")) return "Déclaration préalable";
  if (doc.document_type) return doc.document_type;
  return "—";
}

function resolveContactCell(doc: OrganizationDocumentListItem): string {
  if (doc.lead_name?.trim()) return doc.lead_name.trim();
  if (doc.client_name?.trim()) return doc.client_name.trim();
  return "—";
}

export default function DocumentsList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<OrganizationDocumentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

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
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, typeFilter]);

  const listItems = items ?? [];
  const hasMore = listItems.length < total;

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

  const handleSendDocument = useCallback(
    (doc: OrganizationDocumentListItem) => {
      const fileName = doc.file_name?.trim() || resolveDisplayName(doc);
      const prefill: MailComposerInitialPrefill = {
        crmLeadId: doc.lead_id || null,
        crmClientId: doc.entity_type === "client" ? doc.entity_id : null,
        subject: `Document : ${resolveDisplayName(doc)}`,
        documents: [{ id: doc.id, filename: fileName }],
      };
      navigate("/mail", { state: { mailComposePrefill: prefill } });
    },
    [navigate]
  );

  const handleDownload = useCallback(async (doc: OrganizationDocumentListItem) => {
    if (!getAuthToken()) return;
    setDownloadingId(doc.id);
    setError(null);
    try {
      const url = `${apiBase()}/api/documents/${encodeURIComponent(doc.id)}/download`;
      const res = await apiFetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Téléchargement impossible");
      }
      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
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

  const subtitle = useMemo(
    () =>
      !loading && !error
        ? `${total} document${total !== 1 ? "s" : ""} au total${listItems.length < total ? ` · ${listItems.length} affiché(s)` : ""}`
        : null,
    [loading, error, total, listItems.length]
  );

  return (
    <Card className="documents-page" style={{ padding: "var(--spacing-24)" }}>
      <header className="documents-page__header">
        <h1 className="sg-title">Documents</h1>
        <p className="documents-page__subtitle">Tous les documents de l&apos;organisation</p>
        {subtitle ? <p className="documents-page__muted" style={{ marginTop: 6 }}>{subtitle}</p> : null}
      </header>

      <div className="documents-page__toolbar">
        <div className="documents-page__field documents-page__field--grow">
          <span className="documents-page__label">Recherche</span>
          <input
            type="search"
            className="documents-page__input"
            placeholder="Nom, type, contact…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Rechercher un document"
          />
        </div>
        <div className="documents-page__field">
          <span className="documents-page__label">Type</span>
          <select
            className="documents-page__select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filtrer par type"
          >
            {TYPE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
          Réinitialiser
        </Button>
      </div>

      {error && (
        <div className="documents-page__error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="documents-page__muted">Chargement…</p>}

      {!loading && !error && listItems.length === 0 && (
        <div className="documents-page__empty">Aucun document trouvé.</div>
      )}

      {!loading && listItems.length > 0 && (
        <>
          <div className="documents-page__table-wrap">
            <table className="documents-page__table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th>Lead / Client</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listItems.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <div className="documents-page__name">
                        {resolveDisplayName(doc)}
                        {(doc.is_visible_to_client || doc.isClientVisible) && (
                          <span className="documents-page__badge">Visible client</span>
                        )}
                      </div>
                      <div className="documents-page__muted">{doc.file_name}</div>
                    </td>
                    <td>{resolveTypeLabel(doc)}</td>
                    <td>{resolveContactCell(doc)}</td>
                    <td>{formatDocDate(doc.created_at)}</td>
                    <td>
                      <div className="documents-page__actions">
                        <button
                          type="button"
                          className="documents-page__link"
                          disabled={downloadingId === doc.id}
                          onClick={() => void handleDownload(doc)}
                        >
                          {downloadingId === doc.id ? "Téléchargement…" : "Télécharger"}
                        </button>
                        <button type="button" className="documents-page__link" onClick={() => handleSendDocument(doc)}>
                          Envoyer
                        </button>
                        {doc.lead_id ? (
                          <Link className="documents-page__link" to={`/leads/${doc.lead_id}`}>
                            Ouvrir le lead
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="documents-page__footer">
              <Button type="button" variant="outlineGold" disabled={loadingMore} onClick={() => void handleLoadMore()}>
                {loadingMore ? "Chargement…" : "Charger plus"}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
