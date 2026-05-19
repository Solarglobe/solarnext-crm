import { buildApiUrl } from "../config/crmApiBase";
import { apiFetch } from "./api";

export type OnboardingStepId = "company" | "mail" | "team" | "lead";

export type OnboardingProfile = {
  name: string;
  logoName: string;
  address: string;
  siret: string;
  rgeNumber: string;
  primaryColor: string;
  interventionRegion: string;
};

export type OnboardingMail = {
  mode: "solarnext" | "custom";
  email: string;
  imapHost: string;
  smtpHost: string;
};

export type OnboardingCollaborator = {
  email: string;
  role: "ADMIN" | "COMMERCIAL" | "TECHNICIEN" | "INSTALLATEUR";
};

export type OnboardingLeadDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
};

export type OnboardingData = {
  profile: OnboardingProfile;
  mail: OnboardingMail;
  collaborators: OnboardingCollaborator[];
  lead: OnboardingLeadDraft;
};

export type OnboardingStateResponse = {
  completed: boolean;
  completedSteps: OnboardingStepId[];
  organization?: { id: string; name: string };
  data?: Partial<{
    profile: Partial<{
      name: string;
      logo_name: string;
      address: string;
      siret: string;
      rge_number: string;
      primary_color: string;
      intervention_region: string;
    }>;
    mail: Partial<{
      mode: "solarnext" | "custom";
      email: string;
      imap_host: string;
      smtp_host: string;
    }>;
    collaborators: OnboardingCollaborator[];
    lead: Partial<{
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
      address: string;
    }>;
    active_step: OnboardingStepId;
  }>;
};

export const DEFAULT_ONBOARDING_DATA: OnboardingData = {
  profile: {
    name: "",
    logoName: "",
    address: "",
    siret: "",
    rgeNumber: "",
    primaryColor: "#0f766e",
    interventionRegion: "",
  },
  mail: {
    mode: "solarnext",
    email: "",
    imapHost: "",
    smtpHost: "",
  },
  collaborators: [],
  lead: {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
  },
};

function mergeOnboardingData(response?: OnboardingStateResponse): OnboardingData {
  const data = response?.data ?? {};
  return {
    profile: {
      ...DEFAULT_ONBOARDING_DATA.profile,
      name: data.profile?.name ?? response?.organization?.name ?? "",
      logoName: data.profile?.logo_name ?? "",
      address: data.profile?.address ?? "",
      siret: data.profile?.siret ?? "",
      rgeNumber: data.profile?.rge_number ?? "",
      primaryColor: data.profile?.primary_color ?? DEFAULT_ONBOARDING_DATA.profile.primaryColor,
      interventionRegion: data.profile?.intervention_region ?? "",
    },
    mail: {
      ...DEFAULT_ONBOARDING_DATA.mail,
      mode: data.mail?.mode === "custom" ? "custom" : "solarnext",
      email: data.mail?.email ?? "",
      imapHost: data.mail?.imap_host ?? "",
      smtpHost: data.mail?.smtp_host ?? "",
    },
    collaborators: Array.isArray(data.collaborators) ? data.collaborators : [],
    lead: {
      ...DEFAULT_ONBOARDING_DATA.lead,
      firstName: data.lead?.first_name ?? "",
      lastName: data.lead?.last_name ?? "",
      email: data.lead?.email ?? "",
      phone: data.lead?.phone ?? "",
      address: data.lead?.address ?? "",
    },
  };
}

export async function fetchOnboardingState(): Promise<{
  completed: boolean;
  completedSteps: OnboardingStepId[];
  data: OnboardingData;
}> {
  const res = await apiFetch(buildApiUrl("/api/organizations/onboarding"), {
    method: "GET",
    skipErrorToast: true,
  });
  if (!res.ok) {
    throw new Error("Impossible de charger l'onboarding");
  }
  const payload = (await res.json()) as OnboardingStateResponse;
  return {
    completed: Boolean(payload.completed),
    completedSteps: payload.completedSteps ?? [],
    data: mergeOnboardingData(payload),
  };
}

export async function saveOnboardingState(input: {
  data: OnboardingData;
  completedSteps: OnboardingStepId[];
  activeStep: OnboardingStepId;
  completed?: boolean;
}): Promise<void> {
  const payload = {
    completedSteps: input.completedSteps,
    activeStep: input.activeStep,
    completed: Boolean(input.completed),
    data: {
      profile: {
        name: input.data.profile.name,
        logo_name: input.data.profile.logoName,
        address: input.data.profile.address,
        siret: input.data.profile.siret,
        rge_number: input.data.profile.rgeNumber,
        primary_color: input.data.profile.primaryColor,
        intervention_region: input.data.profile.interventionRegion,
      },
      mail: {
        mode: input.data.mail.mode,
        email: input.data.mail.email,
        imap_host: input.data.mail.imapHost,
        smtp_host: input.data.mail.smtpHost,
      },
      collaborators: input.data.collaborators,
      lead: {
        first_name: input.data.lead.firstName,
        last_name: input.data.lead.lastName,
        email: input.data.lead.email,
        phone: input.data.lead.phone,
        address: input.data.lead.address,
      },
    },
  };
  const res = await apiFetch(buildApiUrl("/api/organizations/onboarding"), {
    method: "PATCH",
    body: JSON.stringify(payload),
    skipErrorToast: true,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error((error as { error?: string }).error || "Sauvegarde onboarding impossible");
  }
}

export function getNextIncompleteStep(
  steps: OnboardingStepId[],
  completedSteps: OnboardingStepId[]
): OnboardingStepId {
  return steps.find((step) => !completedSteps.includes(step)) ?? steps[steps.length - 1];
}
