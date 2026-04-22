/**
 * Phase3Sidebar — Sidebar React Phase 3 (Implantation des modules).
 * Composant pur, données via usePhase3Data.
 * Structure produit : 5 zones (header, action, état, validation, outils).
 */
import { useEffect, useId, useState } from "react";
import styles from "./Phase3Sidebar.module.css";
import { usePhase3Data, setupPhase3SidebarNotify } from "../hooks/usePhase3Data";
import { usePhase3ChecklistData } from "../hooks/usePhase3ChecklistData";
import {
  computeLegacyPhase3CanValidate,
  getPhase3ValidateBlockedHint,
} from "../hooks/phase3LegacyValidateUi";
import { Phase3ChecklistPanel } from "../Phase3ChecklistPanel";
import { createDsmOverlayManager } from "../dsmOverlay";
import { getCurrentUser } from "../../../services/auth.service";
import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "../../../services/api";
import "../dsmOverlay/dsmOverlay.css";

function globalStatusLabel(
  canValidate: boolean,
  blockedHint: string | null,
): "Prêt à valider" | "Incomplet" | "Bloqué" {
  if (canValidate) return "Prêt à valider";
  const h = blockedHint || "";
  if (
    h.includes("ratio") ||
    h.includes("DC/AC") ||
    h.includes("0,80") ||
    h.includes("central")
  ) {
    return "Bloqué";
  }
  return "Incomplet";
}

/**
 * Bascule Pose ↔ Sélection (boutons legacy inchangés).
 */
function Phase3ModeSegment() {
  const { activeTool } = usePhase3Data();

  const setPanelsMode = () => {
    document.getElementById("pv-tool-panels")?.click();
  };

  const setSelectMode = () => {
    const win = window as unknown as {
      syncPhase3ToolbarActiveTool?: () => void;
      notifyPhase3SidebarUpdate?: () => void;
    };
    document.getElementById("calpinage-tool-select")?.click();
    if (typeof win.syncPhase3ToolbarActiveTool === "function") {
      win.syncPhase3ToolbarActiveTool();
    }
    if (typeof win.notifyPhase3SidebarUpdate === "function") {
      win.notifyPhase3SidebarUpdate();
    }
  };

  return (
    <div
      className={styles.modeSegmentRow}
      role="toolbar"
      aria-label="Poser ou sélectionner les modules"
    >
      <button
        type="button"
        className={`${styles.modeSegmentBtn} ${activeTool === "panels" ? styles.modeSegmentBtnActive : ""}`}
        aria-pressed={activeTool === "panels"}
        onClick={setPanelsMode}
        title="Ajouter ou compléter la pose des modules"
      >
        Poser
      </button>
      <button
        type="button"
        className={`${styles.modeSegmentBtn} ${activeTool === "select" ? styles.modeSegmentBtnActive : ""}`}
        aria-pressed={activeTool === "select"}
        onClick={setSelectMode}
        title="Sélectionner, déplacer ou pivoter un bloc"
      >
        Sélectionner
      </button>
    </div>
  );
}

/** Émis par CalpinageOverlay (CRM) ou le legacy à la fin du flux de validation. */
const CALPINAGE_VALIDATE_FINISHED = "calpinage:validate-finished";

const API_BASE = getCrmApiBase();

