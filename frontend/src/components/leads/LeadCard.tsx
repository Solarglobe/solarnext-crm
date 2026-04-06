/**
 * Carte lead — pipeline Kanban & overlay drag (v3 business)
 */

import React from "react";
import { useNavigate } from "react-router-dom";
import type { Lead } from "../../services/leads.service";
import {
  getLeadName,
  getLeadFullAddress,
  getLeadPhoneDisplay,
} from "../../services/leads.service";
import {
  scoreBadgeClass,
  inactivityBadgeClass,
  inactivityLabelHybrid,
} from "./leadBadgeClasses";
import { CARD_PIPELINE_CLASS_BY_CODE } from "../../modules/leads/kanban-config";

interface LeadCardProps {
  lead: Lead;
  stageIndex?: number;
  /** Code étape pipeline (aligné DnD / colonne), pas seulement lead.status */
  pipelineCode?: string | null;
  onArchive?: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}

export function LeadCard({
  lead,
  stageIndex,
  pipelineCode = null,
  onArchive,
  onDelete,
  canDelete = false,
}: LeadCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/leads/${lead.id}`);
  };

  const visualStage = Math.min(Math.max(stageIndex ?? 1, 1), 5);

  const pipelineModifier =
    pipelineCode && CARD_PIPELINE_CLASS_BY_CODE[pipelineCode]
      ? CARD_PIPELINE_CLASS_BY_CODE[pipelineCode]
      : "";

  const name = getLeadName(lead);
  const fullAddress = getLeadFullAddress(lead);
  const phoneLine = getLeadPhoneDisplay(lead);
  const source = lead.lead_source?.trim() || "—";

  const score = lead.score ?? 0;
  const inact =
    lead.inactivity_level && lead.inactivity_level !== "none";

  const showMenu = Boolean(onArchive || (canDelete && onDelete));

  return (
    <article
      className={`lead-card stage-${visualStage} sn-leads-card sn-leads-card-v3`}
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      role="button"
      tabIndex={0}
      aria-label={`Ouvrir le lead ${name}`}
    >
      <div className="lead-card-body sn-leads-card-v3__body">
        <header className="sn-leads-card-v3__head">
          <h3 className="sn-leads-card-v3__name">{name}</h3>
          <div className="sn-leads-card-v3__head-right">
            {showMenu ? (
              <div
                className="sn-leads-card-v3__menu"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <details className="lead-card-actions">
                  <summary className="lead-card-actions__trigger" title="Actions">
                    ···
                  </summary>
                  <div className="lead-card-actions__panel">
                    {onArchive ? (
                      <button
                        type="button"
                        className="lead-card-actions__item"
                        onClick={() => onArchive?.()}
                      >
                        Archiver
                      </button>
                    ) : null}
                    {canDelete && onDelete ? (
                      <button
                        type="button"
                        className="lead-card-actions__item lead-card-actions__item--danger"
                        onClick={() => onDelete?.()}
                      >
                        Supprimer
                      </button>
                    ) : null}
                  </div>
                </details>
              </div>
            ) : null}
            <span className="sn-leads-card-v3__head-badges">
              {pipelineCode === "LOST" ? (
                <span className="badge-lost" title="Devis perdu">
                  Perdu
                </span>
              ) : null}
              <span
                className={scoreBadgeClass(score)}
                title="Score commercial"
              >
                {score}
              </span>
            </span>
          </div>
        </header>

        <p className="sn-leads-card-v3__source">{source}</p>

        <p className="sn-leads-card-v3__line sn-leads-card-v3__line--address">
          {fullAddress || "—"}
        </p>
        <p
          className={`sn-leads-card-v3__line sn-leads-card-v3__line--tel${inact ? "" : " sn-leads-card-v3__line--tel--flush"}`}
        >
          {phoneLine || "—"}
        </p>

        {inact ? (
          <footer className="sn-leads-card-v3__foot">
            <span
              className={inactivityBadgeClass(lead.inactivity_level!)}
              title="Inactivité (niveau et jours depuis dernière activité comptée)"
            >
              {inactivityLabelHybrid(lead.inactivity_level ?? "none", lead.last_activity_at)}
            </span>
          </footer>
        ) : null}
      </div>
    </article>
  );
}
