/**
 * Présentation client du devis — route /quotes/:id/present
 * Même rendu que le PDF officiel (QuoteDocumentView) + barre d’actions + signatures interactives.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch, getAuthToken } from "../../services/api";
import {
  getQuoteDocumentViewModel,
  postFinalizeQuoteSigned,
  postGenerateQuotePdf,
} from "../../services/financial.api";
import { Button } from "../../components/ui/Button";
import {
  quoteHasOfficialDocumentSnapshot,
  pickLatestQuotePdf,
  pickLatestSignedQuotePdf,
  pickLatestDocByType,
  QUOTE_DOC_SIGNATURE_CLIENT,
  QUOTE_DOC_SIGNATURE_COMPANY,
} from "./quoteWorkflow";
import { QuoteDocumentView } from "./QuoteDocumentView";
import { QuoteSignaturePadModal } from "./QuoteSignaturePadModal";
import { SIGNATURE_READ_ACCEPTANCE_LABEL_FR } from "./signatureReadAcceptance";
import type { QuotePdfPayload } from "./quoteDocumentTypes";
import { resolvePdfPrimaryColor } from "../../pages/pdf/pdfBrand";
import { quoteShowsOfficialNumber, quoteStatusToUiLabel } from "./quoteUiStatus";
import "./quote-present.css";
import { getCrmApiBase } from "@/config/crmApiBase";

const API_BASE = getCrmApiBase();

interface QuotePdfDocumentRow {
  id: string;
  file_name: string;
  created_at: string;
  document_type?: string | null;
}

export default function QuotePresentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawQuote, setRawQuote] = useState<Record<string, unknown> | null>(null);
  const [documents, setDocuments] = useState<QuotePdfDocumentRow[]>([]);
  const [docMode, setDocMode] = useState<"official" | "draft" | null>(null);
  const [payload, setPayload] = useState<QuotePdfPayload | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [blobBusyId, setBlobBusyId] = useState<string | null>(null);
  const [logoBlobUrl, setLogoBlobUrl] = useState<string | null>(null);
  const [sigClient, setSigClient] = useState<string | null>(null);
  const [sigCompany, setSigCompany] = useState<string | null>(null);
  const [padRole, setPadRole] = useState<"client" | "company" | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [clientReadApproved, setClientReadApproved] = useState(false);
  const [persistedSigClientUrl, setPersistedSigClientUrl] = useState<string | null>(null);
  const [persistedSigCompanyUrl, setPersistedSigCompanyUrl] = useState<string | null>(null);
  const padTargetRef = useRef<"client" | "company">("client");
  const logoObjectUrlRef = useRef<string | null>(null);
  const persistClientObjectUrlRef = useRef<string | null>(null);
  const persistCompanyObjectUrlRef = useRef<string | null>(null);

  const openSignaturePad = (role: "client" | "company") => {
    padTargetRef.current = role;
    setPadRole(role);
  };

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setError("Devis non trouvé");
        setRawQuote(null);
        setDocuments([]);
        setPayload(null);
        setDocMode(null);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
      }
      const json = (await res.json()) as {
        quote: Record<string, unknown>;
        documents?: QuotePdfDocumentRow[];
      };
      setRawQuote(json.quote);
      setDocuments(Array.isArray(json.documents) ? json.documents : []);

      try {
        const vm = await getQuoteDocumentViewModel(id);
        setDocMode(vm.mode);
        setPayload(vm.payload);
        setOrgId(vm.organizationId);
        setError(null);
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : "Impossible de charger le document");
        setPayload(null);
        setDocMode(null);
        setOrgId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setRawQuote(null);
      setPayload(null);
      setDocMode(null);
      setOrgId(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setClientReadApproved(false);
  }, [id]);

  /** Permet au navigateur d’imprimer tout le document (plusieurs pages A4), pas seulement la zone scrollable .sn-main */
  useEffect(() => {
    document.body.classList.add("qp-print-quote-present");
    return () => {
      document.body.classList.remove("qp-print-quote-present");
    };
  }, []);

  useEffect(() => {
    if (!id || !orgId || !payload) {
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
        logoObjectUrlRef.current = null;
      }
      setLogoBlobUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(id)}/pdf-logo`);
        if (cancelled) return;
        if (!res.ok) {
          if (!cancelled) {
            if (logoObjectUrlRef.current) {
              URL.revokeObjectURL(logoObjectUrlRef.current);
              logoObjectUrlRef.current = null;
            }
            setLogoBlobUrl(null);
          }
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(next);
          return;
        }
        if (logoObjectUrlRef.current) URL.revokeObjectURL(logoObjectUrlRef.current);
        logoObjectUrlRef.current = next;
        setLogoBlobUrl(next);
      } catch {
        if (!cancelled) {
          if (logoObjectUrlRef.current) {
            URL.revokeObjectURL(logoObjectUrlRef.current);
            logoObjectUrlRef.current = null;
          }
          setLogoBlobUrl(null);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
        logoObjectUrlRef.current = null;
      }
      setLogoBlobUrl(null);
    };
  }, [id, orgId, payload]);

  const latestPdf = useMemo(() => pickLatestQuotePdf(documents), [documents]);
  const latestSignedPdf = useMemo(() => pickLatestSignedQuotePdf(documents), [documents]);
  const isFinalizeLocked = Boolean(latestSignedPdf);
  const showOfficialOnPresent = useMemo(
    () =>
      quoteShowsOfficialNumber(String(rawQuote?.status ?? ""), {
        quoteSignedPdfRender: isFinalizeLocked,
      }),
    [rawQuote?.status, isFinalizeLocked]
  );
  const clientSigDoc = useMemo(
    () => pickLatestDocByType(documents, QUOTE_DOC_SIGNATURE_CLIENT),
    [documents]
  );
  const companySigDoc = useMemo(
    () => pickLatestDocByType(documents, QUOTE_DOC_SIGNATURE_COMPANY),
    [documents]
  );

  const downloadUrl = (documentId: string) => `${API_BASE}/api/documents/${encodeURIComponent(documentId)}/download`;

  useEffect(() => {
    if (!isFinalizeLocked || !getAuthToken()) {
      if (persistClientObjectUrlRef.current) {
        URL.revokeObjectURL(persistClientObjectUrlRef.current);
        persistClientObjectUrlRef.current = null;
      }
      if (persistCompanyObjectUrlRef.current) {
        URL.revokeObjectURL(persistCompanyObjectUrlRef.current);
        persistCompanyObjectUrlRef.current = null;
      }
      setPersistedSigClientUrl(null);
      setPersistedSigCompanyUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (!clientSigDoc?.id || !companySigDoc?.id) {
          if (!cancelled) {
            setPersistedSigClientUrl(null);
            setPersistedSigCompanyUrl(null);
          }
          return;
        }
        const u = (documentId: string) =>
          `${API_BASE}/api/documents/${encodeURIComponent(documentId)}/download`;
        const [r1, r2] = await Promise.all([apiFetch(u(clientSigDoc.id)), apiFetch(u(companySigDoc.id))]);
        if (cancelled) return;
        if (!r1.ok || !r2.ok) throw new Error("fetch");
        const [b1, b2] = await Promise.all([r1.blob(), r2.blob()]);
        if (cancelled) return;
        const u1 = URL.createObjectURL(b1);
        const u2 = URL.createObjectURL(b2);
        if (persistClientObjectUrlRef.current) URL.revokeObjectURL(persistClientObjectUrlRef.current);
        if (persistCompanyObjectUrlRef.current) URL.revokeObjectURL(persistCompanyObjectUrlRef.current);
        persistClientObjectUrlRef.current = u1;
        persistCompanyObjectUrlRef.current = u2;
        setPersistedSigClientUrl(u1);
        setPersistedSigCompanyUrl(u2);
      } catch {
        if (!cancelled) {
          if (persistClientObjectUrlRef.current) {
            URL.revokeObjectURL(persistClientObjectUrlRef.current);
            persistClientObjectUrlRef.current = null;
          }
          if (persistCompanyObjectUrlRef.current) {
            URL.revokeObjectURL(persistCompanyObjectUrlRef.current);
            persistCompanyObjectUrlRef.current = null;
          }
          setPersistedSigClientUrl(null);
          setPersistedSigCompanyUrl(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isFinalizeLocked, clientSigDoc?.id, companySigDoc?.id]);

  const hasSnapshot = useMemo(() => quoteHasOfficialDocumentSnapshot(rawQuote), [rawQuote]);

  const pdfMessage = useMemo(() => {
    if (latestPdf) return null;
    if (!hasSnapshot) {
      return "Un PDF pourra être généré après figement du document (envoi classique ou validation du devis signé). Avant signature, il s’agit d’une proposition sans numéro officiel.";
    }
    return "Aucun PDF enregistré pour l’instant. Générez-le ci-dessous ou depuis le builder devis.";
  }, [latestPdf, hasSnapshot]);

  const openPdfBlob = async (doc: QuotePdfDocumentRow) => {
    if (!getAuthToken()) return;
    setBlobBusyId(doc.id);
    try {
      const res = await apiFetch(downloadUrl(doc.id));
      if (!res.ok) throw new Error("Erreur chargement");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      window.alert("Impossible d’ouvrir le PDF.");
    } finally {
      setBlobBusyId(null);
    }
  };

  const downloadPdfBlob = async (doc: QuotePdfDocumentRow) => {
    if (!getAuthToken()) return;
    setBlobBusyId(doc.id);
    try {
      const res = await apiFetch(downloadUrl(doc.id));
      if (!res.ok) throw new Error("Erreur téléchargement");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name || "devis.pdf";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      window.alert("Impossible de télécharger le PDF.");
    } finally {
      setBlobBusyId(null);
    }
  };

  const onGeneratePdf = async () => {
    if (!id) return;
    setPdfBusy(true);
    try {
      await postGenerateQuotePdf(id);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur génération PDF");
    } finally {
      setPdfBusy(false);
    }
  };

  const brandColor = useMemo(() => {
    const b = payload?.issuer?.branding as Record<string, string | null> | undefined;
    return resolvePdfPrimaryColor(b?.pdf_primary_color ?? undefined);
  }, [payload]);

  const issuerFallbackName = useMemo(() => {
    const iss = (payload?.issuer || {}) as Record<string, unknown>;
    return String(iss.display_name || "").trim() || "—";
  }, [payload]);

  const refs = (payload?.refs || {}) as Record<string, unknown>;
  const studyId = refs.study_id != null ? String(refs.study_id) : "";
  const studyVersionId = refs.study_version_id != null ? String(refs.study_version_id) : "";
  const leadId = refs.lead_id != null ? String(refs.lead_id) : "";

  const displaySigClient = isFinalizeLocked ? persistedSigClientUrl : sigClient;
  const displaySigCompany = isFinalizeLocked ? persistedSigCompanyUrl : sigCompany;
  const bothSignedLocal = Boolean(sigClient && sigCompany);
  /** Pads + case + date : actifs dès qu’on a un document (brouillon ou officiel), sauf déjà finalisé. */
  const canUseSignaturePads = !isFinalizeLocked && docMode !== null;
  /** PDF signé : une seule action serveur (figement si besoin + PDF + accepté). */
  const canFinalizeSigned =
    !isFinalizeLocked && docMode !== null && bothSignedLocal && clientReadApproved && !finalizeBusy;

  const onValidateSigned = async () => {
    if (!id || isFinalizeLocked) return;
    if (!clientReadApproved) {
      window.alert("Cochez la case attestant que le client a lu et approuvé le devis.");
      return;
    }
    if (!sigClient || !sigCompany) {
      window.alert("Les deux signatures sont obligatoires : client et entreprise.");
      return;
    }
    setFinalizeBusy(true);
    try {
      await postFinalizeQuoteSigned(id, {
        client_read_approved: true,
        signature_client_data_url: sigClient,
        signature_company_data_url: sigCompany,
        signature_client_acceptance: { accepted: true, acceptedLabel: SIGNATURE_READ_ACCEPTANCE_LABEL_FR },
        signature_company_acceptance: { accepted: true, acceptedLabel: SIGNATURE_READ_ACCEPTANCE_LABEL_FR },
      });
      navigate(`/quotes/${id}`, { state: { quoteSignedSaved: true } });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Impossible de finaliser le devis signé.");
    } finally {
      setFinalizeBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="qp-root">
        <p className="qp-muted">Chargement du devis…</p>
      </div>
    );
  }

  if (error && !payload && !rawQuote) {
    return (
      <div className="qp-root">
        <p className="qp-error">{error}</p>
        <Button type="button" variant="primary" onClick={() => navigate("/quotes")}>
          Retour aux devis
        </Button>
      </div>
    );
  }

  if (!payload || !docMode) {
    if (error) {
      return (
        <div className="qp-root">
          <p className="qp-error">{error}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
            Réessayer
          </Button>
          <Button type="button" variant="primary" onClick={() => navigate(`/quotes/${id}`)}>
            Retour au devis
          </Button>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="qp-root">
      <div className="qp-toolbar qp-no-print">
        <div className="qp-toolbar__left">
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate(`/quotes/${id}`)}>
            Retour au devis
          </Button>
          <Button type="button" variant="outlineGold" size="sm" onClick={() => window.print()}>
            Imprimer
          </Button>
          {latestSignedPdf ? (
            <>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={blobBusyId === latestSignedPdf.id}
                onClick={() => void openPdfBlob(latestSignedPdf)}
              >
                Ouvrir le PDF signé
              </Button>
              <Button
                type="button"
                variant="outlineGold"
                size="sm"
                disabled={blobBusyId === latestSignedPdf.id}
                onClick={() => void downloadPdfBlob(latestSignedPdf)}
              >
                Télécharger le PDF signé
              </Button>
            </>
          ) : null}
          {latestPdf ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={blobBusyId === latestPdf.id}
                onClick={() => void openPdfBlob(latestPdf)}
              >
                {latestSignedPdf ? "Ouvrir le PDF (non signé)" : "Ouvrir le PDF"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={blobBusyId === latestPdf.id}
                onClick={() => void downloadPdfBlob(latestPdf)}
              >
                {latestSignedPdf ? "Télécharger le PDF (non signé)" : "Télécharger le PDF"}
              </Button>
            </>
          ) : null}
          {hasSnapshot && !latestPdf ? (
            <Button type="button" variant="ghost" size="sm" disabled={pdfBusy} onClick={() => void onGeneratePdf()}>
              {pdfBusy ? "Génération…" : "Générer le PDF"}
            </Button>
          ) : null}
        </div>
        <div className="qp-toolbar__right">
          {!isFinalizeLocked ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!canFinalizeSigned}
              title={
                !clientReadApproved
                  ? "Cochez l’attestation « Bon pour accord »."
                  : !bothSignedLocal
                    ? "Ajoutez la signature client et la signature entreprise."
                    : docMode !== "official"
                      ? "Un clic : passage en « Envoyé » (figement) si besoin, puis enregistrement du PDF signé (confirmation demandée)."
                      : undefined
              }
              onClick={() => void onValidateSigned()}
            >
              {finalizeBusy ? "Enregistrement…" : "Valider le devis signé"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="qp-toolbar-meta qp-no-print" aria-live="polite">
        <span className="qp-present-ux-status">
          <span className="qp-muted">État</span>{" "}
          <strong>{quoteStatusToUiLabel(String(rawQuote?.status ?? ""))}</strong>
        </span>
        {isFinalizeLocked ? (
          <span className="qp-sign-ok">
            Devis signé — PDF officiel avec signatures enregistré dans le dossier.
          </span>
        ) : (
          <>
            <span className={sigClient ? "qp-sign-ok" : "qp-sign-missing"}>
              Signature client : {sigClient ? "OK" : "manquante"}
            </span>
            <span className={sigCompany ? "qp-sign-ok" : "qp-sign-missing"}>
              Signature entreprise : {sigCompany ? "OK" : "manquante"}
            </span>
            <span className={clientReadApproved ? "qp-sign-ok" : "qp-sign-missing"}>
              Lu et approuvé : {clientReadApproved ? "oui" : "à cocher sur le document"}
            </span>
          </>
        )}
      </div>

      {error ? <p className="qp-error qp-no-print">{error}</p> : null}

      {isFinalizeLocked ? (
        <div className="qp-signed-banner qp-no-print" role="status">
          <strong>Devis signé</strong>
          <span>
            Les signatures sont verrouillées. Utilisez les boutons « PDF signé » pour le document de référence.
          </span>
        </div>
      ) : null}

      {docMode === "draft" ? (
        <div className="qp-draft-banner qp-no-print" role="status">
          <strong>Aperçu brouillon non figé</strong>
          <span>
            Ce document est recalculé en direct tant que la finalisation n’a pas eu lieu. Les signatures et « Valider le devis
            signé » figent officiellement l’offre, génèrent le PDF signé et passent le devis en accepté.
          </span>
        </div>
      ) : null}

      {(studyId && studyVersionId) || leadId ? (
        <div className="qp-context-links qp-no-print">
          {studyId && studyVersionId ? (
            <Link to={`/studies/${studyId}/versions/${studyVersionId}`}>Ouvrir l’étude liée</Link>
          ) : null}
          {leadId ? <Link to={`/leads/${leadId}`}>Voir le dossier (lead)</Link> : null}
        </div>
      ) : null}

      <div className="qp-document-print-area">
        <QuoteDocumentView
          payload={payload}
          variant="present"
          legalMode={showOfficialOnPresent && docMode === "official" ? "official" : "draft"}
          documentVariant={isFinalizeLocked ? "signed_final" : "standard"}
          showOfficialQuoteNumber={showOfficialOnPresent}
          brandColor={brandColor}
          logoSrc={logoBlobUrl}
          issuerFallbackName={issuerFallbackName}
          interactiveSignatures={canUseSignaturePads}
          signatureClientImage={displaySigClient}
          signatureCompanyImage={displaySigCompany}
          onSignatureClientClick={() => openSignaturePad("client")}
          onSignatureCompanyClick={() => openSignaturePad("company")}
          clientReadApproved={isFinalizeLocked ? true : clientReadApproved}
          onClientReadApprovedChange={canUseSignaturePads ? setClientReadApproved : undefined}
        />
      </div>

      {!latestPdf && pdfMessage ? (
        <div className="qp-pdf-banner qp-no-print">
          <strong>PDF enregistré</strong>
          <p style={{ margin: "0.35rem 0 0" }}>{pdfMessage}</p>
        </div>
      ) : null}

      <QuoteSignaturePadModal
        open={padRole !== null}
        onClose={() => setPadRole(null)}
        title={padRole === "company" ? "Signature entreprise" : "Signature client"}
        onConfirm={(payload) => {
          if (padTargetRef.current === "company") setSigCompany(payload.dataUrl);
          else setSigClient(payload.dataUrl);
        }}
      />
    </div>
  );
}
