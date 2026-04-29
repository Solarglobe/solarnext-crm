/**
 * Page principale étude : comparatif scénarios V2 (lecture seule moteur).
 * Route : /studies/:studyId/versions/:versionId/scenarios
 * Données : GET study + GET scenarios (aucun recalcul ici).
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../../services/api";
import { forkStudyVersionApi, patchStudyTitle, type StudyWithVersions } from "../../services/studies.service";
import ScenarioComparisonTable, { type ScenarioV2 as ScenarioV2Type } from "../../components/study/ScenarioComparisonTable";
import ScenarioEconomicsChart from "../../components/study/ScenarioEconomicsChart";
import StudyCalcTracePanel from "../../components/study/StudyCalcTracePanel";
import type { StudyVersionDataJson } from "../../services/studies.service";
import { useSuperAdminReadOnly } from "../../contexts/OrganizationContext";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";
import { openAuthenticatedDocumentInNewTab } from "@/utils/documentDownload";

const API_BASE = getCrmApiBaseWithWindowFallback();

type ScenarioId = "BASE" | "BATTERY_PHYSICAL" | "BATTERY_VIRTUAL";

type ScenarioV2 = ScenarioV2Type;

const COLUMN_ORDER: ScenarioId[] = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL"];
const COLUMN_LABELS: Record<ScenarioId, string> = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
};

function showToast(message: string, isError: boolean) {
  const toast = document.createElement("div");
  toast.setAttribute("role", "alert");
  toast.className = isError ? "study-quote-toast study-quote-toast-error" : "study-quote-toast study-quote-toast-success";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function normalizeOrderedScenarios(scenarios: ScenarioV2Type[]): (ScenarioV2Type | null)[] {
  const byId = new Map<string, ScenarioV2Type>();
  scenarios.forEach((s) => {
    const id = (s.id ?? s.type ?? "") as string;
    if (id) byId.set(id, s);
  });
  return COLUMN_ORDER.map((id) => byId.get(id) ?? null);
}

function parseSelectedScenarioId(raw: unknown): ScenarioId | null {
  if (raw === "BASE" || raw === "BATTERY_PHYSICAL" || raw === "BATTERY_VIRTUAL") return raw;
  return null;
}

export default function ScenariosPage() {
  const { studyId, versionId } = useParams<{ studyId: string; versionId: string }>();
  const navigate = useNavigate();
  const [studyPack, setStudyPack] = useState<StudyWithVersions | null>(null);
  const [studyLoadError, setStudyLoadError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioV2Type[]>([]);
  const [scenariosError, setScenariosError] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [versionLocked, setVersionLocked] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState<ScenarioId | null>(null);
  const [selectingId, setSelectingId] = useState<ScenarioId | null>(null);
  const [pdfFlowBusy, setPdfFlowBusy] = useState(false);
  const [redownloading, setRedownloading] = useState(false);
  const [modifierLoading, setModifierLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const isReadOnly = useSuperAdminReadOnly();

  const orderedScenarios = useMemo(() => normalizeOrderedScenarios(scenarios), [scenarios]);
  const availableCount = orderedScenarios.filter(Boolean).length;

  const study = studyPack?.study;
  const studyDisplayName =
    (study?.title != null && String(study.title).trim() !== "")
      ? String(study.title).trim()
      : study?.study_number ?? "Étude";

  const refreshStudy = useCallback(async () => {
    if (!studyId) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/studies/${encodeURIComponent(studyId)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStudyLoadError((err as { error?: string }).error || `Erreur ${res.status}`);
        setStudyPack(null);
        return;
      }
      const data = (await res.json()) as StudyWithVersions;
      setStudyPack(data);
      setStudyLoadError(null);
      const ver = data.versions?.find((v) => v.id === versionId);
      if (ver) setVersionNumber(ver.version_number);
    } catch {
      setStudyLoadError("Erreur chargement étude");
      setStudyPack(null);
    }
  }, [studyId, versionId]);

  const fetchScenariosOnly = useCallback(async () => {
    if (!studyId || !versionId) return;
    setScenariosError(null);
    setScenarios([]);
    setVersionLocked(false);
    setSelectedScenarioId(null);
    try {
      const res = await apiFetch(
        `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/scenarios`
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        scenarios?: ScenarioV2Type[];
        error?: string;
        is_locked?: boolean;
        selected_scenario_id?: string | null;
      };
      if (res.status === 404 && body.error === "SCENARIOS_NOT_GENERATED") {
        setScenariosError("SCENARIOS_NOT_GENERATED");
        return;
      }
      if (!res.ok) {
        setScenariosError(body.error || `Erreur ${res.status}`);
        showToast("Erreur chargement scénarios", true);
        return;
      }
      if (body.ok && Array.isArray(body.scenarios)) {
        if (import.meta.env.DEV) {
          console.log("[SCENARIOS_V2]", body.scenarios.length, "scénarios");
        }
        setScenarios(body.scenarios);
        setVersionLocked(body.is_locked === true);
        setSelectedScenarioId(parseSelectedScenarioId(body.selected_scenario_id));
      }
    } catch (e) {
      setScenariosError(e instanceof Error ? e.message : "Erreur chargement scénarios");
      showToast("Erreur chargement scénarios", true);
    }
  }, [studyId, versionId]);

  useEffect(() => {
    if (!studyId || !versionId) return;
    let cancelled = false;
    (async () => {
      setInitialLoad(true);
      await Promise.all([refreshStudy(), fetchScenariosOnly()]);
      if (!cancelled) setInitialLoad(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [studyId, versionId, refreshStudy, fetchScenariosOnly]);

  const handleSelectScenario = useCallback(
    async (scenarioId: ScenarioId, _ctx?: { addToDocuments?: boolean }) => {
      if (isReadOnly) return;
      if (!studyId || !versionId) return;
      const base = API_BASE.replace(/\/$/, "");
      const addToDocuments = true;
      setPdfFlowBusy(true);
      setSelectingId(scenarioId);
      try {
        const pdfRes = await apiFetch(
          `${base}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/generate-pdf-from-scenario`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scenario_id: scenarioId,
              ...(addToDocuments ? { add_to_documents: true } : {}),
            }),
          }
        );
        const body = (await pdfRes.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          message?: string;
          downloadUrl?: string;
          fileName?: string;
          leadDocument?: {
            status?: string;
            id?: string;
            reason?: string;
            message?: string;
          };
        };

        if (!pdfRes.ok) {
          showToast(
            body.message || body.error || (pdfRes.status >= 500 ? "Génération PDF impossible" : "Requête invalide"),
            true
          );
          return;
        }
        if (!body.success || !body.downloadUrl) {
          showToast(body.error || body.message || "Génération PDF impossible", true);
          return;
        }

        try {
          await openAuthenticatedDocumentInNewTab(body.downloadUrl);
        } catch (e) {
          showToast(e instanceof Error ? e.message : "Téléchargement PDF échoué", true);
          return;
        }

        await fetchScenariosOnly();
        await refreshStudy();
        showToast("Document généré", false);

        if (addToDocuments && body.leadDocument) {
          const ld = body.leadDocument;
          window.setTimeout(() => {
            if (ld.status === "created") {
              showToast("Proposition ajoutée dans Documents > Propositions commerciales", false);
            } else if (ld.status === "existing") {
              showToast("Cette proposition est déjà présente dans Documents", false);
            } else if (ld.status === "skipped" && ld.reason === "NO_LEAD") {
              showToast(
                "Étude sans dossier lead : impossible d’ajouter la proposition aux documents du client.",
                true
              );
            } else if (ld.status === "error") {
              showToast(
                ld.reason === "STORAGE_KEY_MISSING"
                  ? "PDF généré, mais l’ajout aux documents a échoué (fichier source introuvable)."
                  : "PDF généré, mais l’ajout aux documents du dossier a échoué.",
                true
              );
            }
          }, 380);
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Erreur lors de la génération", true);
      } finally {
        setPdfFlowBusy(false);
        setSelectingId(null);
      }
    },
    [isReadOnly, studyId, versionId, fetchScenariosOnly, refreshStudy]
  );

  const handleRedownloadPdf = useCallback(async () => {
    if (isReadOnly) return;
    if (!studyId || !versionId) return;
    const base = API_BASE.replace(/\/$/, "");
    setRedownloading(true);
    setPdfFlowBusy(true);
    try {
      const pdfRes = await apiFetch(
        `${base}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/generate-pdf`,
        { method: "POST" }
      );
      const pdfBody = (await pdfRes.json().catch(() => ({}))) as {
        downloadUrl?: string;
        fileName?: string;
        error?: string;
      };
      if (!pdfRes.ok || !pdfBody.downloadUrl) {
        showToast(pdfBody.error || "Impossible de régénérer le PDF", true);
        return;
      }
      await openAuthenticatedDocumentInNewTab(pdfBody.downloadUrl);
      showToast("Document généré", false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Erreur", true);
    } finally {
      setRedownloading(false);
      setPdfFlowBusy(false);
    }
  }, [isReadOnly, studyId, versionId]);

  const handleModifierEtude = useCallback(async () => {
    if (isReadOnly) return;
    if (!studyId || !versionId) return;
    if (!versionLocked) {
      navigate(`/studies/${studyId}/versions/${versionId}/calpinage`);
      return;
    }
    setModifierLoading(true);
    try {
      const nv = await forkStudyVersionApi(studyId, versionId);
      navigate(`/studies/${studyId}/versions/${nv.id}/calpinage`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Fork impossible", true);
    } finally {
      setModifierLoading(false);
    }
  }, [isReadOnly, studyId, versionId, versionLocked, navigate]);

  const startTitleEdit = () => {
    if (isReadOnly) return;
    setTitleDraft(studyDisplayName);
    setEditingTitle(true);
  };

  const cancelTitleEdit = () => {
    setEditingTitle(false);
  };

  const saveTitle = async () => {
    if (isReadOnly) return;
    if (!studyId) return;
    const next = titleDraft.trim();
    if (next === "") {
      showToast("Le nom ne peut pas être vide", true);
      return;
    }
    setTitleSaving(true);
    try {
      const updated = await patchStudyTitle(studyId, { title: next });
      setStudyPack(updated);
      setEditingTitle(false);
      showToast("Nom enregistré", false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Erreur enregistrement", true);
    } finally {
      setTitleSaving(false);
    }
  };

  const navCalpinage = () => {
    if (studyId && versionId) navigate(`/studies/${studyId}/versions/${versionId}/calpinage`);
  };
  const navQuote = () => {
    if (studyId && versionId) navigate(`/studies/${studyId}/versions/${versionId}/quote-builder`);
  };
  const navLead = () => {
    if (study?.lead_id) navigate(`/leads/${study.lead_id}`);
  };

  if (!studyId || !versionId) {
    return (
      <div className="scenarios-page" style={{ padding: "var(--spacing-24)", maxWidth: 720, margin: "0 auto" }}>
        <p className="sg-text sg-state-error">Paramètres de route manquants.</p>
      </div>
    );
  }

  if (initialLoad) {
    return (
      <div className="scenarios-page" style={{ padding: "var(--spacing-24)", maxWidth: 1200, margin: "0 auto" }}>
        <p className="sg-text">Chargement…</p>
      </div>
    );
  }

  if (studyLoadError || !studyPack) {
    return (
      <div className="scenarios-page" style={{ padding: "var(--spacing-24)", maxWidth: 720, margin: "0 auto" }}>
        <p className="sg-text sg-state-error">{studyLoadError || "Étude introuvable"}</p>
        <button type="button" className="sg-btn sg-btn-ghost" style={{ marginTop: 16 }} onClick={() => navigate(-1)}>
          Retour
        </button>
      </div>
    );
  }

  const versionTraceData: StudyVersionDataJson | undefined = studyPack.versions?.find(
    (v) => v.id === versionId
  )?.data;

  const headerBlock = (
    <div style={{ marginBottom: "var(--spacing-20)", borderBottom: "1px solid var(--sn-border-soft)", paddingBottom: "var(--spacing-16)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 12 }}>
        {editingTitle ? (
          <>
            <input
              type="text"
              className="sg-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelTitleEdit();
                if (e.key === "Enter") void saveTitle();
              }}
              style={{
                flex: "1 1 200px",
                minWidth: 180,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--sn-border-soft)",
                background: "var(--sn-bg-surface)",
                color: "var(--sn-text-primary)",
              }}
              autoFocus
              disabled={titleSaving || versionLocked || isReadOnly}
              aria-label="Nom de l'étude"
            />
            <button type="button" className="sg-btn sg-btn-primary" onClick={() => void saveTitle()} disabled={titleSaving || versionLocked || isReadOnly}>
              {titleSaving ? "…" : "✔"}
            </button>
            <button type="button" className="sg-btn sg-btn-ghost" onClick={cancelTitleEdit} disabled={titleSaving}>
              Annuler
            </button>
          </>
        ) : (
          <>
            <h1 className="sg-title-lg" style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--sn-text-primary)" }}>
              {studyDisplayName}
            </h1>
            <button
              type="button"
              className="sg-btn sg-btn-ghost sn-btn-sm"
              onClick={startTitleEdit}
              disabled={versionLocked || isReadOnly}
              title={versionLocked ? "Version verrouillée" : "Renommer l'étude"}
              aria-label="Renommer l'étude"
            >
              ✏️
            </button>
          </>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="sg-btn sg-btn-outline-gold sn-btn-sm"
          onClick={() => void handleModifierEtude()}
          disabled={modifierLoading || pdfFlowBusy || redownloading || isReadOnly}
        >
          Modifier mon étude
        </button>
        {study?.lead_id && (
          <button type="button" className="sg-btn sg-btn-ghost sn-btn-sm" onClick={navLead}>
            ← Retour lead
          </button>
        )}
        <button type="button" className="sg-btn sg-btn-secondary sn-btn-sm" onClick={navCalpinage}>
          Calpinage
        </button>
        <button type="button" className="sg-btn sg-btn-secondary sn-btn-sm" onClick={navQuote}>
          Devis technique
        </button>
      </div>
    </div>
  );

  const pdfOverlay = pdfFlowBusy ? (
    <div className="scenarios-pdf-overlay" role="status" aria-live="polite">
      <div className="scenarios-pdf-overlay-panel">
        <div className="scenarios-pdf-overlay-spinner" aria-hidden="true" />
        <p className="scenarios-pdf-overlay-title">Génération du document en cours...</p>
        <p className="scenarios-pdf-overlay-sub">Génération… (2-3 secondes)</p>
      </div>
    </div>
  ) : null;

  if (scenariosError === "SCENARIOS_NOT_GENERATED") {
    return (
      <div className="scenarios-page" style={{ padding: "var(--spacing-24)", maxWidth: 720, margin: "0 auto" }}>
        <div className="sn-card sn-card-premium" style={{ padding: "var(--spacing-24)" }}>
          {pdfOverlay}
          {headerBlock}
          <StudyCalcTracePanel data={versionTraceData} />
          <p
            className="sg-text scenarios-muted-body"
            style={{ margin: 0, textAlign: "center", color: "var(--text-primary)", fontWeight: 600 }}
          >
            Votre étude n&apos;est pas encore prête
          </p>
          <p className="sg-text scenarios-muted-body" style={{ margin: "12px 0 0", textAlign: "center", color: "var(--text-muted)" }}>
            Validez votre devis technique pour voir les résultats
          </p>
          <button type="button" className="sg-btn sg-btn-primary" style={{ marginTop: "var(--spacing-20)", width: "100%" }} onClick={navQuote}>
            Ouvrir le devis technique
          </button>
        </div>
      </div>
    );
  }

  if (scenariosError || scenarios.length === 0) {
    return (
      <div className="scenarios-page" style={{ padding: "var(--spacing-24)", maxWidth: 720, margin: "0 auto" }}>
        <div className="sn-card sn-card-premium" style={{ padding: "var(--spacing-24)" }}>
          {pdfOverlay}
          {headerBlock}
          <StudyCalcTracePanel data={versionTraceData} />
          <p className="sg-text sg-state-error" style={{ marginBottom: "var(--spacing-16)" }}>{scenariosError || "Aucun scénario."}</p>
          <button type="button" className="sg-btn sg-btn-ghost" onClick={navQuote}>
            Devis technique
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="scenarios-page scenarios-page-rebuild scenarios-premium"
      style={{
        padding: "var(--spacing-24)",
        maxWidth: 1180,
        margin: "0 auto",
        position: "relative",
        borderRadius: 16,
        border: "1px solid rgba(195, 152, 71, 0.45)",
      }}
    >
      {pdfOverlay}
      <div
        aria-hidden
        className="scenarios-premium-backdrop"
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--halo-app-1), var(--halo-app-2), var(--surface-app)",
          borderRadius: 16,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>
        {headerBlock}

        <StudyCalcTracePanel data={versionTraceData} />

        <header className="scenarios-page-header" style={{ marginBottom: "var(--spacing-24)" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "var(--spacing-12)",
              marginBottom: "var(--spacing-8)",
            }}
          >
            <h2
              className="sg-title-lg"
              style={{
                margin: 0,
                letterSpacing: "0.02em",
                background: "linear-gradient(90deg, #f3e9d2, #C39847)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                fontSize: "1.35rem",
              }}
            >
              Comparaison des solutions
            </h2>
            {versionLocked && (
              <span
                className="scenarios-badge-readonly"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 8,
                  background: "var(--sn-bg-elevated)",
                  color: "var(--sn-text-secondary)",
                  border: "1px solid var(--sn-border-soft)",
                }}
              >
                Lecture seule
              </span>
            )}
          </div>
          <p className="sg-helper" style={{ margin: "0 0 var(--spacing-8) 0", maxWidth: 640 }}>
            Analyse basée sur votre profil réel de consommation.
          </p>
          <p className="sg-helper" style={{ margin: "0 0 var(--spacing-4) 0" }}>
            Version v{versionNumber ?? "?"}
          </p>
          <p className="sg-helper" style={{ margin: 0 }}>
            {availableCount === 1 ? "1 scénario disponible" : `${availableCount} scénarios disponibles`}
          </p>
        </header>

        <div style={{ marginBottom: "var(--spacing-24)" }}>
          <ScenarioComparisonTable
            orderedScenarios={orderedScenarios}
            columnLabels={COLUMN_LABELS}
            studyId={studyId ?? undefined}
            versionId={versionId ?? undefined}
            onSelectScenario={handleSelectScenario}
            selectionDisabled={pdfFlowBusy || redownloading || isReadOnly}
            selectingId={selectingId}
            versionLocked={versionLocked}
            selectedScenarioId={selectedScenarioId}
            pdfFlowBusy={pdfFlowBusy}
            onRedownloadPdf={versionLocked ? handleRedownloadPdf : undefined}
            redownloading={redownloading}
          />
        </div>

        <div style={{ marginBottom: "var(--spacing-24)" }}>
          <ScenarioEconomicsChart orderedScenarios={orderedScenarios} height={400} />
        </div>
        <style>{`
          .scenarios-premium .scenario-economics-chart-wrapper {
            border-color: var(--sn-border-soft) !important;
            background: var(--sn-bg-surface) !important;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
          }
          .scenarios-premium .scenario-economics-chart-empty {
            border-color: var(--sn-border-soft) !important;
            background: var(--sn-bg-surface) !important;
            backdrop-filter: blur(10px);
          }
        `}</style>
      </div>
    </div>
  );
}
