/**
 * CP-LEAD-V3 — Cockpit : pipeline interactif + actions études / calcul
 */

import React from "react";
import LeadPipelineBar, { type PipelineStageItem } from "./LeadPipelineBar";
import { formatEuroAmount, formatProductionKwh } from "./leadEnergyFormat";

interface ActionBarProps {
  isLead: boolean;
  showStudyButtons?: boolean;
  onStudyClick?: () => void;
  onCreateStudy?: () => void;
  onRunCalc?: () => void;
  createStudyLoading?: boolean;
  calcLoading?: boolean;
  studiesCount?: number;
  calcSummary?: Record<string, unknown> | null;
  stages?: PipelineStageItem[];
  currentStageId?: string;
  onStageChange?: (stageId: string) => void;
  stageChanging?: boolean;
  /** CP-078B — SUPER_ADMIN mode support lecture seule */
  readOnly?: boolean;
}

export default function ActionBar({
  isLead,
  showStudyButtons,
  onStudyClick,
  onCreateStudy,
  onRunCalc,
  createStudyLoading,
  calcLoading,
  studiesCount = 0,
  calcSummary,
  stages = [],
  currentStageId = "",
  onStageChange,
  stageChanging = false,
  readOnly = false,
}: ActionBarProps) {
  const hasLeftActions =
    (isLead && onStudyClick) || (showStudyButtons && (onCreateStudy || onRunCalc));

  const showPipeline: boolean =
    isLead &&
    stages.length > 0 &&
    typeof onStageChange === "function" &&
    (currentStageId ?? "").length > 0;

  if (!isLead && !hasLeftActions && !showPipeline) return null;

  return (
    <section className="crm-lead-cockpit" aria-label="Actions dossier">
      <div className="crm-lead-cockpit-inner">
        {showPipeline && onStageChange ? (
          <div className="crm-lead-cockpit-pipeline">
            <LeadPipelineBar
              stages={stages}
              currentStageId={currentStageId}
              onStageChange={onStageChange}
              disabled={stageChanging || readOnly}
            />
          </div>
        ) : null}

        <div className="crm-lead-cockpit-actions">
          {isLead && onStudyClick ? (
            <button type="button" className="sn-btn sn-btn-outline-gold sn-btn-sm" onClick={onStudyClick}>
              Voir les études
            </button>
          ) : null}
          {showStudyButtons ? (
            <>
              {onCreateStudy ? (
                <button
                  type="button"
                  className="sn-btn sn-btn-primary sn-btn-sm"
                  disabled={createStudyLoading || readOnly}
                  onClick={onCreateStudy}
                  title="Créer une nouvelle étude et ouvrir le calpinage"
                >
                  {createStudyLoading ? "Création…" : "Nouvelle étude"}
                </button>
              ) : null}
              {onRunCalc ? (
                <button
                  type="button"
                  className="sn-btn sn-btn-outline-gold sn-btn-sm"
                  disabled={studiesCount === 0 || !!calcLoading || readOnly}
                  onClick={onRunCalc}
                  title={studiesCount === 0 ? "Créer une étude d'abord" : undefined}
                >
                  {calcLoading ? "Calcul…" : "Lancer le calcul"}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {calcSummary && (calcSummary.annual_kwh != null || calcSummary.capex_ttc != null) ? (
        <div className="crm-lead-cockpit-summary">
          {calcSummary.annual_kwh != null ? (
            <span>
              Production : <strong>{formatProductionKwh(Number(calcSummary.annual_kwh))}</strong>
            </span>
          ) : null}
          {calcSummary.capex_ttc != null ? (
            <span>
              Capex TTC : <strong>{formatEuroAmount(Number(calcSummary.capex_ttc))}</strong>
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
