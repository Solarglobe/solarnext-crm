/**
 * Compteurs électriques par lead (socle multi-compteurs).
 * Phase 1 : compteur par défaut synchronisé avec les colonnes « à plat » de leads
 * pour compat API / moteur (solarnextPayloadBuilder lit encore leads).
 */

/** @typedef {import("pg").Pool | import("pg").PoolClient} Db */

export const DEFAULT_LEAD_METER_NAME = "Compteur principal";

/** Champs métier portés par le compteur par défaut (alignés GET /api/leads/:id). */
export const METER_FIELDS_FROM_LEAD = [
  "consumption_pdl",
  "meter_power_kva",
  "grid_type",
  "consumption_mode",
  "consumption_annual_kwh",
  "consumption_annual_calculated_kwh",
  "consumption_profile",
  "hp_hc",
  "supplier_name",
  "tariff_type",
  "energy_profile",
  "equipement_actuel",
  "equipement_actuel_params",
  "equipements_a_venir",
];

/**
 * @param {Db} db
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function getDefaultMeterRow(db, leadId, organizationId) {
  const r = await db.query(
    `SELECT * FROM lead_meters
     WHERE lead_id = $1 AND organization_id = $2 AND is_default = true
     LIMIT 1`,
    [leadId, organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * Après INSERT leads — compteur par défaut vide (synchronisé ensuite avec les PATCH).
 * @param {Db} db
 * @param {{ id: string, organization_id: string, hp_hc?: boolean }} leadRow
 */
export async function insertDefaultMeterForNewLead(db, leadRow) {
  await db.query(
    `INSERT INTO lead_meters (organization_id, lead_id, name, is_default, sort_order, hp_hc)
     VALUES ($1, $2, $3, true, 0, COALESCE($4, false))`,
    [
      leadRow.organization_id,
      leadRow.id,
      DEFAULT_LEAD_METER_NAME,
      leadRow.hp_hc,
    ]
  );
}

export async function ensureDefaultLeadMeter(db, leadId, organizationId) {
  const existing = await getDefaultMeterRow(db, leadId, organizationId);
  if (existing) return existing;

  const ins = await db.query(
    `INSERT INTO lead_meters (
       organization_id, lead_id, name, is_default, sort_order,
       consumption_pdl, meter_power_kva, grid_type, consumption_mode,
       consumption_annual_kwh, consumption_annual_calculated_kwh,
       consumption_profile, hp_hc, supplier_name, tariff_type,
       energy_profile, equipement_actuel, equipement_actuel_params, equipements_a_venir
     )
     SELECT
       l.organization_id,
       l.id,
       $3,
       true,
       0,
       l.consumption_pdl,
       l.meter_power_kva,
       l.grid_type,
       l.consumption_mode,
       l.consumption_annual_kwh,
       l.consumption_annual_calculated_kwh,
       l.consumption_profile,
       COALESCE(l.hp_hc, false),
       l.supplier_name,
       l.tariff_type,
       l.energy_profile,
       l.equipement_actuel,
       l.equipement_actuel_params,
       l.equipements_a_venir
     FROM leads l
     WHERE l.id = $1 AND l.organization_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM lead_meters m WHERE m.lead_id = l.id AND m.is_default = true
       )
     RETURNING *`,
    [leadId, organizationId, DEFAULT_LEAD_METER_NAME]
  );
  if (ins.rows.length > 0) return ins.rows[0];

  return getDefaultMeterRow(db, leadId, organizationId);
}

/**
 * @param {Db} db
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function listLeadMeters(db, leadId, organizationId) {
  const r = await db.query(
    `SELECT * FROM lead_meters
     WHERE lead_id = $1 AND organization_id = $2
     ORDER BY is_default DESC, sort_order ASC, created_at ASC`,
    [leadId, organizationId]
  );
  return r.rows;
}

/**
 * Copie les champs conso / profil / équipements depuis la ligne leads vers le compteur par défaut.
 * @param {Db} db
 * @param {object} leadRow ligne complète ou partielle (id, organization_id + champs métier)
 */
