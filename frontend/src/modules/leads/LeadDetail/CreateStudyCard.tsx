type Props = {
  onCreate: () => void;
  loading?: boolean;
};

export function CreateStudyCard({ onCreate, loading }: Props) {
  return (
    <button
      type="button"
      onClick={onCreate}
      disabled={loading}
      className="study-create-card-sg"
    >
      <span className="study-create-card-sg-icon" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </span>
      <span className="study-create-card-sg-title">{loading ? "Création…" : "Créer une étude"}</span>
      <span className="study-create-card-sg-hint">Nouvelle étude photovoltaïque pour ce dossier</span>
    </button>
  );
}

export default CreateStudyCard;
