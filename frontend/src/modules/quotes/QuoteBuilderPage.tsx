/**
 * Builder devis commercial — workbench unique (toolbar, lignes, résumé, notes).
 * Route : /quotes/:id
 */

import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { apiFetch, getAuthToken } from "../../services/api";
import { fetchStudiesByLeadId, type Study } from "../../services/studies.service";
import {
  adminGetQuoteCatalog,
  adminGetQuoteTextTemplates,
  type QuoteCatalogItem,
  type QuoteTextTemplateItem,
} from "../../services/admin.api";
import { ModalShell } from "../../components/ui/ModalShell";
import { Button } from "../../components/ui/Button";
import type { QuoteLine } from "./quote.types";
import { computeMaterialMarginFromLines, computeQuoteTotals } from "./quoteCalc";
import {
  quoteBuilderReducer,
  linesToSaveItems,
  createEmptyMeta,
  buildStateFromApi,
  type QuoteBuilderState,
} from "./QuoteBuilderStore";
import {
  enrichPrepItemsWithCatalogDescriptions,
  fetchQuotePrepEconomicItems,
  quotePrepItemsToQuoteLines,
} from "./quotePrepImport";
import QuoteToolbar from "./QuoteToolbar";
import QuoteWorkflowPanel from "./QuoteWorkflowPanel";
import {
  quoteHasOfficialDocumentSnapshot,
  pickLatestQuotePdf,
  pickLatestSignedQuotePdf,
  type QuoteDocumentListRow,
} from "./quoteWorkflow";
import {
  quoteBuilderTitleDisplay,
  quoteBuilderTitleTechHint,
  quoteIsContentEditableStatus,
  quoteStatusToUiLabel,
  quoteUiBucket,
  quoteUiStatusBadgeClass,
} from "./quoteUiStatus";
import QuoteDocumentSection from "./QuoteDocumentSection";
import QuoteLinesTable from "./QuoteLinesTable";
import QuoteSummaryPanel from "./QuoteSummaryPanel";
import QuoteCommercialSection from "./QuoteCommercialSection";
import QuoteClientContentSection from "./QuoteClientContentSection";
import QuoteInternalNotesSection from "./QuoteInternalNotesSection";
import {
  fetchQuoteInvoiceBillingContext,
  patchQuoteStatus,
  postQuoteAddToDocuments,
  type QuoteInvoiceBillingContext,
} from "../../services/financial.api";
import { getComplementaryLegalDocsStatus } from "../../services/legalCgv.api";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import type { MailComposerInitialPrefill } from "../../pages/mail/MailComposer";
import { useSuperAdminReadOnly } from "../../contexts/OrganizationContext";
import { getCrmApiBase } from "@/config/crmApiBase";
import { assertDocumentDownloadOk, DOCUMENT_DOWNLOAD_UNAVAILABLE } from "../../utils/documentDownload";
import "./quote-builder.css";

const API_BASE = getCrmApiBase();

const EMPTY_TEXT_TEMPLATES: {
  commercial_notes: QuoteTextTemplateItem[];
  technical_details: QuoteTextTemplateItem[];
  payment_terms: QuoteTextTemplateItem[];
} = {
  commercial_notes: [],
  technical_details: [],
  payment_terms: [],
};

