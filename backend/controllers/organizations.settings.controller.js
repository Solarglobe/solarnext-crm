/**
 * CP-001 — Paramètres SmartPitch (organizations.settings_json.economics)
 * CP-080 — Paramètres devis + TVA (quote, finance)
 * GET  /api/organizations/settings — economics + quote + finance (fallbacks sans écraser DB)
 * PUT  /api/organizations/settings — merge par section
 */

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import { parseDocumentPrefixForStorage } from "../utils/documentPrefix.js";
import {
  ORG_ECONOMICS_ENGINE_DEFAULTS,
  validateOrgEconomicsPatchStrict,
} from "../config/orgEconomics.common.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

/** Structure JSON cible obligatoire (fallback) — alignée sur `orgEconomics.common` (incl. battery_degradation_pct). */
const ECONOMICS_FALLBACK = {
  economics: { ...ORG_ECONOMICS_ENGINE_DEFAULTS },
};

const QUOTE_DEFAULT = {
  prefix: "ORG",
  next_number: 1,
};

const FINANCE_DEFAULT = {
  default_vat_rate: 20,
};

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] != null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

function validateEconomicsPatch(economicsPatch) {
  if (economicsPatch === undefined) return { skip: true };
  const r = validateOrgEconomicsPatchStrict(economicsPatch);
  if (!r.valid) return { valid: false, error: r.error };
  return { valid: true, economics: r.economics };
}

function validateQuotePatch(quotePatch) {
  if (quotePatch === undefined) return { skip: true };
  if (quotePatch == null || typeof quotePatch !== "object") {
    return { valid: false, error: "quote doit être un objet" };
  }
  if (Object.keys(quotePatch).length === 0) return { skip: true };
  const out = {};
  if (Object.prototype.hasOwnProperty.call(quotePatch, "prefix")) {
    try {
      out.prefix = parseDocumentPrefixForStorage(quotePatch.prefix);
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "prefix invalide" };
    }
  }
  if (Object.prototype.hasOwnProperty.call(quotePatch, "next_number")) {
    const n = Number(quotePatch.next_number);
    if (!Number.isInteger(n) || n < 1) {
      return { valid: false, error: "quote.next_number doit être un entier >= 1" };
    }
    out.next_number = n;
  }
  return { valid: true, quote: out };
}

function validateFinancePatch(financePatch) {
  if (financePatch === undefined) return { skip: true };
  if (financePatch == null || typeof financePatch !== "object") {
    return { valid: false, error: "finance doit être un objet" };
  }
  if (Object.keys(financePatch).length === 0) return { skip: true };
  const out = {};
  if (Object.prototype.hasOwnProperty.call(financePatch, "default_vat_rate")) {
    const v = Number(financePatch.default_vat_rate);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { valid: false, error: "finance.default_vat_rate doit être entre 0 et 100" };
    }
    out.default_vat_rate = v;
  }
  if (Object.keys(out).length === 0) {
    return { valid: false, error: "finance : aucun champ reconnu" };
  }
  return { valid: true, finance: out };
}

function mergeQuoteForGet(raw) {
  const existing = typeof raw.quote === "object" && raw.quote ? raw.quote : {};
  const docPref = raw.documents?.document_prefix;
  const prefixDisplay =
    existing.prefix != null && String(existing.prefix).trim() !== ""
      ? String(existing.prefix)
      : docPref != null && String(docPref).trim() !== ""
        ? String(docPref)
        : QUOTE_DEFAULT.prefix;
  const nn =
    existing.next_number != null && Number.isFinite(Number(existing.next_number))
      ? Math.max(1, Math.floor(Number(existing.next_number)))
      : QUOTE_DEFAULT.next_number;
  return {
    ...QUOTE_DEFAULT,
    ...existing,
    prefix: prefixDisplay,
    next_number: nn,
  };
}

function mergeFinanceForGet(raw) {
  const existing = typeof raw.finance === "object" && raw.finance ? raw.finance : {};
  return {
    ...FINANCE_DEFAULT,
    ...existing,
    default_vat_rate:
      existing.default_vat_rate != null && Number.isFinite(Number(existing.default_vat_rate))
        ? Number(existing.default_vat_rate)
        : FINANCE_DEFAULT.default_vat_rate,
  };
}

/**
 * GET /api/organizations/settings
 */
