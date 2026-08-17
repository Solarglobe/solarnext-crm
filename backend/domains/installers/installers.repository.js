import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";
import { computeInstallationCostFromCatalog } from "./installers.pricing.js";
import { installerError } from "./installers.errors.js";

function compactObject(payload = {}, allowedKeys = []) {
  const out = {};
  for (const key of allowedKeys) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
}

function asJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function userIdFromContext(context) {
  return context?.userId ?? context?.user_id ?? context?.id ?? null;
}

async function assertInstallerInOrg(client, organizationId, installerId) {
  const { rows } = await client.query(
    `SELECT * FROM installers WHERE id = $1 AND organization_id = $2`,
    [installerId, organizationId]
  );
  if (!rows[0]) throw installerError("INSTALLER_NOT_FOUND", "Installateur introuvable", 404);
  return rows[0];
}

async function assertTariffVersionInOrg(client, organizationId, installerId, tariffVersionId) {
  const { rows } = await client.query(
    `SELECT * FROM installer_tariff_versions
      WHERE id = $1 AND installer_id = $2 AND organization_id = $3`,
    [tariffVersionId, installerId, organizationId]
  );
  if (!rows[0]) throw installerError("TARIFF_VERSION_NOT_FOUND", "Version tarifaire introuvable", 404);
  return rows[0];
}

export async function listInstallers({ organizationId, active, q, zoneType, zoneCode }) {
  const params = [organizationId];
  const where = ["i.organization_id = $1"];
  if (active !== undefined) {
    params.push(active === true || active === "true");
    where.push(`i.is_active = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where.push(`(lower(i.name) LIKE $${params.length} OR lower(coalesce(i.legal_name, '')) LIKE $${params.length})`);
  }
  if (zoneCode) {
    params.push(String(zoneType || "DEPARTMENT").toUpperCase());
    params.push(String(zoneCode).trim());
    where.push(`EXISTS (
      SELECT 1 FROM installer_service_zones z
      WHERE z.installer_id = i.id
        AND z.organization_id = i.organization_id
        AND z.zone_type = $${params.length - 1}
        AND z.zone_code = $${params.length}
    )`);
  }

  const { rows } = await pool.query(
    `SELECT i.*,
            COALESCE(
              jsonb_agg(
                jsonb_build_object('zone_type', z.zone_type, 'zone_code', z.zone_code, 'label', z.label)
                ORDER BY z.zone_type, z.zone_code
              ) FILTER (WHERE z.id IS NOT NULL),
              '[]'::jsonb
            ) AS zones,
            tv.id AS active_tariff_version_id,
            tv.version_label AS active_tariff_version_label,
            tv.effective_from AS active_tariff_effective_from
       FROM installers i
       LEFT JOIN installer_service_zones z
         ON z.installer_id = i.id
        AND z.organization_id = i.organization_id
       LEFT JOIN installer_tariff_versions tv
         ON tv.installer_id = i.id
        AND tv.organization_id = i.organization_id
        AND tv.status = 'ACTIVE'
      WHERE ${where.join(" AND ")}
      GROUP BY i.id, tv.id, tv.version_label, tv.effective_from
      ORDER BY i.is_active DESC, lower(i.name) ASC`,
    params
  );
  return rows;
}

export async function createInstaller({ organizationId, payload, context }) {
  const body = compactObject(payload, [
    "name",
    "legal_name",
    "siret",
    "contact_name",
    "contact_email",
    "contact_phone",
    "address_json",
    "qualifications_json",
    "is_active",
    "notes",
  ]);
  if (!String(body.name || "").trim()) throw installerError("INVALID_INSTALLER_NAME", "Nom installateur requis", 400);

  const { rows } = await pool.query(
    `INSERT INTO installers (
       organization_id, name, legal_name, siret, contact_name, contact_email, contact_phone,
       address_json, qualifications_json, is_active, notes, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)
     RETURNING *`,
    [
      organizationId,
      body.name.trim(),
      body.legal_name ?? null,
      body.siret ?? null,
      body.contact_name ?? null,
      body.contact_email ?? null,
      body.contact_phone ?? null,
      JSON.stringify(body.address_json ?? {}),
      JSON.stringify(body.qualifications_json ?? {}),
      body.is_active ?? true,
      body.notes ?? null,
      userIdFromContext(context),
    ]
  );
  return rows[0];
}

export async function patchInstaller({ organizationId, installerId, payload }) {
  const allowed = [
    "name",
    "legal_name",
    "siret",
    "contact_name",
    "contact_email",
    "contact_phone",
    "address_json",
    "qualifications_json",
    "is_active",
    "notes",
  ];
  const body = compactObject(payload, allowed);
  const assignments = [];
  const params = [];
  for (const [key, value] of Object.entries(body)) {
    params.push(key.endsWith("_json") ? JSON.stringify(value ?? {}) : value);
    assignments.push(`${key} = $${params.length}${key.endsWith("_json") ? "::jsonb" : ""}`);
  }
  if (assignments.length === 0) return getInstallerComplete({ organizationId, installerId });
  params.push(installerId, organizationId);
  const { rows } = await pool.query(
    `UPDATE installers SET ${assignments.join(", ")}, updated_at = now()
      WHERE id = $${params.length - 1} AND organization_id = $${params.length}
      RETURNING *`,
    params
  );
  if (!rows[0]) throw installerError("INSTALLER_NOT_FOUND", "Installateur introuvable", 404);
  return rows[0];
}

export async function replaceInstallerZones({ organizationId, installerId, zones }) {
  return withTx(pool, async (client) => {
    await assertInstallerInOrg(client, organizationId, installerId);
    await client.query(
      `DELETE FROM installer_service_zones WHERE installer_id = $1 AND organization_id = $2`,
      [installerId, organizationId]
    );
    const out = [];
    for (const zone of Array.isArray(zones) ? zones : []) {
      const zoneType = String(zone.zone_type || zone.type || "").trim().toUpperCase();
      const zoneCode = String(zone.zone_code || zone.code || "").trim();
      if (!zoneType || !zoneCode) continue;
      const { rows } = await client.query(
        `INSERT INTO installer_service_zones (organization_id, installer_id, zone_type, zone_code, label)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [organizationId, installerId, zoneType, zoneCode, zone.label ?? null]
      );
      out.push(rows[0]);
    }
    return out;
  });
}

