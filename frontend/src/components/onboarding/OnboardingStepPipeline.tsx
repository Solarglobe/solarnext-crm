import type { OnboardingPipelineStage } from "../../services/onboarding.service";

type Props = {
  value: OnboardingPipelineStage[];
  onChange: (value: OnboardingPipelineStage[]) => void;
};

export default function OnboardingStepPipeline({ value, onChange }: Props) {
  const updateName = (index: number, name: string) => {
    onChange(value.map((stage, stageIndex) => (stageIndex === index ? { ...stage, name } : stage)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const remove = (index: number) => onChange(value.filter((_, stageIndex) => stageIndex !== index));

  return (
    <div className="onboarding-stack">
      {value.map((stage, index) => (
        <div className="onboarding-pipeline-row" key={stage.id}>
          <span className="onboarding-pipeline-row__index">{index + 1}</span>
          <input
            value={stage.name}
            onChange={(event) => updateName(index, event.target.value)}
            aria-label={`Statut ${index + 1}`}
          />
          <button type="button" className="onboarding-icon-button" onClick={() => move(index, -1)} aria-label="Monter">
            ↑
          </button>
          <button type="button" className="onboarding-icon-button" onClick={() => move(index, 1)} aria-label="Descendre">
            ↓
          </button>
          <button type="button" className="onboarding-icon-button" onClick={() => remove(index)} aria-label="Supprimer">
            X
          </button>
        </div>
      ))}

      <button
        type="button"
        className="sn-btn sn-btn-secondary onboarding-fit-button"
        disabled={value.length >= 10}
        onClick={() => onChange([...value, { id: `custom-${Date.now()}`, name: "Nouveau statut" }])}
      >
        Ajouter une colonne
      </button>
    </div>
  );
}
