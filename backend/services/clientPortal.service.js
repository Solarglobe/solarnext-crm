/**
 * Portail client SolarGlobe — assemblage JSON et règles métier (source CRM unique).
 */

import { createHash, randomBytes } from "crypto";
import fs from "fs";
import { pool } from "../config/db.js";
import { resolveOrgLogoAbsolutePath } from "./orgLogo.service.js";
import {
  ensureDefaultLeadMeter,
  getDefaultMeterRow,
  hydrateLeadWithDefaultMeterFields,
} from "./leadMeters.service.js";

/** @typedef {import("pg").Pool} Pool */

/**
 * Étapes affichées portail (ordre métier). Les libellés sont la colonne « produit » ;
 * l’avancement réel vient de leads.project_status (mapping ci-dessous).
 */
export const PORTAL_TIMELINE_STEPS = [
  { id: 1, label: "Devis signé" },
  { id: 2, label: "Démarches préparées" },
  { id: 3, label: "DP déposée" },
  { id: 4, label: "DP acceptée" },
  { id: 5, label: "Installation planifiée" },
  { id: 6, label: "Installation réalisée" },
  { id: 7, label: "Consuel en attente" },
  { id: 8, label: "Consuel obtenu" },
  { id: 9, label: "Mise en service" },
  { id: 10, label: "Projet terminé" },
];

/** project_status CRM → index d’étape courante 1..10 (aligné enum leads.controller). */
const PROJECT_STATUS_TO_TIMELINE_INDEX = {
  SIGNE: 1,
  DP_A_DEPOSER: 2,
  DP_DEPOSE: 3,
  DP_ACCEPTE: 4,
  INSTALLATION_PLANIFIEE: 5,
  INSTALLATION_REALISEE: 6,
  CONSUEL_EN_ATTENTE: 7,
  CONSUEL_OBTENU: 8,
  MISE_EN_SERVICE: 9,
  FACTURATION_TERMINEE: 10,
  CLOTURE: 10,
};

export function hashPortalTokenSecret(rawSecret) {
  return createHash("sha256").update(String(rawSecret), "utf8").digest("hex");
}

/**
 * URL publique complète du portail (env) ou null si non configuré (le caller peut reconstruire avec token).
 */
export function buildPortalDisplayUrl(rawToken) {
  const base =
    process.env.CLIENT_PORTAL_PUBLIC_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    "";
  const pathPrefix = "/crm.html/client-portal/";
  if (!base) return null;
  return `${String(base).replace(/\/$/, "")}${pathPrefix}${encodeURIComponent(String(rawToken))}`;
}

/**
 * @param {string} rawSecret
 * @returns {Promise<{ id: string, organization_id: string, lead_id: string }|null>}
 */
