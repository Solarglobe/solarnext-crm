import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import OnboardingStepCompany from "../components/onboarding/OnboardingStepCompany";
import OnboardingStepLead from "../components/onboarding/OnboardingStepLead";
import OnboardingStepMail from "../components/onboarding/OnboardingStepMail";
import OnboardingStepTeam from "../components/onboarding/OnboardingStepTeam";
import { createLead } from "../services/leads.service";
import {
  DEFAULT_ONBOARDING_DATA,
  fetchOnboardingState,
  getNextIncompleteStep,
  saveOnboardingState,
  type OnboardingData,
  type OnboardingStepId,
} from "../services/onboarding.service";
import "./onboarding.css";

const STEPS: { id: OnboardingStepId; title: string; subtitle: string }[] = [
  { id: "company", title: "Entreprise", subtitle: "Le minimum pour identifier votre organisation" },
  { id: "mail", title: "Mail", subtitle: "Optionnel, vous pourrez le configurer plus tard" },
  { id: "team", title: "Equipe", subtitle: "Invitez quelqu'un maintenant ou passez cette etape" },
  { id: "lead", title: "Premier lead", subtitle: "Creer un premier dossier pour demarrer" },
];
const STEP_IDS = STEPS.map((step) => step.id);

function normalizeCompletedSteps(steps: OnboardingStepId[]): OnboardingStepId[] {
  return steps.filter((step): step is OnboardingStepId => STEP_IDS.includes(step));
}

