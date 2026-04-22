/**
 * Page plein écran Calpinage — Route : /studies/:studyId/versions/:versionId/calpinage
 * versionId = UUID de la version (study_versions.id). Source de vérité : URL.
 * Affiche CalpinageOverlay ; à la fermeture, redirige vers l'étude (version).
 */

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import CalpinageOverlay from "../../components/CalpinageOverlay";
import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "../../services/api";

const API_BASE = getCrmApiBase();

interface StudyVersion {
  id: string;
  version_number: number;
}

interface StudyData {
  study: { id: string; lead_id?: string };
  versions: StudyVersion[];
}

export default function StudyCalpinagePage() {
  const { studyId, versionId } = useParams<{ studyId: string; versionId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);

  useEffect(() => {
    if (!studyId || !versionId) {
      setError("Paramètres d’URL manquants");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`${API_BASE}/api/studies/${studyId}`)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setError("Étude non trouvée");
          return;
        }
        if (!res.ok) throw new Error("Erreur chargement étude");
        return res.json();
      })
      .then((data: StudyData | undefined) => {
        if (cancelled || !data) return;
        const version = data.versions?.find((v) => v.id === versionId);
        if (!version) {
          setError("Version introuvable");
          return;
        }
        setVersionNumber(version.version_number);
        if (data.study.lead_id) setLeadId(data.study.lead_id);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur de chargement");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studyId, versionId]);

  const handleClose = useCallback(() => {
    if (leadId) {
      navigate(`/leads/${leadId}?tab=studies`);
    } else if (studyId && versionId) {
      // Fallback : lead_id non disponible (étude orpheline), retour à la page étude
      navigate(`/studies/${studyId}/versions/${versionId}`);
    }
  }, [navigate, leadId, studyId, versionId]);

  const handleSaved = useCallback(() => {
    // Optionnel : recharger si besoin (l’overlay a déjà notifié le parent)
  }, []);

  if (loading) {
    return (
      <div className="study-calpinage-page">
        <div className="study-calpinage-loading">Chargement du calpinage…</div>
        <style>{`
          .study-calpinage-page { padding: 48px; text-align: center; color: var(--text-muted, #9CA8C6); }
          .study-calpinage-loading { font-size: 15px; }
          .study-calpinage-error p { margin: 0 0 12px 0; }
          .study-calpinage-error button { padding: 8px 16px; background: linear-gradient(135deg, #7C3AED, #6D28D9); color: #fff; border: none; border-radius: 8px; cursor: pointer; }
        `}</style>
      </div>
    );
  }

  if (error || !studyId || !versionId || versionNumber == null) {
    return (
      <div className="study-calpinage-page">
        <div className="study-calpinage-error">
          <p>{error || "Version introuvable"}</p>
          <button type="button" onClick={() => studyId && versionId && navigate(`/studies/${studyId}/versions/${versionId}`)}>
            Retour à l’étude
          </button>
        </div>
        <style>{`
          .study-calpinage-page { padding: 48px; text-align: center; color: var(--text-muted, #9CA8C6); }
          .study-calpinage-error button { margin-top: 12px; padding: 8px 16px; background: linear-gradient(135deg, #7C3AED, #6D28D9); color: #fff; border: none; border-radius: 8px; cursor: pointer; }
        `}</style>
      </div>
    );
  }

  return (
    <CalpinageOverlay
      studyId={studyId}
      versionId={String(versionNumber)}
      studyVersionId={versionId}
      onClose={handleClose}
      onSaved={handleSaved}
    />
  );
}
