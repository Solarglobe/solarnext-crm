import type { OnboardingProfile } from "../../services/onboarding.service";

type Props = {
  value: OnboardingProfile;
  onChange: (value: OnboardingProfile) => void;
};

export default function OnboardingStepCompany({ value, onChange }: Props) {
  const update = (patch: Partial<OnboardingProfile>) => onChange({ ...value, ...patch });

  return (
    <div className="onboarding-step-grid">
      <label className="onboarding-field onboarding-field--wide">
        <span>Nom de l'entreprise</span>
        <input
          value={value.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="Solar Installateurs Atlantique"
          required
        />
      </label>

      <label className="onboarding-field onboarding-field--wide">
        <span>Adresse optionnelle</span>
        <input
          value={value.address}
          onChange={(event) => update({ address: event.target.value })}
          placeholder="12 rue des Installateurs, 44000 Nantes"
        />
      </label>

      <label className="onboarding-field">
        <span>SIRET optionnel</span>
        <input
          value={value.siret}
          onChange={(event) => update({ siret: event.target.value })}
          placeholder="12345678900012"
        />
      </label>

      <label className="onboarding-field">
        <span>Numero RGE optionnel</span>
        <input
          value={value.rgeNumber}
          onChange={(event) => update({ rgeNumber: event.target.value })}
          placeholder="RGE-2026-0001"
        />
      </label>

      <label className="onboarding-field onboarding-field--wide">
        <span>Region d'intervention optionnelle</span>
        <input
          value={value.interventionRegion}
          onChange={(event) => update({ interventionRegion: event.target.value })}
          placeholder="Pays de la Loire"
        />
      </label>
    </div>
  );
}
