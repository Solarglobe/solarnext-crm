/**
 * Pipeline commercial horizontal (étapes cliquables)
 */

import React from "react";

export interface PipelineStageItem {
  id: string;
  name: string;
  position?: number;
}

interface LeadPipelineBarProps {
  stages: PipelineStageItem[];
  currentStageId: string;
  onStageChange: (stageId: string) => void;
  disabled?: boolean;
}

export default function LeadPipelineBar({
  stages,
  currentStageId,
  onStageChange,
  disabled,
}: LeadPipelineBarProps) {
  const sorted = [...stages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const activeIndex = sorted.findIndex((s) => s.id === currentStageId);

  const stepState = (index: number): "past" | "active" | "future" => {
    if (activeIndex < 0) return "future";
    if (index < activeIndex) return "past";
    if (index === activeIndex) return "active";
    return "future";
  };

  return (
    <nav className="crm-lead-pipeline-bar" aria-label="Pipeline commercial">
      <ol className="crm-lead-pipeline-bar__list">
        {sorted.map((s, i) => {
          const state = stepState(i);
          const isLast = i === sorted.length - 1;
          return (
            <React.Fragment key={s.id}>
              <li className="crm-lead-pipeline-bar__item">
                <button
                  type="button"
                  className={`crm-lead-pipeline-bar__btn crm-lead-pipeline-bar__btn--${state}`}
                  onClick={() => onStageChange(s.id)}
                  disabled={disabled}
                  aria-current={state === "active" ? "step" : undefined}
                  title={s.name}
                >
                  {s.name}
                </button>
              </li>
              {!isLast ? (
                <li className="crm-lead-pipeline-bar__item crm-lead-pipeline-bar__item--connector" aria-hidden>
                  <span className="crm-lead-pipeline-bar__connector" />
                </li>
              ) : null}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
