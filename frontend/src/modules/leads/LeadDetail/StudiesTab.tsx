/**
 * CP-LEAD-V2 — Onglet Études (grille de cartes + création)
 */

import React from "react";
import type { Study } from "../../../services/studies.service";
import StudyCard from "./StudyCard";
import CreateStudyCard from "./CreateStudyCard";

interface StudiesTabProps {
  studies: Study[];
  studiesLoading: boolean;
  onCreateStudy: () => void;
  createStudyLoading: boolean;
  /** Rafraîchir la liste après rename / fork / suppression */
  onStudiesChange?: () => void | Promise<void>;
  canCreate?: boolean;
  onEditStudy?: (study: Study) => void;
  onOpenCalpinage?: (study: Study) => void;
  onOpenTechnicalQuote?: (study: Study) => void;
}

export default function StudiesTab({
  studies,
  studiesLoading,
  onCreateStudy,
  createStudyLoading,
  onStudiesChange,
  canCreate = true,
  onEditStudy,
  onOpenCalpinage,
  onOpenTechnicalQuote,
}: StudiesTabProps) {
  return (
    <section className="crm-lead-card studies-tab-section">
      <div className="crm-lead-card-head">
        <h2 className="crm-lead-card-title">Études photovoltaïques</h2>
      </div>
      {studiesLoading ? (
        <p className="crm-lead-empty">Chargement…</p>
      ) : studies.length === 0 && !canCreate ? (
        <p className="crm-lead-empty">Aucune étude</p>
      ) : (
        <div className="studies-tab-grid">
          {studies.map((s) => (
            <StudyCard
              key={s.id}
              study={s}
              onStudiesChange={onStudiesChange}
              onEditStudy={onEditStudy}
              onOpenCalpinage={onOpenCalpinage}
              onOpenTechnicalQuote={onOpenTechnicalQuote}
            />
          ))}
          {canCreate && <CreateStudyCard onCreate={onCreateStudy} loading={createStudyLoading} />}
        </div>
      )}
    </section>
  );
}
