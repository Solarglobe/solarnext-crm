import type { OnboardingLeadDraft } from "../../services/onboarding.service";

type Props = {
  value: OnboardingLeadDraft;
  onChange: (value: OnboardingLeadDraft) => void;
};

export default function OnboardingStepLead({ value, onChange }: Props) {
  const update = (patch: Partial<OnboardingLeadDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="onboarding-step-grid">
      <label className="onboarding-field">
        <span>Prenom</span>
        <input
          value={value.firstName}
          onChange={(event) => update({ firstName: event.target.value })}
          title="Prenom du contact principal"
          placeholder="Claire"
          required
        />
      </label>
      <label className="onboarding-field">
        <span>Nom</span>
        <input
          value={value.lastName}
          onChange={(event) => update({ lastName: event.target.value })}
          title="Nom du contact principal"
          placeholder="Martin"
          required
        />
      </label>
      <label className="onboarding-field">
        <span>Email</span>
        <input
          type="email"
          value={value.email}
          onChange={(event) => update({ email: event.target.value })}
          title="Email utilise pour les relances et documents"
          placeholder="claire.martin@example.fr"
        />
      </label>
      <label className="onboarding-field">
        <span>Telephone</span>
        <input
          value={value.phone}
          onChange={(event) => update({ phone: event.target.value })}
          title="Numero utile pour confirmer le rendez-vous"
          placeholder="06 12 34 56 78"
        />
      </label>
      <label className="onboarding-field onboarding-field--wide">
        <span>Adresse du projet</span>
        <input
          value={value.address}
          onChange={(event) => update({ address: event.target.value })}
          title="Adresse du site solaire a etudier"
          placeholder="24 rue du Soleil, 33000 Bordeaux"
        />
      </label>
    </div>
  );
}