export async function listTariffVersions({ organizationId, installerId }) {
  const { rows } = await pool.query(
    `SELECT * FROM installer_tariff_versions
      WHERE organization_id = $1 AND installer_id = $2
      ORDER BY status = 'ACTIVE' DESC, effective_from DESC NULLS LAST, created_at DESC`,
    [organizationId, installerId]
  );
  return rows;
}

export async function createTariffVersion({ organizationId, installerId, payload, context }) {
  return withTx(pool, async (client) => {
    await assertInstallerInOrg(client, organizationId, installerId);
    const label = String(payload?.version_label || payload?.label || "").trim();
    if (!label) throw installerError("INVALID_TARIFF_VERSION", "Libellé de version requis", 400);
    const { rows } = await client.query(
      `INSERT INTO installer_tariff_versions (
         organization_id, installer_id, version_label, status, effective_from, effective_to, notes, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        organizationId,
        installerId,
        label,
        payload?.status || "DRAFT",
        payload?.effective_from || null,
        payload?.effective_to || null,
        payload?.notes || null,
        userIdFromContext(context),
      ]
    );
    return rows[0];
  });
}

export async function activateTariffVersion({ organizationId, installerId, tariffVersionId }) {
  return withTx(pool, async (client) => {
    await assertTariffVersionInOrg(client, organizationId, installerId, tariffVersionId);
    await client.query(
      `UPDATE installer_tariff_versions
          SET status = 'ARCHIVED', updated_at = now()
        WHERE organization_id = $1 AND installer_id = $2 AND status = 'ACTIVE' AND id <> $3`,
      [organizationId, installerId, tariffVersionId]
    );
    const { rows } = await client.query(
      `UPDATE installer_tariff_versions
          SET status = 'ACTIVE', updated_at = now()
        WHERE organization_id = $1 AND installer_id = $2 AND id = $3
        RETURNING *`,
      [organizationId, installerId, tariffVersionId]
    );
    return rows[0];
  });
}

async function loadTariffVersionCatalog(client, organizationId, installerId, tariffVersionId) {
  const installer = await assertInstallerInOrg(client, organizationId, installerId);
  const tariffVersion = tariffVersionId
    ? await assertTariffVersionInOrg(client, organizationId, installerId, tariffVersionId)
    : (
        await client.query(
          `SELECT * FROM installer_tariff_versions
            WHERE organization_id = $1 AND installer_id = $2 AND status = 'ACTIVE'
            ORDER BY effective_from DESC NULLS LAST, created_at DESC
            LIMIT 1`,
          [organizationId, installerId]
        )
      ).rows[0];
  if (!tariffVersion) throw installerError("ACTIVE_TARIFF_VERSION_NOT_FOUND", "Aucune version tarifaire active", 404);

  const [zones, grids, mappings, rows, electricalRules, options, ancillaryServices] = await Promise.all([
    client.query(
      `SELECT * FROM installer_service_zones WHERE organization_id = $1 AND installer_id = $2 ORDER BY zone_type, zone_code`,
      [organizationId, installerId]
    ),
    client.query(
      `SELECT * FROM installer_pricing_grids WHERE organization_id = $1 AND tariff_version_id = $2 ORDER BY code`,
      [organizationId, tariffVersion.id]
    ),
    client.query(
      `SELECT * FROM installer_installation_type_mappings WHERE organization_id = $1 AND tariff_version_id = $2 ORDER BY installation_type`,
      [organizationId, tariffVersion.id]
    ),
    client.query(
      `SELECT r.* FROM installer_tariff_rows r
       JOIN installer_pricing_grids g ON g.id = r.pricing_grid_id AND g.organization_id = r.organization_id
       WHERE r.organization_id = $1 AND g.tariff_version_id = $2
       ORDER BY r.pricing_grid_id, r.power_wc`,
      [organizationId, tariffVersion.id]
    ),
    client.query(
      `SELECT * FROM installer_electrical_rules WHERE organization_id = $1 AND tariff_version_id = $2 ORDER BY electrical_type`,
      [organizationId, tariffVersion.id]
    ),
    client.query(
      `SELECT * FROM installer_options WHERE organization_id = $1 AND tariff_version_id = $2 ORDER BY sort_order, code`,
      [organizationId, tariffVersion.id]
    ),
    client.query(
      `SELECT * FROM installer_ancillary_services WHERE organization_id = $1 AND tariff_version_id = $2 ORDER BY sort_order, code`,
      [organizationId, tariffVersion.id]
    ),
  ]);

  return {
    installer,
    zones: zones.rows,
    tariff_version: tariffVersion,
    grids: grids.rows,
    installation_type_mappings: mappings.rows,
    tariff_rows: rows.rows,
    electrical_rules: electricalRules.rows,
    options: options.rows,
    ancillary_services: ancillaryServices.rows,
  };
}

export async function getTariffVersionComplete({ organizationId, installerId, tariffVersionId }) {
  return withTx(pool, (client) => loadTariffVersionCatalog(client, organizationId, installerId, tariffVersionId));
}

export async function getInstallerComplete({ organizationId, installerId }) {
  return withTx(pool, async (client) => {
    const installer = await assertInstallerInOrg(client, organizationId, installerId);
    const [zones, tariffVersions] = await Promise.all([
      client.query(
        `SELECT * FROM installer_service_zones WHERE organization_id = $1 AND installer_id = $2 ORDER BY zone_type, zone_code`,
        [organizationId, installerId]
      ),
      client.query(
        `SELECT * FROM installer_tariff_versions
          WHERE organization_id = $1 AND installer_id = $2
          ORDER BY status = 'ACTIVE' DESC, effective_from DESC NULLS LAST, created_at DESC`,
        [organizationId, installerId]
      ),
    ]);
    const activeVersion = tariffVersions.rows.find((row) => row.status === "ACTIVE");
    const activeCatalog = activeVersion
      ? await loadTariffVersionCatalog(client, organizationId, installerId, activeVersion.id)
      : null;
    return {
      ...installer,
      zones: zones.rows,
      tariff_versions: tariffVersions.rows,
      active_tariff: activeCatalog,
    };
  });
}

export async function replaceTariffCatalog({ organizationId, installerId, tariffVersionId, payload }) {
  return withTx(pool, async (client) => {
    await assertTariffVersionInOrg(client, organizationId, installerId, tariffVersionId);

    if (Array.isArray(payload?.grids)) {
      for (const grid of payload.grids) {
        await client.query(
          `INSERT INTO installer_pricing_grids (organization_id, tariff_version_id, code, label)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
             label = EXCLUDED.label,
             updated_at = now()`,
          [organizationId, tariffVersionId, String(grid.code).trim().toUpperCase(), grid.label || grid.code]
        );
      }
    }

    const gridRows = (
      await client.query(
        `SELECT * FROM installer_pricing_grids WHERE organization_id = $1 AND tariff_version_id = $2`,
        [organizationId, tariffVersionId]
      )
    ).rows;
    const gridByCode = new Map(gridRows.map((row) => [row.code, row]));

    if (Array.isArray(payload?.installation_type_mappings)) {
      for (const mapping of payload.installation_type_mappings) {
        const grid = gridByCode.get(String(mapping.grid_code || mapping.pricing_grid_code || "").trim().toUpperCase());
        if (!grid) throw installerError("PRICING_GRID_NOT_FOUND", "Grille de mapping introuvable", 400, { mapping });
        await client.query(
          `INSERT INTO installer_installation_type_mappings (organization_id, tariff_version_id, installation_type, pricing_grid_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (organization_id, tariff_version_id, installation_type) DO UPDATE SET
             pricing_grid_id = EXCLUDED.pricing_grid_id`,
          [organizationId, tariffVersionId, String(mapping.installation_type).trim().toUpperCase(), grid.id]
        );
      }
    }

    if (Array.isArray(payload?.tariff_rows)) {
      for (const row of payload.tariff_rows) {
        const grid = gridByCode.get(String(row.grid_code || row.pricing_grid_code || "").trim().toUpperCase());
        if (!grid) throw installerError("PRICING_GRID_NOT_FOUND", "Grille tarifaire introuvable", 400, { row });
        await client.query(
          `INSERT INTO installer_tariff_rows (organization_id, pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (organization_id, pricing_grid_id, power_wc) DO UPDATE SET
             panel_count_hint = EXCLUDED.panel_count_hint,
             amount_ht_cents = EXCLUDED.amount_ht_cents,
             sort_order = EXCLUDED.sort_order,
             updated_at = now()`,
          [
            organizationId,
            grid.id,
            Number(row.power_wc),
            row.panel_count_hint == null ? null : Number(row.panel_count_hint),
            Number(row.amount_ht_cents),
            Number(row.sort_order || 0),
          ]
        );
      }
    }

    if (Array.isArray(payload?.electrical_rules)) {
      for (const rule of payload.electrical_rules) {
        const gridCode = rule.grid_code || rule.pricing_grid_code;
        const grid = gridCode ? gridByCode.get(String(gridCode).trim().toUpperCase()) : null;
        await client.query(
          `INSERT INTO installer_electrical_rules (
             organization_id, tariff_version_id, electrical_type, rule_type, amount_ht_cents, pricing_grid_id, config_json
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
           ON CONFLICT (organization_id, tariff_version_id, electrical_type) DO UPDATE SET
             rule_type = EXCLUDED.rule_type,
             amount_ht_cents = EXCLUDED.amount_ht_cents,
             pricing_grid_id = EXCLUDED.pricing_grid_id,
             config_json = EXCLUDED.config_json,
             updated_at = now()`,
          [
            organizationId,
            tariffVersionId,
            String(rule.electrical_type).trim().toUpperCase(),
            String(rule.rule_type || "NONE").trim().toUpperCase(),
            Number(rule.amount_ht_cents || 0),
            grid?.id || null,
            JSON.stringify(rule.config_json || {}),
          ]
        );
      }
    }

    if (Array.isArray(payload?.options)) {
      for (const option of payload.options) {
        await client.query(
          `INSERT INTO installer_options (
             organization_id, tariff_version_id, code, label, category, amount_ht_cents,
             is_selectable_for_installation, is_amount_overridable, incompatible_group, is_active, sort_order
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
             label = EXCLUDED.label,
             category = EXCLUDED.category,
             amount_ht_cents = EXCLUDED.amount_ht_cents,
             is_selectable_for_installation = EXCLUDED.is_selectable_for_installation,
             is_amount_overridable = EXCLUDED.is_amount_overridable,
             incompatible_group = EXCLUDED.incompatible_group,
             is_active = EXCLUDED.is_active,
             sort_order = EXCLUDED.sort_order,
             updated_at = now()`,
          [
            organizationId,
            tariffVersionId,
            String(option.code).trim().toUpperCase(),
            option.label || option.code,
            option.category || "GENERAL",
            Number(option.amount_ht_cents || 0),
            option.is_selectable_for_installation ?? true,
            option.is_amount_overridable ?? false,
            option.incompatible_group || null,
            option.is_active ?? true,
            Number(option.sort_order || 0),
          ]
        );
      }
    }

    if (Array.isArray(payload?.ancillary_services)) {
      for (const svc of payload.ancillary_services) {
        await client.query(
          `INSERT INTO installer_ancillary_services (
             organization_id, tariff_version_id, code, label, category, amount_ht_cents, is_active, sort_order
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
             label = EXCLUDED.label,
             category = EXCLUDED.category,
             amount_ht_cents = EXCLUDED.amount_ht_cents,
             is_active = EXCLUDED.is_active,
             sort_order = EXCLUDED.sort_order,
             updated_at = now()`,
          [
            organizationId,
            tariffVersionId,
            String(svc.code).trim().toUpperCase(),
            svc.label || svc.code,
            svc.category || "GENERAL",
            Number(svc.amount_ht_cents || 0),
            svc.is_active ?? true,
            Number(svc.sort_order || 0),
          ]
        );
      }
    }

    return loadTariffVersionCatalog(client, organizationId, installerId, tariffVersionId);
  });
}

export async function computeInstallationCost({ organizationId, installerId, payload, context }) {
  const result = await withTx(pool, async (client) => {
    const catalog = await loadTariffVersionCatalog(client, organizationId, installerId, payload?.tariff_version_id || null);
    return computeInstallationCostFromCatalog(catalog, payload);
  });

  if (payload?.save_to_quote_prep === true && payload?.study_id && payload?.study_version_id) {
    await saveInstallerCostToEconomicSnapshot({
      organizationId,
      studyId: payload.study_id,
      studyVersionId: payload.study_version_id,
      calculation: result,
      context,
    });
  }

  return result;
}

export async function saveInstallerCostToEconomicSnapshot({
  organizationId,
  studyId,
  studyVersionId,
  calculation,
  context,
}) {
  return withTx(pool, async (client) => {
    const study = await client.query(
      `SELECT id FROM studies WHERE id = $1 AND organization_id = $2`,
      [studyId, organizationId]
    );
    if (!study.rows[0]) throw installerError("STUDY_NOT_FOUND", "Étude introuvable", 404);
    const version = await client.query(
      `SELECT id FROM study_versions WHERE id = $1 AND study_id = $2 AND organization_id = $3`,
      [studyVersionId, studyId, organizationId]
    );
    if (!version.rows[0]) throw installerError("STUDY_VERSION_NOT_FOUND", "Version d'étude introuvable", 404);

    const latest = await client.query(
      `SELECT id, version_number, config_json, status
         FROM economic_snapshots
        WHERE organization_id = $1 AND study_version_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [organizationId, studyVersionId]
    );

    if (latest.rows[0]?.status === "DRAFT") {
      const current = asJson(latest.rows[0].config_json, {});
      const nextConfig = { ...current, installer_cost: calculation };
      await client.query(
        `UPDATE economic_snapshots
            SET config_json = $1::jsonb, updated_at = now()
          WHERE id = $2 AND organization_id = $3`,
        [JSON.stringify(nextConfig), latest.rows[0].id, organizationId]
      );
      return { snapshot_id: latest.rows[0].id, installer_cost: calculation };
    }

    const maxVersion = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) AS max_version
         FROM economic_snapshots
        WHERE organization_id = $1 AND study_id = $2`,
      [organizationId, studyId]
    );
    const nextVersionNumber = Number(maxVersion.rows[0]?.max_version || 0) + 1;
    const { rows } = await client.query(
      `INSERT INTO economic_snapshots (
         study_id, study_version_id, organization_id, version_number, status, config_json, created_by
       )
       VALUES ($1,$2,$3,$4,'DRAFT',$5::jsonb,$6)
       RETURNING id`,
      [
        studyId,
        studyVersionId,
        organizationId,
        nextVersionNumber,
        JSON.stringify({ installer_cost: calculation }),
        userIdFromContext(context),
      ]
    );
    return { snapshot_id: rows[0].id, installer_cost: calculation };
  });
}

export async function getLatestEconomicInstallerCost({ client, organizationId, studyVersionId }) {
  if (!studyVersionId) return null;
  const { rows } = await client.query(
    `SELECT config_json
       FROM economic_snapshots
      WHERE organization_id = $1 AND study_version_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [organizationId, studyVersionId]
  );
  return asJson(rows[0]?.config_json, {})?.installer_cost || null;
}

export async function persistQuoteInstallerCostSnapshot({
  client,
  organizationId,
  quoteId,
  studyId = null,
  studyVersionId = null,
  installerCost,
  context,
}) {
  if (!installerCost) return null;
  const installer = installerCost.installer || {};
  const tariffVersion = installerCost.tariff_version || {};
  const manualOverride = installerCost.manual_override || null;
  const optionOverrides = installerCost.option_overrides || [];

  const { rows } = await client.query(
    `INSERT INTO quote_installer_cost_snapshots (
       organization_id, quote_id, study_id, study_version_id,
       installer_id, tariff_version_id, installer_name_snapshot,
       requested_power_wc, matched_power_wc, installation_type, electrical_type,
       base_amount_ht_cents, electrical_adjustments_json, options_json,
       catalog_total_ht_cents, option_overrides_json,
       manual_override_ht_cents, manual_override_reason, overridden_by, overridden_at,
       final_total_ht_cents, calculation_json, created_by
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16::jsonb,$17,$18,$19,$20,$21,$22::jsonb,$23
     )
     ON CONFLICT (organization_id, quote_id) DO UPDATE SET
       study_id = EXCLUDED.study_id,
       study_version_id = EXCLUDED.study_version_id,
       installer_id = EXCLUDED.installer_id,
       tariff_version_id = EXCLUDED.tariff_version_id,
       installer_name_snapshot = EXCLUDED.installer_name_snapshot,
       requested_power_wc = EXCLUDED.requested_power_wc,
       matched_power_wc = EXCLUDED.matched_power_wc,
       installation_type = EXCLUDED.installation_type,
       electrical_type = EXCLUDED.electrical_type,
       base_amount_ht_cents = EXCLUDED.base_amount_ht_cents,
       electrical_adjustments_json = EXCLUDED.electrical_adjustments_json,
       options_json = EXCLUDED.options_json,
       catalog_total_ht_cents = EXCLUDED.catalog_total_ht_cents,
       option_overrides_json = EXCLUDED.option_overrides_json,
       manual_override_ht_cents = EXCLUDED.manual_override_ht_cents,
       manual_override_reason = EXCLUDED.manual_override_reason,
       overridden_by = EXCLUDED.overridden_by,
       overridden_at = EXCLUDED.overridden_at,
       final_total_ht_cents = EXCLUDED.final_total_ht_cents,
       calculation_json = EXCLUDED.calculation_json
     RETURNING *`,
    [
      organizationId,
      quoteId,
      studyId,
      studyVersionId,
      installer.id || null,
      tariffVersion.id || null,
      installer.name || installerCost.installer_name_snapshot || "Installateur",
      Number(installerCost.requested_power_wc),
      Number(installerCost.matched_power_wc),
      installerCost.installation_type,
      installerCost.electrical_type,
      Number(installerCost.base_amount_ht_cents),
      JSON.stringify(installerCost.electrical_adjustments || []),
      JSON.stringify(installerCost.options || []),
      Number(installerCost.catalog_total_ht_cents),
      JSON.stringify(optionOverrides),
      manualOverride?.amount_ht_cents ?? null,
      manualOverride?.reason ?? null,
      manualOverride ? userIdFromContext(context) : null,
      manualOverride ? new Date() : null,
      Number(installerCost.final_total_ht_cents),
      JSON.stringify(installerCost),
      userIdFromContext(context),
    ]
  );
  return rows[0];
}