function Phase3FlatRoofControls() {
  const { flatRoof } = usePhase3Data();
  const win = window as any;

  if (!flatRoof.inPvLayout || !flatRoof.hasPanCtx) return null;
  const pid = flatRoof.activePanId;
  if (!pid) return null;
  if (!flatRoof.showFlatEnable && !flatRoof.isFlat) return null;

  const applyPatch = (patch: Record<string, unknown>) => {
    if (typeof win.__applyFlatRoofConfigAndRecompute !== "function") return;
    win.__applyFlatRoofConfigAndRecompute(pid, patch);
    if (typeof win.notifyPhase3SidebarUpdate === "function") {
      win.notifyPhase3SidebarUpdate();
    }
  };

  const setRoofType = (t: "FLAT" | "PITCHED") => {
    if (typeof win.__applyManualPanRoofTypeAndRecompute !== "function") return;
    const ok = win.__applyManualPanRoofTypeAndRecompute(pid, t) as boolean;
    if (!ok && typeof win.showCalpinageUxToast === "function") {
      win.showCalpinageUxToast(
        t === "FLAT"
          ? "Impossible d'activer le mode toiture plate sur ce pan."
          : "Impossible de revenir en toiture inclinée sur ce pan.",
      );
    }
    if (typeof win.notifyPhase3SidebarUpdate === "function") {
      win.notifyPhase3SidebarUpdate();
    }
  };

  return (
    <div className={styles.flatRoofInline}>
      {flatRoof.showFlatEnable && (
        <button
          type="button"
          className={styles.toolLinkBtn}
          onClick={() => setRoofType("FLAT")}
        >
          Passer en toiture plate
        </button>
      )}
      {flatRoof.isFlat && (
        <>
          <div className={styles.flatRoofMicroLabel}>Toiture plate</div>
          <span className={styles.flatRoofTinyLabel}>Inclinaison support</span>
          <div className={styles.toggleCompact} role="group" aria-label="Inclinaison support">
            {([5, 10, 15] as const).map((deg) => (
              <button
                key={deg}
                type="button"
                className={`${styles.toggleCompactBtn} ${flatRoof.supportTiltDeg === deg ? styles.toggleCompactBtnOn : ""}`}
                aria-pressed={flatRoof.supportTiltDeg === deg}
                onClick={() => applyPatch({ supportTiltDeg: deg })}
              >
                {deg}°
              </button>
            ))}
          </div>
          <span className={styles.flatRoofTinyLabel}>Pose</span>
          <div className={styles.toggleCompact} role="group" aria-label="Orientation modules">
            <button
              type="button"
              className={`${styles.toggleCompactBtn} ${flatRoof.layoutPortrait ? styles.toggleCompactBtnOn : ""}`}
              aria-pressed={flatRoof.layoutPortrait}
              onClick={() => applyPatch({ layoutOrientation: "portrait" })}
            >
              Portrait
            </button>
            <button
              type="button"
              className={`${styles.toggleCompactBtn} ${!flatRoof.layoutPortrait ? styles.toggleCompactBtnOn : ""}`}
              aria-pressed={!flatRoof.layoutPortrait}
              onClick={() => applyPatch({ layoutOrientation: "landscape" })}
            >
              Paysage
            </button>
          </div>
          <button
            type="button"
            className={styles.toolLinkBtn}
            onClick={() => setRoofType("PITCHED")}
          >
            Revenir en toiture inclinée
          </button>
        </>
      )}
    </div>
  );
}

function Phase3OrientationToggle() {
  const { orientation, flatRoof } = usePhase3Data();
  const orientationLabelId = useId();
  const win = window as any;

  if (flatRoof.inPvLayout && flatRoof.hasPanCtx && flatRoof.isFlat) {
    return null;
  }

  const setOrientation = (value: "portrait" | "landscape") => {
    if (typeof win.setPvOrientation === "function") {
      win.setPvOrientation(value);
    }
    if (typeof win.notifyPhase3SidebarUpdate === "function") {
      win.notifyPhase3SidebarUpdate();
    }
  };

  return (
    <div className={styles.orientationInline}>
      <span className={styles.orientationMicroLabel} id={orientationLabelId}>
        Portrait / paysage
      </span>
      <div
        className={styles.toggleCompact}
        role="group"
        aria-labelledby={orientationLabelId}
      >
        <button
          type="button"
          className={`${styles.toggleCompactBtn} ${orientation === "portrait" ? styles.toggleCompactBtnOn : ""}`}
          onClick={() => setOrientation("portrait")}
        >
          Portrait
        </button>
        <button
          type="button"
          className={`${styles.toggleCompactBtn} ${orientation === "landscape" ? styles.toggleCompactBtnOn : ""}`}
          onClick={() => setOrientation("landscape")}
        >
          Paysage
        </button>
      </div>
    </div>
  );
}

