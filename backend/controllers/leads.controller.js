/**
 * CP-026 — Leads controller
 * CP-035 — Leads Premium : score, CA, inactivité, filtres
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { recalculateLeadScore } from "../services/leadScoring.service.js";
import { validateAddressForLead } from "../modules/address/address.service.js";
import { createAutoActivity } from "../modules/activities/activity.service.js";
import { buildStoredEnergyProfile } from "../services/energy/energyProfileStorage.js";
import {
  insertDefaultMeterForNewLead,
  syncDefaultMeterFromLeadRow,
} from "../services/leadMeters.service.js";

/** Statuts autorisés sur PATCH (aligné DB + migration lead status) */
const ALLOWED_STATUSES = [
  "NEW",
  "QUALIFIED",
  "APPOINTMENT",
  "OFFER_SENT",
  "IN_REFLECTION",
  "FOLLOW_UP",
  "LOST",
  "ARCHIVED",
  "SIGNED",
  "LEAD",
  "CLIENT",
];

function isValidTransition(from, to) {
  if (from === to) return true;
  /* Ancien état résiduel : seule transition autorisée vers la vérité métier CLIENT + SIGNE */
  if (from === "SIGNED") return to === "CLIENT";
  if (from === "LOST" && to !== "ARCHIVED") return false;
  return true;
}

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function getAll(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const {
      view,
      stage,
      assigned_to,
      search,
      page,
      limit,
      date_from,
      date_to,
      project_status,
      budget_min,
      budget_max,
      is_geo_verified,
      has_signed_quote,
      from_date,
      to_date,
      sort,
      order,
      include_archived
    } = req.query;

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org
    });
    const canReadAll = perms.has("lead.read.all");
    const canReadSelf = perms.has("lead.read.self");

    // CP-029 : view=leads => status=LEAD, view=clients => status=CLIENT (+ devis signé non requis pour la liste)
    const viewMode = (view || "leads").toLowerCase();
    const showArchived =
      include_archived === "true" || include_archived === "1";

    let query = `SELECT l.id, l.full_name, l.first_name, l.last_name, l.email, l.phone, l.phone_mobile,
       l.estimated_kw, l.estimated_budget_eur, l.score, l.potential_revenue, l.inactivity_level, l.status,
       l.stage_id, l.project_status, l.assigned_to, l.assigned_salesperson_user_id, l.lead_source,
       l.created_at, l.updated_at, l.last_activity_at, l.archived_at,
       ps.name as stage_name,
       u.email as assigned_to_email,
       u.email as assigned_salesperson_email,
       sa.city as site_city, sa.postal_code as site_postal_code, sa.formatted_address as site_formatted_address,
       sa.is_geo_verified as is_geo_verified,
       EXISTS (
         SELECT 1 FROM quotes q
         WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
       ) as has_signed_quote,
       (SELECT MAX(q.updated_at) FROM quotes q
        WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)) as quote_signed_at
     FROM leads l
     LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
     LEFT JOIN users u ON u.id = COALESCE(l.assigned_salesperson_user_id, l.assigned_to)
     LEFT JOIN addresses sa ON sa.id = l.site_address_id
     WHERE l.organization_id = $1`;
    const params = [org];
    let idx = 2;

    if (viewMode === "clients") {
      if (showArchived) {
        query += ` AND (
          (l.status = 'CLIENT' AND l.archived_at IS NULL)
          OR (l.status = 'ARCHIVED' AND l.archived_at IS NOT NULL AND l.client_id IS NOT NULL)
        )`;
      } else {
        query += ` AND l.status = 'CLIENT' AND l.archived_at IS NULL`;
      }
    } else {
      if (showArchived) {
        query += ` AND (
          (l.status = 'LEAD' AND l.archived_at IS NULL)
          OR (l.status = 'ARCHIVED' AND l.archived_at IS NOT NULL AND l.client_id IS NULL)
        )`;
      } else {
        query += ` AND l.status = 'LEAD' AND l.archived_at IS NULL`;
      }
    }

    if (canReadSelf && !canReadAll) {
      query += ` AND (l.assigned_salesperson_user_id = $${idx} OR l.assigned_to = $${idx})`;
      params.push(uid);
      idx++;
    }

    if (stage) {
      query += ` AND l.stage_id = $${idx}`;
      params.push(stage);
      idx++;
    }
    if (assigned_to) {
      query += ` AND COALESCE(l.assigned_salesperson_user_id, l.assigned_to) = $${idx++}`;
      params.push(assigned_to);
    }
    if (project_status) {
      query += ` AND l.project_status = $${idx++}`;
      params.push(project_status);
    }
    if (budget_min != null && budget_min !== "") {
      query += ` AND COALESCE(l.estimated_budget_eur, l.potential_revenue, 0) >= $${idx++}`;
      params.push(parseInt(budget_min, 10));
    }
    if (budget_max != null && budget_max !== "") {
      query += ` AND COALESCE(l.estimated_budget_eur, l.potential_revenue, 0) <= $${idx++}`;
      params.push(parseInt(budget_max, 10));
    }
    if (is_geo_verified === "true" || is_geo_verified === "1") {
      query += ` AND sa.is_geo_verified = true`;
    } else if (is_geo_verified === "false" || is_geo_verified === "0") {
      query += ` AND (sa.is_geo_verified = false OR sa.is_geo_verified IS NULL)`;
    }
    if (has_signed_quote === "true" || has_signed_quote === "1") {
      query += ` AND EXISTS (
        SELECT 1 FROM quotes q
        WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
      )`;
    } else if (has_signed_quote === "false" || has_signed_quote === "0") {
      query += ` AND NOT EXISTS (
        SELECT 1 FROM quotes q
        WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
      )`;
    }
    const dateFrom = from_date || date_from;
    const dateTo = to_date || date_to;
    if (dateFrom) {
      query += ` AND l.updated_at >= $${idx++}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND l.updated_at <= $${idx++}`;
      params.push(dateTo);
    }
    if (search) {
      query += ` AND (
        l.full_name ILIKE $${idx} OR l.first_name ILIKE $${idx} OR l.last_name ILIKE $${idx} OR
        l.email ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.phone_mobile ILIKE $${idx} OR
        l.address ILIKE $${idx} OR sa.city ILIKE $${idx} OR sa.postal_code ILIKE $${idx} OR sa.formatted_address ILIKE $${idx}
      )`;
      params.push(`%${search}%`);
      idx++;
    }

    const sortCol = ["full_name", "updated_at", "assigned_salesperson_user_id", "project_status", "estimated_budget_eur"].includes(sort)
      ? sort
      : "updated_at";
    const sortColSql =
      sortCol === "assigned_salesperson_user_id"
        ? "u.email"
        : sortCol === "estimated_budget_eur"
          ? "COALESCE(l.estimated_budget_eur, l.potential_revenue, 0)"
          : `l.${sortCol}`;
    const orderDir = (order || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    query += ` ORDER BY ${sortColSql} ${orderDir} NULLS LAST`;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    query += ` LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limitNum, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getSelf(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const result = await pool.query(
      `SELECT l.*, ps.name as stage_name FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE l.organization_id = $1 AND l.assigned_to = $2 AND (l.archived_at IS NULL) ORDER BY l.updated_at DESC`,
      [org, uid]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getById(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org
    });
    const canReadAll = perms.has("lead.read.all");
    const canReadSelf = perms.has("lead.read.self");

    let query = `SELECT l.*, ps.name as stage_name FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE l.id = $1 AND l.organization_id = $2`;
    const params = [id, org];
    if (canReadSelf && !canReadAll) {
      query += ` AND l.assigned_to = $3`;
      params.push(uid);
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: "Lead non trouvé" });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function create(req, res) {
  try {
    const org = orgId(req);
    const {
      stage_id,
      first_name,
      last_name,
      full_name,
      company_name,
      contact_first_name,
      contact_last_name,
      customer_type,
      siret,
      email,
      phone,
      phone_mobile,
      address,
      source_id,
      assigned_to,
      assigned_salesperson_user_id,
      notes,
      estimated_kw,
      is_owner,
      consumption,
      surface_m2,
      project_delay_months,
      budget_validated,
      roof_exploitable
    } = req.body;
    const stageId = stage_id || (await getDefaultStageId(org));
    // Règle pivot full_name : PRO → company_name, PERSON → first_name + last_name
    const isPro = customer_type === "PRO";
    const fn = isPro
      ? (company_name ?? "").trim() || "Sans nom"
      : (full_name ?? [first_name, last_name].filter(Boolean).join(" ").trim()) || "Sans nom";
    const assigned = assigned_salesperson_user_id ?? assigned_to;
    const result = await pool.query(
      `INSERT INTO leads (organization_id, stage_id, status, project_status,
        full_name, first_name, last_name,
        company_name, contact_first_name, contact_last_name, customer_type, siret,
        email, phone, phone_mobile, address,
        source_id, assigned_to, assigned_salesperson_user_id, notes, estimated_kw, is_owner, consumption, surface_m2,
        project_delay_months, budget_validated, roof_exploitable)
       VALUES ($1, $2, 'LEAD', NULL, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) RETURNING *`,
      [
        org,
        stageId,
        fn,
        isPro ? null : (first_name ?? null),
        isPro ? null : (last_name ?? null),
        company_name ?? null,
        contact_first_name ?? null,
        contact_last_name ?? null,
        customer_type ?? "PERSON",
        siret ?? null,
        email ?? null,
        phone ?? null,
        phone_mobile ?? null,
        address ?? null,
        source_id ?? null,
        assigned ?? null,
        assigned ?? null,
        notes ?? null,
        estimated_kw ?? null,
        is_owner ?? false,
        consumption ?? null,
        surface_m2 ?? null,
        project_delay_months ?? null,
        budget_validated ?? false,
        roof_exploitable ?? false
      ]
    );
    const lead = result.rows[0];
    await insertDefaultMeterForNewLead(pool, lead);
    await recalculateLeadScore(lead.id);
    const updated = await pool.query("SELECT * FROM leads WHERE id = $1", [lead.id]);
    res.status(201).json(updated.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function update(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;
    let {
      stage_id,
      first_name,
      last_name,
      full_name,
      company_name,
      contact_first_name,
      contact_last_name,
      civility,
      siret,
      email,
      phone,
      phone_mobile,
      phone_landline,
      address,
      source_id,
      lead_source,
      assigned_to,
      assigned_salesperson_user_id,
      customer_type,
      notes,
      estimated_kw,
      is_owner,
      consumption,
      surface_m2,
      project_delay_months,
      budget_validated,
      roof_exploitable,
      site_address_id,
      billing_address_id,
      status,
      project_status,
      rgpd_consent,
      property_type,
      household_size,
      construction_year,
      insulation_level,
      roof_type,
      frame_type,
      energy_profile,
      lost_reason
    } = req.body;

    /* SIGNED n'est pas un statut persistant de lead ; on le normalise en CLIENT + SIGNE
       (avant validations project_status « hors CLIENT » et logique archived_at). */
    if (status === "SIGNED") {
      status = "CLIENT";
      project_status = "SIGNE";
    }

    const existingRes = await pool.query(
      "SELECT status, archived_at, project_status, customer_type FROM leads WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    const existingLead = existingRes.rows[0];
    if (!existingLead) {
      return res.status(404).json({ error: "Lead non trouvé" });
    }

    // CP-028 : validation org pour adresses
    if (site_address_id !== undefined) {
      const ok = await validateAddressForLead(org, site_address_id);
      if (!ok) return res.status(400).json({ error: "site_address_id doit appartenir à votre organisation" });
    }
    if (billing_address_id !== undefined) {
      const ok = await validateAddressForLead(org, billing_address_id);
      if (!ok) return res.status(400).json({ error: "billing_address_id doit appartenir à votre organisation" });
    }

    if (status !== undefined) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      if (!isValidTransition(existingLead.status, status)) {
        return res.status(400).json({ error: `Invalid transition from ${existingLead.status} to ${status}` });
      }
      if (status === "LOST") {
        if (!lost_reason || !String(lost_reason).trim()) {
          return res.status(400).json({ error: "lost_reason is required when status = LOST" });
        }
      }
    }

    // CP-LEAD-CLIENT-SPLIT-06-LOCK : validations (status, stage_id)
    if (status === "LEAD" && existingLead.status === "CLIENT") {
      return res.status(400).json({ error: "Impossible de remettre un client en lead" });
    }
    if (stage_id !== undefined && existingLead.status === "CLIENT") {
      return res.status(400).json({ error: "Impossible de modifier le pipeline après conversion en client" });
    }

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org
    });
    const canUpdateAll = perms.has("lead.update.all");
    const canUpdateSelf = perms.has("lead.update.self");

    let query = `UPDATE leads SET updated_at = CURRENT_TIMESTAMP`;
    const updates = [];
    const values = [];
    let idx = 1;

    if (stage_id !== undefined) {
      updates.push(`stage_id = $${idx++}`);
      values.push(stage_id);
    }
    if (civility !== undefined) {
      updates.push(`civility = $${idx++}`);
      values.push(civility);
    }
    if (full_name !== undefined) {
      updates.push(`full_name = $${idx++}`);
      values.push(full_name);
    }
    if (first_name !== undefined) {
      updates.push(`first_name = $${idx++}`);
      values.push(first_name);
    }
    if (last_name !== undefined) {
      updates.push(`last_name = $${idx++}`);
      values.push(last_name);
    }
    if (phone_mobile !== undefined) {
      updates.push(`phone_mobile = $${idx++}`);
      values.push(phone_mobile);
    }
    if (assigned_salesperson_user_id !== undefined) {
      updates.push(`assigned_salesperson_user_id = $${idx++}`);
      values.push(assigned_salesperson_user_id);
    }
    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(email);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${idx++}`);
      values.push(phone);
    }
    if (phone_landline !== undefined) {
      updates.push(`phone_landline = $${idx++}`);
      values.push(phone_landline);
    }
    if (address !== undefined) {
      updates.push(`address = $${idx++}`);
      values.push(address);
    }
    if (source_id !== undefined) {
      updates.push(`source_id = $${idx++}`);
      values.push(source_id);
    }
    if (lead_source !== undefined) {
      updates.push(`lead_source = $${idx++}`);
      values.push(lead_source);
    }
    if (customer_type !== undefined) {
      updates.push(`customer_type = $${idx++}`);
      values.push(customer_type);
    }
    if (company_name !== undefined) {
      updates.push(`company_name = $${idx++}`);
      values.push(company_name);
    }
    if (contact_first_name !== undefined) {
      updates.push(`contact_first_name = $${idx++}`);
      values.push(contact_first_name);
    }
    if (contact_last_name !== undefined) {
      updates.push(`contact_last_name = $${idx++}`);
      values.push(contact_last_name);
    }
    if (siret !== undefined) {
      updates.push(`siret = $${idx++}`);
      values.push(siret ?? null);
    }
    // Règle pivot full_name : recalculer automatiquement si non fourni explicitement
    // PRO → full_name = company_name | PERSON → full_name = first_name + last_name
    if (full_name === undefined) {
      const resolvedType = customer_type ?? existingLead.customer_type ?? "PERSON";
      if (resolvedType === "PRO" && company_name !== undefined) {
        const computedFn = (company_name ?? "").trim() || "Sans nom";
        updates.push(`full_name = $${idx++}`);
        values.push(computedFn);
      } else if (resolvedType !== "PRO" && (first_name !== undefined || last_name !== undefined)) {
        // Besoin des valeurs courantes pour recalculer si un seul des deux champs change
        const existingRow = await pool.query(
          "SELECT first_name, last_name FROM leads WHERE id = $1 AND organization_id = $2",
          [id, org]
        );
        const current = existingRow.rows[0] || {};
        const fn_new = first_name ?? current.first_name ?? "";
        const ln_new = last_name ?? current.last_name ?? "";
        const computedFn = [fn_new, ln_new].filter(Boolean).join(" ").trim() || "Sans nom";
        updates.push(`full_name = $${idx++}`);
        values.push(computedFn);
      }
    }
    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${idx++}`);
      values.push(assigned_to);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(notes);
    }
    if (estimated_kw !== undefined) {
      updates.push(`estimated_kw = $${idx++}`);
      values.push(estimated_kw);
    }
    if (is_owner !== undefined) {
      updates.push(`is_owner = $${idx++}`);
      values.push(is_owner);
    }
    if (consumption !== undefined) {
      updates.push(`consumption = $${idx++}`);
      values.push(consumption);
    }
    if (surface_m2 !== undefined) {
      updates.push(`surface_m2 = $${idx++}`);
      values.push(surface_m2);
    }
    if (project_delay_months !== undefined) {
      updates.push(`project_delay_months = $${idx++}`);
      values.push(project_delay_months);
    }
    if (budget_validated !== undefined) {
      updates.push(`budget_validated = $${idx++}`);
      values.push(budget_validated);
    }
    if (roof_exploitable !== undefined) {
      updates.push(`roof_exploitable = $${idx++}`);
      values.push(roof_exploitable);
    }
    if (site_address_id !== undefined) {
      updates.push(`site_address_id = $${idx++}`);
      values.push(site_address_id);
    }
    if (billing_address_id !== undefined) {
      updates.push(`billing_address_id = $${idx++}`);
      values.push(billing_address_id);
    }
    if (project_status !== undefined) {
      // CP-LEAD-CLIENT-SPLIT-06-LOCK : validation stricte
      const validProjectStatus = [
        "SIGNE", "DP_A_DEPOSER", "DP_DEPOSE", "DP_ACCEPTE",
        "INSTALLATION_PLANIFIEE", "INSTALLATION_REALISEE",
        "CONSUEL_EN_ATTENTE", "CONSUEL_OBTENU", "MISE_EN_SERVICE",
        "FACTURATION_TERMINEE", "CLOTURE"
      ];
      const leadStatus = status !== undefined ? status : existingLead.status ?? "LEAD";

      // Hors CLIENT (pipeline commercial / lead) → project_status doit être NULL
      if (leadStatus !== "CLIENT") {
        if (project_status !== null && project_status !== "") {
          return res.status(400).json({ error: "project_status doit être NULL pour un lead" });
        }
        updates.push(`project_status = $${idx++}`);
        values.push(null);
      } else {
        // CLIENT → project_status obligatoire et dans enum valide
        if (project_status === null || project_status === "") {
          return res.status(400).json({ error: "project_status obligatoire pour un client" });
        }
        if (!validProjectStatus.includes(project_status)) {
          return res.status(400).json({ error: "project_status invalide (cycle projet CLIENT uniquement)" });
        }
        updates.push(`project_status = $${idx++}`);
        values.push(project_status);
      }
    }
    if (rgpd_consent !== undefined) {
      updates.push(`rgpd_consent = $${idx++}`);
      values.push(!!rgpd_consent);
      updates.push(`rgpd_consent_at = $${idx++}`);
      values.push(rgpd_consent ? new Date() : null);
    }
    if (property_type !== undefined) {
      updates.push(`property_type = $${idx++}`);
      values.push(property_type);
    }
    if (household_size !== undefined) {
      updates.push(`household_size = $${idx++}`);
      values.push(household_size);
    }
    if (construction_year !== undefined) {
      updates.push(`construction_year = $${idx++}`);
      values.push(construction_year);
    }
    if (insulation_level !== undefined) {
      updates.push(`insulation_level = $${idx++}`);
      values.push(insulation_level);
    }
    if (roof_type !== undefined) {
      updates.push(`roof_type = $${idx++}`);
      values.push(roof_type);
    }
    if (frame_type !== undefined) {
      updates.push(`frame_type = $${idx++}`);
      values.push(frame_type);
    }
    if (energy_profile !== undefined) {
      const stored = buildStoredEnergyProfile(
        typeof energy_profile === "object" && energy_profile !== null ? energy_profile : {}
      );
      updates.push(`energy_profile = $${idx++}::jsonb`);
      values.push(JSON.stringify(stored));
    }

    if (status !== undefined) {
      let lostReasonValue = null;
      if (status === "LOST") {
        lostReasonValue = String(lost_reason ?? "").trim();
      }
      let includeArchivedAt = false;
      let archivedAtValue = null;
      if (status === "ARCHIVED") {
        archivedAtValue = new Date();
        includeArchivedAt = true;
      } else if (status === "LOST") {
        /* Archivage auto : dossier perdu retiré des vues actives sans suppression */
        archivedAtValue = new Date();
        includeArchivedAt = true;
      } else if (existingLead.status === "ARCHIVED" && status !== "ARCHIVED") {
        archivedAtValue = null;
        includeArchivedAt = true;
      } else if (
        existingLead.archived_at != null &&
        status !== "ARCHIVED" &&
        status !== "LOST"
      ) {
        /* Reprise depuis perdu (archivage auto) ou équivalent — réouvre le dossier */
        archivedAtValue = null;
        includeArchivedAt = true;
      }
      updates.push(`status = $${idx++}`);
      values.push(status);
      updates.push(`lost_reason = $${idx++}`);
      values.push(lostReasonValue);
      if (includeArchivedAt) {
        updates.push(`archived_at = $${idx++}`);
        values.push(archivedAtValue);
      }
      console.log("[LEAD STATUS UPDATE]", { id, from: existingLead.status, to: status });
    }

    if (updates.length === 0) {
      const r = await pool.query("SELECT * FROM leads WHERE id = $1 AND organization_id = $2", [id, org]);
      if (r.rows.length === 0) return res.status(404).json({ error: "Lead non trouvé" });
      return res.json(r.rows[0]);
    }

    const oldStatus = existingLead.status;
    const oldProjectStatus = existingLead.project_status;

    const unarchive =
      status !== undefined && existingLead.status === "ARCHIVED" && status !== "ARCHIVED";

    query += `, ${updates.join(", ")} WHERE id = $${idx++} AND organization_id = $${idx++}`;
    values.push(id, org);
    query += ` AND ((archived_at IS NULL) OR ($${idx++}::boolean = true AND archived_at IS NOT NULL))`;
    values.push(unarchive);

    if (canUpdateSelf && !canUpdateAll) {
      query += ` AND assigned_to = $${idx++}`;
      values.push(uid);
    }

    const result = await pool.query(query + " RETURNING *", values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Lead non trouvé" });

    if (status !== undefined && oldStatus != null && oldStatus !== status) {
      try {
        await createAutoActivity(org, id, uid, "STATUS_CHANGE", "Statut modifié", {
          from: oldStatus,
          to: status
        });
      } catch (_) {}
    }
    if (project_status !== undefined && oldProjectStatus != null && oldProjectStatus !== project_status) {
      try {
        await createAutoActivity(org, id, uid, "PROJECT_STATUS_CHANGE", "Statut projet modifié", {
          from: oldProjectStatus,
          to: project_status
        });
        if (["MISE_EN_SERVICE", "FACTURATION_TERMINEE"].includes(project_status)) {
          await createAutoActivity(org, id, uid, "INSTALLATION_TERMINEE", "Installation terminée", {
            project_status: project_status
          });
        }
      } catch (_) {}
    }

    await recalculateLeadScore(id);
    const updated = await pool.query("SELECT * FROM leads WHERE id = $1", [id]);
    if (energy_profile !== undefined && updated.rows[0]) {
      await syncDefaultMeterFromLeadRow(pool, updated.rows[0]);
    }
    res.json(updated.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getKanban(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { search, stage, assigned_to } = req.query;

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org
    });
    const canReadAll = perms.has("lead.read.all");
    const canReadSelf = perms.has("lead.read.self");

    const stagesRes = await pool.query(
      `SELECT id, name, position, is_closed, code FROM pipeline_stages
       WHERE organization_id = $1 ORDER BY position ASC`,
      [org]
    );
    const stages = stagesRes.rows;

    let leadsQuery = `SELECT l.id, l.full_name, l.first_name, l.last_name, l.email, l.phone, l.phone_mobile,
         l.address, l.estimated_kw, l.score, l.potential_revenue, l.status, l.stage_id,
         l.inactivity_level,
         l.assigned_to, l.assigned_salesperson_user_id, l.lead_source,
         l.created_at, l.updated_at, ps.name as stage_name,
         u.email as assigned_to_email,
         sa.formatted_address as site_formatted_address,
         sa.address_line1 as site_address_line1,
         sa.address_line2 as site_address_line2,
         sa.postal_code as site_postal_code,
         sa.city as site_city
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       LEFT JOIN users u ON u.id = COALESCE(l.assigned_salesperson_user_id, l.assigned_to)
       LEFT JOIN addresses sa ON sa.id = l.site_address_id
       WHERE l.organization_id = $1 AND (l.archived_at IS NULL) AND l.status = 'LEAD'`;
    const values = [org];
    let idx = 2;

    if (canReadSelf && !canReadAll) {
      leadsQuery += ` AND (l.assigned_salesperson_user_id = $${idx} OR l.assigned_to = $${idx})`;
      values.push(uid);
      idx++;
    }

    if (stage) {
      leadsQuery += ` AND l.stage_id = $${idx}`;
      values.push(stage);
      idx++;
    }
    if (assigned_to) {
      leadsQuery += ` AND COALESCE(l.assigned_salesperson_user_id, l.assigned_to) = $${idx++}`;
      values.push(assigned_to);
    }
    if (search) {
      leadsQuery += ` AND (
        l.full_name ILIKE $${idx} OR l.first_name ILIKE $${idx} OR l.last_name ILIKE $${idx} OR
        l.email ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.phone_mobile ILIKE $${idx} OR
        l.address ILIKE $${idx} OR sa.city ILIKE $${idx} OR sa.postal_code ILIKE $${idx} OR sa.formatted_address ILIKE $${idx}
      )`;
      values.push(`%${search}%`);
      idx++;
    }

    leadsQuery += ` ORDER BY l.updated_at DESC`;

    const leadsRes = await pool.query(leadsQuery, values);

    const leadsByStage = stages.reduce((acc, s) => {
      acc[s.id] = { stage_id: s.id, stage_name: s.name, leads: [] };
      return acc;
    }, {});

    for (const lead of leadsRes.rows) {
      const sid = lead.stage_id || stages[0]?.id;
      if (leadsByStage[sid]) leadsByStage[sid].leads.push(lead);
    }

    res.json({
      columns: stages.map((s) => ({
        stage_id: s.id,
        stage_name: s.name,
        leads: leadsByStage[s.id]?.leads ?? []
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getMeta(req, res) {
  try {
    const org = orgId(req);
    const [stagesRes, usersRes] = await Promise.all([
      pool.query(
        `SELECT id, name, position, is_closed, code FROM pipeline_stages
         WHERE organization_id = $1 ORDER BY position ASC`,
        [org]
      ),
      pool.query(
        `SELECT id, email FROM users WHERE organization_id = $1 ORDER BY email`,
        [org]
      )
    ]);
    res.json({
      stages: stagesRes.rows,
      users: usersRes.rows
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function assertLeadUpdateAccess(req, leadRow) {
  const uid = userId(req);
  const perms = await getUserPermissions({
    userId: uid,
    organizationId: orgId(req)
  });
  const canAll = perms.has("lead.update.all");
  const canSelf = perms.has("lead.update.self");
  if (canAll) return true;
  const assignee = leadRow.assigned_salesperson_user_id ?? leadRow.assigned_to;
  if (canSelf && assignee === uid) return true;
  return false;
}

/** PATCH — archivage soft (status ARCHIVED + archived_at) */
export async function patchArchive(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;
    const r = await pool.query(
      `SELECT id, assigned_to, assigned_salesperson_user_id, archived_at, status, client_id
       FROM leads WHERE id = $1 AND organization_id = $2`,
      [id, org]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Lead non trouvé" });
    const lead = r.rows[0];
    if (lead.archived_at) return res.status(400).json({ error: "Lead déjà archivé" });
    if (lead.status === "ARCHIVED") return res.status(400).json({ error: "Lead déjà archivé" });

    if (!(await assertLeadUpdateAccess(req, lead))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const now = new Date();
    const u = await pool.query(
      `UPDATE leads SET
         archived_at = $1,
         archived_by = $2,
         status = 'ARCHIVED',
         archived = true,
         archived_reason = COALESCE(archived_reason, 'MANUAL'),
         updated_at = NOW()
       WHERE id = $3 AND organization_id = $4 AND archived_at IS NULL
       RETURNING *`,
      [now, uid, id, org]
    );
    if (u.rows.length === 0) return res.status(400).json({ error: "Archivage impossible" });
    res.json(u.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** PATCH — désarchivage (restore LEAD ou CLIENT selon client_id) */
export async function patchUnarchive(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;
    const r = await pool.query(
      `SELECT id, assigned_to, assigned_salesperson_user_id, archived_at, status, client_id
       FROM leads WHERE id = $1 AND organization_id = $2`,
      [id, org]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Lead non trouvé" });
    const lead = r.rows[0];
    if (!lead.archived_at) return res.status(400).json({ error: "Lead non archivé" });

    if (!(await assertLeadUpdateAccess(req, lead))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const nextStatus = lead.client_id ? "CLIENT" : "LEAD";
    const u = await pool.query(
      `UPDATE leads SET
         archived_at = NULL,
         archived_by = NULL,
         archived = false,
         archived_reason = NULL,
         status = $1,
         updated_at = NOW()
       WHERE id = $2 AND organization_id = $3 AND archived_at IS NOT NULL
       RETURNING *`,
      [nextStatus, id, org]
    );
    if (u.rows.length === 0) return res.status(400).json({ error: "Désarchivage impossible" });
    res.json(u.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** DELETE — suppression définitive (permission lead.delete) */
export async function deleteLeadHard(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;

    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    if (!perms.has("lead.delete")) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const r = await pool.query(
      `SELECT id FROM leads WHERE id = $1 AND organization_id = $2`,
      [id, org]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Lead non trouvé" });

    const dep = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM quotes WHERE lead_id = $1 LIMIT 1) AS has_quote`,
      [id]
    );
    if (dep.rows[0]?.has_quote) {
      return res.status(400).json({
        error: "Impossible de supprimer un lead avec des données devis / financières"
      });
    }

    await pool.query(`DELETE FROM leads WHERE id = $1 AND organization_id = $2`, [id, org]);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function getDefaultStageId(orgId) {
  const r = await pool.query(
    "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
    [orgId]
  );
  if (r.rows.length === 0) throw new Error("Aucun stage pipeline configuré");
  return r.rows[0].id;
}
