import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getCrmApiBase } from "../config/crmApiBase";
import "./client-portal.css";

const API_BASE = getCrmApiBase();

const ASSET_BG = "/client-portal/bg-solarglobe-client.webp";
const ASSET_LOGO = "/client-portal/logo-solarglobe.png";

type PipelineStep = { id: number; label: string; status: "done" | "current" | "upcoming" };

type PortalPipeline = {
  mode: "LEAD" | "CLIENT";
  /** 1..10 (CLIENT) ; 0 si LEAD */
  current_step: number;
  raw_status: string | null;
  /** Libellé 1re étape si LEAD (CRM : pas encore signé). */
  lead_first_step_label?: string | null;
  steps: PipelineStep[];
};

type PortalOfferSummary =
  | { kind: "none" }
  | { kind: "validated"; headline: string }
  | {
      kind: "pending";
      amount_ttc: number | null;
      currency: string;
      reference_date: string | null;
      date_kind: "sent" | "created";
    };

type PortalPayload = {
  meta: {
    lead_status: string;
    show_pipeline: boolean;
    currency: string;
    /** Nom affiché : CRM Identité « Nom de l'entreprise » (repli nom commercial / juridique côté API). */
    organization_name: string | null;
    /** URL relative `/api/client-portal/organization/logo?token=…` si un logo est enregistré en CRM. */
    organization_logo_url: string | null;
  };
  client: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    property_type: string | null;
    consumption_annual_kwh: number | null;
    site: {
      address_line1: string | null;
      address_line2: string | null;
      postal_code: string | null;
      city: string | null;
      country_code: string | null;
      /** Adresse complète géocodeur (souvent avec n° de rue) — prioritaire à l’affichage. */
      formatted_address?: string | null;
    };
  };
  summary: {
    project_status_label: string;
    consumption_is_estimated: boolean;
    offer: PortalOfferSummary;
    technical_notice: string | null;
  };
  project: {
    study_number: string | null;
    study_status: string | null;
    current_version: number | null;
    latest_version: {
      version_number: number;
      title: string | null;
      summary: string | null;
      created_at: string;
    } | null;
    quotes_summary: Array<{
      id: string;
      quote_number: string | null;
      status: string | null;
      total_ttc: number | null;
      currency: string | null;
      created_at: string | null;
      sent_at?: string | null;
      valid_until: string | null;
    }>;
  };
  pipeline: PortalPipeline;
  documents: Array<{
    id: string;
    /** Libellé combiné côté API (souvent display_name || file_name). */
    name: string;
    /** Code technique — jamais affiché tel quel au client. */
    type: string;
    created_at: string;
    download_url: string;
    /** Si fourni par l’API : prioritaire pour le titre affiché. */
    display_name?: string | null;
    file_name?: string | null;
    /** Si fourni un jour par l’API : prioritaire sur getDocumentLabel(type). */
    document_type_label?: string | null;
  }>;
  advisor: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  };
};

