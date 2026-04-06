/**
 * Paramètres PV — Batteries virtuelles (fournisseurs)
 * GET/POST /api/admin/pv/virtual-batteries, PUT/DELETE :id
 * RBAC: org.settings.manage (SUPER_ADMIN, ADMIN_ORG). Filtré par organization_id.
 */

import { pool } from "../config/db.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

const PRICING_MODELS = ["per_kwc", "per_capacity", "per_kwc_with_variable", "custom"];

const TARIFF_GRID_MAX_BYTES = 200 * 1024; // 200 KB

const WHITELIST = [
  "name",
  "provider_code",
  "pricing_model",
  "monthly_subscription_ht",
  "cost_per_kwh_ht",
  "activation_fee_ht",
  "contribution_autoproducteur_ht",
  "includes_network_fees",
  "indexed_on_trv",
  "capacity_table",
  "tariff_grid_json",
  "tariff_source_label",
  "tariff_effective_date",
  "is_active",
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function toNum(v, defaultVal = null) {
  if (v === undefined || v === null) return defaultVal;
  const n = Number(v);
  return Number.isNaN(n) ? defaultVal : n;
}

function validateCreate(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 255) {
    return { ok: false, error: "name requis (max 255 caractères)" };
  }
  const provider_code = typeof body.provider_code === "string" ? body.provider_code.trim() : "";
  if (!provider_code || provider_code.length > 64) {
    return { ok: false, error: "provider_code requis (max 64 caractères)" };
  }
  const pricing_model = body.pricing_model;
  if (!pricing_model || !PRICING_MODELS.includes(pricing_model)) {
    return { ok: false, error: `pricing_model doit être parmi: ${PRICING_MODELS.join(", ")}` };
  }
  const capacityErr = validateCapacityTable(body.capacity_table, pricing_model);
  if (capacityErr) return { ok: false, error: capacityErr };
  return { ok: true };
}

/**
 * Validation stricte capacity_table selon pricing_model.
 * Si per_capacity : array non vide, chaque entrée capacity_kwh > 0 et monthly_ht >= 0.
 * Sinon : capacity_table doit être null.
 */
function validateCapacityTable(capacityTable, pricingModel) {
  if (pricingModel === "per_capacity") {
    if (!Array.isArray(capacityTable) || capacityTable.length === 0) {
      return "pricing_model per_capacity requiert capacity_table non vide";
    }
    for (let i = 0; i < capacityTable.length; i++) {
      const row = capacityTable[i];
      const capacityKwh = Number(row?.capacity_kwh);
      const monthlyHt =
        Number(row?.monthly_subscription_ht ?? row?.monthly_ht) ?? NaN;
      if (Number.isNaN(capacityKwh) || capacityKwh <= 0) {
        return `capacity_table[${i}]: capacity_kwh doit être > 0`;
      }
      if (Number.isNaN(monthlyHt) || monthlyHt < 0) {
        return `capacity_table[${i}]: monthly_subscription_ht (ou monthly_ht) doit être >= 0`;
      }
    }
    return null;
  }
  if (capacityTable != null) {
    return "capacity_table doit être null lorsque pricing_model n'est pas per_capacity";
  }
  return null;
}

function validateTariffGrid(value) {
  if (value == null) return null;
  let obj = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      return "tariff_grid_json : JSON invalide";
    }
  }
  if (typeof obj !== "object" || Array.isArray(obj)) {
    return "tariff_grid_json doit être un objet JSON";
  }
  const str = JSON.stringify(obj);
  if (Buffer.byteLength(str, "utf8") > TARIFF_GRID_MAX_BYTES) {
    return "tariff_grid_json dépasse la taille maximale autorisée (200 KB)";
  }
  return null;
}

