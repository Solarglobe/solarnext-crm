/**
 * Shell de redirection — la page « étude » principale est le comparatif scénarios.
 * Routes : /studies/:id | /studies/:studyId/versions/:versionId
 * → redirection vers .../versions/:versionUuid/scenarios (version URL ou current_version).
 */

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "../services/api";

const API_BASE = getCrmApiBase();

interface StudyVersionRow {
  id: string;
  version_number: number;
}

interface StudyRow {
  id: string;
  current_version: number;
}

interface StudyPayload {
  study: StudyRow;
  versions: StudyVersionRow[];
}

export default function StudyDetail() {
  const params = useParams<{ id?: string; studyId?: string; versionId?: string }>();
  const studyId = params.studyId ?? params.id ?? undefined;
  const versionIdParam = params.versionId ?? undefined;
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const fetchAndRedirect = useCallback(async () => {
    if (!studyId) return;
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/studies/${studyId}`);
      if (res.status === 404) {
        setError("Étude non trouvée");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
      }
      const data = (await res.json()) as StudyPayload;
      const study = data.study;
      const versions = data.versions ?? [];
      if (versions.length === 0) {
        setError("Aucune version pour cette étude");
        return;
      }

      let targetVersion: StudyVersionRow | undefined;
      if (versionIdParam) {
        targetVersion = versions.find((v) => v.id === versionIdParam);
      }
      if (!targetVersion) {
        targetVersion = versions.find((v) => v.version_number === study.current_version);
      }
      if (!targetVersion) {
        targetVersion = versions[versions.length - 1];
      }

      navigate(`/studies/${study.id}/versions/${targetVersion.id}/scenarios`, {
        replace: true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, [studyId, versionIdParam, navigate]);

  useEffect(() => {
    fetchAndRedirect();
  }, [fetchAndRedirect]);

  if (!studyId) {
    return (
      <div className="study-detail-v2" style={{ padding: 24, textAlign: "center" }}>
        <p>Identifiant d&apos;étude manquant</p>
        <button type="button" className="sg-btn sg-btn-ghost" onClick={() => navigate(-1)}>
          Retour
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="study-detail-v2" style={{ padding: 24, textAlign: "center" }}>
        <p role="alert">{error}</p>
        <button type="button" className="sg-btn sg-btn-ghost" onClick={() => navigate(-1)}>
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="study-detail-v2" style={{ padding: 48, textAlign: "center", color: "var(--text-muted, #9CA8C6)" }}>
      <p>Redirection vers les scénarios…</p>
    </div>
  );
}