function dash(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function normPortalStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Nombre issu du JSON (certains champs pg passent en string). */
function normPortalNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parsePortalOffer(raw: unknown): PortalOfferSummary {
  if (!raw || typeof raw !== "object") return { kind: "none" };
  const r = raw as Record<string, unknown>;
  const k = r.kind;
  if (k === "validated" && typeof r.headline === "string" && r.headline.trim() !== "") {
    return { kind: "validated", headline: r.headline.trim() };
  }
  if (k === "pending") {
    const dateKind = r.date_kind === "created" ? "created" : "sent";
    return {
      kind: "pending",
      amount_ttc: normPortalNum(r.amount_ttc),
      currency: typeof r.currency === "string" && r.currency.trim() !== "" ? r.currency.trim() : "EUR",
      reference_date: typeof r.reference_date === "string" ? r.reference_date : null,
      date_kind: dateKind,
    };
  }
  return { kind: "none" };
}

/** Libellé client (pas de code CRM) pour le bandeau STATUT DU PROJET */
const CLIENT_STATUS_HEADLINE: Record<string, string> = {
  LEAD: "Étude en cours",
  SIGNE: "Étude et formalités administratives",
  DP_A_DEPOSER: "Déclaration préalable en préparation",
  DP_DEPOSE: "Déclaration préalable en instruction",
  DP_ACCEPTE: "Autorisation d’urbanisme obtenue",
  INSTALLATION_PLANIFIEE: "Installation planifiée",
  INSTALLATION_REALISEE: "Installation réalisée",
  CONSUEL_EN_ATTENTE: "Validation Consuel en cours",
  CONSUEL_OBTENU: "Consuel obtenu",
  MISE_EN_SERVICE: "Mise en service",
  FACTURATION_TERMINEE: "Facturation terminée",
  CLOTURE: "Projet terminé",
  UNKNOWN: "Suivi de projet",
};

/** Prochaine étape + texte sous pipeline (strictement project_status, LEAD = attente devis) */
const NEXT_STEP_COPY: Record<string, string> = {
  LEAD: "Votre devis est en attente de validation.",
  SIGNE: "Votre projet est validé. Nous lançons les démarches administratives.",
  DP_A_DEPOSER: "Nous préparons votre dossier administratif.",
  DP_DEPOSE: "Votre dossier est en cours d’instruction en mairie.",
  DP_ACCEPTE: "Votre autorisation est obtenue. Nous préparons l’installation.",
  INSTALLATION_PLANIFIEE: "Votre installation est planifiée. Vous serez contacté prochainement.",
  INSTALLATION_REALISEE: "Votre installation est terminée. Nous préparons la validation Consuel.",
  CONSUEL_EN_ATTENTE: "Votre dossier est en cours de validation électrique (Consuel).",
  CONSUEL_OBTENU: "Votre installation est validée. Mise en service en cours.",
  MISE_EN_SERVICE: "Votre installation est désormais en service.",
  FACTURATION_TERMINEE: "Votre projet est finalisé administrativement.",
  CLOTURE: "Votre projet est terminé.",
  UNKNOWN: "Nous vous tenons informé de l’avancement de votre dossier.",
};

function resolveProjectStatusKey(data: PortalPayload): string {
  if (data.meta.lead_status === "LEAD") return "LEAD";
  const raw = data.pipeline.raw_status;
  if (raw != null && String(raw).trim() !== "") return String(raw).trim().toUpperCase();
  return "UNKNOWN";
}

function getClientStatusHeadline(data: PortalPayload): string {
  const key = resolveProjectStatusKey(data);
  if (key === "UNKNOWN" && data.summary.project_status_label) return data.summary.project_status_label;
  return CLIENT_STATUS_HEADLINE[key] ?? data.summary.project_status_label ?? CLIENT_STATUS_HEADLINE.UNKNOWN;
}

function getNextStepParagraph(data: PortalPayload): string {
  const key = resolveProjectStatusKey(data);
  return NEXT_STEP_COPY[key] ?? NEXT_STEP_COPY.UNKNOWN;
}

function getPipelineReassuranceNote(data: PortalPayload): string {
  if (data.meta.lead_status === "LEAD") {
    return "Aucune action n’est requise de votre part à ce stade.";
  }
  return "Aucune action n’est requise de votre part.";
}

/** Colonne droite — paragraphe principal selon project_status */
function getStoryPrimaryParagraph(data: PortalPayload, brand: string): string {
  const key = resolveProjectStatusKey(data);
  const b = brand.trim();
  const org = b || "Notre équipe";

  const map: Record<string, string> = {
    LEAD:
      "Cet espace sécurisé centralise les informations de votre projet photovoltaïque. Dès signature du devis, chaque étape y sera détaillée.",
    SIGNE: `${org} coordonne désormais les démarches administratives et techniques de votre installation.`,
    DP_A_DEPOSER: `Nous constituons le dossier à déposer en mairie. ${org} vous informe dès que les pièces sont prêtes.`,
    DP_DEPOSE:
      "Votre dossier est actuellement en cours d’instruction. Nous vous tiendrons informé de son évolution.",
    DP_ACCEPTE:
      "Votre autorisation est validée. Nous enchaînons sur la planification et la préparation du chantier.",
    INSTALLATION_PLANIFIEE:
      "Votre installation est en préparation. Nos équipes coordonnent les prochaines étapes.",
    INSTALLATION_REALISEE:
      "Votre installation est terminée sur le toit. Les étapes électriques et de mise en service suivent leur cours.",
    CONSUEL_EN_ATTENTE:
      "Le Consuel examine votre installation pour la conformité électrique. Nous suivons le dossier pour vous.",
    CONSUEL_OBTENU: "La conformité électrique est validée. La mise en service avec votre fournisseur peut être planifiée.",
    MISE_EN_SERVICE:
      "Votre installation est active. Vous commencez à produire votre énergie solaire.",
    FACTURATION_TERMINEE: "Les aspects administratifs et financiers de votre dossier sont bouclés. Conservez vos justificatifs.",
    CLOTURE: "Votre projet solaire est terminé. Merci de votre confiance.",
    UNKNOWN: `Cet espace vous permet de suivre l’avancement de votre projet${b ? ` avec ${b}` : ""}.`,
  };

  return map[key] ?? map.UNKNOWN;
}

type DocGroupId = "project" | "quote" | "other";

function categorizePortalDocument(docType: string | null | undefined): DocGroupId {
  const t = (docType ?? "").toLowerCase().trim();
  if (["quote_pdf", "quote_pdf_signed", "quote_signature_client", "quote_signature_company"].includes(t)) {
    return "quote";
  }
  if (["study_pdf", "study_attachment", "lead_attachment"].includes(t)) {
    return "project";
  }
  return "other";
}

const DOCUMENT_SECTION_ORDER: { key: DocGroupId; title: string }[] = [
  { key: "project", title: "Votre projet" },
  { key: "quote", title: "Votre devis" },
  { key: "other", title: "Autres documents" },
];

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  MAISON: "Maison",
  APPARTEMENT: "Appartement",
  IMMEUBLE: "Immeuble",
  LOCAL_PRO: "Local professionnel",
  AUTRE: "Autre",
};

