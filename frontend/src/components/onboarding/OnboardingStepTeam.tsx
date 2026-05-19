import type { OnboardingCollaborator } from "../../services/onboarding.service";

const ROLES: OnboardingCollaborator["role"][] = ["ADMIN", "COMMERCIAL", "TECHNICIEN", "INSTALLATEUR"];

type Props = {
  value: OnboardingCollaborator[];
  onChange: (value: OnboardingCollaborator[]) => void;
};

export default function OnboardingStepTeam({ value, onChange }: Props) {
  const rows = value.length > 0 ? value : [{ email: "", role: "COMMERCIAL" as const }];

  const updateRow = (index: number, patch: Partial<OnboardingCollaborator>) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <div className="onboarding-stack">
      <div className="onboarding-info-band">
        Cette etape est optionnelle. Vous pourrez inviter votre equipe depuis Parametres &gt; Utilisateurs.
      </div>

      {rows.map((row, index) => (
        <div className="onboarding-row" key={`collaborator-${index}`}>
          <label className="onboarding-field onboarding-row__email">
            <span>Email collaborateur</span>
            <input
              type="email"
              value={row.email}
              onChange={(event) => updateRow(index, { email: event.target.value })}
              placeholder="prenom@installateur.fr"
            />
          </label>
          <label className="onboarding-field onboarding-row__role">
            <span>Role</span>
            <select value={row.role} onChange={(event) => updateRow(index, { role: event.target.value as OnboardingCollaborator["role"] })}>
              {ROLES.map((role) => (
                <option value={role} key={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="onboarding-icon-button" onClick={() => removeRow(index)} aria-label="Supprimer l'invitation">
            X
          </button>
        </div>
      ))}

      <button
        type="button"
        className="sn-btn sn-btn-secondary onboarding-fit-button"
        onClick={() => onChange([...rows, { email: "", role: "COMMERCIAL" }])}
      >
        Ajouter une invitation
      </button>
    </div>
  );
}