export async function syncDefaultMeterFromLeadRow(db, leadRow) {
  if (!leadRow?.id || !leadRow?.organization_id) return;
  await ensureDefaultLeadMeter(db, leadRow.id, leadRow.organization_id);

  await db.query(
    `UPDATE lead_meters SET
       consumption_pdl = $3,
       meter_power_kva = $4,
       grid_type = $5,
       consumption_mode = $6,
       consumption_annual_kwh = $7,
       consumption_annual_calculated_kwh = $8,
       consumption_profile = $9,
       hp_hc = COALESCE($10, false),
       supplier_name = $11,
       tariff_type = $12,
       energy_profile = $13::jsonb,
       equipement_actuel = $14,
       equipement_actuel_params = $15::jsonb,
       equipements_a_venir = $16::jsonb,
       updated_at = now()
     WHERE lead_id = $1 AND organization_id = $2 AND is_default = true`,
    [
      leadRow.id,
      leadRow.organization_id,
      leadRow.consumption_pdl ?? null,
      leadRow.meter_power_kva ?? null,
      leadRow.grid_type ?? null,
      leadRow.consumption_mode ?? null,
      leadRow.consumption_annual_kwh ?? null,
      leadRow.consumption_annual_calculated_kwh ?? null,
      leadRow.consumption_profile ?? null,
      leadRow.hp_hc,
      leadRow.supplier_name ?? null,
      leadRow.tariff_type ?? null,
      leadRow.energy_profile != null ? JSON.stringify(leadRow.energy_profile) : null,
      leadRow.equipement_actuel ?? null,
      leadRow.equipement_actuel_params != null
        ? JSON.stringify(leadRow.equipement_actuel_params)
        : null,
      leadRow.equipements_a_venir != null ? JSON.stringify(leadRow.equipements_a_venir) : null,
    ]
  );
}

/**
 * Pour GET lead : surcharger l’objet API avec la vérité du compteur par défaut.
 * @param {Record<string, unknown>} leadObj objet `lead` déjà construit pour l’API
 * @param {object | null} meterRow
 * @returns {Record<string, unknown>}
 */
export function hydrateLeadWithDefaultMeterFields(leadObj, meterRow) {
  if (!meterRow) return leadObj;
  const next = { ...leadObj };
  for (const key of METER_FIELDS_FROM_LEAD) {
    if (Object.prototype.hasOwnProperty.call(meterRow, key)) {
      next[key] = meterRow[key];
    }
  }
  return next;
}

/**
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function getDefaultMeterIdForLead(db, leadId, organizationId) {
  const m = await ensureDefaultLeadMeter(db, leadId, organizationId);
  return m?.id ?? null;
}

/**
 * Réponse légère GET /meters (liste UI).
 * @param {object} row
 */
export function meterRowToListItem(row) {
  return {
    id: row.id,
    name: row.name,
    is_default: row.is_default === true,
    meter_power_kva: row.meter_power_kva ?? null,
    grid_type: row.grid_type ?? null,
    consumption_mode: row.consumption_mode ?? null,
    consumption_annual_kwh: row.consumption_annual_kwh ?? null,
    consumption_annual_calculated_kwh: row.consumption_annual_calculated_kwh ?? null,
    consumption_pdl: row.consumption_pdl ?? null,
    sort_order: row.sort_order ?? 0,
  };
}

/**
 * @param {Db} db
 * @param {string} meterId
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function getMeterByIdForLead(db, meterId, leadId, organizationId) {
  const r = await db.query(
    `SELECT * FROM lead_meters
     WHERE id = $1 AND lead_id = $2 AND organization_id = $3`,
    [meterId, leadId, organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * Détail compteur + grille mensuelle (année courante) si mode MONTHLY.
 * @param {Db} db
 */
export async function getLeadMeterDetailWithMonthly(db, meterId, leadId, organizationId) {
  const row = await getMeterByIdForLead(db, meterId, leadId, organizationId);
  if (!row) return null;
  let consumption_monthly = [];
  if (row.consumption_mode === "MONTHLY") {
    const cmRes = await db.query(
      `SELECT month, kwh FROM lead_consumption_monthly
       WHERE meter_id = $1 AND year = extract(year from now())::int
       ORDER BY month`,
      [row.id]
    );
    consumption_monthly = cmRes.rows;
  }
  return { meter: row, consumption_monthly };
}

/**
 * @param {Db} db
 * @param {{ organizationId: string, leadId: string, meterId: string, year: number, months: { month: number, kwh: number }[] }} args
 */