export default function QuoteBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, dispatch] = useReducer(quoteBuilderReducer, {
    header: null,
    lines: [],
    meta: createEmptyMeta(),
    dirty: false,
  } as QuoteBuilderState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<QuoteCatalogItem[]>([]);
  const [catalogQ, setCatalogQ] = useState("");
  const [studyModal, setStudyModal] = useState(false);
  const [studies, setStudies] = useState<Study[]>([]);
  const [billCtx, setBillCtx] = useState<QuoteInvoiceBillingContext | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [textTemplates, setTextTemplates] = useState(EMPTY_TEXT_TEMPLATES);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [relativeTick, setRelativeTick] = useState(0);
  const [hasOfficialSnapshot, setHasOfficialSnapshot] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [complementaryDocStatus, setComplementaryDocStatus] = useState<{
    rge: { configured: boolean; file_name: string | null };
    decennale: { configured: boolean; file_name: string | null };
  } | null>(null);
  const [addToDocumentsBusy, setAddToDocumentsBusy] = useState(false);
  const [leadDocConflict, setLeadDocConflict] = useState<{
    existing_document_id: string;
    is_signed: boolean;
    message: string;
  } | null>(null);
  const [linkedDocuments, setLinkedDocuments] = useState<QuoteDocumentListRow[]>([]);
  const [docBlobBusyId, setDocBlobBusyId] = useState<string | null>(null);
  const [signedSavedBanner, setSignedSavedBanner] = useState(false);

  const canEdit = state.header ? quoteIsContentEditableStatus(state.header.status) : false;
  const isReadOnly = useSuperAdminReadOnly();
  const canEditMutations = canEdit && !isReadOnly;

  useEffect(() => {
    if (!lastSavedAt) return;
    const idTimer = window.setInterval(() => setRelativeTick((t) => t + 1), 12000);
    return () => window.clearInterval(idTimer);
  }, [lastSavedAt]);

  useEffect(() => {
    const st = location.state as { quoteSignedSaved?: boolean } | undefined;
    if (!st?.quoteSignedSaved) return;
    setSignedSavedBanner(true);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [location.pathname, location.search, location.state, navigate]);

  const totals = useMemo(
    () =>
      computeQuoteTotals(
        state.lines,
        state.meta.global_discount_percent,
        state.meta.global_discount_amount_ht
      ),
    [state.lines, state.meta.global_discount_percent, state.meta.global_discount_amount_ht]
  );

  const materialMargin = useMemo(
    () =>
      computeMaterialMarginFromLines(
        state.lines.map((l) => ({
          quantity: l.quantity,
          unit_price_ht: l.unit_price_ht,
          purchase_price_ht_cents: l.purchase_unit_price_ht_cents,
        }))
      ),
    [state.lines]
  );

  const latestLinkedPdf = useMemo(() => pickLatestQuotePdf(linkedDocuments), [linkedDocuments]);
  const latestLinkedSignedPdf = useMemo(() => pickLatestSignedQuotePdf(linkedDocuments), [linkedDocuments]);

  const downloadDocUrl = (documentId: string) => `${API_BASE}/api/documents/${encodeURIComponent(documentId)}/download`;

  const openQuoteDocument = useCallback(async (doc: QuoteDocumentListRow) => {
    if (!getAuthToken()) return;
    setDocBlobBusyId(doc.id);
    try {
      const res = await apiFetch(`${API_BASE}/api/documents/${encodeURIComponent(doc.id)}/download`);
      assertDocumentDownloadOk(res, doc.id);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : DOCUMENT_DOWNLOAD_UNAVAILABLE);
    } finally {
      setDocBlobBusyId(null);
    }
  }, []);

  const handleSendQuoteByMail = useCallback(() => {
    if (isReadOnly) return;
    const doc = latestLinkedSignedPdf || latestLinkedPdf;
    if (!doc) {
      window.alert("Aucun PDF de devis disponible.");
      return;
    }
    const clientName = (state.header?.client_display ?? "").trim();
    const prefill: MailComposerInitialPrefill = {
      crmLeadId: state.header?.lead_id ?? null,
      crmClientId: state.header?.client_id ?? null,
      subject: clientName ? `Votre devis solaire — ${clientName}` : "Votre devis solaire",
      documents: [{ id: doc.id, filename: doc.file_name }],
      composePresentation: "overlay",
    };
    navigate("/mail", { state: { mailComposePrefill: prefill } });
  }, [
    latestLinkedPdf,
    latestLinkedSignedPdf,
    navigate,
    state.header?.client_display,
    state.header?.client_id,
    state.header?.lead_id,
    isReadOnly,
  ]);

  const downloadQuoteDocument = async (doc: QuoteDocumentListRow) => {
    if (!getAuthToken()) return;
    setDocBlobBusyId(doc.id);
    try {
      const res = await apiFetch(downloadDocUrl(doc.id));
      if (!res.ok) throw new Error("Erreur");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name || "document.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      window.alert("Impossible de télécharger le document.");
    } finally {
      setDocBlobBusyId(null);
    }
  };

  /** Import quote-prep uniquement si une étude + version sont liées au devis (optionnel). */
  const canImportFromStudy = useMemo(
    () => !!(state.header?.study_id && state.header?.study_version_id),
    [state.header?.study_id, state.header?.study_version_id]
  );

  const hasStudyPrepLines = useMemo(() => state.lines.some((l) => l.line_source === "study_prep"), [state.lines]);

  const importStudyButtonLabel = hasStudyPrepLines ? "Mettre à jour depuis l'étude" : "Importer depuis l'étude";

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setHasOfficialSnapshot(false);
        setLinkedDocuments([]);
        setError("Devis non trouvé");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
      }
      const json = (await res.json()) as {
        quote?: Record<string, unknown>;
        items?: unknown[];
        documents?: QuoteDocumentListRow[];
      };
      const q = json.quote as Record<string, unknown> | undefined;
      if (!q) {
        throw new Error("Réponse invalide");
      }
      setLinkedDocuments(Array.isArray(json.documents) ? json.documents : []);
      setHasOfficialSnapshot(quoteHasOfficialDocumentSnapshot(q));
      const updatedRaw = (q?.updated_at ?? q?.created_at) as string | undefined;
      if (updatedRaw) {
        const d = new Date(updatedRaw);
        if (!Number.isNaN(d.getTime())) setLastSavedAt(d);
      }
      dispatch({
        type: "HYDRATE",
        payload: buildStateFromApi({
          quote: q,
          items: (json.items || []) as Record<string, unknown>[],
        }),
      });
      void getComplementaryLegalDocsStatus()
        .then((d) =>
          setComplementaryDocStatus({
            rge: d.rge,
            decennale: d.decennale,
          })
        )
        .catch(() => setComplementaryDocStatus(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    adminGetQuoteTextTemplates()
      .then(({ items }) => {
        if (cancelled) return;
        const next = {
          commercial_notes: [] as QuoteTextTemplateItem[],
          technical_details: [] as QuoteTextTemplateItem[],
          payment_terms: [] as QuoteTextTemplateItem[],
        };
        for (const it of items) {
          if (it.template_kind === "commercial_notes") next.commercial_notes.push(it);
          else if (it.template_kind === "technical_details") next.technical_details.push(it);
          else if (it.template_kind === "payment_terms") next.payment_terms.push(it);
        }
        setTextTemplates(next);
      })
      .catch(() => {
        if (!cancelled) setTextTemplates(EMPTY_TEXT_TEMPLATES);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const save = useCallback(async () => {
    if (isReadOnly) return;
    if (!id || !state.header || !canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const dep = state.meta.deposit;
      const body: Record<string, unknown> = {
        items: linesToSaveItems(state.lines),
        global_discount_percent: state.meta.global_discount_percent,
        global_discount_amount_ht: state.meta.global_discount_amount_ht,
        validity_days: state.meta.validity_days,
        deposit: {
          type: dep.type,
          value: dep.value,
          ...(dep.note?.trim() ? { note: dep.note.trim() } : {}),
        },
        notes: state.meta.notes,
        commercial_notes: state.meta.commercial_notes,
        technical_notes: state.meta.technical_notes,
        payment_terms: state.meta.payment_terms,
        pdf_show_line_pricing: state.meta.pdf_show_line_pricing,
        legal_documents: state.meta.legal_documents,
      };
      if (state.header.study_id) body.study_id = state.header.study_id;
      if (state.header.study_version_id) body.study_version_id = state.header.study_version_id;
      if (state.meta.study_import != null) {
        body.study_import = state.meta.study_import;
      }

      const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
      }
      dispatch({ type: "MARK_CLEAN" });
      await load();
      setLastSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur enregistrement");
    } finally {
      setSaving(false);
    }
  }, [id, state, canEdit, isReadOnly, load]);

  const changeQuoteStatus = useCallback(
    async (next: string, confirmMsg?: string) => {
      if (isReadOnly) return;
      if (!id) return;
      if (state.dirty) {
        setError("Enregistrez vos modifications avant de changer le statut du devis.");
        return;
      }
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      setStatusBusy(true);
      setError(null);
      try {
        await patchQuoteStatus(id, next);
        await load();
        setLastSavedAt(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur lors du changement de statut");
      } finally {
        setStatusBusy(false);
      }
    },
    [id, state.dirty, isReadOnly, load]
  );

  const markAsSigned = useCallback(async () => {
    if (isReadOnly) return;
    if (!id || !state.header) return;
    if (state.dirty) {
      setError("Enregistrez vos modifications avant de marquer le devis comme signé.");
      return;
    }
    const st = String(state.header.status).toUpperCase();
    if (st === "ACCEPTED") return;
    if (!["SENT", "DRAFT", "READY_TO_SEND"].includes(st)) {
      window.alert("Action impossible pour ce statut.");
      return;
    }

    const hasRecipient = Boolean(
      String(state.header.client_id || "").trim() || String(state.header.lead_id || "").trim()
    );
    if ((st === "DRAFT" || st === "READY_TO_SEND") && !hasRecipient) {
      window.alert("Rattachez une fiche client ou un dossier (lead) sur ce devis.");
      return;
    }

    if (!window.confirm("Marquer ce devis comme signé ? Il ne pourra plus être modifié.")) return;

    setStatusBusy(true);
    setError(null);
    try {
      if (st === "SENT") {
        await patchQuoteStatus(id, "ACCEPTED");
      } else {
        await patchQuoteStatus(id, "SENT");
        await load();
        await patchQuoteStatus(id, "ACCEPTED");
      }
      await load();
      setLastSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors du marquage signé");
    } finally {
      setStatusBusy(false);
    }
  }, [id, state.dirty, state.header, isReadOnly, load]);

  useEffect(() => {
    const leadId = state.header?.lead_id;
    if (!leadId) return;
    void fetchStudiesByLeadId(leadId)
      .then(setStudies)
      .catch(() => setStudies([]));
  }, [state.header?.lead_id]);

  useEffect(() => {
    if (!id || String(state.header?.status).toUpperCase() !== "ACCEPTED") {
      setBillCtx(null);
      return;
    }
    setBillLoading(true);
    setBillCtx(null);
    void fetchQuoteInvoiceBillingContext(id)
      .then(setBillCtx)
      .catch(() => setBillCtx(null))
      .finally(() => setBillLoading(false));
  }, [id, state.header?.status]);

  const openCatalog = async () => {
    if (isReadOnly) return;
    setCatalogOpen(true);
    try {
      const { items } = await adminGetQuoteCatalog({ q: catalogQ || undefined });
      setCatalogItems(items.filter((x) => x.is_active));
    } catch {
      setCatalogItems([]);
    }
  };

  const addCatalogLine = (c: QuoteCatalogItem) => {
    if (isReadOnly) return;
    const unitHt = (Number(c.sale_price_ht_cents) || 0) / 100;
    const vat = (Number(c.default_vat_rate_bps) || 2000) / 100;
    const pCents = Number(c.purchase_price_ht_cents);
    const line: QuoteLine = {
      id: crypto.randomUUID(),
      type: "catalog",
      catalog_item_id: c.id,
      line_source: "manual",
      label: c.name,
      description: c.description?.trim() ? c.description.trim() : "",
      reference: "",
      quantity: 1,
      unit_price_ht: unitHt,
      tva_percent: vat,
      line_discount_percent: 0,
      position: state.lines.length + 1,
      ...(Number.isFinite(pCents) && pCents > 0 ? { purchase_unit_price_ht_cents: Math.floor(pCents) } : {}),
    };
    dispatch({ type: "ADD_LINE", line });
    setCatalogOpen(false);
  };

  const addFreeLine = () => {
    if (isReadOnly) return;
    dispatch({
      type: "ADD_LINE",
      line: {
        id: crypto.randomUUID(),
        type: "custom",
        label: "Prestation",
        description: "",
        reference: "",
        quantity: 1,
        unit_price_ht: 0,
        tva_percent: 20,
        line_discount_percent: 0,
        position: state.lines.length + 1,
      },
    });
  };

  const importFromTechnicalQuote = async () => {
    if (isReadOnly) return;
    if (!id || !state.header || !canEdit) return;
    const sid = state.header.study_id;
    const vid = state.header.study_version_id;
    if (!sid || !vid) {
      window.alert("Liez une étude avec version pour importer le chiffrage technique.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const prep = await fetchQuotePrepEconomicItems(sid, vid);
      if (!prep.items.length) {
        window.alert("Aucune ligne matériel dans le devis technique (quote-prep).");
        return;
      }
      const enriched = await enrichPrepItemsWithCatalogDescriptions(prep.items);
      const manual = state.lines.filter((l) => l.line_source !== "study_prep");
      if (manual.length > 0 && !hasStudyPrepLines) {
        const ok = window.confirm(
          "Vous avez déjà des lignes sans marqueur « étude ». Les lignes du chiffrage technique seront ajoutées en plus (les lignes existantes ne sont pas supprimées). Continuer ?"
        );
        if (!ok) return;
      }
      const studyLines = quotePrepItemsToQuoteLines(enriched);
      const merged = [...manual, ...studyLines];
      const dep = state.meta.deposit;
      const body: Record<string, unknown> = {
        items: linesToSaveItems(merged),
        global_discount_percent: prep.conditions.discount_percent,
        global_discount_amount_ht: prep.conditions.discount_amount_ht,
        study_import: {
          last_at: new Date().toISOString(),
          study_version_id: vid,
        },
        validity_days: state.meta.validity_days,
        deposit: {
          type: dep.type,
          value: dep.value,
          ...(dep.note?.trim() ? { note: dep.note.trim() } : {}),
        },
        notes: state.meta.notes,
        commercial_notes: state.meta.commercial_notes,
        technical_notes: state.meta.technical_notes,
        payment_terms: state.meta.payment_terms,
        pdf_show_line_pricing: state.meta.pdf_show_line_pricing,
        legal_documents: state.meta.legal_documents,
      };
      if (state.header.study_id) body.study_id = state.header.study_id;
      if (state.header.study_version_id) body.study_version_id = state.header.study_version_id;

      const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
      }
      dispatch({ type: "MARK_CLEAN" });
      await load();
      setLastSavedAt(new Date());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur import";
      setError(msg);
      window.alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const openStudyModal = async () => {
    const leadId = state.header?.lead_id;
    if (!leadId) {
      window.alert("Aucun lead associé à ce devis.");
      return;
    }
    setStudyModal(true);
    try {
      setStudies(await fetchStudiesByLeadId(leadId));
    } catch {
      setStudies([]);
    }
  };

  const linkStudy = async (study: Study) => {
    if (isReadOnly) return;
    if (!id) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          study_id: study.id,
          study_version_id: study.latest_version_id || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Erreur");
      }
      setStudyModal(false);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur");
    }
  };

  const duplicate = async () => {
    if (isReadOnly) return;
    if (!id) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Duplication impossible");
      const data = await res.json();
      const newId = data?.quote?.id;
      if (newId) navigate(`/quotes/${newId}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur");
    }
  };

  const handlePdf = useCallback(async () => {
    if (!id || !state.header) return;
    if (isReadOnly) {
      const signed = pickLatestSignedQuotePdf(linkedDocuments);
      const plain = pickLatestQuotePdf(linkedDocuments);
      const doc = signed || plain;
      if (doc) {
        await openQuoteDocument(doc);
        return;
      }
      window.alert("Mode support lecture seule : aucun PDF enregistré à ouvrir. Activez l’édition pour générer un PDF.");
      return;
    }
    if (state.dirty) {
      setError("Enregistrez vos modifications avant de créer le PDF.");
      return;
    }

    const st = String(state.header.status).toUpperCase();
    const bucket = quoteUiBucket(st);

    const tryOpenStored = async (docs: QuoteDocumentListRow[]): Promise<boolean> => {
      const signed = pickLatestSignedQuotePdf(docs);
      const plain = pickLatestQuotePdf(docs);
      if (signed) {
        await openQuoteDocument(signed);
        return true;
      }
      /** Devis accepté sans PDF signé en base : secours non signé (edge). Sinon le non signé n’est pas proposé si un signé existe. */
      if (plain) {
        await openQuoteDocument(plain);
        return true;
      }
      return false;
    };

    const postPdfAndOpen = async () => {
      const ld = state.meta.legal_documents ?? { include_rge: false, include_decennale: false };
      if (complementaryDocStatus) {
        if (ld.include_rge && !complementaryDocStatus.rge.configured) {
          throw new Error(
            "Document RGE non configuré pour cette organisation. Ajoutez le PDF dans Équipes & entreprise → Documents légaux."
          );
        }
        if (ld.include_decennale && !complementaryDocStatus.decennale.configured) {
          throw new Error(
            "Document assurance décennale non configuré pour cette organisation. Ajoutez le PDF dans Équipes & entreprise → Documents légaux."
          );
        }
      }
      const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}/pdf`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "PDF");
      }
      const data = (await res.json().catch(() => ({}))) as {
        downloadUrl?: string;
        document?: { id?: string; file_name?: string };
      };
      const docId =
        data.document?.id ||
        (data.downloadUrl && /\/documents\/([^/]+)\/download/.exec(data.downloadUrl)?.[1]) ||
        null;
      await load();
      if (docId) {
        await openQuoteDocument({
          id: docId,
          file_name: data.document?.file_name || "devis.pdf",
          created_at: new Date().toISOString(),
        });
      }
    };

    setPdfBusy(true);
    setError(null);
    try {
      if (bucket === "signe") {
        if (await tryOpenStored(linkedDocuments)) return;
        if (!quoteHasOfficialDocumentSnapshot(state.header as unknown as { document_snapshot_json?: unknown })) {
          window.alert("Impossible d’afficher le PDF pour le moment.");
          return;
        }
        await postPdfAndOpen();
        return;
      }

      if (bucket === "refuse" || bucket === "annule") {
        if (!(await tryOpenStored(linkedDocuments))) {
          window.alert("Aucun PDF enregistré sur ce devis.");
        }
        return;
      }

      let snap = hasOfficialSnapshot;
      if (!snap && (st === "DRAFT" || st === "READY_TO_SEND")) {
        const hasRecipient = Boolean(
          String(state.header.client_id || "").trim() || String(state.header.lead_id || "").trim()
        );
        if (!hasRecipient) {
          window.alert("Associez un client ou un dossier (lead) pour générer le PDF.");
          return;
        }
        setStatusBusy(true);
        try {
          await patchQuoteStatus(id, "SENT");
          await load();
          const resDetail = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}`);
          const jsonDetail = (await resDetail.json()) as { quote?: Record<string, unknown> };
          snap = quoteHasOfficialDocumentSnapshot(jsonDetail.quote);
        } finally {
          setStatusBusy(false);
        }
        if (!snap) {
          window.alert("Impossible de créer le PDF pour le moment.");
          return;
        }
      }

      if (!snap) {
        window.alert("Impossible de créer le PDF pour le moment.");
        return;
      }

      await postPdfAndOpen();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur PDF");
    } finally {
      setPdfBusy(false);
    }
  }, [
    id,
    isReadOnly,
    state.dirty,
    state.header,
    state.meta.legal_documents,
    hasOfficialSnapshot,
    linkedDocuments,
    load,
    openQuoteDocument,
    complementaryDocStatus,
  ]);

  const handleAddToDocuments = useCallback(async () => {
    if (isReadOnly) return;
    if (!id || !state.header?.lead_id) return;
    if (state.dirty) {
      showCrmInlineToast("Enregistrez d’abord vos modifications.", "error");
      return;
    }
    setAddToDocumentsBusy(true);
    try {
      const data = await postQuoteAddToDocuments(id);
      if (data.status === "conflict") {
        setLeadDocConflict({
          existing_document_id: data.existing_document_id,
          is_signed: data.is_signed,
          message: data.message,
        });
        return;
      }
      if (data.status === "replaced") {
        showCrmInlineToast("Document remplacé dans Documents > Devis.", "success");
      } else {
        showCrmInlineToast("Devis ajouté dans Documents > Devis.", "success");
      }
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Erreur", "error");
    } finally {
      setAddToDocumentsBusy(false);
    }
  }, [id, state.dirty, state.header?.lead_id, isReadOnly]);

  const confirmReplaceLeadDocument = useCallback(async () => {
    if (isReadOnly) return;
    if (!id || !leadDocConflict) return;
    setAddToDocumentsBusy(true);
    try {
      const data = await postQuoteAddToDocuments(id, { force_replace: true });
      setLeadDocConflict(null);
      if (data.status === "conflict") {
        setLeadDocConflict({
          existing_document_id: data.existing_document_id,
          is_signed: data.is_signed,
          message: data.message,
        });
        return;
      }
      if (data.status === "replaced" || data.status === "created") {
        showCrmInlineToast("Document remplacé dans Documents > Devis.", "success");
      }
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Erreur", "error");
    } finally {
      setAddToDocumentsBusy(false);
    }
  }, [id, leadDocConflict, isReadOnly]);

  const removeQuote = async () => {
    if (isReadOnly) return;
    if (!id || !window.confirm("Supprimer définitivement ce devis ?")) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status === 204) navigate("/quotes");
      else throw new Error("Suppression refusée");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur");
    }
  };

  const studyLabel = state.header?.study_id
    ? studies.find((s) => s.id === state.header?.study_id)?.study_number ?? "Étude liée"
    : null;

  if (loading && !state.header) {
    return (
      <div className="qb-page">
        <p className="qb-muted">Chargement du devis…</p>
      </div>
    );
  }

  if (error && !state.header) {
    return (
      <div className="qb-page">
        <p className="qb-error">{error}</p>
        <Button type="button" variant="primary" onClick={() => navigate("/finance")}>
          Vue d&apos;ensemble
        </Button>
      </div>
    );
  }

  if (!state.header) return null;

  const stUpper = String(state.header.status).toUpperCase();
  /** PDF non signé masqué pour un devis ACCEPTÉ dès qu’un PDF signé existe. */
  const showUnsignedPdfActions =
    Boolean(latestLinkedPdf) && (stUpper !== "ACCEPTED" || !latestLinkedSignedPdf);
  const isDraftForDelete = stUpper === "DRAFT";
  const uxLabel = quoteStatusToUiLabel(state.header.status);
  const uxClass = quoteUiStatusBadgeClass(state.header.status);
  const canOfferMarkSigned = ["SENT", "DRAFT", "READY_TO_SEND"].includes(stUpper);
  const markSignedNeedsRecipient = stUpper === "DRAFT" || stUpper === "READY_TO_SEND";
  const hasLeadOrClient = Boolean(
    String(state.header.client_id || "").trim() || String(state.header.lead_id || "").trim()
  );
  let markSignedTitle: string | null = null;
  if (state.dirty) markSignedTitle = "Enregistrez d’abord vos modifications.";
  else if (markSignedNeedsRecipient && !hasLeadOrClient) {
    markSignedTitle = "Rattachez une fiche client ou un dossier lead.";
  }
  const markSignedDisabled =
    !canOfferMarkSigned ||
    state.dirty ||
    saving ||
    statusBusy ||
    isReadOnly ||
    (markSignedNeedsRecipient && !hasLeadOrClient);

  return (
    <div className="qb-page">
      <QuoteToolbar
        quoteNumber={quoteBuilderTitleDisplay(state.header.quote_number, state.header.status)}
        quoteNumberTitle={quoteBuilderTitleTechHint(state.header.quote_number, state.header.status)}
        uxStatusLabel={uxLabel}
        uxStatusClass={uxClass}
        canEdit={canEditMutations}
        saving={saving}
        studyLabel={studyLabel}
        onBack={() => navigate(-1)}
        onSave={() => void save()}
        onSign={() => navigate(`/quotes/${encodeURIComponent(state.header!.id)}/present`)}
        onPdf={() => void handlePdf()}
        pdfBusy={pdfBusy}
        pdfNeedsSave={state.dirty}
        pdfSaveFirstHint="Enregistrez d’abord vos modifications."
        onMarkSigned={() => void markAsSigned()}
        markSignedDisabled={markSignedDisabled}
        markSignedTitle={markSignedTitle}
        statusBusy={statusBusy}
        onDuplicate={() => void duplicate()}
        onLinkStudy={canEditMutations ? openStudyModal : undefined}
        onDelete={isDraftForDelete ? () => void removeQuote() : undefined}
        onMarkRejected={() =>
          void changeQuoteStatus("REJECTED", "Marquer ce devis comme refusé par le client ?")
        }
        onMarkCancelled={() =>
          void changeQuoteStatus("CANCELLED", "Annuler définitivement ce devis ? Cette action est irréversible côté statut.")
        }
        showMarkRejected={stUpper === "SENT"}
        showMarkCancelled={stUpper === "DRAFT" || stUpper === "READY_TO_SEND" || stUpper === "SENT"}
      />

      <QuoteWorkflowPanel
        backendStatus={state.header.status}
        canEditContent={canEditMutations}
        dirty={state.dirty}
        saving={saving}
        lastSavedAt={lastSavedAt}
        relativeTick={relativeTick}
        hasSignedPdf={Boolean(latestLinkedSignedPdf)}
      />

      {signedSavedBanner ? (
        <div
          className="sn-card"
          role="status"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            borderColor: "rgba(46, 125, 50, 0.35)",
            background: "rgba(46, 125, 50, 0.08)",
            fontSize: "0.9rem",
            lineHeight: 1.45,
          }}
        >
          <strong>Devis signé enregistré</strong>
          <p style={{ margin: "0.35rem 0 0" }}>
            Le PDF signé est disponible ci-dessous dans « Documents ». Le devis est passé à « Signé ».
          </p>
          <Button type="button" variant="ghost" size="sm" style={{ marginTop: "0.5rem" }} onClick={() => setSignedSavedBanner(false)}>
            Fermer
          </Button>
        </div>
      ) : null}

      {latestLinkedPdf || latestLinkedSignedPdf ? (
        <section className="qb-linked-docs sn-card" aria-labelledby="qb-linked-pdf-title">
          <h2 id="qb-linked-pdf-title" className="qb-section-title qb-section-title--muted">
            Documents
          </h2>
          <p className="qb-section-hint qb-linked-docs__hint">
            Ouvrez ou téléchargez les fichiers enregistrés. La version signée fait foi après signature.
          </p>
          <div className="qb-linked-docs__actions">
            {latestLinkedSignedPdf ? (
              <>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={docBlobBusyId === latestLinkedSignedPdf.id}
                  onClick={() => void openQuoteDocument(latestLinkedSignedPdf)}
                >
                  Ouvrir le PDF signé
                </Button>
                <Button
                  type="button"
                  variant="outlineGold"
                  size="sm"
                  disabled={docBlobBusyId === latestLinkedSignedPdf.id}
                  onClick={() => void downloadQuoteDocument(latestLinkedSignedPdf)}
                >
                  Télécharger le PDF signé
                </Button>
              </>
            ) : null}
            {showUnsignedPdfActions ? (
              <>
                <Button
                  type="button"
                  variant={latestLinkedSignedPdf ? "outlineGold" : "primary"}
                  size="sm"
                  disabled={docBlobBusyId === latestLinkedPdf!.id}
                  onClick={() => void openQuoteDocument(latestLinkedPdf!)}
                >
                  {latestLinkedSignedPdf ? "Ouvrir le PDF (non signé)" : "Ouvrir le PDF"}
                </Button>
                <Button
                  type="button"
                  variant="outlineGold"
                  size="sm"
                  disabled={docBlobBusyId === latestLinkedPdf!.id}
                  onClick={() => void downloadQuoteDocument(latestLinkedPdf!)}
                >
                  {latestLinkedSignedPdf ? "Télécharger le PDF (non signé)" : "Télécharger le PDF"}
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="outlineGold"
              size="sm"
              disabled={state.dirty || isReadOnly}
              title={state.dirty ? "Enregistrez d’abord vos modifications." : undefined}
              onClick={() => void handleSendQuoteByMail()}
            >
              📧 Envoyer par mail
            </Button>
            {state.header.lead_id ? (
              <Button
                type="button"
                variant="outlineGold"
                size="sm"
                className="qb-linked-docs__btn-add-documents"
                disabled={addToDocumentsBusy || state.dirty || isReadOnly}
                title={state.dirty ? "Enregistrez d’abord vos modifications." : undefined}
                onClick={() => void handleAddToDocuments()}
              >
                {addToDocumentsBusy ? "Ajout…" : "Ajouter aux documents"}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? <p className="qb-error-inline">{error}</p> : null}

      <nav className="fin-entity-links" aria-label="Navigation contextuelle">
        {state.header.lead_id ? (
          <Link to={`/leads/${state.header.lead_id}`}>Dossier lead</Link>
        ) : null}
        {state.header.study_id && state.header.study_version_id ? (
          <Link to={`/studies/${state.header.study_id}/versions/${state.header.study_version_id}`}>Étude liée</Link>
        ) : null}
        {state.header.client_id ? <Link to={`/clients/${state.header.client_id}`}>Fiche client</Link> : null}
        {String(state.header.status).toUpperCase() === "ACCEPTED" && id ? (
          <>
            {billLoading ? (
              <span className="qb-muted">Facturation…</span>
            ) : (
              <>
                {billCtx?.quote_zero_total ? (
                  <span className="qb-muted" role="status">
                    Total devis nul : facturation depuis ce devis (acompte, solde ou facture complète) indisponible.
                  </span>
                ) : null}
                {billCtx && !billCtx.quote_zero_total ? (
                  <span className="qb-muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                    Total devis{" "}
                    {(billCtx.quote_total_ttc ?? 0).toLocaleString("fr-FR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    € · Déjà engagé{" "}
                    {(billCtx.invoiced_ttc ?? 0).toLocaleString("fr-FR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    € · Reste{" "}
                    {(billCtx.remaining_ttc ?? 0).toLocaleString("fr-FR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    €
                  </span>
                ) : null}
                {billCtx?.can_create_deposit ? (
                  <Link to={`/invoices/new?fromQuote=${encodeURIComponent(id)}&billingRole=DEPOSIT`}>
                    Créer acompte
                  </Link>
                ) : null}
                {billCtx?.can_create_balance ? (
                  <Link
                    to={`/invoices/new?fromQuote=${encodeURIComponent(id)}&billingRole=solde&amountTtc=${encodeURIComponent(
                      String(billCtx.remaining_ttc ?? 0)
                    )}`}
                  >
                    Créer facture solde
                  </Link>
                ) : null}
                {billCtx?.can_create_standard_full ? (
                  <Link to={`/invoices/new?fromQuote=${encodeURIComponent(id)}&billingRole=STANDARD`}>
                    Facture complète (lignes devis)
                  </Link>
                ) : null}
                {!billCtx?.can_create_deposit &&
                !billCtx?.can_create_balance &&
                !billCtx?.can_create_standard_full &&
                billCtx ? (
                  <span className="qb-muted" title="Création de facture depuis la liste ou le hub si besoin.">
                    Facturation à jour pour ce devis
                  </span>
                ) : null}
                {!billLoading && !billCtx && id && String(state.header.status).toUpperCase() === "ACCEPTED" ? (
                  <Link to={`/invoices/new?fromQuote=${encodeURIComponent(id)}&billingRole=STANDARD`}>
                    Créer une facture (complet)
                  </Link>
                ) : null}
              </>
            )}
          </>
        ) : null}
        <Link to="/quotes">Liste des devis</Link>
        <Link to="/finance">Vue d&apos;ensemble</Link>
      </nav>

      <div className="qb-workbench">
        <QuoteDocumentSection
          quoteNumber={state.header.quote_number}
          status={state.header.status}
          clientDisplay={state.header.client_display ?? null}
          pdfShowLinePricing={state.meta.pdf_show_line_pricing}
          canEdit={canEditMutations}
          onPdfShowLinePricingChange={(v) => dispatch({ type: "SET_META", payload: { pdf_show_line_pricing: v } })}
          legalDocuments={state.meta.legal_documents}
          onLegalDocumentsChange={(patch) =>
            dispatch({
              type: "SET_META",
              payload: {
                legal_documents: {
                  include_rge: patch.include_rge ?? state.meta.legal_documents?.include_rge ?? false,
                  include_decennale:
                    patch.include_decennale ?? state.meta.legal_documents?.include_decennale ?? false,
                },
              },
            })
          }
          complementaryConfigured={
            complementaryDocStatus
              ? {
                  rge: complementaryDocStatus.rge.configured,
                  decennale: complementaryDocStatus.decennale.configured,
                }
              : null
          }
          studyId={state.header.study_id}
          studyVersionId={state.header.study_version_id}
          studyLabel={studyLabel}
        />

        <div className="qb-workbench-surface sn-card">
          <section className="qb-section qb-section--lines" aria-labelledby="qb-lines-title">
            <header className="qb-lines-head">
              <div className="qb-lines-head-text">
                <h2 id="qb-lines-title" className="qb-section-title qb-section-title--hero">
                  Lignes du devis
                </h2>
                <p className="qb-section-hint">
                  Ajoutez des lignes ; réordonnez par glisser-déposer.
                </p>
              </div>
              <div className="qb-lines-cta qb-lines-cta--premium" role="group" aria-label="Ajouter des lignes">
                <Button
                  type="button"
                  className="qb-lines-btn qb-lines-btn--secondary"
                  variant="ghost"
                  size="sm"
                  disabled={!canEditMutations}
                  onClick={() => void openCatalog()}
                >
                  Catalogue
                </Button>
                <Button
                  type="button"
                  className="qb-lines-btn qb-lines-btn--secondary"
                  variant="ghost"
                  size="sm"
                  disabled={!canEditMutations}
                  onClick={addFreeLine}
                >
                  Ligne libre
                </Button>
                <Button
                  type="button"
                  className="qb-lines-btn qb-lines-btn--tertiary"
                  variant="ghost"
                  size="sm"
                  disabled={!canEditMutations || !canImportFromStudy}
                  title={
                    canImportFromStudy
                      ? "Remplace uniquement les lignes marquées « étude » ; conserve catalogue et lignes libres ajoutées manuellement."
                      : "Liez une étude avec version (menu Actions) pour importer le chiffrage technique."
                  }
                  onClick={() => void importFromTechnicalQuote()}
                >
                  {importStudyButtonLabel}
                </Button>
              </div>
            </header>
            <QuoteLinesTable
              lines={state.lines}
              canEdit={canEditMutations}
              docShowLinePricing={state.meta.pdf_show_line_pricing}
              onChangeLine={(lid, patch) => dispatch({ type: "UPDATE_LINE", id: lid, patch })}
              onRemoveLine={(lid) => dispatch({ type: "REMOVE_LINE", id: lid })}
              onReorder={(a, b) => dispatch({ type: "REORDER", activeId: a, overId: b })}
            />
          </section>

          <div className="qb-divider" role="presentation" />

          <QuoteSummaryPanel
            totals={totals}
            globalDiscountPercent={state.meta.global_discount_percent}
            globalDiscountAmountHt={state.meta.global_discount_amount_ht}
            validityDays={state.meta.validity_days}
            deposit={state.meta.deposit}
            linesCount={state.lines.length}
            studyLinked={canImportFromStudy}
            studyLabel={studyLabel}
            validUntil={state.header.valid_until}
            materialMarginMargeHt={materialMargin.margeHt}
            materialMarginTauxSurAchatPct={materialMargin.tauxMargeSurAchatPct}
          />

          <div className="qb-divider" role="presentation" />

          <details className="qb-secondary-sections" open>
            <summary className="qb-secondary-sections__summary">
              Conditions commerciales, textes PDF et notes internes — replier / déplier
            </summary>
            <div className="qb-secondary-sections__body">
              <section className="qb-section" aria-labelledby="qb-commercial-title">
                <h2 id="qb-commercial-title" className="qb-section-title">
                  Conditions commerciales
                </h2>
                <p className="qb-section-hint">Acompte, validité du devis et remise sur le document (HT).</p>
                <QuoteCommercialSection
                  canEdit={canEditMutations}
                  deposit={state.meta.deposit}
                  onDepositChange={(patch) =>
                    dispatch({ type: "SET_META", payload: { deposit: { ...state.meta.deposit, ...patch } } })
                  }
                  validityDays={state.meta.validity_days}
                  globalDiscountPercent={state.meta.global_discount_percent}
                  globalDiscountAmountHt={state.meta.global_discount_amount_ht}
                  onValidityDaysChange={(n) => dispatch({ type: "SET_META", payload: { validity_days: n } })}
                  onGlobalDiscountPercentChange={(n) =>
                    dispatch({ type: "SET_META", payload: { global_discount_percent: n } })
                  }
                  onGlobalDiscountAmountHtChange={(n) =>
                    dispatch({ type: "SET_META", payload: { global_discount_amount_ht: n } })
                  }
                />
              </section>

              <div className="qb-divider" role="presentation" />

              <section className="qb-section" aria-labelledby="qb-client-title">
                <h2 id="qb-client-title" className="qb-section-title">
                  Contenu client (PDF)
                </h2>
                <p className="qb-section-hint">Textes visibles côté client sur le devis PDF.</p>
                <QuoteClientContentSection
                  canEdit={canEditMutations}
                  commercialNotes={state.meta.commercial_notes}
                  technicalNotes={state.meta.technical_notes}
                  paymentTerms={state.meta.payment_terms}
                  templatesCommercial={textTemplates.commercial_notes}
                  templatesTechnical={textTemplates.technical_details}
                  templatesPayment={textTemplates.payment_terms}
                  onCommercialNotesChange={(v) => dispatch({ type: "SET_META", payload: { commercial_notes: v } })}
                  onTechnicalNotesChange={(v) => dispatch({ type: "SET_META", payload: { technical_notes: v } })}
                  onPaymentTermsChange={(v) => dispatch({ type: "SET_META", payload: { payment_terms: v } })}
                />
              </section>

              <div className="qb-divider" role="presentation" />

              <section className="qb-section qb-section--internal" aria-labelledby="qb-internal-title">
                <h2 id="qb-internal-title" className="qb-section-title qb-section-title--muted">
                  Notes internes équipe
                </h2>
                <p className="qb-section-hint qb-section-hint--internal">Hors PDF client — usage interne.</p>
                <QuoteInternalNotesSection
                  canEdit={canEditMutations}
                  notes={state.meta.notes}
                  onNotesChange={(v) => dispatch({ type: "SET_META", payload: { notes: v } })}
                />
              </section>
            </div>
          </details>
        </div>
      </div>

      <ModalShell
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        title="Catalogue"
        subtitle="Sélectionnez un module à ajouter"
        size="lg"
        footer={
          <Button type="button" variant="ghost" onClick={() => setCatalogOpen(false)}>
            Fermer
          </Button>
        }
      >
        <input
          className="sn-input"
          placeholder="Rechercher…"
          value={catalogQ}
          onChange={(e) => setCatalogQ(e.target.value)}
          style={{ marginBottom: 12, width: "100%" }}
        />
        <div className="qb-catalog-list">
          {catalogItems
            .filter((c) => !catalogQ || c.name.toLowerCase().includes(catalogQ.toLowerCase()))
            .map((c) => (
              <button
                key={c.id}
                type="button"
                className="qb-catalog-row"
                onClick={() => addCatalogLine(c)}
              >
                <span className="qb-catalog-name">{c.name}</span>
                <span className="qb-muted">{(c.sale_price_ht_cents / 100).toFixed(2)} € HT</span>
              </button>
            ))}
        </div>
      </ModalShell>

      <ModalShell
        open={leadDocConflict != null}
        onClose={() => setLeadDocConflict(null)}
        title="Document déjà existant"
        size="sm"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button type="button" variant="ghost" onClick={() => setLeadDocConflict(null)} disabled={addToDocumentsBusy}>
              Annuler
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void confirmReplaceLeadDocument()}
              disabled={addToDocumentsBusy}
            >
              {addToDocumentsBusy ? "Remplacement…" : "Remplacer"}
            </Button>
          </div>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          Un document pour ce devis est déjà enregistré. Voulez-vous le remplacer par la version actuelle (signée) ?
        </p>
      </ModalShell>

      <ModalShell
        open={studyModal}
        onClose={() => setStudyModal(false)}
        title="Lier une étude"
        size="sm"
      >
        <ul className="qb-study-list">
          {studies.map((s) => (
            <li key={s.id}>
              <button type="button" className="qb-study-pick" onClick={() => void linkStudy(s)}>
                {s.study_number} {s.title ? `— ${s.title}` : ""}
              </button>
            </li>
          ))}
        </ul>
        {studies.length === 0 ? <p className="qb-muted">Aucune étude sur ce dossier.</p> : null}
      </ModalShell>
    </div>
  );
}