export async function list(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(403).json({ error: "Organization non identifiée" });
    }
    const { rows } = await pool.query(
      `SELECT * FROM pv_virtual_batteries WHERE organization_id = $1 ORDER BY name`,
      [org]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function create(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(403).json({ error: "Organization non identifiée" });
    }
    const validation = validateCreate(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    const body = pick(req.body, WHITELIST);
    const tariffErr = validateTariffGrid(body.tariff_grid_json);
    if (tariffErr) {
      return res.status(400).json({ error: tariffErr });
    }
    const name = (body.name || "").trim();
    const provider_code = (body.provider_code || "").trim();
    const pricing_model = body.pricing_model;
    const monthly_subscription_ht = toNum(body.monthly_subscription_ht);
    const cost_per_kwh_ht = toNum(body.cost_per_kwh_ht);
    const activation_fee_ht = toNum(body.activation_fee_ht);
    const contribution_autoproducteur_ht = toNum(body.contribution_autoproducteur_ht);
    const includes_network_fees = body.includes_network_fees === true;
    const indexed_on_trv = body.indexed_on_trv === true;
    let capacity_table = null;
    if (pricing_model === "per_capacity" && Array.isArray(body.capacity_table) && body.capacity_table.length > 0) {
      capacity_table = JSON.stringify(body.capacity_table);
    }
    const is_active = body.is_active !== false;
    let tariff_grid_json = null;
    if (body.tariff_grid_json != null && typeof body.tariff_grid_json === "object") {
      tariff_grid_json = JSON.stringify(body.tariff_grid_json);
    } else if (typeof body.tariff_grid_json === "string" && body.tariff_grid_json.trim()) {
      try {
        tariff_grid_json = JSON.stringify(JSON.parse(body.tariff_grid_json));
      } catch {
        tariff_grid_json = null;
      }
    }
    const tariff_source_label =
      typeof body.tariff_source_label === "string" ? body.tariff_source_label.trim() || null : null;
    const tariff_effective_date =
      typeof body.tariff_effective_date === "string" && body.tariff_effective_date.trim()
        ? body.tariff_effective_date.trim()
        : null;

    const { rows } = await pool.query(
      `INSERT INTO pv_virtual_batteries (
        organization_id, name, provider_code, pricing_model,
        monthly_subscription_ht, cost_per_kwh_ht, activation_fee_ht, contribution_autoproducteur_ht,
        includes_network_fees, indexed_on_trv, capacity_table,
        tariff_grid_json, tariff_source_label, tariff_effective_date,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15)
      RETURNING *`,
      [
        org,
        name,
        provider_code,
        pricing_model,
        monthly_subscription_ht,
        cost_per_kwh_ht,
        activation_fee_ht,
        contribution_autoproducteur_ht,
        includes_network_fees,
        indexed_on_trv,
        capacity_table,
        tariff_grid_json,
        tariff_source_label,
        tariff_effective_date,
        is_active,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23514") {
      return res.status(400).json({ error: "pricing_model invalide" });
    }
    if (e.code === "23505" || (e.message || "").includes("uq_virtual_battery_provider_per_org")) {
      return res.status(409).json({ error: "Ce code fournisseur existe déjà pour cette organisation" });
    }
    res.status(500).json({ error: e.message });
  }
}

export async function update(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(403).json({ error: "Organization non identifiée" });
    }
    const { id } = req.params;
    const body = pick(req.body, WHITELIST);
    if (body.pricing_model != null && !PRICING_MODELS.includes(body.pricing_model)) {
      return res.status(400).json({
        error: `pricing_model doit être parmi: ${PRICING_MODELS.join(", ")}`,
      });
    }

    const { rows: existing } = await pool.query(
      "SELECT * FROM pv_virtual_batteries WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: "Batterie virtuelle non trouvée" });
    }

    const current = existing[0];
    const effectivePricingModel = body.pricing_model !== undefined ? body.pricing_model : current.pricing_model;
    const effectiveCapacityTable = body.capacity_table !== undefined ? body.capacity_table : current.capacity_table;

    const capacityErr = validateCapacityTable(effectiveCapacityTable, effectivePricingModel);
    if (capacityErr) {
      return res.status(400).json({ error: capacityErr });
    }
    if (body.tariff_grid_json !== undefined) {
      const tariffErr = validateTariffGrid(body.tariff_grid_json);
      if (tariffErr) {
        return res.status(400).json({ error: tariffErr });
      }
    }

    // TODO: vérifier si batterie utilisée dans devis avant d'autoriser le changement de pricing_model.
    // Lorsque le module devis référencera pv_virtual_batteries, ajouter ici :
    // if (body.pricing_model !== undefined && body.pricing_model !== current.pricing_model) {
    //   const used = await isVirtualBatteryUsedInQuotes(id, org);
    //   if (used) return res.status(409).json({ error: "Impossible de modifier le modèle tarifaire : batterie utilisée dans un devis" });
    // }

    const updates = [];
    const values = [];
    let idx = 1;
    const allowed = [
      "name",
      "provider_code",
      "pricing_model",
      "monthly_subscription_ht",
      "cost_per_kwh_ht",
      "activation_fee_ht",
      "contribution_autoproducteur_ht",
      "includes_network_fees",
      "indexed_on_trv",
      "capacity_table",
      "tariff_grid_json",
      "tariff_source_label",
      "tariff_effective_date",
      "is_active",
    ];
    for (const k of allowed) {
      if (body[k] === undefined) continue;
      if (k === "capacity_table") {
        updates.push(`capacity_table = $${idx}::jsonb`);
        const normalized =
          effectivePricingModel === "per_capacity" &&
          Array.isArray(body[k]) &&
          body[k].length > 0
            ? JSON.stringify(body[k])
            : null;
        values.push(normalized);
      } else if (k === "tariff_grid_json") {
        updates.push(`tariff_grid_json = $${idx}::jsonb`);
        let val = body[k];
        if (typeof val === "string" && val.trim()) {
          try {
            val = JSON.parse(val);
          } catch {
            val = null;
          }
        }
        values.push(val != null && typeof val === "object" ? JSON.stringify(val) : null);
      } else if (k === "tariff_source_label") {
        updates.push(`tariff_source_label = $${idx}`);
        values.push(typeof body[k] === "string" ? body[k].trim() || null : null);
      } else if (k === "tariff_effective_date") {
        updates.push(`tariff_effective_date = $${idx}`);
        values.push(
          typeof body[k] === "string" && body[k].trim() ? body[k].trim() : null
        );
      } else if (k === "includes_network_fees" || k === "indexed_on_trv" || k === "is_active") {
        updates.push(`${k} = $${idx}`);
        values.push(body[k] === true);
      } else if (
        k === "monthly_subscription_ht" ||
        k === "cost_per_kwh_ht" ||
        k === "activation_fee_ht" ||
        k === "contribution_autoproducteur_ht"
      ) {
        updates.push(`${k} = $${idx}`);
        values.push(toNum(body[k]));
      } else {
        updates.push(`${k} = $${idx}`);
        values.push(typeof body[k] === "string" ? body[k].trim() : body[k]);
      }
      idx += 1;
    }
    if (effectivePricingModel !== "per_capacity" && !updates.some((u) => u.startsWith("capacity_table"))) {
      updates.push("capacity_table = NULL");
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "Aucune modification" });
    }
    updates.push("updated_at = NOW()");
    values.push(id, org);
    const { rows } = await pool.query(
      `UPDATE pv_virtual_batteries SET ${updates.join(", ")} WHERE id = $${idx} AND organization_id = $${idx + 1} RETURNING *`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Batterie virtuelle non trouvée" });
    }
    res.json(rows[0]);
  } catch (e) {
    if (e.code === "23514") {
      return res.status(400).json({ error: "pricing_model invalide" });
    }
    if (e.code === "23505" || (e.message || "").includes("uq_virtual_battery_provider_per_org")) {
      return res.status(409).json({ error: "Ce code fournisseur existe déjà pour cette organisation" });
    }
    res.status(500).json({ error: e.message });
  }
}

export async function remove(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(403).json({ error: "Organization non identifiée" });
    }
    const { id } = req.params;
    const { rows } = await pool.query(
      "DELETE FROM pv_virtual_batteries WHERE id = $1 AND organization_id = $2 RETURNING id",
      [id, org]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Batterie virtuelle non trouvée" });
    }
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
