/**
 * Phase3ChecklistPanel — Module UI passif, lecture seule.
 * Affiche une checklist de validation du calpinage Phase 3.
 * Aucune mutation du state existant.
 * P5-CHECKLIST-LOCKED : computeInverterSizing exclusif, règles CENTRAL/MICRO distinctes.
 */

import styles from "./Phase3ChecklistPanel.module.css";
import { computeInverterSizing, type InverterFamily } from "./utils/inverterSizing";

/** Critère de validation électrique individuel (issu du backend electricalValidation). */
export type ElectricalCheck = {
  criterion: string;
  measured: number | null;
  limit: number | null;
  status: "ok" | "warning" | "error" | "neutral";
  message: string;
  unit?: string;
};

/** Résultat complet de validation électrique renvoyé par l'API SmartPitch. */
export type ElectricalValidation = {
  status: "ok" | "warning" | "error" | "neutral";
  checks: ElectricalCheck[];
  meta?: {
    panelCount?: number;
    nSeries?: number | null;
    tMinC?: number;
    inverterModel?: string | null;
  };
};

export type Phase3ChecklistProps = {
  panelCount: number;
  totalDcKw: number;
  selectedInverter: {
    name: string;
    acPowerKw: number;
  } | null;
  /** Famille onduleur pour dimensionnement AC. Par défaut CENTRAL. */
  inverterFamily?: InverterFamily;
  /**
   * Même condition que le bouton legacy : référence module catalogue (barre du haut).
   * Défaut true pour les tests / intégrations qui ne passent pas la prop.
   */
  catalogModuleSelected?: boolean;
  className?: string;
  /** Sidebar Phase 3 : liste courte, sans ligne « Validation » (déjà en zone État). */
  sidebarCompact?: boolean;
  /**
   * Résultat de validation électrique renvoyé par l'API SmartPitch (electricalValidation).
   * Si absent ou null, la section est masquée.
   */
  electricalValidation?: ElectricalValidation | null;
  /**
   * Données ombrage inter-rangées calculées par le backend (row_to_row).
   * Affiché uniquement si pitchActualM < pitchMinM.
   */
  rowToRow?: {
    pitchActualM: number;
    pitchMinM: number;
    annualLossPct: number;
  } | null;
};

type Status = "ok" | "warning" | "error" | "neutral";

/** Message explicatif pour ratio CENTRAL. */
function getCentralRatioMessage(ratio: number): string | null {
  if (ratio < 0.8) return "Onduleur sous-dimensionné";
  if (ratio > 1.4) return "Onduleur surdimensionné";
  return null;
}

function IconOk() {
  return (
    <svg className={styles.icon} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9l3 3 7-7" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg className={styles.icon} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6v4M9 13h.01" />
      <path d="M9 2L1 16h16L9 2z" />
    </svg>
  );
}

function IconError() {
  return (
    <svg className={styles.icon} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="7" />
      <path d="M9 5v4M9 11h.01" />
    </svg>
  );
}

function IconNeutral() {
  return (
    <svg className={styles.icon} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="6" />
    </svg>
  );
}

function StatusIcon({ status }: { status: Status }) {
  const cls = status === "ok" ? styles.iconOk : status === "warning" ? styles.iconWarning : status === "error" ? styles.iconError : styles.iconNeutral;
  return (
    <span className={cls}>
      {status === "ok" && <IconOk />}
      {status === "warning" && <IconWarning />}
      {status === "error" && <IconError />}
      {status === "neutral" && <IconNeutral />}
    </span>
  );
}