function propertyTypeDisplay(raw: string | null | undefined): string {
  const t = raw != null ? String(raw).trim() : "";
  if (!t) return "—";
  const up = t.toUpperCase();
  return PROPERTY_TYPE_LABELS[up] ?? t;
}

function formatPortalDateFr(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

/** Libellé catégorie client (ne jamais afficher le code `type` brut). */
function getDocumentLabel(type: string | null | undefined): string {
  const t = (type ?? "").toLowerCase().trim();
  const map: Record<string, string> = {
    quote_pdf: "Devis",
    quote_pdf_signed: "Devis signé",
    study_pdf: "Étude",
    study_attachment: "Étude",
    lead_attachment: "Document projet",
    invoice_pdf: "Facture",
    credit_note_pdf: "Avoir",
    quote_signature_client: "Signature client",
    quote_signature_company: "Signature entreprise",
    organization_pdf_cover: "Document entreprise",
    consumption_csv: "Données de consommation",
  };
  return map[t] ?? "Autre document";
}

function parsePortalDocumentRow(raw: unknown): PortalPayload["documents"][number] {
  const r = raw as Record<string, unknown>;
  const name = normPortalStr(r.name) ?? "Document";
  return {
    id: String(r.id ?? ""),
    name,
    type: typeof r.type === "string" ? r.type : "",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    download_url: typeof r.download_url === "string" ? r.download_url : "",
    display_name: normPortalStr(r.display_name),
    file_name: normPortalStr(r.file_name),
    document_type_label: normPortalStr(r.document_type_label),
  };
}

function getDocumentPrimaryTitle(d: PortalPayload["documents"][number]): string {
  return normPortalStr(d.display_name) ?? normPortalStr(d.file_name) ?? d.name ?? "Document";
}

function getDocumentCategoryLine(d: PortalPayload["documents"][number]): string {
  const fromApi = normPortalStr(d.document_type_label);
  if (fromApi) return fromApi;
  return getDocumentLabel(d.type);
}

function parsePortalPayload(raw: unknown): PortalPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Réponse serveur invalide.");
  }
  const o = raw as Record<string, unknown>;
  const client = o.client;
  const project = o.project;
  const meta = o.meta;
  const advisor = o.advisor;
  const summaryRaw = o.summary;
  if (!client || typeof client !== "object") throw new Error("Réponse serveur invalide (client).");
  if (!project || typeof project !== "object") throw new Error("Réponse serveur invalide (projet).");
  if (!meta || typeof meta !== "object") throw new Error("Réponse serveur invalide (meta).");
  if (!advisor || typeof advisor !== "object") throw new Error("Réponse serveur invalide (contact).");
  if (!summaryRaw || typeof summaryRaw !== "object") throw new Error("Réponse serveur invalide (synthèse).");
  const rawAdv = advisor as Record<string, unknown>;
  const advisorNorm = {
    first_name: normPortalStr(rawAdv.first_name),
    last_name: normPortalStr(rawAdv.last_name),
    email: normPortalStr(rawAdv.email),
    phone: normPortalStr(rawAdv.phone),
  };
  const site = (client as Record<string, unknown>).site;
  if (!site || typeof site !== "object") throw new Error("Réponse serveur invalide (adresse).");
  const qs = (project as Record<string, unknown>).quotes_summary;
  if (!Array.isArray(qs)) throw new Error("Réponse serveur invalide (devis).");
  if (!Array.isArray(o.documents)) throw new Error("Réponse serveur invalide (documents).");
  if (!o.pipeline || typeof o.pipeline !== "object") throw new Error("Réponse serveur invalide (pipeline).");
  const pl = o.pipeline as Record<string, unknown>;
  if (!Array.isArray(pl.steps)) throw new Error("Réponse serveur invalide (étapes).");
  const rawMeta = meta as Record<string, unknown>;
  const metaNorm = {
    ...rawMeta,
    organization_name: normPortalStr(rawMeta.organization_name),
    organization_logo_url: normPortalStr(rawMeta.organization_logo_url),
  };
  const sum = summaryRaw as Record<string, unknown>;
  const summaryNorm = {
    project_status_label:
      typeof sum.project_status_label === "string" && sum.project_status_label.trim() !== ""
        ? sum.project_status_label.trim()
        : "En cours",
    consumption_is_estimated: Boolean(sum.consumption_is_estimated),
    offer: parsePortalOffer(sum.offer),
    technical_notice:
      typeof sum.technical_notice === "string" && sum.technical_notice.trim() !== ""
        ? sum.technical_notice.trim()
        : null,
  };
  const documentsNorm = (o.documents as unknown[]).map(parsePortalDocumentRow);
  return { ...o, advisor: advisorNorm, meta: metaNorm, summary: summaryNorm, documents: documentsNorm } as PortalPayload;
}

