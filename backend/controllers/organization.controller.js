/**
 * CP-026 - Organization Settings controller
 * Legacy endpoint for organization settings. Critical settings must use
 * /api/organizations/settings, which has section-level validation.
 */

import { pool } from "../config/db.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

const LEGACY_ALLOWED_SETTINGS_SECTIONS = new Set(["quote_pdf"]);
const LEGACY_CRITICAL_SETTINGS_SECTIONS = new Set([
  "economics",
  "quote",
  "finance",
  "documents",
  "onboarding",
  "security",
  "pv",
  "pricing",
  "components",
  "pvtech",
  "ai",
  "calpinage_rules",
  "pdf_cover_image_key",
  "logo_image_key",
]);

function splitLegacySettingsPatch(settings) {
  const keys = Object.keys(settings);
  const critical = keys.filter((key) => LEGACY_CRITICAL_SETTINGS_SECTIONS.has(key));
  const unsupported = keys.filter(
    (key) => !LEGACY_ALLOWED_SETTINGS_SECTIONS.has(key) && !LEGACY_CRITICAL_SETTINGS_SECTIONS.has(key)
  );
  const allowed = {};
  for (const key of keys) {
    if (LEGACY_ALLOWED_SETTINGS_SECTIONS.has(key)) allowed[key] = settings[key];
  }
  return { allowed, critical, unsupported };
}

export async function getSettings(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      "SELECT id, name, settings_json FROM organizations WHERE id = $1",
      [org]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Organisation non trouvee" });
    res.set("Deprecation", "true");
    res.set("Link", '</api/organizations/settings>; rel="successor-version"');
    res.json(result.rows[0].settings_json ?? {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function updateSettings(req, res) {
  try {
    const org = orgId(req);
    const settings = req.body;
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      return res.status(422).json({ error: "settings doit etre un objet JSON" });
    }

    const { allowed, critical, unsupported } = splitLegacySettingsPatch(settings);
    if (critical.length > 0) {
      return res.status(422).json({
        error: "Endpoint legacy restreint : utilisez /api/organizations/settings pour les parametres critiques.",
        code: "LEGACY_SETTINGS_CRITICAL_SECTION",
        sections: critical,
      });
    }
    if (unsupported.length > 0) {
      return res.status(422).json({
        error: "Section settings non modifiable via cet endpoint legacy.",
        code: "LEGACY_SETTINGS_UNSUPPORTED_SECTION",
        sections: unsupported,
      });
    }
    if (Object.keys(allowed).length === 0) {
      return res.status(422).json({
        error: "Aucune section compatible avec l'endpoint legacy.",
        code: "LEGACY_SETTINGS_EMPTY_PATCH",
      });
    }

    const result = await pool.query(
      `UPDATE organizations
       SET settings_json = COALESCE(settings_json, '{}'::jsonb) || $1::jsonb
       WHERE id = $2
       RETURNING settings_json`,
      [JSON.stringify(allowed), org]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Organisation non trouvee" });

    void logAuditEvent({
      action: AuditActions.ORG_SETTINGS_UPDATED,
      entityType: "organization_settings_legacy",
      entityId: org,
      organizationId: org,
      userId: userId(req),
      req,
      statusCode: 200,
      metadata: {
        endpoint: "/api/organization/settings",
        sections: Object.keys(allowed),
        deprecated: true,
      },
    });

    res.set("Deprecation", "true");
    res.set("Link", '</api/organizations/settings>; rel="successor-version"');
    res.json(result.rows[0].settings_json ?? {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