export async function upsertMeterMonthlyConsumption(db, { organizationId, leadId, meterId, year, months }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (let m = 1; m <= 12; m++) {
      const monthData = months.find((mo) => Number(mo.month) === m);
      const kwh = monthData ? Number(monthData.kwh) || 0 : 0;
      await client.query(
        `INSERT INTO lead_consumption_monthly (organization_id, lead_id, meter_id, year, month, kwh, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (meter_id, year, month)
         DO UPDATE SET kwh = EXCLUDED.kwh, updated_at = now(), lead_id = EXCLUDED.lead_id`,
        [organizationId, leadId, meterId, year, m, kwh]
      );
    }
    const sumRes = await client.query(
      `SELECT COALESCE(SUM(kwh), 0)::int as total FROM lead_consumption_monthly
       WHERE meter_id = $1 AND year = $2`,
      [meterId, year]
    );
    await client.query("COMMIT");
    return sumRes.rows[0]?.total ?? 0;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Copie les champs métier du compteur vers la ligne leads (vérité moteur = colonnes à plat).
 * @param {Db} db
 * @param {object} meterRow
 */
export async function syncLeadFlatFromMeterRow(db, meterRow) {
  if (!meterRow?.lead_id || !meterRow?.organization_id) return;
  await db.query(
    `UPDATE leads SET
       consumption_pdl = $1,
       meter_power_kva = $2,
       grid_type = $3,
       consumption_mode = $4,
       consumption_annual_kwh = $5,
       consumption_annual_calculated_kwh = $6,
       consumption_profile = $7,
       hp_hc = COALESCE($8, false),
       supplier_name = $9,
       tariff_type = $10,
       energy_profile = $11::jsonb,
       equipement_actuel = $12,
       equipement_actuel_params = $13::jsonb,
       equipements_a_venir = $14::jsonb,
       updated_at = now()
     WHERE id = $15 AND organization_id = $16`,
    [
      meterRow.consumption_pdl ?? null,
      meterRow.meter_power_kva ?? null,
      meterRow.grid_type ?? null,
      meterRow.consumption_mode ?? null,
      meterRow.consumption_annual_kwh ?? null,
      meterRow.consumption_annual_calculated_kwh ?? null,
      meterRow.consumption_profile ?? null,
      meterRow.hp_hc,
      meterRow.supplier_name ?? null,
      meterRow.tariff_type ?? null,
      meterRow.energy_profile != null ? JSON.stringify(meterRow.energy_profile) : null,
      meterRow.equipement_actuel ?? null,
      meterRow.equipement_actuel_params != null
        ? JSON.stringify(meterRow.equipement_actuel_params)
        : null,
      meterRow.equipements_a_venir != null ? JSON.stringify(meterRow.equipements_a_venir) : null,
      meterRow.lead_id,
      meterRow.organization_id,
    ]
  );
}

/**
 * @param {Db} db
 * @param {string} leadId
 * @param {string} organizationId
 * @param {string} name
 * @param {boolean} [copyFromDefault=true]
 */
export async function createLeadMeter(db, leadId, organizationId, name, copyFromDefault = true) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) {
    const err = new Error("name requis");
    err.code = "VALIDATION";
    throw err;
  }
  if (trimmed.length > 120) {
    const err = new Error("name : 120 caractères maximum");
    err.code = "VALIDATION";
    throw err;
  }

  await ensureDefaultLeadMeter(db, leadId, organizationId);

  const maxRes = await db.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM lead_meters WHERE lead_id = $1 AND organization_id = $2`,
    [leadId, organizationId]
  );
  const sortOrder = maxRes.rows[0]?.n ?? 0;

  if (copyFromDefault) {
    const ins = await db.query(
      `INSERT INTO lead_meters (
         organization_id, lead_id, name, is_default, sort_order,
         consumption_pdl, meter_power_kva, grid_type, consumption_mode,
         consumption_annual_kwh, consumption_annual_calculated_kwh,
         consumption_profile, hp_hc, supplier_name, tariff_type,
         energy_profile, equipement_actuel, equipement_actuel_params, equipements_a_venir
       )
       SELECT
         d.organization_id,
         d.lead_id,
         $3,
         false,
         $4,
         d.consumption_pdl,
         d.meter_power_kva,
         d.grid_type,
         d.consumption_mode,
         d.consumption_annual_kwh,
         d.consumption_annual_calculated_kwh,
         d.consumption_profile,
         COALESCE(d.hp_hc, false),
         d.supplier_name,
         d.tariff_type,
         d.energy_profile,
         d.equipement_actuel,
         d.equipement_actuel_params,
         d.equipements_a_venir
       FROM lead_meters d
       WHERE d.lead_id = $1 AND d.organization_id = $2 AND d.is_default = true
       LIMIT 1
       RETURNING *`,
      [leadId, organizationId, trimmed, sortOrder]
    );
    if (ins.rows.length === 0) {
      const err = new Error("compteur par défaut introuvable");
      err.code = "NOT_FOUND";
      throw err;
    }
    return ins.rows[0];
  }

  const ins = await db.query(
    `INSERT INTO lead_meters (organization_id, lead_id, name, is_default, sort_order, hp_hc)
     VALUES ($1, $2, $3, false, $4, false)
     RETURNING *`,
    [organizationId, leadId, trimmed, sortOrder]
  );
  return ins.rows[0];
}

/** Champs PATCH autorisés sur un compteur (hors name / is_default / sort_order gérés à part). */
const PATCHABLE_METER_COLUMNS = new Set([
  "name",
  "meter_power_kva",
  "grid_type",
  "consumption_mode",
  "consumption_annual_kwh",
  "consumption_annual_calculated_kwh",
  "consumption_pdl",
  "consumption_profile",
  "hp_hc",
  "supplier_name",
  "tariff_type",
  "energy_profile",
  "equipement_actuel",
  "equipement_actuel_params",
  "equipements_a_venir",
]);

/**
 * @param {Db} db
 * @param {string} meterId
 * @param {string} leadId
 * @param {string} organizationId
 * @param {Record<string, unknown>} patch champs autorisés uniquement
 * @param {{ validateEquipment?: (v: unknown, field: string) => { ok: boolean, error?: string }, migrateEquipment?: (v: unknown) => unknown }} [validators]
 */
export async function updateLeadMeter(db, meterId, leadId, organizationId, patch, validators = {}) {
  const row = await getMeterByIdForLead(db, meterId, leadId, organizationId);
  if (!row) {
    const err = new Error("Compteur non trouvé");
    err.code = "NOT_FOUND";
    throw err;
  }

  const updates = [];
  const values = [];
  let idx = 1;

  for (const key of Object.keys(patch)) {
    if (!PATCHABLE_METER_COLUMNS.has(key)) continue;
    const v = patch[key];

    if (key === "name") {
      if (v === undefined) continue;
      const t = String(v ?? "").trim();
      if (!t) {
        const err = new Error("name ne peut pas être vide");
        err.code = "VALIDATION";
        throw err;
      }
      if (t.length > 120) {
        const err = new Error("name : 120 caractères maximum");
        err.code = "VALIDATION";
        throw err;
      }
      updates.push(`name = $${idx++}`);
      values.push(t);
      continue;
    }

    if (key === "consumption_mode") {
      if (v === undefined || v === null) continue;
      if (!["ANNUAL", "MONTHLY", "PDL"].includes(v)) {
        const err = new Error("consumption_mode invalide");
        err.code = "VALIDATION";
        throw err;
      }
      updates.push(`consumption_mode = $${idx++}`);
      values.push(v);
      continue;
    }

    if (key === "equipement_actuel") {
      if (v === undefined) continue;
      if (v !== null && typeof v !== "string") {
        const err = new Error("equipement_actuel doit être une chaîne ou null");
        err.code = "VALIDATION";
        throw err;
      }
      const raw = v === null || v === "" ? null : String(v).trim();
      if (raw != null && raw.length > 50) {
        const err = new Error("equipement_actuel : 50 caractères maximum");
        err.code = "VALIDATION";
        throw err;
      }
      updates.push(`equipement_actuel = $${idx++}`);
      values.push(raw);
      continue;
    }

    if (key === "equipement_actuel_params") {
      if (v === undefined) continue;
      if (v !== null && typeof v !== "object") {
        const err = new Error("equipement_actuel_params doit être un objet ou null");
        err.code = "VALIDATION";
        throw err;
      }
      let norm = v === null ? null : validators.migrateEquipment ? validators.migrateEquipment(v) : v;
      if (validators.validateEquipment) {
        const vr = validators.validateEquipment(norm, "equipement_actuel_params");
        if (!vr.ok) {
          const err = new Error(vr.error || "equipement_actuel_params invalide");
          err.code = "VALIDATION";
          throw err;
        }
      }
      updates.push(`equipement_actuel_params = $${idx++}::jsonb`);
      values.push(norm == null ? null : JSON.stringify(norm));
      continue;
    }

    if (key === "equipements_a_venir") {
      if (v === undefined) continue;
      if (v !== null && typeof v !== "object") {
        const err = new Error("equipements_a_venir doit être un objet ou null");
        err.code = "VALIDATION";
        throw err;
      }
      let norm = v === null ? null : validators.migrateEquipment ? validators.migrateEquipment(v) : v;
      if (validators.validateEquipment) {
        const vr = validators.validateEquipment(norm, "equipements_a_venir");
        if (!vr.ok) {
          const err = new Error(vr.error || "equipements_a_venir invalide");
          err.code = "VALIDATION";
          throw err;
        }
      }
      updates.push(`equipements_a_venir = $${idx++}::jsonb`);
      values.push(norm == null ? null : JSON.stringify(norm));
      continue;
    }

    if (key === "energy_profile") {
      if (v === undefined) continue;
      updates.push(`energy_profile = $${idx++}::jsonb`);
      values.push(v == null ? null : JSON.stringify(v));
      continue;
    }

    if (key === "hp_hc") {
      if (v === undefined) continue;
      updates.push(`hp_hc = $${idx++}`);
      values.push(!!v);
      continue;
    }

    if (v === undefined) continue;

    updates.push(`${key} = $${idx++}`);
    values.push(v);
  }

  if (updates.length === 0) {
    return getMeterByIdForLead(db, meterId, leadId, organizationId);
  }

  updates.push(`updated_at = now()`);
  values.push(meterId, leadId, organizationId);

  await db.query(
    `UPDATE lead_meters SET ${updates.join(", ")}
     WHERE id = $${idx++} AND lead_id = $${idx++} AND organization_id = $${idx++}`,
    values
  );

  const updated = await getMeterByIdForLead(db, meterId, leadId, organizationId);
  if (updated?.is_default === true) {
    await syncLeadFlatFromMeterRow(db, updated);
  }
  return updated;
}

/**
 * @param {Db} db
 * @param {string} meterId
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function setDefaultLeadMeter(db, meterId, leadId, organizationId) {
  const target = await getMeterByIdForLead(db, meterId, leadId, organizationId);
  if (!target) {
    const err = new Error("Compteur non trouvé");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (target.is_default === true) {
    return target;
  }

  const client = await db.connect();
  let row = null;
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE lead_meters SET is_default = false, updated_at = now()
       WHERE lead_id = $1 AND organization_id = $2`,
      [leadId, organizationId]
    );
    const r = await client.query(
      `UPDATE lead_meters SET is_default = true, updated_at = now()
       WHERE id = $1 AND lead_id = $2 AND organization_id = $3
       RETURNING *`,
      [meterId, leadId, organizationId]
    );
    await client.query("COMMIT");
    row = r.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  if (row) await syncLeadFlatFromMeterRow(db, row);
  return row;
}

