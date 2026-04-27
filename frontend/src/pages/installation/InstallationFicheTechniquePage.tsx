import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { SaasTabs } from "../../components/ui/SaasTabs";
import { ModalShell } from "../../components/ui/ModalShell";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import { apiFetch } from "../../services/api";
import { getCrmApiBase } from "../../config/crmApiBase";
import {
  fetchFicheTechniques,
  fetchFicheTechniquesMeta,
  fetchMailAccountsForSend,
  mapListItemToRow,
  patchFicheFavorite,
  sendFicheTechniqueEmail,
  uploadFicheTechnique,
  type FicheTechniqueCategoryMeta,
  type FicheTechniquesListResponse,
} from "../../services/ficheTechniques.api";
import type { FicheTechniqueCategory, FicheTechniqueRow, FicheTechniqueStatus } from "./ficheTechnique.data";
import {
  buildFicheListCacheKey,
  mapFicheTechniqueUserMessage,
  readFicheTechniqueUiState,
  writeFicheTechniqueUiState,
} from "./ficheTechniqueUi";
import "./installation-fiche-technique-page.css";

const STATUS_FILTER_ALL = "all" as const;
type StatusFilter = typeof STATUS_FILTER_ALL | FicheTechniqueStatus;

const PAGE_SIZE = 20;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const STATUS_LABELS: Record<FicheTechniqueStatus, string> = {
  active: "Actif",
  obsolete: "Obsolète",
  recommended: "Recommandé",
};

type SortByField = "created_at" | "name";
type SortOrder = "asc" | "desc";

type EmptyKind = "category" | "search" | "filters";

function crmAbsoluteUrl(relativePath: string): string {
  const base = getCrmApiBase().replace(/\/$/, "");
  if (base && relativePath.startsWith("/")) return `${base}${relativePath}`;
  return relativePath;
}

function formatDateFr(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function isValidEmail(raw: string): boolean {
  const s = raw.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function resolveEmptyKind(p: {
  listLoading: boolean;
  listError: string | null;
  total: number;
  debouncedSearch: string;
  debouncedBrand: string;
  statusFilter: StatusFilter;
}): EmptyKind | null {
  if (p.listLoading || p.listError || p.total > 0) return null;
  if (p.debouncedSearch) return "search";
  if (p.debouncedBrand || p.statusFilter !== STATUS_FILTER_ALL) return "filters";
  return "category";
}

function StatusBadge({ status }: { status: FicheTechniqueStatus }) {
  const cls =
    status === "active"
      ? "ft-status-badge ft-status-badge--active"
      : status === "obsolete"
        ? "ft-status-badge ft-status-badge--obsolete"
        : "ft-status-badge ft-status-badge--recommended";
  return <span className={cls}>{STATUS_LABELS[status]}</span>;
}

function IconStar({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconExternalTab() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  );
}

function TableSkeleton({ rows, dense }: { rows: number; dense?: boolean }) {
  const cells = dense ? 5 : 7;
  return (
    <div className={`installation-ft-page__table-skeleton${dense ? " installation-ft-page__table-skeleton--light" : ""}`}>
      <div className="installation-ft-page__table-skeleton-head" aria-hidden>
        {Array.from({ length: cells }).map((_, i) => (
          <div key={`h-${i}`} className="installation-ft-page__skeleton-block installation-ft-page__skeleton-block--head" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={`r-${r}`} className="installation-ft-page__table-skeleton-row">
          {Array.from({ length: cells }).map((_, c) => (
            <div key={`c-${r}-${c}`} className="installation-ft-page__skeleton-block" />
          ))}
        </div>
      ))}
    </div>
  );
}

function TabsSkeleton() {
  return (
    <div className="installation-ft-page__tabs-skeleton" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="installation-ft-page__skeleton-tab" />
      ))}
    </div>
  );
}

const SORT_PRESETS: { value: string; sort_by: SortByField; sort_order: SortOrder; label: string }[] = [
  { value: "created_desc", sort_by: "created_at", sort_order: "desc", label: "Date (récent → ancien)" },
  { value: "created_asc", sort_by: "created_at", sort_order: "asc", label: "Date (ancien → récent)" },
  { value: "name_asc", sort_by: "name", sort_order: "asc", label: "Nom (A → Z)" },
  { value: "name_desc", sort_by: "name", sort_order: "desc", label: "Nom (Z → A)" },
];

const persistedUi = readFicheTechniqueUiState();