export function Phase3ChecklistPanel({
  panelCount,
  totalDcKw,
  selectedInverter,
  inverterFamily = "CENTRAL",
  catalogModuleSelected = true,
  className,
  sidebarCompact = false,
  electricalValidation,
  rowToRow,
}: Phase3ChecklistProps) {
  const { acTotalKw, ratio } = computeInverterSizing({
    panelCount,
    totalDcKw,
    inverterFamily,
    inverterAcKw: selectedInverter?.acPowerKw ?? 0,
  });

  const catalogStatus: Status = catalogModuleSelected ? "ok" : "warning";
  const panelStatus: Status = panelCount === 0 ? "error" : "ok";
  const inverterStatus: Status = selectedInverter === null ? "warning" : "ok";

  const inverterSelected = selectedInverter !== null;
  const isMicro = inverterFamily === "MICRO";

  /** CENTRAL : ratio bloquant. MICRO : ratio indicatif uniquement. */
  let acDcStatus: Status = "neutral";
  let acDcMessage: string | null = null;
  if (isMicro) {
    acDcStatus = ratio !== null ? "ok" : "neutral";
    acDcMessage = null;
  } else {
    if (ratio !== null) {
      acDcMessage = getCentralRatioMessage(ratio);
      if (ratio < 0.8) acDcStatus = "warning";
      else if (ratio > 1.4) acDcStatus = "warning";
      else if (ratio >= 0.8 && ratio <= 1.4) acDcStatus = "ok";
      else acDcStatus = "warning";
    }
  }

  const validationOk =
    catalogModuleSelected &&
    panelCount > 0 &&
    inverterSelected &&
    (isMicro || (ratio !== null && ratio >= 0.8));

  const statusClass = (s: Status) =>
    s === "ok" ? styles.statusOk : s === "warning" ? styles.statusWarning : s === "error" ? styles.statusError : styles.statusNeutral;

  return (
    <div
      className={[styles.panel, sidebarCompact ? styles.panelCompact : "", className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      <div className={styles.row}>
        <StatusIcon status={catalogStatus} />
        <span className={`${styles.label} sg-label`}>Module (catalogue)</span>
        <span className={`${styles.value} ${statusClass(catalogStatus)}`}>
          {catalogModuleSelected ? "Sélectionné" : "À choisir en haut"}
        </span>
      </div>
      <div className={styles.row}>
        <StatusIcon status={panelStatus} />
        <span className={`${styles.label} sg-label`}>Panneaux</span>
        <span className={`${styles.value} ${statusClass(panelStatus)}`}>
          {panelCount === 0 ? "Aucun" : `${panelCount} module${panelCount > 1 ? "s" : ""}`}
        </span>
      </div>
      <div className={styles.row}>
        <StatusIcon status={inverterStatus} />
        <span className={`${styles.label} sg-label`}>Onduleur</span>
        <span className={`${styles.value} ${statusClass(inverterStatus)}`}>
          {selectedInverter ? selectedInverter.name : "Non sélectionné"}
        </span>
      </div>
      {isMicro && (
        <div className={styles.row}>
          <StatusIcon status={acDcStatus} />
          <span className={`${styles.label} sg-label`}>AC total</span>
          <span className={`${styles.value} ${statusClass(acDcStatus)}`}>
            {acTotalKw > 0 ? `${acTotalKw.toFixed(2)} kW` : "—"}
          </span>
        </div>
      )}
      <div className={styles.row}>
        <StatusIcon status={acDcStatus} />
        <span className={`${styles.label} sg-label`}>{isMicro ? "Ratio DC/AC (indicatif)" : "Ratio DC/AC"}</span>
        <span className={`${styles.value} ${statusClass(acDcStatus)}`}>
          {ratio !== null
            ? acDcMessage
              ? `${ratio.toFixed(2)} — ${acDcMessage}`
              : ratio.toFixed(2)
            : "—"}
        </span>
      </div>
      {!sidebarCompact && (
        <div className={styles.row}>
          <StatusIcon status={validationOk ? "ok" : "warning"} />
          <span className={`${styles.label} sg-label`}>Validation</span>
          <span className={`${styles.value} ${statusClass(validationOk ? "ok" : "warning")}`}>
            {validationOk ? "Prêt" : "À compléter"}
          </span>
        </div>
      )}

      {/* ── Ombrage inter-rangées (warning si pitch insuffisant) ── */}
      {rowToRow != null && rowToRow.pitchActualM < rowToRow.pitchMinM && (
        <div className={styles.row}>
          <StatusIcon status="warning" />
          <span className={`${styles.label} sg-label`}>Espacement rangées</span>
          <span className={`${styles.value} ${styles.statusWarning}`}>
            {rowToRow.pitchActualM.toFixed(2)}m {"<"} min {rowToRow.pitchMinM.toFixed(2)}m
            {" "}— pertes ~{rowToRow.annualLossPct.toFixed(1)}%/an
          </span>
        </div>
      )}

      {/* ── Section Validation Électrique (optionnelle, pilotée par prop) ── */}
      {electricalValidation != null && !sidebarCompact && (
        <ElectricalValidationSection validation={electricalValidation} statusClass={statusClass} />
      )}
    </div>
  );
}

// ─── Sous-composant : Section Validation Électrique ───────────────────────────

type ElectricalValidationSectionProps = {
  validation: ElectricalValidation;
  statusClass: (s: Status) => string;
};

function ElectricalValidationSection({ validation, statusClass }: ElectricalValidationSectionProps) {
  const { checks, meta } = validation;

  return (
    <>
      <div className={styles.sectionDivider}>
        Validation électrique
        {meta?.inverterModel && (
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 10 }}>
            {" "}— {meta.inverterModel}
          </span>
        )}
      </div>

      {checks.length === 0 && (
        <p className={styles.elecMessage}>Aucun critère disponible (données panneau/onduleur manquantes).</p>
      )}

      {checks.map((check, i) => {
        const s = check.status as Status;
        return (
          <div key={i} className={styles.row} title={check.message}>
            <StatusIcon status={s} />
            <span className={`${styles.label} sg-label`} style={{ fontSize: 12 }}>
              {check.criterion}
            </span>
            <span className={`${styles.elecValue} ${statusClass(s)}`}>
              {check.measured != null
                ? `${check.measured}${check.unit ? " " + check.unit : ""}`
                : "—"}
              {check.limit != null && s !== "ok" && (
                <span className={styles.elecMeasured}>
                  {" "}/ {check.limit}{check.unit ? " " + check.unit : ""}
                </span>
              )}
            </span>
          </div>
        );
      })}

      {meta?.nSeries == null && (
        <p className={styles.elecMessage}>
          💡 Ajoutez <code>pvParams.nSeries</code> pour activer le string sizing.
        </p>
      )}
    </>
  );
}

/** Retourne true si la checklist est OK (validation possible). */
export function isPhase3ChecklistOk(props: Phase3ChecklistProps): boolean {
  const { panelCount, totalDcKw, selectedInverter, inverterFamily = "CENTRAL" } = props;
  const inverterSelected = selectedInverter !== null;
  const { ratio } = computeInverterSizing({
    panelCount,
    totalDcKw,
    inverterFamily,
    inverterAcKw: selectedInverter?.acPowerKw ?? 0,
  });
  return (
    panelCount > 0 &&
    inverterSelected &&
    (inverterFamily === "MICRO" || (ratio !== null && ratio >= 0.8))
  );
}