export async function get(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query("SELECT settings_json FROM organizations WHERE id = $1", [org]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }
    const raw = result.rows[0].settings_json ?? {};
    const existingEconomics = raw.economics ?? {};
    const mergedEco = deepMerge(ECONOMICS_FALLBACK.economics, existingEconomics);
    res.json({
      economics: mergedEco,
      quote: mergeQuoteForGet(raw),
      finance: mergeFinanceForGet(raw),
      settings_json: raw,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function syncQuoteSequenceToNextNumber(client, organizationId, nextNumber, year) {
  const y = year ?? new Date().getFullYear();
  const targetLast = Math.max(0, nextNumber - 1);
  await client.query(
    `
    INSERT INTO document_sequences (organization_id, document_kind, year, last_value, updated_at)
    VALUES ($1, 'QUOTE', $2, $3, now())
    ON CONFLICT (organization_id, document_kind, year)
    DO UPDATE SET
      last_value = GREATEST(document_sequences.last_value, $3),
      updated_at = now()
    `,
    [organizationId, y, targetLast]
  );
}

/**
 * PUT /api/organizations/settings
 * Body: { economics?, quote?, finance? } — au moins une section
 */
export async function put(req, res) {
  try {
    const org = orgId(req);
    const body = req.body ?? {};

    const hasEco = Object.prototype.hasOwnProperty.call(body, "economics");
    const hasQuote = Object.prototype.hasOwnProperty.call(body, "quote");
    const hasFinance = Object.prototype.hasOwnProperty.call(body, "finance");

    if (!hasEco && !hasQuote && !hasFinance) {
      return res.status(400).json({ error: "Au moins une section requise : economics, quote ou finance" });
    }

    const vEco = validateEconomicsPatch(hasEco ? body.economics : undefined);
    if (!vEco.skip && !vEco.valid) {
      return res.status(400).json({ error: vEco.error });
    }
    const vQuote = validateQuotePatch(hasQuote ? body.quote : undefined);
    if (!vQuote.skip && !vQuote.valid) {
      return res.status(400).json({ error: vQuote.error });
    }
    const vFin = validateFinancePatch(hasFinance ? body.finance : undefined);
    if (!vFin.skip && !vFin.valid) {
      return res.status(400).json({ error: vFin.error });
    }

    const willApplyEco = !vEco.skip && vEco.valid;
    const willApplyQuote = !vQuote.skip && vQuote.valid;
    const willApplyFin = !vFin.skip && vFin.valid;
    if (!willApplyEco && !willApplyQuote && !willApplyFin) {
      return res.status(400).json({ error: "Aucune modification valide" });
    }

    await withTx(pool, async (client) => {
      const current = await client.query("SELECT settings_json FROM organizations WHERE id = $1 FOR UPDATE", [org]);
      if (current.rows.length === 0) {
        const err = new Error("Organisation non trouvée");
        err.statusCode = 404;
        throw err;
      }
      const existing = current.rows[0].settings_json ?? {};

      let newSettings = { ...existing };

      if (willApplyEco) {
        const existingEconomics = existing.economics ?? {};
        const mergedEconomics = deepMerge(ECONOMICS_FALLBACK.economics, existingEconomics);
        newSettings = {
          ...newSettings,
          economics: deepMerge(mergedEconomics, vEco.economics),
        };
      }

      if (willApplyQuote) {
        const prevQ = typeof existing.quote === "object" && existing.quote ? { ...existing.quote } : {};
        if (vQuote.quote.prefix !== undefined) {
          prevQ.prefix = vQuote.quote.prefix;
        }
        if (vQuote.quote.next_number !== undefined) {
          prevQ.next_number = vQuote.quote.next_number;
        }
        newSettings = { ...newSettings, quote: prevQ };

        if (vQuote.quote.next_number !== undefined) {
          await syncQuoteSequenceToNextNumber(client, org, vQuote.quote.next_number, new Date().getFullYear());
        }
      }

      if (willApplyFin) {
        const prevF = typeof existing.finance === "object" && existing.finance ? existing.finance : {};
        newSettings = {
          ...newSettings,
          finance: { ...FINANCE_DEFAULT, ...prevF, ...vFin.finance },
        };
      }

      await client.query("UPDATE organizations SET settings_json = $1::jsonb WHERE id = $2", [
        JSON.stringify(newSettings),
        org,
      ]);
    });

    const result = await pool.query("SELECT settings_json FROM organizations WHERE id = $1", [org]);
    const raw = result.rows[0].settings_json ?? {};
    const existingEconomics = raw.economics ?? {};
    const mergedEco = deepMerge(ECONOMICS_FALLBACK.economics, existingEconomics);

    void logAuditEvent({
      action: AuditActions.ORG_SETTINGS_UPDATED,
      entityType: "organization_settings",
      entityId: org,
      organizationId: org,
      userId: userId(req),
      req,
      statusCode: 200,
      metadata: {
        sections: {
          economics: hasEco,
          quote: hasQuote,
          finance: hasFinance,
        },
      },
    });

    res.json({
      economics: mergedEco,
      quote: mergeQuoteForGet(raw),
      finance: mergeFinanceForGet(raw),
      settings_json: raw,
    });
  } catch (e) {
    if (e && e.statusCode === 404) {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * CP-078 — GET /api/organizations : toutes les orgs si SUPER_ADMIN, sinon uniquement celle du JWT.
 * SUPER_ADMIN : inclut created_at, leads_count, clients_count (actifs).
 */
export async function listOrganizations(req, res) {
  try {
    const role = req.user?.role;
    if (role === "SUPER_ADMIN") {
      const r = await pool.query(`
        SELECT o.id,
               o.name,
               o.created_at,
               (SELECT COUNT(*)::int FROM leads l
                 WHERE l.organization_id = o.id
                   AND l.status <> 'CLIENT'
                   AND l.archived_at IS NULL) AS leads_count,
               (SELECT COUNT(*)::int FROM leads l
                 WHERE l.organization_id = o.id
                   AND l.status = 'CLIENT'
                   AND l.archived_at IS NULL) AS clients_count
        FROM organizations o
        ORDER BY o.name ASC
      `);
      return res.json(
        r.rows.map((row) => ({
          id: row.id,
          name: row.name,
          created_at: row.created_at,
          leads_count: row.leads_count ?? 0,
          clients_count: row.clients_count ?? 0,
        }))
      );
    }
    const oid = req.user?.organizationId ?? req.user?.organization_id;
    if (!oid) {
      return res.status(403).json({ error: "Organisation manquante" });
    }
    const r = await pool.query("SELECT id, name FROM organizations WHERE id = $1", [oid]);
    return res.json(r.rows.map((row) => ({ id: row.id, name: row.name })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/organizations/super-admin/org-switch-audit
 * SUPER_ADMIN uniquement — journalise l’entrée / sortie d’un compte client (pas de mutation métier).
 * Body: { organization_id: string | null } — null = retour au compte JWT (principal).
 */
export async function postSuperAdminOrgSwitchAudit(req, res) {
  try {
    if (req.user?.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const rawTarget = body.organization_id;
    const jwtOrg =
      req.user.jwtOrganizationId ??
      req.user.jwt_organization_id ??
      req.user.organizationId ??
      req.user.organization_id;
    const uid = req.user?.userId ?? req.user?.id ?? null;

    if (rawTarget === null || rawTarget === undefined || rawTarget === "") {
      void logAuditEvent({
        action: AuditActions.SUPER_ADMIN_ORG_SWITCH,
        entityType: "organization",
        entityId: jwtOrg,
        organizationId: jwtOrg,
        userId: uid,
        req,
        statusCode: 200,
        metadata: {
          direction: "exit_support",
          home_organization_id: jwtOrg,
        },
      });
      return res.json({ success: true, mode: "exit" });
    }

    const targetId = String(rawTarget).trim();
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(targetId)) {
      return res.status(400).json({ error: "organization_id invalide" });
    }

    const r = await pool.query("SELECT id, name FROM organizations WHERE id = $1", [targetId]);
    if (r.rows.length === 0) {
      return res.status(400).json({ error: "Organisation inconnue" });
    }
    const row = r.rows[0];
    void logAuditEvent({
      action: AuditActions.SUPER_ADMIN_ORG_SWITCH,
      entityType: "organization",
      entityId: row.id,
      organizationId: row.id,
      userId: uid,
      req,
      statusCode: 200,
      metadata: {
        direction: "enter_support",
        target_organization_id: row.id,
        target_organization_name: row.name,
        jwt_home_organization_id: jwtOrg,
      },
    });
    return res.json({
      success: true,
      mode: "enter",
      organization: { id: row.id, name: row.name },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