export default function InstallationFicheTechniquePage() {
  const panelId = useId();
  const tabPrefix = useId().replace(/:/g, "");
  const previewBlobCache = useRef<Map<string, string>>(new Map());
  const mailSuccessTimer = useRef<number | null>(null);
  const listCacheRef = useRef<Map<string, FicheTechniquesListResponse>>(new Map());
  const panelScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingHighlightIdRef = useRef<string | null>(null);
  const listResetSigRef = useRef<string>("");

  const [categories, setCategories] = useState<FicheTechniqueCategoryMeta[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>(persistedUi.activeCategory);
  const [search, setSearch] = useState(persistedUi.search);
  const [debouncedSearch, setDebouncedSearch] = useState(persistedUi.search);
  const [brandFilter, setBrandFilter] = useState(persistedUi.brandFilter);
  const [debouncedBrand, setDebouncedBrand] = useState(persistedUi.brandFilter);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(persistedUi.statusFilter);
  const [sortPreset, setSortPreset] = useState(persistedUi.sortPreset);

  const sortParams = useMemo(() => {
    const p = SORT_PRESETS.find((x) => x.value === sortPreset) ?? SORT_PRESETS[0];
    return { sort_by: p.sort_by, sort_order: p.sort_order };
  }, [sortPreset]);

  const [page, setPage] = useState(persistedUi.page);
  const [items, setItems] = useState<FicheTechniqueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [hasReceivedListOnce, setHasReceivedListOnce] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [formName, setFormName] = useState("");
  const [formReference, setFormReference] = useState("");
  const [formCategory, setFormCategory] = useState<string>("panneaux");
  const [formBrand, setFormBrand] = useState("");
  const [formStatus, setFormStatus] = useState<FicheTechniqueStatus>("active");
  const [formPdfFile, setFormPdfFile] = useState<File | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [uploadLocalError, setUploadLocalError] = useState<string | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<FicheTechniqueRow | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [mailRow, setMailRow] = useState<FicheTechniqueRow | null>(null);
  const [mailTo, setMailTo] = useState("");
  const [mailAccountId, setMailAccountId] = useState("");
  const [mailAccounts, setMailAccounts] = useState<{ id: string; email: string }[]>([]);
  const [mailMetaReady, setMailMetaReady] = useState(false);
  const [mailSending, setMailSending] = useState(false);
  const [mailError, setMailError] = useState<string | null>(null);
  const [mailSuccess, setMailSuccess] = useState(false);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [servedSnapshot, setServedSnapshot] = useState<{
    category: string;
    filterFp: string;
    page: number;
  } | null>(null);

  const listFilterFingerprint = useMemo(
    () =>
      [debouncedSearch, debouncedBrand, statusFilter, sortPreset].join("\t"),
    [debouncedSearch, debouncedBrand, statusFilter, sortPreset],
  );

  const filtersActive = Boolean(debouncedSearch || debouncedBrand || statusFilter !== STATUS_FILTER_ALL);

  const tabItems = useMemo(
    () => categories.map((c) => ({ id: c.id as FicheTechniqueCategory, label: c.label })),
    [categories],
  );

  useEffect(() => {
    writeFicheTechniqueUiState({
      activeCategory,
      search,
      brandFilter,
      statusFilter,
      sortPreset,
      page,
    });
  }, [activeCategory, search, brandFilter, statusFilter, sortPreset, page]);

  useEffect(() => {
    return () => {
      previewBlobCache.current.forEach((url) => URL.revokeObjectURL(url));
      previewBlobCache.current.clear();
      if (mailSuccessTimer.current != null) window.clearTimeout(mailSuccessTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMetaLoading(true);
      setMetaError(null);
      try {
        const cats = await fetchFicheTechniquesMeta();
        if (cancelled) return;
        setCategories(cats);
        if (cats.length > 0 && !cats.some((c) => c.id === activeCategory)) {
          setActiveCategory(cats[0].id);
        }
      } catch (e) {
        if (!cancelled) setMetaError(e instanceof Error ? e.message : "Erreur meta");
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedBrand(brandFilter.trim()), 350);
    return () => window.clearTimeout(t);
  }, [brandFilter]);

  useEffect(() => {
    const sig = [activeCategory, debouncedSearch, debouncedBrand, statusFilter, sortPreset].join("\t");
    if (!listResetSigRef.current) {
      listResetSigRef.current = sig;
      return;
    }
    if (listResetSigRef.current === sig) return;
    listResetSigRef.current = sig;
    setPage(0);
  }, [activeCategory, debouncedSearch, debouncedBrand, statusFilter, sortPreset]);

  const listKeyFor = useCallback(
    (category: string, pageIndex: number) =>
      buildFicheListCacheKey({
        category,
        page: pageIndex,
        search: debouncedSearch,
        brand: debouncedBrand,
        status: statusFilter === STATUS_FILTER_ALL ? "" : statusFilter,
        sort_by: sortParams.sort_by,
        sort_order: sortParams.sort_order,
        limit: PAGE_SIZE,
      }),
    [debouncedSearch, debouncedBrand, statusFilter, sortParams.sort_by, sortParams.sort_order],
  );

  const refreshList = useCallback(
    async (pageOverride?: number, categoryOverride?: string) => {
      const category = categoryOverride ?? activeCategory;
      const effectivePage = pageOverride != null ? pageOverride : page;
      const key = listKeyFor(category, effectivePage);
      const cached = listCacheRef.current.get(key);
      if (cached) {
        setListError(null);
        setItems(cached.data.map(mapListItemToRow));
        setTotal(cached.total);
        if (pageOverride != null) setPage(pageOverride);
        setServedSnapshot({ category, filterFp: listFilterFingerprint, page: effectivePage });
        setListLoading(false);
        setHasReceivedListOnce(true);
        return;
      }

      setListError(null);
      setListLoading(true);
      const offset = effectivePage * PAGE_SIZE;
      try {
        const res = await fetchFicheTechniques({
          category: category as FicheTechniqueCategory,
          search: debouncedSearch || undefined,
          brand: debouncedBrand || undefined,
          status: statusFilter === STATUS_FILTER_ALL ? undefined : statusFilter,
          limit: PAGE_SIZE,
          offset,
          sort_by: sortParams.sort_by,
          sort_order: sortParams.sort_order,
        });
        listCacheRef.current.set(key, res);
        setItems(res.data.map(mapListItemToRow));
        setTotal(res.total);
        if (pageOverride != null) setPage(pageOverride);
        setServedSnapshot({ category, filterFp: listFilterFingerprint, page: effectivePage });
        setHasReceivedListOnce(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : mapFicheTechniqueUserMessage();
        setListError(msg);
      } finally {
        setListLoading(false);
      }
    },
    [
      activeCategory,
      debouncedSearch,
      debouncedBrand,
      statusFilter,
      sortParams.sort_by,
      sortParams.sort_order,
      page,
      listKeyFor,
      listFilterFingerprint,
    ],
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (metaLoading || categories.length < 2) return;
    const idx = categories.findIndex((c) => c.id === activeCategory);
    if (idx < 0) return;
    const nextCat = categories[(idx + 1) % categories.length];
    const key = listKeyFor(nextCat.id, 0);
    if (listCacheRef.current.has(key)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchFicheTechniques({
          category: nextCat.id as FicheTechniqueCategory,
          search: debouncedSearch || undefined,
          brand: debouncedBrand || undefined,
          status: statusFilter === STATUS_FILTER_ALL ? undefined : statusFilter,
          limit: PAGE_SIZE,
          offset: 0,
          sort_by: sortParams.sort_by,
          sort_order: sortParams.sort_order,
        });
        if (!cancelled) listCacheRef.current.set(key, res);
      } catch {
        /* préchargement silencieux */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeCategory,
    categories,
    debouncedSearch,
    debouncedBrand,
    statusFilter,
    sortParams.sort_by,
    sortParams.sort_order,
    metaLoading,
    listKeyFor,
  ]);

  useEffect(() => {
    const id = pendingHighlightIdRef.current;
    if (!id) return;
    if (!items.some((r) => r.id === id)) return;
    pendingHighlightIdRef.current = null;
    setHighlightedRowId(id);
    panelScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = window.setTimeout(() => setHighlightedRowId(null), 2000);
    return () => window.clearTimeout(t);
  }, [items]);

  useEffect(() => {
    if (uploadOpen) {
      setFormCategory(activeCategory);
      setUploadLocalError(null);
    }
  }, [uploadOpen, activeCategory]);

  useEffect(() => {
    if (!mailRow) {
      setMailMetaReady(false);
      setMailSuccess(false);
      return;
    }
    setMailMetaReady(false);
    setMailSuccess(false);
    let cancelled = false;
    (async () => {
      const acc = await fetchMailAccountsForSend();
      if (cancelled) return;
      setMailAccounts(acc.map((a) => ({ id: a.id, email: a.email })));
      if (acc.length === 1) setMailAccountId(acc[0].id);
      setMailMetaReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mailRow]);

  const canPrev = page > 0;
  const canNext = (page + 1) * PAGE_SIZE < total;
  const rangeFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeTo = total === 0 ? 0 : Math.min((page + 1) * PAGE_SIZE, total);

  const heavySkeleton = listLoading && !hasReceivedListOnce;
  const showBodySkeleton =
    Boolean(
      listLoading &&
        hasReceivedListOnce &&
        servedSnapshot &&
        (servedSnapshot.category !== activeCategory || servedSnapshot.filterFp !== listFilterFingerprint),
    );
  const showStaleRowsWhilePaging =
    Boolean(
      listLoading &&
        hasReceivedListOnce &&
        servedSnapshot &&
        servedSnapshot.category === activeCategory &&
        servedSnapshot.filterFp === listFilterFingerprint &&
        servedSnapshot.page !== page,
    );
  const theadSpinner = listLoading && hasReceivedListOnce && !heavySkeleton;
  const paginationBusy = listLoading && hasReceivedListOnce;

  const emptyKind = resolveEmptyKind({
    listLoading,
    listError,
    total,
    debouncedSearch,
    debouncedBrand,
    statusFilter,
  });

  const uploadCanSubmit =
    formName.trim().length > 0 &&
    formReference.trim().length > 0 &&
    !!formCategory?.trim() &&
    !!formPdfFile &&
    !uploadSubmitting;

  const toggleFavorite = useCallback(
    async (id: string) => {
      const row = items.find((r) => r.id === id);
      if (!row) return;
      const next = !row.isFavorite;
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, isFavorite: next } : r)));
      try {
        await patchFicheFavorite(id, next);
        listCacheRef.current.clear();
        showCrmInlineToast("Favori mis à jour.", "success", 2000);
      } catch (e) {
        setItems((prev) => prev.map((r) => (r.id === id ? { ...r, isFavorite: row.isFavorite } : r)));
        showCrmInlineToast(e instanceof Error ? e.message : "Impossible de mettre à jour le favori.", "error", 4000);
      }
    },
    [items],
  );

  const resetFilters = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setBrandFilter("");
    setDebouncedBrand("");
    setStatusFilter(STATUS_FILTER_ALL);
    setSortPreset("created_desc");
    setPage(0);
  }, []);

  const closeUpload = useCallback(() => {
    setUploadOpen(false);
    setFormName("");
    setFormReference("");
    setFormBrand("");
    setFormStatus("active");
    setFormPdfFile(null);
    setDropActive(false);
    setUploadSubmitting(false);
    setUploadLocalError(null);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setPreviewRow(null);
    setPreviewBlobUrl(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewScale(1);
  }, []);

  const openPreview = useCallback(async (row: FicheTechniqueRow) => {
    setPreviewRow(row);
    setPreviewOpen(true);
    setPreviewError(null);
    const cached = previewBlobCache.current.get(row.id);
    if (cached) {
      setPreviewBlobUrl(cached);
      setPreviewLoading(false);
      return;
    }
    setPreviewBlobUrl(null);
    setPreviewLoading(true);
    try {
      const res = await apiFetch(crmAbsoluteUrl(row.downloadUrl));
      if (!res.ok) throw new Error("Impossible de charger le PDF.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      previewBlobCache.current.set(row.id, url);
      setPreviewBlobUrl(url);
    } catch (e) {
      const msg =
        e instanceof TypeError ? mapFicheTechniqueUserMessage({ isNetwork: true }) : "Impossible de charger le PDF.";
      setPreviewError(msg);
      showCrmInlineToast(msg, "error");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const openPreviewInNewTab = useCallback(() => {
    if (!previewBlobUrl) return;
    window.open(previewBlobUrl, "_blank", "noopener,noreferrer");
  }, [previewBlobUrl]);

  const handleDownload = useCallback(async (row: FicheTechniqueRow) => {
    setDownloadingId(row.id);
    try {
      const res = await apiFetch(crmAbsoluteUrl(row.downloadUrl));
      if (!res.ok) throw new Error("Téléchargement impossible");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = row.reference.endsWith(".pdf") ? row.reference : `${row.reference}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      showCrmInlineToast("PDF téléchargé.", "success");
    } catch (e) {
      showCrmInlineToast(
        e instanceof TypeError ? mapFicheTechniqueUserMessage({ isNetwork: true }) : "Échec du téléchargement.",
        "error",
      );
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const openMailFromPreview = useCallback(() => {
    if (!previewRow) return;
    const row = previewRow;
    closePreview();
    setMailRow(row);
    setMailTo("");
    setMailAccountId("");
    setMailError(null);
  }, [previewRow, closePreview]);

  const closeMail = useCallback(() => {
    if (mailSuccessTimer.current != null) {
      window.clearTimeout(mailSuccessTimer.current);
      mailSuccessTimer.current = null;
    }
    setMailRow(null);
    setMailTo("");
    setMailAccountId("");
    setMailAccounts([]);
    setMailMetaReady(false);
    setMailError(null);
    setMailSending(false);
    setMailSuccess(false);
  }, []);

  const handleMailSend = useCallback(async () => {
    if (!mailRow) return;
    setMailError(null);
    setMailSending(true);
    try {
      await sendFicheTechniqueEmail(mailRow.id, {
        to: mailTo.trim(),
        mail_account_id: mailAccountId || null,
      });
      setMailSuccess(true);
      showCrmInlineToast("Mail envoyé.", "success");
      mailSuccessTimer.current = window.setTimeout(() => {
        closeMail();
      }, 1600);
    } catch (e) {
      setMailError(e instanceof Error ? e.message : "Envoi impossible");
      showCrmInlineToast(e instanceof Error ? e.message : "Échec de l’envoi.", "error");
    } finally {
      setMailSending(false);
    }
  }, [mailRow, mailTo, mailAccountId, closeMail]);

  const setPdfFromList = useCallback((fileList: FileList | null) => {
    const f = fileList?.[0];
    if (!f) {
      setFormPdfFile(null);
      setUploadLocalError(null);
      return;
    }
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      setUploadLocalError("Le fichier doit être un PDF.");
      setFormPdfFile(null);
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setUploadLocalError("Taille max. 10 Mo.");
      setFormPdfFile(null);
      return;
    }
    setFormPdfFile(f);
    setUploadLocalError(null);
  }, []);

  const handleUploadSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!uploadCanSubmit || !formPdfFile) return;
      setUploadSubmitting(true);
      setUploadLocalError(null);
      try {
        const fd = new FormData();
        fd.append("name", formName.trim());
        fd.append("reference", formReference.trim());
        fd.append("category", formCategory);
        fd.append("status", formStatus);
        if (formBrand.trim()) fd.append("brand", formBrand.trim());
        fd.append("file", formPdfFile);
        const created = await uploadFicheTechnique(fd);
        listCacheRef.current.clear();
        pendingHighlightIdRef.current = created.id;
        setActiveCategory(formCategory);
        setPage(0);
        await refreshList(0, formCategory);
        showCrmInlineToast("Fiche technique ajoutée.", "success");
        closeUpload();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Échec de l’upload";
        setUploadLocalError(msg);
        showCrmInlineToast(msg, "error");
      } finally {
        setUploadSubmitting(false);
      }
    },
    [uploadCanSubmit, formName, formReference, formCategory, formStatus, formBrand, formPdfFile, refreshList, closeUpload],
  );

  const preventDefaults = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const bannerError = metaError || listError;
  const mailSendDisabled =
    mailSending ||
    !mailTo.trim() ||
    !isValidEmail(mailTo) ||
    !mailMetaReady ||
    mailAccounts.length === 0 ||
    mailSuccess;

  return (
    <Card className="installation-ft-page" style={{ padding: "var(--spacing-24)" }}>
      <div className="installation-ft-page__header-row">
        <div>
          <h1 className="sg-title">Fiches techniques</h1>
          <p className="installation-ft-page__lead">Bibliothèque PDF — recherche, filtres, envoi.</p>
        </div>
        <Button type="button" variant="primary" size="md" onClick={() => setUploadOpen(true)}>
          Ajouter une fiche technique
        </Button>
      </div>

      {bannerError ? (
        <div className="installation-ft-page__error" role="alert">
          {bannerError}
        </div>
      ) : null}

      <div className="installation-ft-page__toolbar">
        <div className="installation-ft-page__field installation-ft-page__field--grow">
          <span className="installation-ft-page__label">Recherche</span>
          <input
            type="search"
            className="installation-ft-page__input"
            placeholder="Nom, référence, marque…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Rechercher une fiche technique"
          />
        </div>
        <div className="installation-ft-page__field">
          <span className="installation-ft-page__label">Marque (exacte)</span>
          <input
            type="text"
            className="installation-ft-page__input"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            placeholder="ex. Huawei"
            aria-label="Filtrer par marque (correspondance exacte)"
          />
        </div>
        <div className="installation-ft-page__field">
          <span className="installation-ft-page__label">Statut</span>
          <select
            className="installation-ft-page__select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filtrer par statut"
          >
            <option value={STATUS_FILTER_ALL}>Tous</option>
            <option value="active">{STATUS_LABELS.active}</option>
            <option value="obsolete">{STATUS_LABELS.obsolete}</option>
            <option value="recommended">{STATUS_LABELS.recommended}</option>
          </select>
        </div>
        <div className="installation-ft-page__field">
          <span className="installation-ft-page__label">Tri</span>
          <select
            className="installation-ft-page__select"
            value={sortPreset}
            onChange={(e) => setSortPreset(e.target.value)}
            aria-label="Trier la liste (serveur)"
          >
            {SORT_PRESETS.map((o) => (
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

      {metaLoading ? (
        <div className="installation-ft-page__tabs-wrap">
          <TabsSkeleton />
        </div>
      ) : tabItems.length > 0 ? (
        <div className="installation-ft-page__tabs-wrap">
          <SaasTabs<FicheTechniqueCategory>
            items={tabItems}
            activeId={activeCategory as FicheTechniqueCategory}
            onChange={(id) => setActiveCategory(id)}
            ariaLabel="Catégories de fiches techniques"
            tabIdPrefix={tabPrefix}
            panelId={panelId}
          />
        </div>
      ) : null}

      <div id={panelId} ref={panelScrollRef} role="tabpanel" aria-labelledby={`${tabPrefix}-${activeCategory}`} className="installation-ft-page__panel">
        {heavySkeleton ? <TableSkeleton rows={8} /> : null}

        {!heavySkeleton && emptyKind ? (
          <div className="installation-ft-page__empty-card">
            {emptyKind === "category" ? (
              <>
                <p className="installation-ft-page__empty-title">Aucune fiche technique dans cet onglet.</p>
                <Button type="button" variant="primary" size="sm" onClick={() => setUploadOpen(true)}>
                  Ajouter une fiche technique
                </Button>
              </>
            ) : null}
            {emptyKind === "search" ? (
              <>
                <p className="installation-ft-page__empty-title">Aucun résultat pour cette recherche.</p>
                <Button type="button" variant="outlineGold" size="sm" onClick={resetFilters}>
                  Réinitialiser les filtres
                </Button>
              </>
            ) : null}
            {emptyKind === "filters" ? (
              <>
                <p className="installation-ft-page__empty-title">Aucun document ne correspond aux filtres sélectionnés.</p>
                <Button type="button" variant="outlineGold" size="sm" onClick={resetFilters}>
                  Réinitialiser les filtres
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {!heavySkeleton && !emptyKind && hasReceivedListOnce ? (
          <>
            <div className="installation-ft-page__table-pro-head">
              <div className="installation-ft-page__table-pro-head-main">
                <span className="installation-ft-page__total-label">
                  {showBodySkeleton
                    ? "…"
                    : total === 1
                      ? "1 fiche technique"
                      : `${total} fiches techniques`}
                </span>
                <span className="installation-ft-page__range-label" aria-live="polite">
                  {showBodySkeleton ? "…" : total === 0 ? "—" : `${rangeFrom}–${rangeTo} sur ${total}`}
                </span>
              </div>
              {filtersActive ? <span className="installation-ft-page__filters-pill">Filtres actifs</span> : null}
            </div>

            <div className="installation-ft-page__table-wrap">
              <div className="sn-saas-table-wrap">
                <table className="sn-saas-table sn-saas-table--dense installation-ft-page__data-table">
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: 48 }}>
                        Favori
                      </th>
                      <th scope="col">Nom produit</th>
                      <th scope="col">Référence</th>
                      <th scope="col">Marque</th>
                      <th scope="col">Statut</th>
                      <th scope="col">Date ajout</th>
                      <th scope="col" className="sn-saas-table__cell--right installation-ft-page__th-actions">
                        <span className="installation-ft-page__th-actions-inner">
                          Actions
                          {theadSpinner ? (
                            <span className="installation-ft-page__inline-spinner" title="Chargement" aria-label="Chargement" />
                          ) : null}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {showBodySkeleton
                      ? Array.from({ length: 8 }).map((_, i) => (
                          <tr key={`sk-${i}`} className="installation-ft-page__tbody-skel-tr" aria-hidden>
                            <td colSpan={7}>
                              <div className="installation-ft-page__tbody-skel-bar" />
                            </td>
                          </tr>
                        ))
                      : items.map((row) => (
                          <tr
                            key={row.id}
                            className={`installation-ft-page__data-row${selectedRowId === row.id ? " installation-ft-page__row--selected" : ""}${highlightedRowId === row.id ? " installation-ft-page__row--highlight" : ""}`}
                            onClick={() => setSelectedRowId(row.id)}
                            onDoubleClick={() => void openPreview(row)}
                          >
                            <td>
                              <button
                                type="button"
                                className={`ft-star-btn${row.isFavorite ? " ft-star-btn--on" : ""}`}
                                title={row.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void toggleFavorite(row.id);
                                }}
                                aria-pressed={row.isFavorite}
                                aria-label={row.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                              >
                                <IconStar filled={row.isFavorite} />
                              </button>
                            </td>
                            <td>
                              <span style={{ fontWeight: 600 }}>{row.name}</span>
                            </td>
                            <td className="sn-saas-table__cell--mono">{row.reference}</td>
                            <td className="sn-saas-table__cell--muted">{row.brand?.trim() ? row.brand : "—"}</td>
                            <td>
                              <StatusBadge status={row.status} />
                            </td>
                            <td>{formatDateFr(row.createdAt)}</td>
                            <td className="sn-saas-table__cell--right">
                              <div className="ft-icon-actions">
                                <button
                                  type="button"
                                  className="ft-icon-btn"
                                  disabled={downloadingId === row.id || listLoading}
                                  title="Télécharger le PDF"
                                  aria-label="Télécharger le PDF"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDownload(row);
                                  }}
                                >
                                  <IconDownload />
                                </button>
                                <button
                                  type="button"
                                  className="ft-icon-btn"
                                  disabled={previewLoading && previewRow?.id === row.id}
                                  title="Aperçu PDF"
                                  aria-label="Aperçu PDF"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void openPreview(row);
                                  }}
                                >
                                  <IconEye />
                                </button>
                                <button
                                  type="button"
                                  className="ft-icon-btn"
                                  title="Envoyer par mail"
                                  aria-label="Envoyer par mail"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMailRow(row);
                                    setMailTo("");
                                    setMailAccountId("");
                                    setMailError(null);
                                  }}
                                >
                                  <IconMail />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="installation-ft-page__pagination" aria-label="Pagination des fiches techniques">
              <Button
                type="button"
                variant="outlineGold"
                size="sm"
                disabled={!canPrev || listLoading}
                className={paginationBusy ? "installation-ft-page__pagination-btn--busy" : ""}
                aria-busy={paginationBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  setPage((p) => p - 1);
                }}
              >
                {paginationBusy && showStaleRowsWhilePaging ? (
                  <span className="installation-ft-page__btn-label">
                    <span className="installation-ft-page__btn-spinner installation-ft-page__btn-spinner--subtle" aria-hidden />
                    Précédent
                  </span>
                ) : (
                  "Précédent"
                )}
              </Button>
              <Button
                type="button"
                variant="outlineGold"
                size="sm"
                disabled={!canNext || listLoading}
                className={paginationBusy ? "installation-ft-page__pagination-btn--busy" : ""}
                aria-busy={paginationBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  setPage((p) => p + 1);
                }}
              >
                {paginationBusy && showStaleRowsWhilePaging ? (
                  <span className="installation-ft-page__btn-label">
                    <span className="installation-ft-page__btn-spinner installation-ft-page__btn-spinner--subtle" aria-hidden />
                    Suivant
                  </span>
                ) : (
                  "Suivant"
                )}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <ModalShell
        open={uploadOpen}
        onClose={() => {
          if (!uploadSubmitting) closeUpload();
        }}
        closeOnBackdropClick={!uploadSubmitting}
        title="Ajouter une fiche technique"
        subtitle="PDF uniquement — taille max. 10 Mo. Le fichier est nommé de façon sécurisée côté serveur."
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" disabled={uploadSubmitting} onClick={closeUpload}>
              Annuler
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              form="installation-ft-upload-form"
              disabled={!uploadCanSubmit}
              aria-busy={uploadSubmitting}
              className={uploadSubmitting ? "installation-ft-page__btn--working" : ""}
            >
              {uploadSubmitting ? (
                <span className="installation-ft-page__btn-label">
                  <span className="installation-ft-page__btn-spinner" aria-hidden />
                  Envoi…
                </span>
              ) : (
                "Enregistrer"
              )}
            </Button>
          </>
        }
      >
        <form id="installation-ft-upload-form" onSubmit={(e) => void handleUploadSubmit(e)}>
          {uploadLocalError ? (
            <div className="installation-ft-page__error installation-ft-page__error--inline" role="alert">
              {uploadLocalError}
            </div>
          ) : null}
          <section className="sn-saas-form-section">
            <h3 className="sn-saas-form-section__title">Informations</h3>
            <div className="sn-saas-field-grid sn-saas-field-grid--2">
              <div>
                <label className="sn-saas-label" htmlFor="installation-ft-name">
                  Nom <span className="installation-ft-page__req">*</span>
                </label>
                <input
                  id="installation-ft-name"
                  className="sn-saas-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex. Panneau X 400W"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="sn-saas-label" htmlFor="installation-ft-ref">
                  Référence <span className="installation-ft-page__req">*</span>
                </label>
                <input
                  id="installation-ft-ref"
                  className="sn-saas-input"
                  value={formReference}
                  onChange={(e) => setFormReference(e.target.value)}
                  placeholder="Référence fabricant"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="sn-saas-label" htmlFor="installation-ft-cat">
                  Catégorie <span className="installation-ft-page__req">*</span>
                </label>
                <select
                  id="installation-ft-cat"
                  className="sn-saas-input"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="sn-saas-label" htmlFor="installation-ft-brand">
                  Marque
                </label>
                <input
                  id="installation-ft-brand"
                  className="sn-saas-input"
                  value={formBrand}
                  onChange={(e) => setFormBrand(e.target.value)}
                  placeholder="Optionnel"
                  autoComplete="off"
                />
              </div>
              <div className="sn-saas-field-span-2">
                <label className="sn-saas-label" htmlFor="installation-ft-status">
                  Statut
                </label>
                <select
                  id="installation-ft-status"
                  className="sn-saas-input"
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as FicheTechniqueStatus)}
                >
                  <option value="active">{STATUS_LABELS.active}</option>
                  <option value="obsolete">{STATUS_LABELS.obsolete}</option>
                  <option value="recommended">{STATUS_LABELS.recommended}</option>
                </select>
              </div>
              <div className="sn-saas-field-span-2">
                <span className="sn-saas-label">
                  PDF <span className="installation-ft-page__req">*</span>
                  <span className="installation-ft-page__hint"> · max. 10 Mo</span>
                </span>
                <div
                  className={`ft-dropzone${dropActive ? " ft-dropzone--active" : ""}`}
                  onDragEnter={preventDefaults}
                  onDragOver={(e) => {
                    preventDefaults(e);
                    setDropActive(true);
                  }}
                  onDragLeave={(e) => {
                    preventDefaults(e);
                    setDropActive(false);
                  }}
                  onDrop={(e) => {
                    preventDefaults(e);
                    setDropActive(false);
                    setPdfFromList(e.dataTransfer.files);
                  }}
                >
                  <p className="ft-dropzone__hint">Glissez-déposez un PDF ou choisissez un fichier.</p>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sn-saas-input"
                    style={{ marginTop: 12 }}
                    onChange={(e) => setPdfFromList(e.target.files)}
                  />
                  {formPdfFile ? <p className="ft-dropzone__file">{formPdfFile.name}</p> : null}
                </div>
              </div>
            </div>
          </section>
        </form>
      </ModalShell>

      <ModalShell
        open={previewOpen}
        onClose={closePreview}
        title={previewRow ? `${previewRow.name} — ${previewRow.reference}` : "Aperçu"}
        subtitle="Lecture sécurisée (aperçu local)"
        size="xl"
        panelClassName="installation-ft-page__preview-modal-panel"
        bodyClassName="installation-ft-page__preview-modal-body"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" onClick={closePreview}>
              Fermer
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!previewBlobUrl || !!previewError}
              onClick={openPreviewInNewTab}
              title="Ouvrir dans un nouvel onglet"
            >
              <span className="installation-ft-page__footer-btn-inner">
                <IconExternalTab />
                Nouvel onglet
              </span>
            </Button>
            <Button
              type="button"
              variant="outlineGold"
              size="sm"
              disabled={!previewRow || downloadingId === previewRow.id}
              onClick={() => previewRow && void handleDownload(previewRow)}
            >
              Télécharger
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={!previewRow} onClick={openMailFromPreview}>
              Envoyer par mail
            </Button>
          </>
        }
      >
        <div className="installation-ft-page__preview-body">
          {!previewLoading && previewBlobUrl && !previewError ? (
            <div className="installation-ft-page__preview-toolbar">
              <span className="installation-ft-page__preview-zoom-label">Zoom</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="installation-ft-page__zoom-btn"
                aria-label="Réduire"
                disabled={previewScale <= 0.5}
                onClick={() => setPreviewScale((s) => Math.max(0.5, Math.round((s - 0.1) * 10) / 10))}
              >
                −
              </Button>
              <span className="installation-ft-page__preview-zoom-value">{Math.round(previewScale * 100)}%</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="installation-ft-page__zoom-btn"
                aria-label="Agrandir"
                disabled={previewScale >= 2}
                onClick={() => setPreviewScale((s) => Math.min(2, Math.round((s + 0.1) * 10) / 10))}
              >
                +
              </Button>
            </div>
          ) : null}
          {previewLoading ? (
            <div className="installation-ft-page__preview-loader" aria-busy="true">
              <div className="installation-ft-page__preview-spinner" />
              <p className="installation-ft-page__preview-loader-text">Chargement du PDF…</p>
            </div>
          ) : null}
          {previewError && !previewLoading ? (
            <div className="installation-ft-page__preview-error" role="alert">
              {previewError}
            </div>
          ) : null}
          {!previewLoading && previewBlobUrl && !previewError ? (
            <div className="installation-ft-page__preview-zoom-outer">
              <div
                className="installation-ft-page__preview-zoom-inner"
                style={{
                  transform: `scale(${previewScale})`,
                  transformOrigin: "top center",
                }}
              >
                <iframe className="installation-ft-page__preview-frame" title="Aperçu PDF" src={previewBlobUrl} />
              </div>
            </div>
          ) : null}
        </div>
      </ModalShell>

      <ModalShell
        open={mailRow != null}
        onClose={closeMail}
        title="Envoyer la fiche technique"
        subtitle={mailRow ? `${mailRow.name} — ${mailRow.reference}` : ""}
        size="md"
        footer={
          mailSuccess ? null : (
            <>
              <Button type="button" variant="secondary" size="sm" disabled={mailSending} onClick={closeMail}>
                Annuler
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={mailSendDisabled}
                aria-busy={mailSending}
                className={mailSending ? "installation-ft-page__btn--working" : ""}
                onClick={() => void handleMailSend()}
              >
                {mailSending ? (
                  <span className="installation-ft-page__btn-label">
                    <span className="installation-ft-page__btn-spinner" aria-hidden />
                    Envoi…
                  </span>
                ) : (
                  "Envoyer"
                )}
              </Button>
            </>
          )
        }
      >
        <div className="sn-saas-field-grid">
          {mailRow ? (
            <div className="installation-ft-page__mail-fiche">
              <span className="installation-ft-page__mail-fiche-label">Fiche</span>
              <p className="installation-ft-page__mail-fiche-title">{mailRow.name}</p>
              <p className="installation-ft-page__mail-fiche-ref">{mailRow.reference}</p>
            </div>
          ) : null}
          {mailSuccess ? (
            <div className="installation-ft-page__mail-success" role="status">
              Message envoyé.
            </div>
          ) : null}
          {!mailSuccess && mailError ? (
            <div className="installation-ft-page__error" role="alert">
              {mailError}
            </div>
          ) : null}
          {!mailSuccess ? (
            <>
              <div>
                <label className="sn-saas-label" htmlFor="installation-ft-mail-to">
                  Email destinataire <span className="installation-ft-page__req">*</span>
                </label>
                <input
                  id="installation-ft-mail-to"
                  type="email"
                  className={`sn-saas-input${mailTo.trim() && !isValidEmail(mailTo) ? " installation-ft-page__input--invalid" : ""}`}
                  value={mailTo}
                  onChange={(e) => setMailTo(e.target.value)}
                  placeholder="contact@exemple.fr"
                  autoComplete="email"
                />
                {mailTo.trim() && !isValidEmail(mailTo) ? (
                  <p className="installation-ft-page__field-hint">Adresse email invalide.</p>
                ) : null}
              </div>
              {mailAccounts.length > 1 ? (
                <div>
                  <label className="sn-saas-label" htmlFor="installation-ft-mail-account">
                    Compte d&apos;envoi
                  </label>
                  <select
                    id="installation-ft-mail-account"
                    className="sn-saas-input"
                    value={mailAccountId}
                    onChange={(e) => setMailAccountId(e.target.value)}
                  >
                    <option value="">Automatique (premier compte autorisé)</option>
                    {mailAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.email}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {mailAccounts.length === 0 && mailRow ? (
                <p className="installation-ft-page__lead">
                  Aucun compte mail actif. Configurez une boîte dans Messagerie pour activer l&apos;envoi.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </ModalShell>
    </Card>
  );
}
