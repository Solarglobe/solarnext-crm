/**
 * Page plein écran dossier DP — Route : /leads/:id/dp
 * Charge GET /api/leads/:id/dp puis ouvre DpOverlay ; à la fermeture, retour fiche lead.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DpOverlay from "../../components/DpOverlay";
import { getCrmApiBase } from "../../config/crmApiBase";
import { apiFetch } from "../../services/api";
import type { DpToolHostContext } from "../../modules/dp/dpToolLoader";

const API_BASE = getCrmApiBase();

type LeadDpApiBody = DpToolHostContext;

function errorMessageForStatus(status: number, body: unknown): string {
  if (status === 404) {
    return "Aucun lead ne correspond à cet identifiant.";
  }
  if (status === 403) {
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
    return "Accès refusé à ce dossier DP.";
  }
  if (status >= 500) {
    return "Erreur serveur. Réessayez plus tard.";
  }
  return "Impossible de charger le dossier DP.";
}

export default function LeadDpPage() {
  const { id: leadId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostPayload, setHostPayload] = useState<LeadDpApiBody | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (String(API_BASE || "").trim()) return;
    console.warn(
      "[DP] VITE_API_URL est absent ou vide pour ce build : le module DP utilisera l’origine de la page (ex. domaine Vercel) pour les requêtes API, ce qui casse la persistance et les PDF. Sur Vercel → Environment Variables (Production), ajoutez par exemple : VITE_API_URL=https://api.solarnext-crm.fr"
    );
  }, []);

  useEffect(() => {
    if (!leadId) {
      setError("Paramètre d’URL manquant");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHostPayload(null);

    const url = `${API_BASE}/api/leads/${encodeURIComponent(leadId)}/dp`;

    apiFetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404 || res.status === 403) {
          let body: unknown = null;
          try {
            body = await res.json();
          } catch {
            /* ignore */
          }
          if (res.status === 403) {
            const code =
              body &&
              typeof body === "object" &&
              "code" in body &&
              typeof (body as { code?: unknown }).code === "string"
                ? (body as { code: string }).code
                : undefined;
            console.warn("[DP ACCESS BLOCKED]", code ?? "(no code)", body);
          }
          setError(errorMessageForStatus(res.status, body));
          return;
        }
        if (!res.ok) {
          setError(errorMessageForStatus(res.status, null));
          return;
        }
        let data: LeadDpApiBody;
        try {
          data = (await res.json()) as LeadDpApiBody;
        } catch {
          setError("Réponse API invalide.");
          return;
        }
        if (!data?.leadId) {
          setError("Données dossier DP incomplètes.");
          return;
        }
        setHostPayload({
          leadId: data.leadId,
          clientId: data.clientId ?? null,
          context: data.context,
          draft: data.draft ?? null,
          updatedAt: data.updatedAt ?? null,
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Erreur réseau — vérifiez votre connexion."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const handleClose = useCallback(() => {
    if (leadId) {
      navigate(`/leads/${leadId}`);
    } else {
      navigate("/leads");
    }
  }, [navigate, leadId]);

  if (loading) {
    return (
      <div className="lead-dp-page">
        <div className="lead-dp-loading">Chargement du dossier DP…</div>
        <style>{`
          .lead-dp-page { padding: 48px; text-align: center; color: var(--text-muted, #9CA8C6); }
          .lead-dp-loading { font-size: 15px; }
        `}</style>
      </div>
    );
  }

  if (error || !leadId || !hostPayload) {
    return (
      <div className="lead-dp-page">
        <div className="lead-dp-error">
          <p>{error || "Impossible d’afficher le dossier DP."}</p>
          <button type="button" onClick={handleClose}>
            Retour au lead
          </button>
        </div>
        <style>{`
          .lead-dp-page { padding: 48px; text-align: center; color: var(--text-muted, #9CA8C6); }
          .lead-dp-error p { margin: 0 0 12px 0; }
          .lead-dp-error button {
            margin-top: 12px;
            padding: 8px 16px;
            background: linear-gradient(135deg, #7C3AED, #6D28D9);
            color: #fff;
            border: none;
            border-radius: 8px;
            cursor: pointer;
          }
        `}</style>
      </div>
    );
  }

  const storageKey = `solarnext-dp-lead-${hostPayload.leadId}`;

  return (
    <DpOverlay
      isOpen
      onClose={handleClose}
      hostPayload={hostPayload}
      storageKey={storageKey}
      apiBase={API_BASE || undefined}
    />
  );
}
