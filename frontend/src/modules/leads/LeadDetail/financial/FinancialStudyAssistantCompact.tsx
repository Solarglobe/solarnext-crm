import React from "react";
import type { Study } from "../../../../services/studies.service";
import { Button } from "../../../../components/ui/Button";

interface FinancialStudyAssistantCompactProps {
  studies: Study[];
  studiesLoading: boolean;
  onOpenCalpinage: (study: Study) => void;
  onOpenQuoteBuilder: (study: Study) => void;
  onCreateCommercialFromStudy?: (study: Study) => void | Promise<void>;
}

/**
 * Assistant étude — secondaire dans l’onglet Financier (préparation / pré-remplissage devis).
 */
export default function FinancialStudyAssistantCompact({
  studies,
  studiesLoading,
  onOpenCalpinage,
  onOpenQuoteBuilder,
  onCreateCommercialFromStudy,
}: FinancialStudyAssistantCompactProps) {
  if (studiesLoading) {
    return (
      <section className="fin-section fin-section--assistant">
        <div className="fin-section-head fin-section-head--compact">
          <h3 className="fin-section-title fin-section-title--assistant">Assistant étude</h3>
          <span className="sn-badge sn-badge-neutral">Optionnel</span>
        </div>
        <p className="fin-muted fin-assistant-loading">Chargement…</p>
      </section>
    );
  }

  if (studies.length === 0) {
    return (
      <section className="fin-section fin-section--assistant fin-section--assistant-empty">
        <div className="fin-section-head fin-section-head--compact">
          <h3 className="fin-section-title fin-section-title--assistant">Assistant étude</h3>
          <span className="sn-badge sn-badge-neutral">Optionnel</span>
        </div>
        <p className="fin-assistant-muted">
          Aucune étude sur ce dossier. Vous pouvez créer un devis sans étude, ou ajouter une étude plus tard pour
          dimensionner et pré-chiffrer le technique.
        </p>
      </section>
    );
  }

  const study = [...studies].sort(
    (a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
  )[0];

  return (
    <section className="fin-section fin-section--assistant">
      <div className="fin-section-head fin-section-head--compact">
        <h3 className="fin-section-title fin-section-title--assistant">Assistant étude</h3>
        <span className="sn-badge sn-badge-info">Préparation devis</span>
      </div>
      <p className="fin-assistant-lead">
        Pré-remplissage technique — le devis commercial reste le document central du dossier.
      </p>
      <div className="fin-assistant-card">
        <div>
          <div className="fin-assistant-name">{study.title || study.study_number}</div>
          <div className="fin-assistant-meta">
            {study.study_number}
            {study.current_version != null ? <span> · v{study.current_version}</span> : null}
            {study.status ? <span> · {study.status}</span> : null}
          </div>
        </div>
        <div className="fin-assistant-btns">
          <Button type="button" variant="ghost" size="sm" onClick={() => window.open(`/studies/${study.id}`, "_blank")}>
            Ouvrir l&apos;étude
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenCalpinage(study)}>
            Calpinage
          </Button>
          <Button type="button" variant="outlineGold" size="sm" onClick={() => onOpenQuoteBuilder(study)}>
            Préparation devis
          </Button>
          {onCreateCommercialFromStudy ? (
            <Button type="button" variant="primary" size="sm" onClick={() => void onCreateCommercialFromStudy(study)}>
              Créer / MAJ devis depuis l&apos;étude
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