/** Nom d'entreprise issu du CRM (portail). Chaîne vide si non renseigné. */
function orgBrand(data: PortalPayload): string {
  return data.meta.organization_name?.trim() ?? "";
}

function advisorDisplayName(a: PortalPayload["advisor"]): string | null {
  const s = [a.first_name, a.last_name]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return s || null;
}

function buildHeroBadge(data: PortalPayload): string {
  if (data.meta.lead_status === "LEAD") {
    return "Devis en attente de signature";
  }
  const cur = data.pipeline.steps.find((s) => s.status === "current");
  if (cur) {
    return `Étape : ${cur.label}`;
  }
  if (data.project.study_status) {
    return `Étude : ${data.project.study_status}`;
  }
  const b = orgBrand(data);
  return b ? `Projet client — ${b}` : "Projet client";
}

function stepLabelForPortal(s: PipelineStep, pipeline: PortalPipeline): string {
  if (pipeline.mode === "LEAD" && s.id === 1 && pipeline.lead_first_step_label) {
    return pipeline.lead_first_step_label;
  }
  return s.label;
}

function docHref(d: PortalPayload["documents"][0]): string {
  const u = d.download_url;
  if (u.startsWith("http")) return u;
  return `${API_BASE}${u}`;
}

/** Logo hero : CRM (upload entreprise) ou repli asset statique. */
function heroLogoSrc(data: PortalPayload): string {
  const u = data.meta.organization_logo_url?.trim();
  if (u) {
    if (u.startsWith("http")) return u;
    return `${API_BASE}${u.startsWith("/") ? u : `/${u}`}`;
  }
  return ASSET_LOGO;
}

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Si l’URL logo CRM échoue (404, réseau), repli sur l’asset local. */
  const [heroLogoFallback, setHeroLogoFallback] = useState(false);

  useEffect(() => {
    if (!token) {
      setErr("Lien invalide.");
      setLoading(false);
      return;
    }
    const url = `${API_BASE}/api/client-portal/${encodeURIComponent(token)}`;
    fetch(url)
      .then(async (r) => {
        if (r.status === 401) {
          throw new Error("Lien expiré ou invalide.");
        }
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || "Impossible de charger le dossier.");
        }
        return r.json().then((raw) => parsePortalPayload(raw));
      })
      .then((d) => {
        setHeroLogoFallback(false);
        setData(d);
      })
      .catch((e: Error) => setErr(e.message || "Erreur"))
      .finally(() => setLoading(false));
  }, [token]);

  const addressBlock = useMemo(() => {
    if (!data) return "";
    const s = data.client.site;
    const fmt = normPortalStr(s.formatted_address);
    if (fmt) return fmt;
    const line1 = [dash(s.address_line1), dash(s.address_line2)]
      .filter((x) => x !== "—")
      .join(", ");
    const line2 = [s.postal_code, s.city].filter(Boolean).join(" ");
    return [line1, line2].filter((x) => x !== "—").join("\n") || "—";
  }, [data]);

  const documentGroups = useMemo(() => {
    const empty = { project: [] as PortalPayload["documents"], quote: [] as PortalPayload["documents"], other: [] as PortalPayload["documents"] };
    if (!data?.documents.length) return empty;
    for (const d of data.documents) {
      const g = categorizePortalDocument(d.type);
      if (g === "project") empty.project.push(d);
      else if (g === "quote") empty.quote.push(d);
      else empty.other.push(d);
    }
    return empty;
  }, [data]);

  if (loading) {
    return (
      <div className="client-portal client-portal--center">
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 15 }}>Chargement de votre espace…</p>
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="client-portal client-portal--center">
        <h1 className="client-portal__title">Espace client</h1>
        <p className="client-portal__error">{err || "Erreur"}</p>
      </div>
    );
  }

  const subline = ["Projet photovoltaïque", data.client.site.city, data.client.property_type]
    .filter(Boolean)
    .join(" · ");

  const brand = orgBrand(data);
  const pipelineContextMain = getNextStepParagraph(data);
  const pipelineContextNote = getPipelineReassuranceNote(data);
  const storyPrimary = getStoryPrimaryParagraph(data, brand);
  const statusHeadline = getClientStatusHeadline(data);
  const badge = buildHeroBadge(data);
  const heroLogo = heroLogoFallback ? ASSET_LOGO : heroLogoSrc(data);

  const offer = data.summary.offer;
  const offerHeadline =
    offer.kind === "validated"
      ? offer.headline
      : offer.kind === "pending" && offer.amount_ttc != null
        ? `Offre en cours : ${new Intl.NumberFormat("fr-FR", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(offer.amount_ttc)} ${offer.currency === "EUR" ? "€" : offer.currency} TTC`
        : offer.kind === "pending"
          ? "Offre en cours"
          : null;
  const offerDateLine = (() => {
    if (offer.kind !== "pending") return null;
    const label = offer.date_kind === "sent" ? "Devis envoyé le" : "Devis établi le";
    const fd = formatPortalDateFr(offer.reference_date);
    return fd ? `${label} ${fd}` : null;
  })();

  const contactIncomplete = !data.advisor.email || !data.advisor.phone;

  return (
    <div className="client-portal">
      <header className="cp-hero">
        <div
          className="cp-hero__bg"
          style={{ backgroundImage: `url(${ASSET_BG})` }}
          role="presentation"
        />
        <div className="cp-hero__overlay" />
        <div className="cp-hero__brand">
          <div className="cp-hero__brand-halo" aria-hidden />
          <img
            className="cp-hero__logo"
            src={heroLogo}
            alt={brand ? `Logo ${brand}` : "Logo"}
            width={200}
            height={64}
            onError={() => setHeroLogoFallback(true)}
          />
          <span className="cp-hero__brand-label">Espace client</span>
        </div>
        <div className="cp-hero__content">
          <span className="cp-hero__line" aria-hidden />
          <h1 className="cp-hero__name">{dash(data.client.full_name)}</h1>
          <p className="cp-hero__sub">{subline || "—"}</p>
          <div className="cp-hero__meta">
            {data.project.study_number ? (
              <span className="cp-hero__ref">
                Dossier <strong>{data.project.study_number}</strong>
              </span>
            ) : null}
            <span className="cp-hero__badge">{badge}</span>
          </div>
        </div>
      </header>

      <section className="cp-body">
        <div className="cp-container">
          <div className="cp-grid">
            <div className="cp-grid__stack">
              <div className="cp-summary">
                <h2>Synthèse de votre projet</h2>

                <div className="cp-summary-status-banner" role="status">
                  <span className="cp-summary-status-banner__label">Statut du projet</span>
                  <p className="cp-summary-status-banner__value">{statusHeadline}</p>
                </div>

                <div className="cp-summary-main">
                  <div className="cp-summary-main__col">
                  <div className="cp-summary-block cp-summary-block--in-grid">
                    <h3 className="cp-summary-block__title">Identité du projet</h3>
                    <div className="cp-summary-identity-stack">
                      <div>
                        <span className="cp-field__label">Adresse</span>
                        <span className="cp-field__value cp-field__value--emph" style={{ whiteSpace: "pre-line" }}>
                          {addressBlock}
                        </span>
                      </div>
                      <div>
                        <span className="cp-field__label">Type de bien</span>
                        <span className="cp-field__value">{propertyTypeDisplay(data.client.property_type)}</span>
                      </div>
                      {data.project.study_number ? (
                        <div>
                          <span className="cp-field__label">Référence dossier</span>
                          <span className="cp-field__value">{data.project.study_number}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  </div>

                  <div className="cp-summary-main__col">
                  <div className="cp-summary-block cp-summary-block--in-grid">
                    <h3 className="cp-summary-block__title">Énergie</h3>
                    <div className="cp-highlight cp-highlight--energy">
                      <span className="cp-field__label">
                        Consommation annuelle
                        {data.summary.consumption_is_estimated ? (
                          <span className="cp-field__tag">estimée</span>
                        ) : null}
                      </span>
                      <div className="cp-field__value cp-field__value--big">
                        {data.client.consumption_annual_kwh != null
                          ? `${Number(data.client.consumption_annual_kwh).toLocaleString("fr-FR")} kWh`
                          : "—"}
                      </div>
                    </div>
                  </div>

                  {offer.kind !== "none" ? (
                    <div className="cp-summary-block cp-summary-block--in-grid">
                      <h3 className="cp-summary-block__title">Offre client</h3>
                      {offer.kind === "validated" ? (
                        <p className="cp-summary-offer cp-summary-offer--single">{offer.headline}</p>
                      ) : (
                        <div className="cp-summary-offer-lines">
                          {offerHeadline ? (
                            <p className="cp-summary-offer cp-summary-offer--amount">{offerHeadline}</p>
                          ) : null}
                          {offerDateLine ? (
                            <p className="cp-summary-offer cp-summary-offer--date">{offerDateLine}</p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}
                  </div>
                </div>

                {data.summary.technical_notice ? (
                  <div className="cp-summary-block cp-summary-block--muted cp-summary-block--full-width">
                    <h3 className="cp-summary-block__title">Données techniques</h3>
                    <p className="cp-summary-note">{data.summary.technical_notice}</p>
                  </div>
                ) : null}
              </div>

              <div className="cp-next-step">
                <h3 className="cp-next-step__title">Prochaine étape</h3>
                <p className="cp-next-step__text">{pipelineContextMain}</p>
              </div>
            </div>

            <div className="cp-story">
              <h2>
                Votre espace projet{brand ? <span> {brand}</span> : null}
              </h2>
              <p>{storyPrimary}</p>
              <p>
                {brand ? (
                  <>
                    <strong>{brand}</strong> est un <strong>bureau d&apos;étude indépendant</strong> : étude
                    technique, démarches administratives, suivi de chantier et mise en service font partie du
                    cadre d&apos;accompagnement.
                  </>
                ) : (
                  <>
                    Nous intervenons en tant que <strong>bureau d&apos;étude indépendant</strong> : étude
                    technique, démarches administratives, suivi de chantier et mise en service.
                  </>
                )}
              </p>
              <p className="cp-story__emphasis">
                Vous n&apos;avez aucune action particulière à effectuer. Nous pilotons les étapes et vous
                informons à chaque jalon important.
              </p>
            </div>
          </div>

          <div className="cp-pipeline-wrap">
            <div className="cp-pipeline-head">
              <h2 className="cp-pipeline-title">Avancement de votre projet</h2>
              <p className="cp-pipeline-lead">Une vision claire, sans complexité.</p>
            </div>
            <div className="cp-pipeline cp-pipeline--timeline" role="list">
              <div className="cp-pipeline__track" aria-hidden />
              {data.pipeline.steps.map((s) => (
                <div
                  key={s.id}
                  role="listitem"
                  className={`cp-pipeline-step cp-pipeline-step--${s.status}`}
                >
                  {stepLabelForPortal(s, data.pipeline)}
                </div>
              ))}
            </div>
            <div className="cp-pipeline-context">
              <p>{pipelineContextMain}</p>
              <p className="cp-muted-gold">{pipelineContextNote}</p>
            </div>
          </div>

          <div className="cp-docs-section">
            <div className="cp-docs-head">
              <h3>
                Vos propositions &amp; <span>documents</span>
              </h3>
              <p className="cp-docs-lead">
                L&apos;ensemble de vos documents, centralisés et accessibles à tout moment.
              </p>
              <p className="cp-docs-intro">
                Vous trouverez ci-dessous les documents constituant votre projet. Ces documents peuvent être
                consultés ou téléchargés librement, selon les droits définis par votre interlocuteur.
              </p>
            </div>

            {data.documents.length === 0 ? (
              <p className="cp-docs-empty">Aucun document disponible pour le moment.</p>
            ) : (
              <div className="cp-proposal-card">
                {DOCUMENT_SECTION_ORDER.map(({ key, title }) => {
                  const list = documentGroups[key];
                  if (!list.length) return null;
                  return (
                    <div key={key} className="cp-doc-group">
                      <h4 className="cp-doc-group__title">{title}</h4>
                      {list.map((d) => {
                        const href = docHref(d);
                        const dateStr = formatPortalDateFr(d.created_at);
                        return (
                          <div key={d.id} className="cp-doc-row">
                            <div className="cp-doc-meta">
                              <span className="cp-doc-title">{getDocumentPrimaryTitle(d)}</span>
                              <span className="cp-doc-secondary">
                                <span className="cp-doc-category">{getDocumentCategoryLine(d)}</span>
                                {dateStr ? <span className="cp-doc-date"> · {dateStr}</span> : null}
                              </span>
                            </div>
                            <div className="cp-doc-actions">
                              <a className="cp-btn-doc" href={href} target="_blank" rel="noopener noreferrer">
                                Ouvrir
                              </a>
                              <a
                                className="cp-btn-doc cp-btn-doc--outline"
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Télécharger
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="cp-advisor">
            <div className="cp-advisor-head">
              <h3>Votre interlocuteur</h3>
              <p className="cp-advisor-lead">Un point de contact unique, à votre écoute.</p>
            </div>
            <div className="cp-advisor-card">
              <div className="cp-advisor-identity">
                <span className="cp-advisor-name">
                  {advisorDisplayName(data.advisor) ??
                    (brand ? `Votre conseiller ${brand}` : "Votre conseiller")}
                </span>
                <span className="cp-advisor-role">
                  {brand ? `Conseiller projet — ${brand}` : "Conseiller projet"}
                </span>
              </div>
              <div className="cp-advisor-contact" aria-label="Coordonnées du conseiller">
                {contactIncomplete ? (
                  <p className="cp-advisor-fallback-msg">Un conseiller vous sera attribué prochainement.</p>
                ) : null}
                {data.advisor.phone ? (
                  <div className="cp-advisor-contact-block">
                    <span className="cp-advisor-contact-label">Téléphone</span>
                    <a
                      className="cp-advisor-contact-value"
                      href={`tel:${String(data.advisor.phone).replace(/\s/g, "")}`}
                    >
                      {data.advisor.phone}
                    </a>
                  </div>
                ) : null}
                {data.advisor.email ? (
                  <div className="cp-advisor-contact-block">
                    <span className="cp-advisor-contact-label">E-mail</span>
                    <a className="cp-advisor-contact-value" href={`mailto:${data.advisor.email}`}>
                      {data.advisor.email}
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="cp-advisor-note">
              <p>
                Votre conseiller reste disponible pour toute question relative à votre projet ou à son
                avancement.
              </p>
              <p className="cp-muted-partner">
                L&apos;installation est réalisée par un partenaire certifié et assuré, sélectionné selon les
                exigences
                {brand ? <> {brand}</> : <> applicables à votre projet</>}.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="cp-footer">
        <span className="cp-footer__main">
          {brand ? `${brand} — Bureau d'étude photovoltaïque` : "Bureau d'étude photovoltaïque"}
        </span>
        <span className="cp-footer__sep">·</span>
        <span className="cp-footer__sub">
          Espace client sécurisé · Données et documents confidentiels · Accès réservé au titulaire du dossier
        </span>
      </footer>
    </div>
  );
}
