import type { OnboardingMail } from "../../services/onboarding.service";

type Props = {
  value: OnboardingMail;
  testing: boolean;
  onChange: (value: OnboardingMail) => void;
  onTest: () => void;
};

export default function OnboardingStepMail({ value, testing, onChange, onTest }: Props) {
  const update = (patch: Partial<OnboardingMail>) => onChange({ ...value, ...patch, tested: patch.tested ?? false });

  return (
    <div className="onboarding-stack">
      <div className="onboarding-choice-row" role="group" aria-label="Mode de messagerie">
        <button
          type="button"
          className={value.mode === "solarnext" ? "onboarding-choice is-active" : "onboarding-choice"}
          onClick={() => update({ mode: "solarnext", tested: true })}
        >
          Email SolarNext
        </button>
        <button
          type="button"
          className={value.mode === "custom" ? "onboarding-choice is-active" : "onboarding-choice"}
          onClick={() => update({ mode: "custom" })}
        >
          IMAP / SMTP
        </button>
      </div>

      {value.mode === "custom" ? (
        <div className="onboarding-step-grid">
          <label className="onboarding-field onboarding-field--wide">
            <span>Email expediteur</span>
            <input
              type="email"
              value={value.email}
              onChange={(event) => update({ email: event.target.value })}
              placeholder="contact@installateur.fr"
              required
            />
          </label>
          <label className="onboarding-field">
            <span>Serveur IMAP</span>
            <input
              value={value.imapHost}
              onChange={(event) => update({ imapHost: event.target.value })}
              placeholder="imap.installateur.fr"
              required
            />
          </label>
          <label className="onboarding-field">
            <span>Serveur SMTP</span>
            <input
              value={value.smtpHost}
              onChange={(event) => update({ smtpHost: event.target.value })}
              placeholder="smtp.installateur.fr"
              required
            />
          </label>
          <div className="onboarding-inline-action onboarding-field--wide">
            <button type="button" className="sn-btn sn-btn-secondary" onClick={onTest} disabled={testing}>
              {testing ? "Test en cours" : "Tester la connexion"}
            </button>
            {value.tested ? <span className="onboarding-success">Connexion validee</span> : null}
          </div>
        </div>
      ) : (
        <div className="onboarding-info-band">
          SolarNext enverra les premiers emails depuis l'adresse de plateforme. Vous pourrez connecter votre domaine plus tard.
        </div>
      )}
    </div>
  );
}
