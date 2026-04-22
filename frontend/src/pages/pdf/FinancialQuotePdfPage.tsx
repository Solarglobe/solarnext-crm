/**
 * PDF Devis client — rendu Playwright (snapshot figé uniquement).
 * Paramètres URL : financialQuoteId, renderToken [, quoteSigned=1]
 */

import React, { useEffect, useMemo, useState } from "react";
import { QuoteDocumentView } from "../../modules/quotes/QuoteDocumentView";
import type { QuotePdfPayload } from "../../modules/quotes/quoteDocumentTypes";
import { quoteShowsOfficialNumber } from "../../modules/quotes/quoteUiStatus";
import { resolvePdfPrimaryColor } from "./pdfBrand";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

const API_BASE = getCrmApiBaseWithWindowFallback();

type Status = "loading" | "error" | "ready";

function getSearch() {
  if (typeof window === "undefined") {
    return { financialQuoteId: "", renderToken: "", quoteSigned: false };
  }
  const s = new URLSearchParams(window.location.search);
  return {
    financialQuoteId: s.get("financialQuoteId") ?? "",
    renderToken: s.get("renderToken") ?? "",
    quoteSigned: s.get("quoteSigned") === "1",
  };
}

export default function FinancialQuotePdfPage() {
  const { financialQuoteId, renderToken, quoteSigned } = useMemo(() => getSearch(), []);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<QuotePdfPayload | null>(null);
  const [quoteRowStatus, setQuoteRowStatus] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [logoOk, setLogoOk] = useState(false);
  const [sigClientOk, setSigClientOk] = useState(!quoteSigned);
  const [sigCompanyOk, setSigCompanyOk] = useState(!quoteSigned);

  useEffect(() => {
    (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = false;
    return () => {
      (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = false;
    };
  }, []);

  useEffect(() => {
    if (!financialQuoteId || !renderToken) {
      setStatus("error");
      setErrMsg("Paramètres manquants : financialQuoteId et renderToken requis.");
      return;
    }
    let url = `${API_BASE}/api/internal/pdf-financial-quote/${encodeURIComponent(financialQuoteId)}?renderToken=${encodeURIComponent(renderToken)}`;
    if (quoteSigned) {
      url += "&quoteSigned=1";
    }
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Chargement impossible");
        return res.json();
      })
      .then((data: { ok?: boolean; payload?: QuotePdfPayload; organizationId?: string; quoteStatus?: string | null }) => {
        if (data?.ok === true && data.payload) {
          setPayload(data.payload);
          setQuoteRowStatus(data.quoteStatus != null ? String(data.quoteStatus) : null);
          setOrganizationId(data.organizationId ?? null);
          setStatus("ready");
        } else {
          throw new Error("Réponse invalide");
        }
      })
      .catch(() => {
        setErrMsg("Impossible de charger le devis figé.");
        setStatus("error");
      });
  }, [financialQuoteId, renderToken, quoteSigned]);

  const brandColor = useMemo(() => {
    const b = payload?.issuer?.branding as Record<string, string | null> | undefined;
    return resolvePdfPrimaryColor(b?.pdf_primary_color ?? undefined);
  }, [payload]);

  const logoUrl = useMemo(() => {
    if (!organizationId || !renderToken || !financialQuoteId) return null;
    return `${API_BASE}/api/internal/pdf-asset/${encodeURIComponent(organizationId)}/logo-for-quote?renderToken=${encodeURIComponent(renderToken)}&quoteId=${encodeURIComponent(financialQuoteId)}`;
  }, [organizationId, renderToken, financialQuoteId]);

  const signatureClientUrl = useMemo(() => {
    if (!quoteSigned || !financialQuoteId || !renderToken) return null;
    return `${API_BASE}/api/internal/pdf-quote-signature/${encodeURIComponent(financialQuoteId)}/client?renderToken=${encodeURIComponent(renderToken)}`;
  }, [quoteSigned, financialQuoteId, renderToken]);

  const signatureCompanyUrl = useMemo(() => {
    if (!quoteSigned || !financialQuoteId || !renderToken) return null;
    return `${API_BASE}/api/internal/pdf-quote-signature/${encodeURIComponent(financialQuoteId)}/company?renderToken=${encodeURIComponent(renderToken)}`;
  }, [quoteSigned, financialQuoteId, renderToken]);

  const issuerFallbackName = useMemo(() => {
    const iss = (payload?.issuer || {}) as Record<string, unknown>;
    return String(iss.display_name || "").trim() || "—";
  }, [payload]);

  const showOfficialQuoteNumber = quoteShowsOfficialNumber(quoteRowStatus, {
    quoteSignedPdfRender: quoteSigned,
  });

  useEffect(() => {
    if (status !== "ready" || !payload) return;
    if (logoUrl && !logoOk) return;
    if (quoteSigned && (!sigClientOk || !sigCompanyOk)) return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = true;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [status, payload, logoUrl, logoOk, quoteSigned, sigClientOk, sigCompanyOk]);

  if (status === "loading") {
    return (
      <div className="fq-loading" id="pdf-loading">
        Préparation du document…
      </div>
    );
  }

  if (status === "error" || !payload) {
    return (
      <div className="fq-error" id="pdf-error">
        {errMsg || "Erreur"}
      </div>
    );
  }

  return (
    <QuoteDocumentView
      payload={payload}
      variant="pdf"
      legalMode={showOfficialQuoteNumber ? "official" : "draft"}
      documentVariant={quoteSigned ? "signed_final" : "standard"}
      showOfficialQuoteNumber={showOfficialQuoteNumber}
      brandColor={brandColor}
      logoSrc={logoUrl}
      issuerFallbackName={issuerFallbackName}
      onLogoLoad={() => setLogoOk(true)}
      onLogoError={() => setLogoOk(true)}
      interactiveSignatures={false}
      signatureClientImage={signatureClientUrl}
      signatureCompanyImage={signatureCompanyUrl}
      onSignatureClientImageLoad={() => setSigClientOk(true)}
      onSignatureCompanyImageLoad={() => setSigCompanyOk(true)}
      onSignatureClientImageError={() => {
        setErrMsg("Impossible de charger la signature client pour le PDF.");
        setStatus("error");
      }}
      onSignatureCompanyImageError={() => {
        setErrMsg("Impossible de charger la signature entreprise pour le PDF.");
        setStatus("error");
      }}
      clientReadApproved={quoteSigned}
      pdfReadyMarker={status === "ready"}
    />
  );
}
