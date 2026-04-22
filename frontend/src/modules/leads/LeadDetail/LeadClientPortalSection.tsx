/**
 * Section « Page de suivi client » — lien magique portail (state local uniquement).
 */

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../../services/api";
import { fetchMailAccounts } from "../../../services/mailApi";
import type { MailComposerInitialPrefill } from "../../../pages/mail/MailComposer";
import { Button } from "../../../components/ui/Button";
import "./lead-client-portal-section.css";

export interface LeadClientPortalSectionProps {
  leadId: string;
  apiBase: string;
  /** Intégré dans un accordion CRM : pas de carte ni titre dupliqué */
  embedded?: boolean;
  /** Pour afficher le résumé dans l’en-tête du bloc (section fermée) */
  onLinkStateChange?: (hasActiveLink: boolean) => void;
}

type CreateResponse = {
  token: string;
  expires_at: string | null;
  portal_url: string | null;
};

type StaffPortalGetResponse = {
  active?: boolean;
  expired?: boolean;
  expires_at: string | null;
  portal_url: string | null;
  token: string | null;
  legacy_without_displayable_secret?: boolean;
};

function resolvePortalUrl(data: CreateResponse): string {
  if (data.portal_url && data.portal_url.trim()) {
    return data.portal_url.trim();
  }
  const origin = typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "";
  return `${origin}/crm.html/client-portal/${encodeURIComponent(data.token)}`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function LeadClientPortalSection({
  leadId,
  apiBase,
  embedded = false,
  onLinkStateChange,
}: LeadClientPortalSectionProps) {
  const navigate = useNavigate();
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(true);
  const [bootstrapHint, setBootstrapHint] = useState<string | null>(null);

  useEffect(() => {
    setPortalUrl(null);
    setError(null);
    setFeedback(null);
    setLoading(false);
    setBootstrapHint(null);
    setPortalLoading(true);

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(
          `${apiBase}/api/leads/${encodeURIComponent(leadId)}/client-portal-token`
        );
        if (cancelled || !res.ok) return;
        const j = (await res.json()) as StaffPortalGetResponse;
        if (!j.active) return;
        if (j.legacy_without_displayable_secret) {
          setBootstrapHint(
            "Un lien actif existe déjà, mais l’URL ne peut pas être réaffichée (jeton créé avant la mise à jour). Utilisez « Régénérer le lien » pour afficher une URL."
          );
          return;
        }
        const url =
          j.portal_url?.trim() ||
          (j.token ? resolvePortalUrl({ token: j.token, portal_url: null, expires_at: j.expires_at }) : null);
        if (url) setPortalUrl(url);
      } catch {
        /* silencieux : pas de lien ou API indisponible */
      } finally {
        if (!cancelled) setPortalLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leadId, apiBase]);

  useEffect(() => {
    onLinkStateChange?.(Boolean(portalUrl));
  }, [portalUrl, onLinkStateChange]);

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(null), 3200);
  }, []);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await apiFetch(`${apiBase}/api/leads/${encodeURIComponent(leadId)}/client-portal-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string } & Partial<CreateResponse>;
      if (!res.ok) {
        throw new Error(j.error || "Impossible de créer le lien.");
      }
      const data = j as CreateResponse;
      if (!data.token) {
        throw new Error("Réponse serveur invalide.");
      }
      const url = resolvePortalUrl(data);
      setPortalUrl(url);
      setBootstrapHint(null);
      showFeedback("Lien créé");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [apiBase, leadId, showFeedback]);

  const handleCopy = useCallback(async () => {
    if (!portalUrl) return;
    const ok = await copyTextToClipboard(portalUrl);
    showFeedback(ok ? "Lien copié" : "Copie impossible — sélectionnez le lien manuellement");
  }, [portalUrl, showFeedback]);

  const handleOpen = useCallback(() => {
    if (!portalUrl) return;
    window.open(portalUrl, "_blank", "noopener,noreferrer");
  }, [portalUrl]);

  const handleSendPortalByEmail = useCallback(async () => {
    if (!portalUrl) return;
    const subject = "Votre page de suivi SolarGlobe";
    const bodyText = `Bonjour,\n\nVoici le lien pour suivre votre dossier photovoltaïque :\n${portalUrl}\n\nCordialement`;
    try {
      const accounts = await fetchMailAccounts();
      if (accounts.length > 0) {
        const lines = bodyText.split("\n").map((line) =>
          line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        );
        const bodyHtml = `<p>${lines.join("<br/>")}</p>`;
        const prefill: MailComposerInitialPrefill = {
          crmLeadId: leadId,
          subject,
          bodyHtml,
          composePresentation: "overlay",
        };
        navigate("/mail", { state: { mailComposePrefill: prefill } });
      } else {
        window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
      }
    } catch {
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    }
  }, [portalUrl, navigate, leadId]);

  const rootClass = `lead-client-portal${embedded ? " lead-client-portal--embedded" : ""}`;

  return (
    <section
      className={rootClass}
      aria-labelledby={embedded ? undefined : "lead-client-portal-title"}
      aria-label={embedded ? "Outils lien page de suivi client" : undefined}
    >
      {!embedded ? (
        <h2 id="lead-client-portal-title" className="lead-client-portal__title">
          Page de suivi client
        </h2>
      ) : null}
      {portalLoading ? (
        <p className="lead-client-portal__hint">Chargement du lien…</p>
      ) : !portalUrl ? (
        <>
          {bootstrapHint ? <p className="lead-client-portal__hint">{bootstrapHint}</p> : null}
          <p className="lead-client-portal__hint">
            Générez un lien sécurisé que le client peut utiliser pour consulter l’avancement et les
            documents partagés.
          </p>
          <Button type="button" variant="primary" size="sm" onClick={() => void handleCreate()} disabled={loading}>
            {loading ? "Génération…" : "Créer le lien"}
          </Button>
        </>
      ) : (
        <>
          <p className="lead-client-portal__hint">
            Partagez ce lien avec le client. Le régénérer invalide l’ancien lien.
          </p>
          <div className="lead-client-portal__row">
            <a
              className="lead-client-portal__url lead-client-portal__url-link"
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={portalUrl}
            >
              {portalUrl}
            </a>
          </div>
          <div className="lead-client-portal__actions" style={{ marginTop: 12 }}>
            <Button type="button" variant="outlineGold" size="sm" onClick={() => void handleCopy()}>
              Copier
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={handleOpen}>
              Ouvrir
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void handleSendPortalByEmail()}>
              📨 Écrire
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleCreate()}
              disabled={loading}
            >
              {loading ? "…" : "Régénérer le lien"}
            </Button>
          </div>
          <p className="lead-client-portal__mail-hint">Envoyer depuis votre boîte CRM</p>
        </>
      )}
      {feedback ? <p className="lead-client-portal__feedback">{feedback}</p> : null}
      {error ? <p className="lead-client-portal__error">{error}</p> : null}
    </section>
  );
}
