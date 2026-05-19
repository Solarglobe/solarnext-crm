import type { Study } from "../../../../services/studies.service";
import { Button } from "../../../../components/ui/Button";

interface FinancialStudyAssistantCompactProps {
  studies: Study[];
  studiesLoading: boolean;
  onCreateStudy?: () => void | Promise<void>;
  createStudyLoading?: boolean;
  onOpenCalpinage: (study: Study) => void;
  onOpenQuoteBuilder: (study: Study) => void;
  onCreateCommercialFromStudy?: (study: Study) => void | Promise<void>;
}

/**
 * Assistant etude: secondaire dans l'onglet Financier, mais il donne la prochaine action du parcours.
 */
export default function FinancialStudyAssistantCompact({
  studies,
  studiesLoading,
  onCreateStudy,
  createStudyLoading = false,
  onOpenCalpinage,
  onOpenQuoteBuilder,
  onCreateCommercialFromStudy,
}: FinancialStudyAssistantCompactProps) {
  if (studiesLoading) {
    return (
      <section className="fin-section fin-section--assistant">
        <div className="fin-section-head fin-section-head--compact">
          <h3 className="fin-section-title fin-section-title--assistant">Assistant etude</h3>
          <span className="sn-badge sn-badge-neutral">Optionnel</span>
        </div>
        <p className="fin-muted fin-assistant-loading">Chargement...</p>
      </section>
    );
  }

  if (studies.length === 0) {
    return (
      <section className="fin-section fin-section--assistant fin-section--assistant-empty">
        <div className="fin-section-head fin-section-head--compact">
          <h3 className="fin-section-title fin-section-title--assistant">Assistant etude</h3>
          <span className="sn-badge sn-badge-neutral">Prochaine action</span>
        </div>
        <p className="fin-assistant-muted">
          Aucune etude sur ce dossier. Demarrez une etude pour preparer le chiffrage technique, ou creez un devis
          commercial autonome si le dossier est deja qualifie.
        </p>
        {onCreateStudy ? (
          <div className="fin-empty-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={createStudyLoading}
              onClick={() => void onCreateStudy()}
            >
              {createStudyLoading ? "Creation..." : "Creer une etude"}
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  const study = [...studies].sort(
    (a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
  )[0];

  return (
    <section className="fin-section fin-section--assistant">
      <div className="fin-section-head fin-section-head--compact">
        <h3 className="fin-section-title fin-section-title--assistant">Assistant etude</h3>
        <span className="sn-badge sn-badge-info">Preparation devis</span>
      </div>
      <p className="fin-assistant-lead">Preparation technique pour alimenter le devis commercial du dossier.</p>
      <div className="fin-assistant-card">
        <div>
          <div className="fin-assistant-name">{study.title || study.study_number}</div>
          <div className="fin-assistant-meta">
            {study.study_number}
            {study.current_version != null ? <span> - v{study.current_version}</span> : null}
            {study.status ? <span> - {study.status}</span> : null}
          </div>
        </div>
        <div className="fin-assistant-btns">
          <Button type="button" variant="ghost" size="sm" onClick={() => window.open(`/studies/${study.id}`, "_blank")}>
            Ouvrir l'etude
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenCalpinage(study)}>
            Calpinage
          </Button>
          <Button type="button" variant="outlineGold" size="sm" onClick={() => onOpenQuoteBuilder(study)}>
            Preparation devis
          </Button>
          {onCreateCommercialFromStudy ? (
            <Button type="button" variant="primary" size="sm" onClick={() => void onCreateCommercialFromStudy(study)}>
              Creer le devis depuis l'etude
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
