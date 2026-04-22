/**
 * Hub documentaire métier — sections par catégorie + upload enrichi (P3 / polish P4).
 */

import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch, getAuthToken } from "../../services/api";
import type { DocumentCategory, DocumentSectionKey, EntityDocument } from "./entityDocumentTypes";
import { resolveDocumentLifecycleBadge } from "./documentLifecycleBadge";
import { groupDocumentsBySection, SECTION_ORDER } from "./groupDocumentsBySection";
import styles from "./EntityDocumentsHub.module.css";

const API_BASE = getCrmApiBase();

const SECTION_UI: Record<DocumentSectionKey, { title: string; empty: string; kicker: string }> = {
  QUOTE: { title: "Devis", empty: "Aucun devis", kicker: "Offres & PDF devis" },
  INVOICE: { title: "Factures", empty: "Aucune facture", kicker: "Facturation & avoirs" },
  COMMERCIAL_PROPOSAL: {
    title: "Propositions commerciales",
    empty: "Aucune proposition commerciale",
    kicker: "Études & propositions",
  },
  DP: {
    title: "DP",
    empty: "Aucun document DP",
    kicker: "Déclaration préalable & pièces générées",
  },
  DP_MAIRIE: { title: "DP Mairie", empty: "Aucun DP mairie", kicker: "Dossier municipal" },
  ADMINISTRATIVE: {
    title: "Documents administratifs",
    empty: "Aucun document administratif",
    kicker: "Conso, signatures, interne",
  },
  OTHER: { title: "Autres", empty: "Aucun autre document", kicker: "Pièces diverses" },
};

const CATEGORY_OPTIONS: { value: DocumentCategory; label: string }[] = [
  { value: "QUOTE", label: "Devis" },
  { value: "INVOICE", label: "Facture" },
  { value: "COMMERCIAL_PROPOSAL", label: "Proposition commerciale" },
  { value: "DP", label: "DP (déclaration préalable)" },
  { value: "DP_MAIRIE", label: "DP Mairie" },
  { value: "ADMINISTRATIVE", label: "Document administratif" },
  { value: "OTHER", label: "Autre" },
];

function defaultVisibilityForCategory(cat: DocumentCategory): boolean {
  return cat === "QUOTE" || cat === "INVOICE" || cat === "COMMERCIAL_PROPOSAL" || cat === "DP";
}

function isSystemGenerated(doc: EntityDocument): boolean {
  return doc.sourceType === "SYSTEM_GENERATED";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function mimeLabel(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) return "PDF";
  if (m.includes("png")) return "PNG";
  if (m.includes("jpeg") || m.includes("jpg")) return "JPEG";
  if (m.includes("csv")) return "CSV";
  if (m.includes("spreadsheet") || m.includes("excel")) return "Tableur";
  return mime.split("/").pop() || "Fichier";
}

export interface EntityDocumentsHubProps {
  entityType: "lead" | "client" | "study" | "quote";
  entityId: string;
  documents: EntityDocument[];
  onRefresh: () => void;
}