/**
 * @param {Db} db
 * @param {string} meterId
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function deleteLeadMeter(db, meterId, leadId, organizationId) {
  const row = await getMeterByIdForLead(db, meterId, leadId, organizationId);
  if (!row) {
    const err = new Error("Compteur non trouvé");
    err.code = "NOT_FOUND";
    throw err;
  }

  const cnt = await db.query(
    `SELECT COUNT(*)::int AS c FROM lead_meters WHERE lead_id = $1 AND organization_id = $2`,
    [leadId, organizationId]
  );
  if ((cnt.rows[0]?.c ?? 0) <= 1) {
    const err = new Error("Impossible de supprimer le seul compteur du dossier");
    err.code = "CONFLICT";
    throw err;
  }

  const wasDefault = row.is_default === true;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (wasDefault) {
      const nextRes = await client.query(
        `SELECT id FROM lead_meters
         WHERE lead_id = $1 AND organization_id = $2 AND id <> $3
         ORDER BY sort_order ASC, created_at ASC
         LIMIT 1`,
        [leadId, organizationId, meterId]
      );
      const nextId = nextRes.rows[0]?.id;
      if (!nextId) {
        await client.query("ROLLBACK");
        const err = new Error("Aucun compteur de remplacement");
        err.code = "CONFLICT";
        throw err;
      }
      await client.query(
        `UPDATE lead_meters SET is_default = false WHERE lead_id = $1 AND organization_id = $2`,
        [leadId, organizationId]
      );
      await client.query(
        `UPDATE lead_meters SET is_default = true, updated_at = now() WHERE id = $1`,
        [nextId]
      );
    }

    await client.query(
      `DELETE FROM lead_meters WHERE id = $1 AND lead_id = $2 AND organization_id = $3`,
      [meterId, leadId, organizationId]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  if (wasDefault) {
    const def = await getDefaultMeterRow(db, leadId, organizationId);
    if (def) await syncLeadFlatFromMeterRow(db, def);
  }

  return { ok: true, was_default: wasDefault };
}