function isValidEmail(value: string): boolean {
  return !value || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function validateStep(step: OnboardingStepId, data: OnboardingData): string[] {
  if (step === "company") {
    return data.profile.name.trim() ? [] : ["Nom de l'entreprise"];
  }
  if (step === "mail") {
    return data.mail.email.trim() && !isValidEmail(data.mail.email) ? ["Email expediteur invalide"] : [];
  }
  if (step === "team") {
    return data.collaborators.some((row) => row.email.trim() && !isValidEmail(row.email))
      ? ["Une invitation contient un email invalide"]
      : [];
  }
  if (step === "lead") {
    const missing: string[] = [];
    if (!data.lead.firstName.trim()) missing.push("Prenom du premier lead");
    if (!data.lead.lastName.trim()) missing.push("Nom du premier lead");
    if (!isValidEmail(data.lead.email)) missing.push("Email du premier lead invalide");
    return missing;
  }
  return [];
}

function getStepValidationMessage(step: OnboardingStepId, data: OnboardingData): string | null {
  const issues = validateStep(step, data);
  if (issues.length === 0) return null;
  if (step === "company") return "Le nom de l'entreprise est obligatoire.";
  if (step === "mail") return "L'email expediteur est invalide.";
  if (step === "team") return "Une invitation contient un email invalide.";
  return issues.join(", ");
}

function validateAllSteps(data: OnboardingData): string[] {
  return STEPS.flatMap((step) => validateStep(step.id, data).map((issue) => `${step.title} : ${issue}`));
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [data, setData] = useState<OnboardingData>(DEFAULT_ONBOARDING_DATA);
  const [completedSteps, setCompletedSteps] = useState<OnboardingStepId[]>([]);
  const [activeStep, setActiveStep] = useState<OnboardingStepId>("company");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const activeIndex = STEPS.findIndex((step) => step.id === activeStep);
  const activeMeta = STEPS[Math.max(0, activeIndex)];
  const visibleCompletedSteps = normalizeCompletedSteps(completedSteps);
  const progress = Math.min(100, Math.round((visibleCompletedSteps.length / STEPS.length) * 100));
  const firstIncompleteIndex = STEPS.findIndex((step) => !visibleCompletedSteps.includes(step.id));
  const maxAccessibleIndex = firstIncompleteIndex === -1 ? STEPS.length - 1 : firstIncompleteIndex;

  useEffect(() => {
    let cancelled = false;
    fetchOnboardingState()
      .then((state) => {
        if (cancelled) return;
        const normalizedCompleted = normalizeCompletedSteps(state.completedSteps);
        setData(state.data);
        setCompletedSteps(normalizedCompleted);
        setActiveStep(getNextIncompleteStep(STEP_IDS, normalizedCompleted));
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(getErrorMessage(error, "Impossible de charger l'onboarding"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validationMessage = useMemo(() => {
    return getStepValidationMessage(activeStep, data);
  }, [activeStep, data]);

  const persist = useCallback(
    async (steps: OnboardingStepId[], nextStep: OnboardingStepId, completed = false) => {
      await saveOnboardingState({ data, completedSteps: steps, activeStep: nextStep, completed });
    },
    [data]
  );

  const completeCurrentStep = async () => {
    if (validationMessage) {
      setMessage(validationMessage);
      setIssues(validateStep(activeStep, data));
      return;
    }
    setSaving(true);
    setMessage(null);
    setIssues([]);
    const nextCompleted = completedSteps.includes(activeStep) ? completedSteps : [...completedSteps, activeStep];
    const nextStep = STEPS[Math.min(activeIndex + 1, STEPS.length - 1)].id;
    try {
      await persist(nextCompleted, nextStep);
      setCompletedSteps(nextCompleted);
      setActiveStep(nextStep);
    } catch (error) {
      setMessage(getErrorMessage(error, "Sauvegarde impossible"));
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    const globalIssues = validateAllSteps(data);
    if (globalIssues.length > 0) {
      setIssues(globalIssues);
      setMessage("Impossible de terminer : certains champs obligatoires sont incomplets.");
      const firstInvalidStep = STEPS.find((step) => validateStep(step.id, data).length > 0);
      if (firstInvalidStep) setActiveStep(firstInvalidStep.id);
      return;
    }
    setSaving(true);
    setMessage(null);
    setIssues([]);
    const nextCompleted = STEP_IDS;
    try {
      await createLead({
        firstName: data.lead.firstName,
        lastName: data.lead.lastName,
        email: data.lead.email || undefined,
        phone: data.lead.phone || undefined,
        address: data.lead.address || undefined,
      });
      await persist(nextCompleted, "lead", true);
      navigate("/leads", { replace: true, state: { onboardingLeadCreated: true } });
    } catch (error) {
      setMessage(getErrorMessage(error, "Creation du premier lead impossible"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="onboarding-page onboarding-page--loading">Chargement du demarrage guide...</div>;
  }

  return (
    <main className="onboarding-page">
      <aside className="onboarding-rail" aria-label="Etapes onboarding">
        <div className="onboarding-brand">SolarNext</div>
        <div className="onboarding-progress" aria-label={`Progression ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <nav className="onboarding-steps">
          {STEPS.map((step, index) => {
            const done = visibleCompletedSteps.includes(step.id);
            const active = step.id === activeStep;
            const accessible = index <= maxAccessibleIndex || done;
            return (
              <button
                type="button"
                key={step.id}
                className={`onboarding-step-link${active ? " is-active" : ""}${done ? " is-done" : ""}${
                  !accessible ? " is-locked" : ""
                }`}
                disabled={!accessible}
                aria-disabled={!accessible}
                onClick={() => {
                  if (accessible) {
                    setActiveStep(step.id);
                    setMessage(null);
                    setIssues([]);
                  }
                }}
              >
                <span>{done ? "✓" : index + 1}</span>
                <strong>{step.title}</strong>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="onboarding-main">
        <header className="onboarding-header">
          <p>Premier demarrage</p>
          <h1>{activeMeta.title}</h1>
          <span>{activeMeta.subtitle}</span>
        </header>

        <form className="onboarding-panel" onSubmit={(event) => event.preventDefault()}>
          {activeStep === "company" ? (
            <OnboardingStepCompany value={data.profile} onChange={(profile) => setData((prev) => ({ ...prev, profile }))} />
          ) : null}
          {activeStep === "mail" ? (
            <OnboardingStepMail
              value={data.mail}
              onChange={(mail) => setData((prev) => ({ ...prev, mail }))}
            />
          ) : null}
          {activeStep === "team" ? (
            <OnboardingStepTeam
              value={data.collaborators}
              onChange={(collaborators) => setData((prev) => ({ ...prev, collaborators }))}
            />
          ) : null}
          {activeStep === "lead" ? (
            <OnboardingStepLead value={data.lead} onChange={(lead) => setData((prev) => ({ ...prev, lead }))} />
          ) : null}

          {message ? <p className="onboarding-message">{message}</p> : null}
          {issues.length > 0 ? (
            <ul className="onboarding-issue-list" aria-label="Champs a corriger">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}

          <footer className="onboarding-actions">
            <button
              type="button"
              className="sn-btn sn-btn-ghost"
              disabled={activeIndex <= 0 || saving}
              onClick={() => setActiveStep(STEPS[Math.max(0, activeIndex - 1)].id)}
            >
              Retour
            </button>
            {activeStep === "lead" ? (
              <button type="button" className="sn-btn sn-btn-primary" disabled={saving} onClick={() => void finish()}>
                {saving ? "Creation..." : "Bravo, creer le premier lead"}
              </button>
            ) : (
              <button type="button" className="sn-btn sn-btn-primary" disabled={saving} onClick={() => void completeCurrentStep()}>
                {saving ? "Sauvegarde..." : activeStep === "mail" || activeStep === "team" ? "Passer ou continuer" : "Continuer"}
              </button>
            )}
          </footer>
        </form>
      </section>
    </main>
  );
}
