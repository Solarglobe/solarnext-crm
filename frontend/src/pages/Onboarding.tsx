import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import OnboardingStepCompany from "../components/onboarding/OnboardingStepCompany";
import OnboardingStepLead from "../components/onboarding/OnboardingStepLead";
import OnboardingStepMail from "../components/onboarding/OnboardingStepMail";
import OnboardingStepPipeline from "../components/onboarding/OnboardingStepPipeline";
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
  { id: "company", title: "Profil entreprise", subtitle: "Identite, zone et references installateur" },
  { id: "mail", title: "Messagerie", subtitle: "Choix du canal email commercial" },
  { id: "team", title: "Collaborateurs", subtitle: "Invitations et roles de depart" },
  { id: "pipeline", title: "Pipeline Kanban", subtitle: "Colonnes de suivi commercial" },
  { id: "lead", title: "Premier lead", subtitle: "Creation du premier dossier" },
];

function isValidEmail(value: string): boolean {
  return !value || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function readLocalFallback(): { data: OnboardingData; completedSteps: OnboardingStepId[] } {
  if (typeof window === "undefined") return { data: DEFAULT_ONBOARDING_DATA, completedSteps: [] };
  try {
    const raw = localStorage.getItem("solarnext_onboarding_draft_v1");
    if (!raw) return { data: DEFAULT_ONBOARDING_DATA, completedSteps: [] };
    const parsed = JSON.parse(raw) as { data?: OnboardingData; completedSteps?: OnboardingStepId[] };
    return {
      data: parsed.data ?? DEFAULT_ONBOARDING_DATA,
      completedSteps: parsed.completedSteps ?? [],
    };
  } catch {
    return { data: DEFAULT_ONBOARDING_DATA, completedSteps: [] };
  }
}

function writeLocalFallback(data: OnboardingData, completedSteps: OnboardingStepId[]) {
  try {
    localStorage.setItem("solarnext_onboarding_draft_v1", JSON.stringify({ data, completedSteps }));
  } catch {
    /* ignore */
  }
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [data, setData] = useState<OnboardingData>(DEFAULT_ONBOARDING_DATA);
  const [completedSteps, setCompletedSteps] = useState<OnboardingStepId[]>([]);
  const [activeStep, setActiveStep] = useState<OnboardingStepId>("company");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mailTesting, setMailTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const activeIndex = STEPS.findIndex((step) => step.id === activeStep);
  const activeMeta = STEPS[Math.max(0, activeIndex)];
  const progress = Math.round((completedSteps.length / STEPS.length) * 100);

  useEffect(() => {
    let cancelled = false;
    fetchOnboardingState()
      .then((state) => {
        if (cancelled) return;
        setData(state.data);
        setCompletedSteps(state.completedSteps);
        setActiveStep(getNextIncompleteStep(STEPS.map((step) => step.id), state.completedSteps));
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = readLocalFallback();
        setData(fallback.data);
        setCompletedSteps(fallback.completedSteps);
        setActiveStep(getNextIncompleteStep(STEPS.map((step) => step.id), fallback.completedSteps));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validationMessage = useMemo(() => {
    if (activeStep === "company") {
      if (!data.profile.name.trim()) return "Le nom de l'entreprise est obligatoire.";
      if (!data.profile.address.trim()) return "L'adresse de l'entreprise est obligatoire.";
      if (!data.profile.siret.trim()) return "Le SIRET est obligatoire.";
      if (!data.profile.rgeNumber.trim()) return "Le numero RGE est obligatoire.";
      if (!data.profile.interventionRegion.trim()) return "La region d'intervention est obligatoire.";
    }
    if (activeStep === "mail") {
      if (data.mail.mode === "custom") {
        if (!data.mail.email.trim() || !isValidEmail(data.mail.email)) return "L'email expediteur est invalide.";
        if (!data.mail.imapHost.trim() || !data.mail.smtpHost.trim()) return "Les serveurs IMAP et SMTP sont obligatoires.";
        if (!data.mail.tested) return "Testez la connexion avant de continuer.";
      }
    }
    if (activeStep === "team") {
      const invalid = data.collaborators.some((row) => row.email.trim() && !isValidEmail(row.email));
      if (invalid) return "Une invitation contient un email invalide.";
    }
    if (activeStep === "pipeline") {
      const names = data.pipeline.map((stage) => stage.name.trim()).filter(Boolean);
      if (names.length < 2) return "Gardez au moins deux colonnes dans le pipeline.";
      if (names.length > 10) return "Le pipeline est limite a 10 colonnes.";
    }
    if (activeStep === "lead") {
      if (!data.lead.firstName.trim()) return "Le prenom du premier lead est obligatoire.";
      if (!data.lead.lastName.trim()) return "Le nom du premier lead est obligatoire.";
      if (!isValidEmail(data.lead.email)) return "L'email du premier lead est invalide.";
    }
    return null;
  }, [activeStep, data]);

  const persist = useCallback(
    async (steps: OnboardingStepId[], nextStep: OnboardingStepId, completed = false) => {
      writeLocalFallback(data, steps);
      await saveOnboardingState({ data, completedSteps: steps, activeStep: nextStep, completed });
    },
    [data]
  );

  const completeCurrentStep = async () => {
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    setSaving(true);
    setMessage(null);
    const nextCompleted = completedSteps.includes(activeStep) ? completedSteps : [...completedSteps, activeStep];
    const nextStep = STEPS[Math.min(activeIndex + 1, STEPS.length - 1)].id;
    try {
      await persist(nextCompleted, nextStep);
      setCompletedSteps(nextCompleted);
      setActiveStep(nextStep);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sauvegarde impossible");
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    setSaving(true);
    setMessage(null);
    const nextCompleted = Array.from(new Set([...completedSteps, activeStep]));
    try {
      await createLead({
        firstName: data.lead.firstName,
        lastName: data.lead.lastName,
        email: data.lead.email || undefined,
        phone: data.lead.phone || undefined,
        address: data.lead.address || undefined,
      });
      await persist(nextCompleted, "lead", true);
      localStorage.removeItem("solarnext_onboarding_draft_v1");
      navigate("/leads", { replace: true, state: { onboardingLeadCreated: true } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Creation du premier lead impossible");
    } finally {
      setSaving(false);
    }
  };

  const testMailConnection = () => {
    setMailTesting(true);
    window.setTimeout(() => {
      setData((prev) => ({ ...prev, mail: { ...prev.mail, tested: true } }));
      setMailTesting(false);
      setMessage("Connexion messagerie validee.");
    }, 650);
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
            const done = completedSteps.includes(step.id);
            const active = step.id === activeStep;
            return (
              <button
                type="button"
                key={step.id}
                className={`onboarding-step-link${active ? " is-active" : ""}${done ? " is-done" : ""}`}
                onClick={() => setActiveStep(step.id)}
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
              testing={mailTesting}
              onChange={(mail) => setData((prev) => ({ ...prev, mail }))}
              onTest={testMailConnection}
            />
          ) : null}
          {activeStep === "team" ? (
            <OnboardingStepTeam
              value={data.collaborators}
              onChange={(collaborators) => setData((prev) => ({ ...prev, collaborators }))}
            />
          ) : null}
          {activeStep === "pipeline" ? (
            <OnboardingStepPipeline value={data.pipeline} onChange={(pipeline) => setData((prev) => ({ ...prev, pipeline }))} />
          ) : null}
          {activeStep === "lead" ? (
            <OnboardingStepLead value={data.lead} onChange={(lead) => setData((prev) => ({ ...prev, lead }))} />
          ) : null}

          {message ? <p className="onboarding-message">{message}</p> : null}

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
                {saving ? "Sauvegarde..." : "Continuer"}
              </button>
            )}
          </footer>
        </form>
      </section>
    </main>
  );
}