function Phase3StateSummary({
  canValidate,
  blockedHint,
}: {
  canValidate: boolean;
  blockedHint: string | null;
}) {
  const {
    modulesCount,
    totalKwc,
    inverterName,
    acTotal,
    dcAcRatio,
  } = usePhase3Data();

  const status = globalStatusLabel(canValidate, blockedHint);
  const statusClass =
    status === "Prêt à valider"
      ? styles.stateStatusOk
      : status === "Bloqué"
        ? styles.stateStatusBlocked
        : styles.stateStatusIncomplete;

  const ratioStatus =
    dcAcRatio !== null
      ? dcAcRatio >= 0.8 && dcAcRatio <= 1.4
        ? "valid"
        : "warning"
      : "";

  return (
    <div className={styles.stateBlock}>
      <div className={styles.stateStatusRow}>
        <span className={styles.stateStatusKey}>Statut</span>
        <span className={`${styles.stateStatusVal} ${statusClass}`}>{status}</span>
      </div>
      <dl className={styles.stateDl}>
        <div className={styles.stateDlRow}>
          <dt>Modules</dt>
          <dd>{modulesCount}</dd>
        </div>
        <div className={styles.stateDlRow}>
          <dt>Puissance</dt>
          <dd>{totalKwc > 0 ? `${totalKwc.toFixed(2)} kWc` : "—"}</dd>
        </div>
        <div className={styles.stateDlRow}>
          <dt>Onduleur</dt>
          <dd className={styles.stateDdTruncate}>{inverterName}</dd>
        </div>
        <div className={styles.stateDlRow}>
          <dt>DC/AC</dt>
          <dd
            className={
              ratioStatus === "valid"
                ? styles.metricOk
                : ratioStatus === "warning"
                  ? styles.metricWarn
                  : ""
            }
          >
            {dcAcRatio !== null ? dcAcRatio.toFixed(2) : "—"}
          </dd>
        </div>
        {acTotal > 0 ? (
          <div className={styles.stateDlRow}>
            <dt>AC total</dt>
            <dd>{acTotal.toFixed(2)} kW</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function showDsmToast(message: string, isError = false) {
  const toast = document.createElement("div");
  toast.className = "dsm-pdf-toast";
  toast.textContent = message;
  toast.setAttribute("role", "alert");
  toast.style.cssText = isError
    ? "position:fixed;top:20px;right:20px;z-index:99999;padding:14px 20px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border-radius:8px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.3);"
    : "position:fixed;top:20px;right:20px;z-index:99999;padding:14px 20px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border-radius:8px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.3);";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function DsmOverlayButton({
  containerRef,
  onActiveChange,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onActiveChange?: (active: boolean) => void;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;
    const manager = createDsmOverlayManager(container);
    const enabled = manager.isEnabled();
    setActive(enabled);
    onActiveChange?.(enabled);
  }, [containerRef, onActiveChange]);

  const handleClick = () => {
    const container = containerRef?.current;
    if (!container) return;
    const manager = createDsmOverlayManager(container);
    manager.toggle();
    const nowEnabled = manager.isEnabled();
    setActive(nowEnabled);
    onActiveChange?.(nowEnabled);
  };

  return (
    <button
      type="button"
      className={`${styles.toolGhostBtn} ${active ? styles.toolGhostBtnOn : ""}`}
      onClick={handleClick}
      title="Visualisation estimations d’ombrage (DSM)"
      aria-pressed={active}
    >
      <span className={styles.toolGhostIcon} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      </span>
      Analyse d’ombrage
    </button>
  );
}

function DsmPdfExportButton({ active }: { active: boolean }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!active) return;
    const studyId = (window as any).CALPINAGE_STUDY_ID;
    const version = (window as any).CALPINAGE_VERSION_ID ?? "1";
    if (!studyId) {
      showDsmToast("Impossible : studyId manquant", true);
      return;
    }
    setLoading(true);
    try {
      const user = await getCurrentUser();
      const orgId = user?.organizationId;
      if (!orgId) {
        showDsmToast("Impossible : orgId manquant", true);
        setLoading(false);
        return;
      }
      if (API_BASE.includes("5173")) {
        throw new Error("API_BASE pointe vers le frontend au lieu du backend");
      }

      const pdfUrl = `${API_BASE}/internal/pdf/horizon-mask/${studyId}?orgId=${encodeURIComponent(orgId)}&version=${encodeURIComponent(String(version))}`;
      const response = await apiFetch(pdfUrl, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        let errMsg = "Erreur lors de la génération du PDF";
        try {
          const body = await response.json();
          if (body?.error && typeof body.error === "string") {
            errMsg = body.error;
          }
        } catch (_) {
          /* ignorer si réponse non JSON */
        }
        if (response.status === 500) {
          errMsg = "Erreur technique lors de la génération du PDF";
        }
        throw new Error(errMsg);
      }

      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const header = new TextDecoder("ascii").decode(bytes.slice(0, 5));
      if (header !== "%PDF-") {
        throw new Error(`Réponse invalide (attendu PDF, reçu: ${header})`);
      }

      const blob = new Blob([arrayBuffer], { type: "application/pdf" });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `horizon-mask-study-${studyId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      showDsmToast("PDF téléchargé", false);
    } catch (e) {
      console.error("Erreur téléchargement PDF :", e);
      showDsmToast(e instanceof Error ? e.message : "Impossible de télécharger le PDF", true);
    } finally {
      setLoading(false);
    }
  };

  if (!active) return null;

  return (
    <button
      type="button"
      className={styles.toolGhostBtn}
      onClick={handleClick}
      disabled={loading}
      title="Exporter le PDF analyse d’ombrage"
    >
      <span className={styles.toolGhostIcon} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </span>
      {loading ? "PDF…" : "Exporter PDF"}
    </button>
  );
}

function Phase3AutofillSection() {
  const { hasActiveBlockWithPanels, autofillActive, autofillText, autofillValidCount } = usePhase3Data();

  const handleAutofill = () => {
    const run = (window as unknown as { runCalpinageAutofillPreview?: () => void })
      .runCalpinageAutofillPreview;
    if (typeof run === "function") {
      run();
      return;
    }
    document.getElementById("pv-tool-autofill")?.click();
  };

  const handleConfirm = () => {
    document.getElementById("pv-autofill-confirm")?.click();
  };

  const handleCancel = () => {
    document.getElementById("pv-autofill-cancel")?.click();
  };

  if (!hasActiveBlockWithPanels && !autofillActive) return null;

  return (
    <div className={styles.autofillWrap}>
      {!autofillActive && (
        <button
          type="button"
          className={styles.toolGhostBtn}
          onClick={handleAutofill}
          title="Remplir automatiquement le pan"
        >
          Auto-remplir
        </button>
      )}
      {autofillActive && (
        <div className={styles.autofillActive}>
          <span className={styles.autofillText}>{autofillText}</span>
          <div className={styles.autofillRow}>
            <button
              type="button"
              className={styles.autofillConfirm}
              onClick={handleConfirm}
              disabled={autofillValidCount === 0}
            >
              Confirmer
            </button>
            <button type="button" className={styles.autofillCancel} onClick={handleCancel}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Phase3Actions({
  canValidate,
  validateHintId,
  blockedHint,
}: {
  canValidate: boolean;
  validateHintId: string;
  blockedHint: string | null;
}) {
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    const onFinished = () => setIsValidating(false);
    window.addEventListener(CALPINAGE_VALIDATE_FINISHED, onFinished);
    return () => window.removeEventListener(CALPINAGE_VALIDATE_FINISHED, onFinished);
  }, []);

  const handleValidateClick = () => {
    if (!canValidate || isValidating) return;
    setIsValidating(true);
    document.getElementById("btn-validate-calpinage")?.click();
  };

  const handleBack = () => {
    document.getElementById("btn-back-roof")?.click();
  };

  return (
    <div className={styles.actionsCol}>
      <button
        type="button"
        className={styles.btnValidatePrimary}
        onClick={handleValidateClick}
        disabled={!canValidate || isValidating}
        aria-busy={isValidating}
        aria-describedby={!canValidate && blockedHint ? validateHintId : undefined}
        title={
          canValidate
            ? "Valider le calpinage"
            : blockedHint || "Compléter les critères ci-dessus"
        }
      >
        <span className={styles.validateBtnInner}>
          {isValidating && <span className={styles.validateSpinner} aria-hidden="true" />}
          {isValidating ? "Validation…" : "Valider le calpinage"}
        </span>
      </button>
      <button
        type="button"
        className={styles.btnBackSecondary}
        onClick={handleBack}
        title="Revenir au relevé toiture"
      >
        Retour relevé toiture
      </button>
    </div>
  );
}

export function Phase3Sidebar({
  containerRef,
}: {
  containerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [dsmActive, setDsmActive] = useState(false);
  const validateHintId = useId();
  usePhase3Data();
  const { data: checklistData, catalogModuleSelected } = usePhase3ChecklistData();
  const canValidate = computeLegacyPhase3CanValidate();
  const blockedHint = canValidate ? null : getPhase3ValidateBlockedHint();

  useEffect(() => {
    const previous = (window as any).notifyPhase3SidebarUpdate;
    const fn = setupPhase3SidebarNotify();
    return () => {
      if ((window as any).notifyPhase3SidebarUpdate === fn) {
        if (previous) (window as any).notifyPhase3SidebarUpdate = previous;
        else delete (window as any).notifyPhase3SidebarUpdate;
      }
    };
  }, []);

  return (
    <aside className={styles.sidebar}>
      <header className={styles.zoneHeader}>
        <h2 className={styles.headerTitle}>Phase 3</h2>
        <p className={styles.headerLead}>Implantation panneaux</p>
        <p className={styles.headerTagline}>Pose, orientation, puis validation.</p>
      </header>

      {/* ZONE 2 — Action */}
      <section className={styles.zoneAction} aria-label="Action">
        <Phase3ModeSegment />
        <Phase3OrientationToggle />
        <Phase3AutofillSection />
        <Phase3FlatRoofControls />
      </section>

      {/* ZONE 3 — État */}
      <section className={styles.zoneState} aria-label="État">
        <Phase3StateSummary canValidate={canValidate} blockedHint={blockedHint} />
      </section>

      {/* ZONE 4 — Validation (checklist + synthèse + boutons, un seul bloc) */}
      <section className={styles.zoneValidation} aria-label="Validation">
        {checklistData ? (
          <Phase3ChecklistPanel
            className={styles.checklistEmbed}
            panelCount={checklistData.panelCount}
            totalDcKw={checklistData.totalDcKw}
            selectedInverter={checklistData.selectedInverter}
            inverterFamily={checklistData.inverterFamily}
            catalogModuleSelected={catalogModuleSelected}
            sidebarCompact
          />
        ) : (
          <p className={styles.checklistLoading} role="status">
            Chargement des critères…
          </p>
        )}
        {canValidate ? (
          <p className={styles.validationNoteOk} role="status">
            Conditions remplies.
          </p>
        ) : blockedHint ? (
          <p className={styles.validationNoteBlock} id={validateHintId} role="status">
            {blockedHint}
          </p>
        ) : null}
        <Phase3Actions
          canValidate={canValidate}
          validateHintId={validateHintId}
          blockedHint={blockedHint}
        />
      </section>

      {/* ZONE 5 — Outils secondaires */}
      <section className={styles.zoneTools} aria-label="Outils">
        {containerRef && (
          <>
            <DsmOverlayButton containerRef={containerRef} onActiveChange={setDsmActive} />
            <DsmPdfExportButton active={dsmActive} />
          </>
        )}
      </section>
    </aside>
  );
}
