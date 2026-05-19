import { Link } from "react-router-dom";
import type { OnboardingMail } from "../../services/onboarding.service";

type Props = {
  value: OnboardingMail;
  onChange: (value: OnboardingMail) => void;
};

export default function OnboardingStepMail({ value, onChange }: Props) {
  const update = (patch: Partial<OnboardingMail>) => onChange({ ...value, ...patch });

  return (
    <div className="onboarding-stack">
      <div className="onboarding-info-band">
        La configuration mail est facultative au demarrage. Les tests IMAP/SMTP reels se font ensuite dans{" "}
        <Link to="/settings/mail" className="onboarding-inline-link">
          Parametres &gt; Configuration mail
        </Link>
        .
      </div>

      <div className="onboarding-choice-row" role="group" aria-label="Mode de messagerie">
        <button
          type="button"
          className={value.mode === "solarnext" ? "onboarding-choice is-active" : "onboarding-choice"}
          onClick={() => update({ mode: "solarnext" })}
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
            />
          </label>
          <label className="onboarding-field">
            <span>Serveur IMAP optionnel</span>
            <input
              value={value.imapHost}
              onChange={(event) => update({ imapHost: event.target.value })}
              placeholder="imap.installateur.fr"
            />
          </label>
          <label className="onboarding-field">
            <span>Serveur SMTP optionnel</span>
            <input
              value={value.smtpHost}
              onChange={(event) => update({ smtpHost: event.target.value })}
              placeholder="smtp.installateur.fr"
            />
          </label>
        </div>
      ) : (
        <div className="onboarding-info-band">
          Vos premiers dossiers peuvent etre crees sans compte mail connecte. Aucun test de connexion n'est lance ici.
        </div>
      )}
    </div>
  );
}
