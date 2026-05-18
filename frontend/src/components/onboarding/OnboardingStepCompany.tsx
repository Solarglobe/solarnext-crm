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

      <label className="onboarding-field">
        <span>Logo</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => update({ logoName: event.target.files?.[0]?.name ?? "" })}
        />
        {value.logoName ? <small>{value.logoName}</small> : null}
      </label>

      <label className="onboarding-field">
        <span>Couleur principale</span>
        <input
          type="color"
          value={value.primaryColor}
          onChange={(event) => update({ primaryColor: event.target.value })}
        />
      </label>

      <label className="onboarding-field onboarding-field--wide">
        <span>Adresse</span>
        <input
          value={value.address}
          onChange={(event) => update({ address: event.target.value })}
          placeholder="12 rue des Installateurs, 44000 Nantes"
          required
        />
      </label>

      <label className="onboarding-field">
        <span>SIRET</span>
        <input
          value={value.siret}
          onChange={(event) => update({ siret: event.target.value })}
          placeholder="12345678900012"
          required
        />
      </label>

      <label className="onboarding-field">
        <span>Numero RGE</span>
        <input
          value={value.rgeNumber}
          onChange={(event) => update({ rgeNumber: event.target.value })}
          placeholder="RGE-2026-0001"
          required
        />
      </label>

      <label className="onboarding-field onboarding-field--wide">
        <span>Region principale d'intervention</span>
        <input
          value={value.interventionRegion}
          onChange={(event) => update({ interventionRegion: event.target.value })}
          placeholder="Pays de la Loire"
          required
        />
      </label>
    </div>
  );
}