export default function EntityDocumentsHub({
  entityType,
  entityId,
  documents,
  onRefresh,
}: EntityDocumentsHubProps) {
  const uploadAnchorRef = useRef<HTMLDivElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>("OTHER");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [clientVisible, setClientVisible] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [visibilityBusyId, setVisibilityBusyId] = useState<string | null>(null);

  const buckets = useMemo(() => groupDocumentsBySection(documents), [documents]);

  const newestDocumentId = useMemo(() => {
    if (!documents.length) return null;
    const sorted = [...documents].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return sorted[0]?.id ?? null;
  }, [documents]);

  const openUploadWithCategory = useCallback((cat: DocumentCategory) => {
    setCategory(cat);
    setClientVisible(defaultVisibilityForCategory(cat));
    setDisplayName("");
    setDescription("");
    setPickedFile(null);
    setError(null);
    setUploadOpen(true);
    requestAnimationFrame(() => {
      uploadAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const onCategorySelectChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as DocumentCategory;
    setCategory(v);
    setClientVisible(defaultVisibilityForCategory(v));
  }, []);

  const setFileFromList = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    setPickedFile(files[0]);
  }, []);

  const submitUpload = async () => {
    if (!getAuthToken()) {
      setError("Non authentifié");
      return;
    }
    const name = displayName.trim();
    if (!name) {
      setError("Le nom du document est obligatoire.");
      return;
    }
    if (!pickedFile) {
      setError("Veuillez choisir un fichier.");
      return;
    }
    setUploading(true);
    setError(null);
    setProgress(15);
    try {
      const formData = new FormData();
      formData.append("entityType", entityType);
      formData.append("entityId", entityId);
      formData.append("file", pickedFile);
      formData.append("document_category", category);
      formData.append("is_client_visible", clientVisible ? "true" : "false");
      formData.append("display_name", name);
      if (description.trim()) {
        formData.append("description", description.trim());
      }
      const res = await apiFetch(`${API_BASE}/api/documents`, {
        method: "POST",
        body: formData,
      });
      setProgress(90);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
      }
      setProgress(100);
      setPickedFile(null);
      setDisplayName("");
      setDescription("");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur upload");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDownload = async (doc: EntityDocument) => {
    if (!getAuthToken()) return;
    setDownloadingId(doc.id);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/documents/${doc.id}/download`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Erreur téléchargement");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.displayName?.trim() || doc.file_name;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur téléchargement");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!getAuthToken()) return;
    if (!window.confirm("Supprimer définitivement ce document ?")) return;
    setDeletingId(docId);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Erreur suppression");
      }
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur suppression");
    } finally {
      setDeletingId(null);
    }
  };

  const handleArchive = async (docId: string) => {
    if (!getAuthToken()) return;
    if (!window.confirm("Archiver ce document ? Il disparaîtra de cette liste (récupérable via restauration admin si prévu).")) return;
    setArchivingId(docId);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/documents/${docId}/archive`, { method: "PATCH" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Erreur archivage");
      }
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur archivage");
    } finally {
      setArchivingId(null);
    }
  };

  const handleToggleClientVisible = async (doc: EntityDocument) => {
    if (!getAuthToken()) return;
    const next = !doc.isClientVisible;
    setVisibilityBusyId(doc.id);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/documents/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_client_visible: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Erreur visibilité");
      }
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur visibilité");
    } finally {
      setVisibilityBusyId(null);
    }
  };

  return (
    <div className={styles.hub}>
      <div ref={uploadAnchorRef} className={styles.uploadPanel}>
        <button
          type="button"
          className={`${styles.uploadPanelHead} ${uploadOpen ? styles.uploadOpenHead : ""}`}
          onClick={() => setUploadOpen((o) => !o)}
          aria-expanded={uploadOpen}
        >
          <div className={styles.uploadHeadLeft}>
            <span className={styles.uploadIcon} aria-hidden>
              +
            </span>
            <div>
              <span className={styles.uploadPanelTitle}>Ajouter un document</span>
              <span className={styles.uploadHeadHint}>
                Nom, catégorie, visibilité client — un fichier par envoi
              </span>
            </div>
          </div>
          <span className={`${styles.uploadChevron} ${uploadOpen ? styles.uploadChevronOpen : ""}`}>
            ▼
          </span>
        </button>
        {uploadOpen ? (
          <div className={styles.uploadBody}>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label htmlFor="edoc-display-name">Nom du document</label>
                <input
                  id="edoc-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ex. Plans toiture, Courrier mairie…"
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="edoc-category">Catégorie métier</label>
                <select id="edoc-category" value={category} onChange={onCategorySelectChange}>
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.checkboxBox} ${styles.formGridFull}`}>
                <div className={styles.checkboxRow}>
                  <input
                    id="edoc-visible"
                    type="checkbox"
                    checked={clientVisible}
                    onChange={(e) => setClientVisible(e.target.checked)}
                  />
                  <label htmlFor="edoc-visible">Visible sur l’espace client</label>
                </div>
              </div>
              <div className={`${styles.field} ${styles.formGridFull}`}>
                <label htmlFor="edoc-desc">Description (optionnel)</label>
                <textarea
                  id="edoc-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Note interne ou contexte pour l’équipe…"
                  rows={3}
                />
              </div>
              <div
                className={`${styles.dropzone} ${styles.formGridFull} ${
                  dragging ? styles.dropzoneActive : ""
                } ${uploading ? styles.dropzoneDisabled : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!uploading) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!uploading) setFileFromList(e.dataTransfer.files);
                }}
              >
                <input
                  type="file"
                  disabled={uploading}
                  onChange={(e) => {
                    setFileFromList(e.target.files);
                    e.target.value = "";
                  }}
                />
                <p className={styles.dropzoneHint}>
                  Déposez un fichier ou cliquez pour parcourir
                </p>
                {pickedFile ? (
                  <p className={styles.filePicked}>
                    <strong>{pickedFile.name}</strong> · {formatSize(pickedFile.size)}
                  </p>
                ) : null}
              </div>
            </div>
            {uploading ? (
              <div className={styles.progressWrap}>
                <div className={styles.progressBar} style={{ width: `${progress}%` }} />
              </div>
            ) : null}
            {error ? <p className={styles.error}>{error}</p> : null}
            <div className={styles.submitRow}>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={uploading}
                onClick={() => void submitUpload()}
              >
                {uploading ? "Envoi…" : "Enregistrer le document"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {SECTION_ORDER.map((key) => {
        const meta = SECTION_UI[key];
        const list = buckets[key];
        return (
          <section key={key} className={styles.section} aria-labelledby={`edoc-sec-${key}`}>
            <div className={styles.sectionInner}>
              <div className={styles.sectionBar} aria-hidden />
              <div className={styles.sectionMain}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitleBlock}>
                    <h3 className={styles.sectionTitle} id={`edoc-sec-${key}`}>
                      {meta.title}
                    </h3>
                    <p className={styles.sectionSubtitle}>{meta.kicker}</p>
                  </div>
                  <div className={styles.sectionActions}>
                    <span className={styles.sectionCount} aria-label={`${list.length} document(s)`}>
                      {list.length}
                    </span>
                    <button
                      type="button"
                      className={styles.btnAddSection}
                      onClick={() => openUploadWithCategory(key)}
                    >
                      + Ajouter
                    </button>
                  </div>
                </div>
                {list.length === 0 ? (
                  <p className={styles.sectionEmpty}>{meta.empty}</p>
                ) : (
                  <div className={styles.cardList}>
                    {list.map((doc) => {
                      const title = doc.displayName?.trim() || doc.file_name;
                      const sys = isSystemGenerated(doc);
                      const isRecent = doc.id === newestDocumentId;
                      const lifecycle = resolveDocumentLifecycleBadge(doc.document_type);
                      return (
                        <article
                          key={doc.id}
                          className={`${styles.card} ${isRecent ? styles.cardRecent : ""}`}
                        >
                          <div className={styles.cardRow1}>
                            <h4 className={styles.cardTitle}>{title}</h4>
                            <div className={styles.badgeGroup}>
                              {lifecycle ? (
                                <span
                                  className={`${styles.badge} ${
                                    lifecycle.variant === "signed"
                                      ? styles.badgeLifecycleSigned
                                      : styles.badgeLifecycleDraft
                                  }`}
                                >
                                  {lifecycle.label}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className={`${styles.badge} ${styles.badgeClickable} ${
                                  doc.isClientVisible ? styles.badgeVisibleOn : styles.badgeVisibleOff
                                }`}
                                onClick={() => void handleToggleClientVisible(doc)}
                                disabled={visibilityBusyId === doc.id}
                                aria-pressed={doc.isClientVisible}
                                title="Cliquer pour basculer la visibilité sur l’espace client"
                              >
                                {visibilityBusyId === doc.id
                                  ? "…"
                                  : doc.isClientVisible
                                    ? "Visible client"
                                    : "Non visible client"}
                              </button>
                              <span
                                className={`${styles.badge} ${
                                  sys ? styles.badgeSourceAuto : styles.badgeSourceManual
                                }`}
                              >
                                {sys ? "Auto" : "Manuel"}
                              </span>
                            </div>
                          </div>
                          <div className={styles.cardMeta}>
                            <span>{formatDate(doc.created_at)}</span>
                            <span className={styles.metaSep}>·</span>
                            <span>{formatSize(doc.file_size)}</span>
                            <span className={styles.metaSep}>·</span>
                            <span>{mimeLabel(doc.mime_type)}</span>
                            {doc.document_type ? (
                              <>
                                <span className={styles.metaSep}>·</span>
                                <span className={styles.metaTechnical}>{doc.document_type}</span>
                              </>
                            ) : null}
                          </div>
                          {doc.description ? (
                            <p className={styles.cardDesc}>{doc.description}</p>
                          ) : null}
                          <div className={styles.cardActions}>
                            <button
                              type="button"
                              className={styles.btnDownload}
                              onClick={() => void handleDownload(doc)}
                              disabled={downloadingId === doc.id}
                            >
                              {downloadingId === doc.id ? "Téléchargement…" : "Télécharger"}
                            </button>
                            {sys ? (
                              <button
                                type="button"
                                className={styles.btnArchiveDoc}
                                onClick={() => void handleArchive(doc.id)}
                                disabled={archivingId === doc.id}
                              >
                                {archivingId === doc.id ? "Archivage…" : "Archiver"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.btnDeleteDoc}
                                onClick={() => void handleDelete(doc.id)}
                                disabled={deletingId === doc.id}
                              >
                                {deletingId === doc.id ? "Suppression…" : "Supprimer"}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