export async function findValidPortalTokenRow(rawSecret) {
  const tokenHash = hashPortalTokenSecret(rawSecret);
  const r = await pool.query(
    `SELECT id, organization_id, lead_id, expires_at, revoked_at
     FROM client_portal_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;
  return row;
}

export async function touchPortalTokenLastUsed(tokenRowId) {
  await pool.query(`UPDATE client_portal_tokens SET last_used_at = now() WHERE id = $1`, [tokenRowId]);
}

/**
 * Jeton portail encore actif pour un lead (staff) — inclut token_secret si présent (lignes post-migration).
 * @returns {Promise<{ id: string, expires_at: Date|null, token_secret: string|null, created_at: Date }|null>}
 */
export async function findActivePortalTokenRowForLead(db, { organizationId, leadId }) {
  const r = await db.query(
    `SELECT id, expires_at, token_secret, created_at
     FROM client_portal_tokens
     WHERE lead_id = $1 AND organization_id = $2 AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [leadId, organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {string|null|undefined} projectStatus
 * @returns {number} index 1..10
 */
export function mapProjectStatusToTimelineStepIndex(projectStatus) {
  if (!projectStatus || !PROJECT_STATUS_TO_TIMELINE_INDEX[projectStatus]) return 1;
  return PROJECT_STATUS_TO_TIMELINE_INDEX[projectStatus];
}

/** Libellés portail pour leads.project_status (CLIENT uniquement). */
export const PORTAL_PROJECT_STATUS_LABELS = {
  SIGNE: "Devis signé",
  DP_A_DEPOSER: "Démarches en cours",
  DP_DEPOSE: "Démarches en cours",
  DP_ACCEPTE: "Démarches en cours",
  INSTALLATION_PLANIFIEE: "Installation planifiée",
  INSTALLATION_REALISEE: "Installation en cours",
  CONSUEL_EN_ATTENTE: "Consuel en attente",
  CONSUEL_OBTENU: "Consuel obtenu",
  MISE_EN_SERVICE: "Mise en service",
  FACTURATION_TERMINEE: "Facturation",
  CLOTURE: "Projet terminé",
};

/** Repli si status = LEAD (pas de project_status). */
export const PORTAL_LEAD_STATUS_LABELS = {
  LEAD: "Étude en cours",
  CLIENT: "Projet client",
};

/**
 * Libellé humain pour la ligne « Statut actuel » (portail).
 * @param {string} leadStatus
 * @param {string|null|undefined} projectStatus
 */
export function resolvePortalProjectStatusLabel(leadStatus, projectStatus) {
  const ls = String(leadStatus || "").toUpperCase();
  if (ls === "CLIENT" && projectStatus) {
    const ps = String(projectStatus).toUpperCase();
    return PORTAL_PROJECT_STATUS_LABELS[ps] || "En cours";
  }
  return PORTAL_LEAD_STATUS_LABELS[ls] || "En cours";
}

const QUOTE_OPEN_STATUSES = new Set(["DRAFT", "READY_TO_SEND", "SENT"]);

/**
 * Règle offre portail : quotes déjà triées created_at DESC (plus récent en premier).
 * - Le devis le plus récent s’il est « ouvert » → offre en cours (montant + date), même si un ancien devis est signé.
 * - Sinon, si un devis signé (ACCEPTED) apparaît dans l’historique → message projet validé.
 * - Sinon rien.
 *
 * @param {Array<{ status?: string|null, total_ttc?: unknown, currency?: string|null, sent_at?: Date|string|null, created_at?: Date|string|null }>} quotesDesc
 * @returns {{ kind: "none" } | { kind: "validated"; headline: string } | { kind: "pending"; amount_ttc: number|null; currency: string; reference_date: string|null; date_kind: "sent"|"created" }}
 */
export function resolvePortalOffer(quotesDesc) {
  const list = Array.isArray(quotesDesc) ? quotesDesc : [];
  if (list.length === 0) return { kind: "none" };
  const norm = (s) => String(s ?? "").toUpperCase();

  const pendingShape = (pending) => {
    const amount =
      pending.total_ttc != null && Number.isFinite(Number(pending.total_ttc))
        ? Number(pending.total_ttc)
        : null;
    const currency = (pending.currency && String(pending.currency).trim()) || "EUR";
    const sent = pending.sent_at != null ? pending.sent_at : null;
    const created = pending.created_at != null ? pending.created_at : null;
    const ref = sent || created;
    let reference_date = null;
    if (ref != null) {
      const d = ref instanceof Date ? ref : new Date(ref);
      reference_date = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return {
      kind: "pending",
      amount_ttc: amount,
      currency,
      reference_date,
      date_kind: sent ? "sent" : "created",
    };
  };

  const top = list[0];
  const topSt = norm(top.status);
  if (QUOTE_OPEN_STATUSES.has(topSt)) {
    return pendingShape(top);
  }
  if (topSt === "ACCEPTED") {
    return { kind: "validated", headline: "Projet validé — Installation en cours" };
  }
  const signed = list.find((q) => norm(q.status) === "ACCEPTED");
  if (signed) {
    return { kind: "validated", headline: "Projet validé — Installation en cours" };
  }
  const pending = list.find((q) => QUOTE_OPEN_STATUSES.has(norm(q.status)));
  if (!pending) return { kind: "none" };
  return pendingShape(pending);
}

/**
 * Payload pipeline portail : LEAD (aucune étape validée) ou CLIENT (statuts CRM).
 * @param {string} leadStatus
 * @param {string|null|undefined} projectStatus
 */
export function buildPortalTimelinePayload(leadStatus, projectStatus) {
  const defs = PORTAL_TIMELINE_STEPS;
  if (leadStatus === "LEAD") {
    /** Pas de devis signé → étape 1 = « en attente de signature », affichée active (dorée). */
    return {
      mode: "LEAD",
      current_step: 1,
      raw_status: null,
      lead_first_step_label: "Devis en attente de signature",
      steps: defs.map((s) => ({
        id: s.id,
        label: s.label,
        status: s.id === 1 ? "current" : "upcoming",
      })),
    };
  }
  const cur = mapProjectStatusToTimelineStepIndex(projectStatus);
  return {
    mode: "CLIENT",
    current_step: cur,
    raw_status: projectStatus ?? null,
    lead_first_step_label: null,
    steps: defs.map((s) => {
      let status = "upcoming";
      if (s.id < cur) status = "done";
      else if (s.id === cur) status = "current";
      return { id: s.id, label: s.label, status };
    }),
  };
}

function toIso(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Libellé UX portail (hors codes techniques).
 * @param {string|null|undefined} documentType
 * @returns {string}
 */
export function resolvePortalDocumentLabel(documentType) {
  const t = String(documentType ?? "")
    .toLowerCase()
    .trim();
  if (t === "quote_pdf") {
    return "Devis";
  }
  if (t === "study_pdf" || t === "study_proposal") {
    return "Proposition";
  }
  return "Document";
}

/** Types copiés sur le lead — exclus du bloc « documents manuels » portail. */
/**
 * Types de documents portail — correspond aux mirrors entity_type='lead' créés à la génération.
 * Identique à ce que le CRM Documents tab (GET /api/documents/lead/:id) retourne, filtré.
 *
 * NB : les propositions commerciales sauvegardées sur le lead utilisent document_type='study_pdf'
 * (via saveStudyProposalPdfOnLeadDocument). 'study_proposal' est gardé comme filet de sécurité.
 */
const PORTAL_ALLOWED_DOC_TYPES = [
  "quote_pdf",
  "quote_pdf_signed",
  "study_pdf",
  "study_proposal",
  "invoice_pdf",
];

/**
 * Documents visibles espace client : miroirs sur le lead ET sur le client CRM (factures copiées côté client, etc.).
 * @param {Record<string, unknown>} doc
 * @returns {boolean}
 */
export function isPortalClientDocument(doc) {
  const et = String(doc.entity_type ?? "").toLowerCase().trim();
  const dt = String(doc.document_type ?? "").toLowerCase().trim();
  if (!PORTAL_ALLOWED_DOC_TYPES.includes(dt)) return false;
  if (et === "lead" || et === "client") return true;
  if (et === "quote" && (dt === "quote_pdf" || dt === "quote_pdf_signed")) return true;
  if (et === "invoice" && dt === "invoice_pdf") return true;
  if ((et === "study" || et === "study_version") && (dt === "study_pdf" || dt === "study_proposal")) return true;
  return false;
}

/**
 * Libellé UX portail selon document_type (entity_type lead ou client).
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
export function resolvePortalDocumentLabelFromRow(row) {
  const dt = String(row.document_type ?? "").toLowerCase().trim();
  if (dt === "quote_pdf" || dt === "quote_pdf_signed") return "Devis";
  if (dt === "study_pdf" || dt === "study_proposal") return "Proposition commerciale";
  if (dt === "invoice_pdf") return "Facture";
  if (dt === "credit_note_pdf") return "Avoir";
  return resolvePortalDocumentLabel(row.document_type);
}

/**
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function normalizePortalFileName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase();
}

function portalMeta(row) {
  const meta = row?.metadata_json;
  if (!meta) return {};
  if (typeof meta === "object" && !Array.isArray(meta)) return meta;
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function portalDocumentDedupeKey(row) {
  const et = String(row?.entity_type ?? "").toLowerCase().trim();
  const dt = String(row?.document_type ?? "").toLowerCase().trim();
  const meta = portalMeta(row);
  const entityId = row?.entity_id != null ? String(row.entity_id) : "";
  const docId = row?.id != null ? String(row.id) : entityId;
  const metaId = (...keys) => {
    for (const key of keys) {
      if (meta[key] != null && String(meta[key]).trim() !== "") return String(meta[key]).trim();
    }
    return null;
  };

  if (dt === "quote_pdf" || dt === "quote_pdf_signed") {
    const quoteId = metaId("quote_id", "quoteId");
    return `quote:${quoteId || (et === "quote" && entityId ? entityId : `doc:${docId}`)}`;
  }
  if (dt === "invoice_pdf") {
    const invoiceId = metaId("invoice_id", "invoiceId");
    return `invoice:${invoiceId || (et === "invoice" && entityId ? entityId : `doc:${docId}`)}`;
  }
  if (dt === "study_pdf" || dt === "study_proposal") {
    const studyId = metaId("study_version_id", "studyVersionId", "study_id", "studyId");
    return `study:${studyId || ((et === "study" || et === "study_version") && entityId ? entityId : `doc:${docId}`)}`;
  }
  return `doc:${docId}`;
}

/**
 * Dédup par entity_id : pour chaque entité source (quote, invoice, étude…), garde seulement
 * le document pertinent. Évite les doublons quand un PDF est régénéré plusieurs fois.
 *
 * Priorité (pour les devis) : quote_pdf_signed > quote_pdf (indépendamment des dates).
 * Priorité générale : le plus récent en cas d'égalité de type.
 *
 * @param {Array<Record<string, unknown>>} docs
 * @returns {Array<Record<string, unknown>>}
 */
export function dedupeByEntityIdKeepNewest(docs) {
  const list = Array.isArray(docs) ? docs : [];
  // Tri : signé en premier, puis plus récent en premier
  const sorted = [...list].sort((a, b) => {
    const aIsSigned = String(a.document_type ?? "").toLowerCase() === "quote_pdf_signed" ? 1 : 0;
    const bIsSigned = String(b.document_type ?? "").toLowerCase() === "quote_pdf_signed" ? 1 : 0;
    if (bIsSigned !== aIsSigned) return bIsSigned - aIsSigned; // signé en tête
    const aTime = new Date(/** @type {Date|string|undefined} */ (a.created_at) || 0).getTime();
    const bTime = new Date(/** @type {Date|string|undefined} */ (b.created_at) || 0).getTime();
    return bTime - aTime;
  });
  /** @type {Map<string, Record<string, unknown>>} */
  const byKey = new Map();
  for (const doc of sorted) {
    // Clé = entity_id (une seule entrée par entité source — le premier gagne, donc le signé si disponible)
    const key = portalDocumentDedupeKey(doc);
    if (!byKey.has(key)) {
      byKey.set(key, doc);
    }
  }
  return Array.from(byKey.values());
}

/**
 * @deprecated Utiliser dedupeByEntityIdKeepNewest — la dédup par file_name ne fonctionne pas
 * quand les PDFs ont des noms UUID uniques (régénération).
 * @param {Array<Record<string, unknown>>} docs
 * @returns {Array<Record<string, unknown>>}
 */
export function dedupeByFileNameKeepNewest(docs) {
  return dedupeByEntityIdKeepNewest(docs);
}

function portalDocumentFamily(row) {
  const dt = String(row?.document_type ?? "").toLowerCase().trim();
  if (dt === "quote_pdf" || dt === "quote_pdf_signed") return "quote";
  if (dt === "study_pdf" || dt === "study_proposal") return "proposal";
  if (dt === "invoice_pdf") return "invoice";
  return "other";
}

function isPortalMirrorDocument(row) {
  const et = String(row?.entity_type ?? "").toLowerCase().trim();
  return et === "lead" || et === "client";
}

function newestFirst(a, b) {
  const aTime = new Date(/** @type {Date|string|undefined} */ (a.created_at) || 0).getTime();
  const bTime = new Date(/** @type {Date|string|undefined} */ (b.created_at) || 0).getTime();
  return bTime - aTime;
}

export function selectPortalDocumentsForResponse(rows) {
  const candidates = Array.isArray(rows) ? rows.filter((d) => isPortalClientDocument(d)) : [];
  const mirrors = dedupeByEntityIdKeepNewest(candidates.filter((d) => isPortalMirrorDocument(d)));
  const sources = dedupeByEntityIdKeepNewest(candidates.filter((d) => !isPortalMirrorDocument(d)));

  const mirrorFamilies = new Set(mirrors.map((d) => portalDocumentFamily(d)));
  const selected = [...mirrors];

  if (!mirrorFamilies.has("quote")) {
    const fallbackQuote = sources.filter((d) => portalDocumentFamily(d) === "quote").sort(newestFirst)[0];
    if (fallbackQuote) selected.push(fallbackQuote);
  }

  if (!mirrorFamilies.has("proposal")) {
    const fallbackProposal = sources.filter((d) => portalDocumentFamily(d) === "proposal").sort(newestFirst)[0];
    if (fallbackProposal) selected.push(fallbackProposal);
  }

  const invoiceKeys = new Set(
    selected.filter((d) => portalDocumentFamily(d) === "invoice").map((d) => portalDocumentDedupeKey(d))
  );
  for (const invoice of sources.filter((d) => portalDocumentFamily(d) === "invoice")) {
    const key = portalDocumentDedupeKey(invoice);
    if (!invoiceKeys.has(key)) {
      selected.push(invoice);
      invoiceKeys.add(key);
    }
  }

  return dedupeByEntityIdKeepNewest(selected).sort(newestFirst);
}

/**
 * Après `isPortalClientDocument`, répartit en familles pour dédup ciblée.
 * @param {Array<Record<string, unknown>>} rows
 */
export function splitPortalFilteredDocuments(rows) {
  const quotes = [];
  const proposals = [];
  const invoices = [];
  for (const doc of rows) {
    const et = String(doc.entity_type ?? "")
      .toLowerCase()
      .trim();
    const dt = String(doc.document_type ?? "")
      .toLowerCase()
      .trim();
    if (et === "quote" && (dt === "quote_pdf" || dt === "quote_pdf_signed")) {
      quotes.push(doc);
    } else if (
      (et === "study" || et === "study_version") &&
      dt === "study_proposal"
    ) {
      proposals.push(doc);
    } else if (et === "invoice" && dt === "invoice_pdf") {
      invoices.push(doc);
    }
  }
  return { quotes, proposals, invoices };
}

/**
 * Ordre final : propositions, devis, factures ; tri par section puis `created_at` DESC.
 * @param {{ proposalsDeduped: Record<string, unknown>[]; quotesDeduped: Record<string, unknown>[]; invoicesDeduped: Record<string, unknown>[] }} p
 */
export function mergePortalDocumentsForResponse(p) {
  const merged = [...p.proposalsDeduped, ...p.quotesDeduped, ...p.invoicesDeduped];
  merged.sort((a, b) => {
    const ta = new Date(/** @type {Date|string|undefined} */ (a.created_at) || 0).getTime();
    const tb = new Date(/** @type {Date|string|undefined} */ (b.created_at) || 0).getTime();
    return tb - ta;
  });
  return merged;
}

/** Nom affiché côté portail : aligné sur le CRM (Nom de l'entreprise → nom commercial → nom juridique). */
function pickOrganizationDisplayName(row) {
  if (!row) return null;
  const pick = (v) => (v != null && String(v).trim() !== "" ? String(v).trim() : null);
  return pick(row.org_name) || pick(row.org_trade_name) || pick(row.org_legal_name) || null;
}

function annualKwhFromEnergyProfileJson(ep) {
  if (ep == null) return null;
  const p = typeof ep === "string" ? (() => { try { return JSON.parse(ep); } catch { return null; } })() : ep;
  if (!p || typeof p !== "object") return null;
  const fromEngine = p.engine?.annual_kwh;
  if (typeof fromEngine === "number" && Number.isFinite(fromEngine)) return fromEngine;
  const fromSummary = p.summary?.annual_kwh;
  if (typeof fromSummary === "number" && Number.isFinite(fromSummary)) return fromSummary;
  return null;
}

/**
 * kWh/an pour le portail : même logique que la fiche lead (Overview).
 * - ANNUAL → consommation annuelle saisie, sinon repli sur calculée.
 * - MONTHLY → somme des 12 mois (compteur par défaut, dernière année avec données) ; sinon calculée.
 * - PDL → kWh/an persistés (colonnes compteur) ou moteur CSV (energy_profile.engine).
 * @returns {Promise<{ annual_kwh: number|null, consumption_is_estimated: boolean }>}
 */
async function resolveLeadConsumptionForPortal(db, { leadId, organizationId, lead, defaultMeterId }) {
  const mode = String(lead.consumption_mode || "ANNUAL").toUpperCase();
  const ann = lead.consumption_annual_kwh != null ? Number(lead.consumption_annual_kwh) : null;
  const calc = lead.consumption_annual_calculated_kwh != null ? Number(lead.consumption_annual_calculated_kwh) : null;

  const finite = (n) => (n != null && Number.isFinite(n) ? n : null);

  if (mode === "ANNUAL") {
    if (finite(ann) != null) return { annual_kwh: ann, consumption_is_estimated: false };
    if (finite(calc) != null) return { annual_kwh: calc, consumption_is_estimated: true };
    return { annual_kwh: null, consumption_is_estimated: false };
  }

  if (mode === "MONTHLY") {
    /* Aligné GET /api/leads/:id : grille du compteur par défaut uniquement. */
    const r = defaultMeterId
      ? await db.query(
          `SELECT COALESCE((
             SELECT SUM(lcm.kwh)::numeric
             FROM lead_consumption_monthly lcm
             WHERE lcm.lead_id = $1::uuid
               AND lcm.organization_id = $2::uuid
               AND lcm.meter_id = $3::uuid
               AND lcm.year = (
                 SELECT MAX(m2.year)
                 FROM lead_consumption_monthly m2
                 WHERE m2.lead_id = $1::uuid
                   AND m2.organization_id = $2::uuid
                   AND m2.meter_id = $3::uuid
               )
           ), 0)::numeric AS t`,
          [leadId, organizationId, defaultMeterId]
        )
      : await db.query(
          `SELECT COALESCE((
             SELECT SUM(lcm.kwh)::numeric
             FROM lead_consumption_monthly lcm
             WHERE lcm.lead_id = $1::uuid
               AND lcm.organization_id = $2::uuid
               AND lcm.year = (
                 SELECT MAX(m2.year)
                 FROM lead_consumption_monthly m2
                 WHERE m2.lead_id = $1::uuid AND m2.organization_id = $2::uuid
               )
           ), 0)::numeric AS t`,
          [leadId, organizationId]
        );
    const sum = Number(r.rows[0]?.t ?? 0);
    if (Number.isFinite(sum) && sum > 0) return { annual_kwh: sum, consumption_is_estimated: false };
    if (finite(calc) != null) return { annual_kwh: calc, consumption_is_estimated: true };
    return { annual_kwh: null, consumption_is_estimated: false };
  }

  if (mode === "PDL") {
    if (finite(ann) != null) return { annual_kwh: ann, consumption_is_estimated: false };
    if (finite(calc) != null) return { annual_kwh: calc, consumption_is_estimated: true };
    const fromProf = finite(annualKwhFromEnergyProfileJson(lead.energy_profile));
    if (fromProf != null) return { annual_kwh: fromProf, consumption_is_estimated: true };
    return { annual_kwh: null, consumption_is_estimated: false };
  }

  if (finite(ann) != null) return { annual_kwh: ann, consumption_is_estimated: false };
  if (finite(calc) != null) return { annual_kwh: calc, consumption_is_estimated: true };
  return { annual_kwh: null, consumption_is_estimated: false };
}

/**
 * @param {Pool} db
 * @param {{ organizationId: string, leadId: string, rawToken: string }} ctx
 */
export async function buildClientPortalPayload(db, ctx) {
  const { organizationId, leadId, rawToken } = ctx;

  const leadRes = await db.query(
    `SELECT l.id, l.organization_id, l.client_id, l.status, l.project_status, l.archived_at,
            l.full_name, l.email, l.phone, l.phone_mobile, l.phone_landline,
            l.property_type, l.consumption_mode,
            l.consumption_annual_kwh, l.consumption_annual_calculated_kwh,
            l.site_address_id, l.assigned_user_id
     FROM leads l
     WHERE l.id = $1 AND l.organization_id = $2`,
    [leadId, organizationId]
  );
  if (leadRes.rows.length === 0) {
    const err = new Error("LEAD_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }
  const lead = leadRes.rows[0];
  if (lead.archived_at) {
    const err = new Error("LEAD_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  let site = {
    address_line1: null,
    address_line2: null,
    postal_code: null,
    city: null,
    country_code: null,
    formatted_address: null,
  };
  if (lead.site_address_id) {
    const a = await db.query(
      `SELECT address_line1, address_line2, postal_code, city, country_code, formatted_address
       FROM addresses
       WHERE id = $1 AND organization_id = $2`,
      [lead.site_address_id, organizationId]
    );
    if (a.rows.length > 0) {
      const row = a.rows[0];
      site = {
        address_line1: row.address_line1 ?? null,
        address_line2: row.address_line2 ?? null,
        postal_code: row.postal_code ?? null,
        city: row.city ?? null,
        country_code: row.country_code ?? null,
        formatted_address: row.formatted_address ?? null,
      };
    }
  }

  const phone =
    lead.phone_mobile?.trim() ||
    lead.phone_landline?.trim() ||
    (lead.phone && String(lead.phone).trim()) ||
    null;

  /** Aligné sur GET /api/leads/:id : vérité compteur par défaut (conso calculée souvent là, pas sur leads). */
  let defaultMeter = await getDefaultMeterRow(db, leadId, organizationId);
  if (!defaultMeter) {
    defaultMeter = await ensureDefaultLeadMeter(db, leadId, organizationId);
  }
  const leadForConsumption = hydrateLeadWithDefaultMeterFields({ ...lead }, defaultMeter);
  const { annual_kwh: consumption, consumption_is_estimated } = await resolveLeadConsumptionForPortal(db, {
    leadId,
    organizationId,
    lead: leadForConsumption,
    defaultMeterId: defaultMeter?.id ?? null,
  });

  const studyRes = await db.query(
    `SELECT id, study_number, status, current_version, created_at
     FROM studies
     WHERE lead_id = $1 AND organization_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [leadId, organizationId]
  );

  let project = {
    study_number: null,
    study_status: null,
    current_version: null,
    latest_version: null,
    quotes_summary: [],
  };

  if (studyRes.rows.length > 0) {
    const study = studyRes.rows[0];
    project.study_number = study.study_number;
    project.study_status = study.status;
    project.current_version = study.current_version;

    let svRes = await db.query(
      `SELECT id, version_number, title, summary, created_at
       FROM study_versions
       WHERE study_id = $1 AND organization_id = $2 AND version_number = $3`,
      [study.id, organizationId, study.current_version]
    );
    if (svRes.rows.length === 0) {
      svRes = await db.query(
        `SELECT id, version_number, title, summary, created_at
         FROM study_versions
         WHERE study_id = $1 AND organization_id = $2
         ORDER BY version_number DESC
         LIMIT 1`,
        [study.id, organizationId]
      );
    }

    if (svRes.rows.length > 0) {
      const sv = svRes.rows[0];
      project.latest_version = {
        version_number: sv.version_number,
        title: sv.title ?? null,
        summary: sv.summary ?? null,
        created_at: toIso(sv.created_at),
      };
    }
  }

  const quotesRes = await db.query(
    `SELECT id, quote_number, status,
            COALESCE(NULLIF(document_snapshot_json->'totals'->>'total_ttc', '')::numeric, total_ttc) AS total_ttc,
            currency, created_at, sent_at, valid_until
     FROM quotes
     WHERE lead_id = $1 AND organization_id = $2 AND (archived_at IS NULL)
     ORDER BY created_at DESC`,
    [leadId, organizationId]
  );
  project.quotes_summary = quotesRes.rows.map((q) => ({
    id: String(q.id),
    quote_number: q.quote_number ?? null,
    status: q.status ?? null,
    total_ttc: q.total_ttc != null ? Number(q.total_ttc) : null,
    currency: q.currency ?? null,
    created_at: toIso(q.created_at),
    sent_at: q.sent_at ? toIso(q.sent_at) : null,
    valid_until: q.valid_until ? toIso(q.valid_until) : null,
  }));

  const portalOffer = resolvePortalOffer(quotesRes.rows);
  const projectStatusLabel = resolvePortalProjectStatusLabel(lead.status, lead.project_status);

  const currency =
    project.quotes_summary.find((q) => q.currency)?.currency || "EUR";

  const showPipeline = true;
  const pipeline = buildPortalTimelinePayload(lead.status, lead.project_status);

  const advRes = await db.query(
    `SELECT u.first_name AS advisor_first_name,
            u.last_name AS advisor_last_name,
            u.email AS user_email,
            o.phone AS org_phone,
            o.name AS org_name,
            o.trade_name AS org_trade_name,
            o.legal_name AS org_legal_name,
            o.pdf_primary_color AS org_pdf_primary_color
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_user_id
     LEFT JOIN organizations o ON o.id = l.organization_id
     WHERE l.id = $1 AND l.organization_id = $2`,
    [leadId, organizationId]
  );
  const advRow = advRes.rows[0];
  const organizationName = pickOrganizationDisplayName(advRow);
  const orgBrandColor =
    advRow?.org_pdf_primary_color != null && String(advRow.org_pdf_primary_color).trim() !== ""
      ? String(advRow.org_pdf_primary_color).trim()
      : null;
  const fn = advRow?.advisor_first_name != null ? String(advRow.advisor_first_name).trim() : "";
  const ln = advRow?.advisor_last_name != null ? String(advRow.advisor_last_name).trim() : "";
  const advisor = {
    first_name: fn || null,
    last_name: ln || null,
    email: advRow?.user_email ?? null,
    phone: advRow?.org_phone?.trim() || null,
  };

  const enc = encodeURIComponent(rawToken);
  /**
   * PDF visibles client : entrées attachées au lead et, si présent, au client CRM lié au dossier.
   */
  const portalClientUuid = lead.client_id ?? null;
  const docRes = await db.query(
    `SELECT ed.id,
            ed.entity_type,
            ed.entity_id,
            ed.file_name,
            ed.document_type,
            ed.metadata_json,
            COALESCE(NULLIF(TRIM(ed.display_name), ''), ed.file_name) AS name,
            ed.created_at
     FROM entity_documents ed
     WHERE ed.organization_id = $1
       AND ed.archived_at IS NULL
       AND ed.is_client_visible IS TRUE
       AND (
         (ed.entity_type = 'lead' AND ed.entity_id = $2::uuid)
         OR (
           $3::uuid IS NOT NULL
           AND ed.entity_type = 'client'
           AND ed.entity_id = $3::uuid
         )
         OR (
           ed.entity_type = 'quote'
           AND ed.document_type IN ('quote_pdf', 'quote_pdf_signed')
           AND EXISTS (
             SELECT 1 FROM quotes q
             WHERE q.id = ed.entity_id
               AND q.organization_id = $1
               AND (q.archived_at IS NULL)
               AND (
                 q.lead_id = $2::uuid
                 OR ($3::uuid IS NOT NULL AND q.client_id = $3::uuid)
               )
           )
         )
         OR (
           ed.entity_type = 'invoice'
           AND ed.document_type = 'invoice_pdf'
           AND EXISTS (
             SELECT 1 FROM invoices i
             WHERE i.id = ed.entity_id
               AND i.organization_id = $1
               AND (i.archived_at IS NULL)
               AND (
                 i.lead_id = $2::uuid
                 OR ($3::uuid IS NOT NULL AND i.client_id = $3::uuid)
               )
           )
         )
         OR (
           ed.entity_type = 'study'
           AND ed.document_type IN ('study_pdf', 'study_proposal')
           AND EXISTS (
             SELECT 1 FROM studies s
             WHERE s.id = ed.entity_id
               AND s.organization_id = $1
               AND (
                 s.lead_id = $2::uuid
                 OR ($3::uuid IS NOT NULL AND s.client_id = $3::uuid)
               )
           )
         )
         OR (
           ed.entity_type = 'study_version'
           AND ed.document_type IN ('study_pdf', 'study_proposal')
           AND EXISTS (
             SELECT 1 FROM study_versions sv
             INNER JOIN studies s ON s.id = sv.study_id AND s.organization_id = sv.organization_id
             WHERE sv.id = ed.entity_id
               AND sv.organization_id = $1
               AND (
                 s.lead_id = $2::uuid
                 OR ($3::uuid IS NOT NULL AND s.client_id = $3::uuid)
               )
           )
         )
       )
       AND ed.document_type IN ('quote_pdf', 'quote_pdf_signed', 'study_pdf', 'study_proposal', 'invoice_pdf')
     ORDER BY ed.created_at DESC`,
    [organizationId, leadId, portalClientUuid]
  );

  if (process.env.CLIENT_PORTAL_DOC_DEBUG === "1") {
    console.log(`[client-portal] documents lead=${leadId}`, {
      n: docRes.rows.length,
      rows: docRes.rows.map((d) => ({
        id: d.id,
        document_type: d.document_type,
        file_name: d.file_name,
        created_at: d.created_at,
      })),
    });
  }

  const portalRows = selectPortalDocumentsForResponse(docRes.rows);
  const documents = portalRows.map((d) => {
    const docType = d.document_type || "unknown";
    const label = resolvePortalDocumentLabelFromRow(d);
    const displayName = (d.name && String(d.name).trim()) || (d.file_name && String(d.file_name).trim()) || "Document";
    const rel = `/api/client-portal/documents/${d.id}/file?token=${enc}`;
    return {
      id: String(d.id),
      name: displayName,
      file_name: d.file_name ?? null,
      file_url: rel,
      created_at: toIso(d.created_at),
      entity_type: d.entity_type ?? null,
      document_type: docType,
      document_label: label,
      document_type_label: label,
      type: docType,
      download_url: rel,
    };
  });

  let organization_logo_url = null;
  try {
    const logoAbs = await resolveOrgLogoAbsolutePath(organizationId);
    if (logoAbs && fs.existsSync(logoAbs)) {
      organization_logo_url = `/api/client-portal/organization/logo?token=${enc}`;
    }
  } catch (_) {
    /* pas de fichier logo */
  }

  return {
    meta: {
      lead_status: lead.status,
      show_pipeline: showPipeline,
      currency,
      organization_name: organizationName,
      organization_logo_url: organization_logo_url,
      /** Couleur de marque entreprise (organizations.pdf_primary_color) — injectée comme CSS variable sur le portail. */
      organization_brand_color: orgBrandColor,
    },
    client: {
      full_name: lead.full_name ?? null,
      email: lead.email ?? null,
      phone,
      property_type: lead.property_type ?? null,
      consumption_annual_kwh: consumption,
      site,
    },
    summary: {
      project_status_label: projectStatusLabel,
      consumption_is_estimated: consumption_is_estimated,
      offer: portalOffer,
      technical_notice: "Les données techniques seront disponibles dans votre étude.",
    },
    project,
    pipeline,
    documents,
    advisor,
  };
}

/**
 * Révoque les jetons actifs puis insère un nouveau (une ligne active par lead).
 * @returns {{ token: string, expires_at: Date|null }}
 */
export async function mintClientPortalToken(db, { leadId, organizationId, expiresAt = null }) {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = hashPortalTokenSecret(raw);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE client_portal_tokens SET revoked_at = now() WHERE lead_id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
      [leadId, organizationId]
    );
    await client.query(
      `INSERT INTO client_portal_tokens (organization_id, lead_id, token_hash, expires_at, token_secret)
       VALUES ($1, $2, $3, $4, $5)`,
      [organizationId, leadId, tokenHash, expiresAt, raw]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  return { token: raw, expires_at: expiresAt };
}

/**
 * Vérifie qu'un document est téléchargeable pour ce lead (portail).
 * Source unique : entity_type='lead', entity_id=leadId — miroir exact du CRM onglet Documents.
 */
export async function assertDocumentInPortalScope(db, { organizationId, leadId, documentId }) {
  const r = await db.query(
    `SELECT ed.id, ed.storage_key, ed.file_name, ed.mime_type, ed.entity_type, ed.document_type, ed.entity_id
     FROM entity_documents ed
     INNER JOIN leads l ON l.id = $3 AND l.organization_id = $2
     WHERE ed.id = $1
       AND ed.organization_id = $2
       AND ed.archived_at IS NULL
       AND ed.is_client_visible IS TRUE
       AND ed.document_type IN ('quote_pdf', 'quote_pdf_signed', 'study_pdf', 'study_proposal', 'invoice_pdf')
       AND (
         (ed.entity_type = 'lead' AND ed.entity_id = l.id)
         OR (ed.entity_type = 'client' AND l.client_id IS NOT NULL AND ed.entity_id = l.client_id)
         OR (
           ed.entity_type = 'quote'
           AND ed.document_type IN ('quote_pdf', 'quote_pdf_signed')
           AND EXISTS (
             SELECT 1 FROM quotes q
             WHERE q.id = ed.entity_id
               AND q.organization_id = ed.organization_id
               AND (q.archived_at IS NULL)
               AND (
                 q.lead_id = l.id
                 OR (l.client_id IS NOT NULL AND q.client_id = l.client_id)
               )
           )
         )
         OR (
           ed.entity_type = 'invoice'
           AND ed.document_type = 'invoice_pdf'
           AND EXISTS (
             SELECT 1 FROM invoices i
             WHERE i.id = ed.entity_id
               AND i.organization_id = ed.organization_id
               AND (i.archived_at IS NULL)
               AND (
                 i.lead_id = l.id
                 OR (l.client_id IS NOT NULL AND i.client_id = l.client_id)
               )
           )
         )
         OR (
           ed.entity_type = 'study'
           AND ed.document_type IN ('study_pdf', 'study_proposal')
           AND EXISTS (
             SELECT 1 FROM studies s
             WHERE s.id = ed.entity_id
               AND s.organization_id = ed.organization_id
               AND (
                 s.lead_id = l.id
                 OR (l.client_id IS NOT NULL AND s.client_id = l.client_id)
               )
           )
         )
         OR (
           ed.entity_type = 'study_version'
           AND ed.document_type IN ('study_pdf', 'study_proposal')
           AND EXISTS (
             SELECT 1 FROM study_versions sv
             INNER JOIN studies s ON s.id = sv.study_id AND s.organization_id = sv.organization_id
             WHERE sv.id = ed.entity_id
               AND sv.organization_id = ed.organization_id
               AND (
                 s.lead_id = l.id
                 OR (l.client_id IS NOT NULL AND s.client_id = l.client_id)
               )
           )
         )
       )`,
    [documentId, organizationId, leadId]
  );
  if (r.rows.length === 0) return null;
  return r.rows[0];
}
