import { pool } from "../../config/db.js";
import { createAutomatedTask } from "./tasks.service.js";
import logger from "../../app/core/logger.js";

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function leadAssignee(row, fallbackUserId = null) {
  return row.assigned_user_id || fallbackUserId || row.created_by || null;
}

export async function createQuoteSentFollowUpTasks({ organizationId, quoteId, userId = null }) {
  const { rows } = await pool.query(
    `SELECT q.id, q.organization_id, q.lead_id, q.client_id, q.sent_at, q.quote_number,
            l.assigned_user_id, l.full_name
     FROM quotes q
     LEFT JOIN leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id
     WHERE q.id = $1 AND q.organization_id = $2 AND q.status = 'SENT' AND q.archived_at IS NULL`,
    [quoteId, organizationId]
  );
  const quote = rows[0];
  if (!quote || (!quote.lead_id && !quote.client_id)) return [];
  const assigned = leadAssignee(quote, userId);
  if (!assigned) return [];

  const base = quote.sent_at || new Date().toISOString();
  const offsets = [
    { days: 2, label: "J+2", priority: "HIGH" },
    { days: 7, label: "J+7", priority: "NORMAL" },
    { days: 14, label: "J+14", priority: "NORMAL" },
  ];

  const results = [];
  for (const offset of offsets) {
    const result = await createAutomatedTask({
      organization_id: organizationId,
      lead_id: quote.lead_id,
      client_id: quote.client_id,
      assigned_user_id: assigned,
      type: "CALL",
      title: `Relance offre envoyée ${offset.label}`,
      description: `Relancer le client après l'envoi du devis ${quote.quote_number || ""}`.trim(),
      due_at: addDays(base, offset.days),
      priority: offset.priority,
      created_from: "STAGE_RULE",
      automation_key: `quote_sent:${quote.id}:${offset.days}`,
      created_by_user_id: userId || assigned,
      updated_by_user_id: userId || assigned,
    });
    results.push(result);
  }
  return results;
}

export async function createFollowUpStageTask({
  organizationId,
  leadId,
  dueAt,
  userId = null,
}) {
  const { rows } = await pool.query(
    `SELECT l.id, l.client_id, l.assigned_user_id, l.full_name
     FROM leads l
     WHERE l.id = $1 AND l.organization_id = $2 AND l.archived_at IS NULL`,
    [leadId, organizationId]
  );
  const lead = rows[0];
  if (!lead) return null;
  const assigned = leadAssignee(lead, userId);
  if (!assigned) return null;

  return createAutomatedTask({
    organization_id: organizationId,
    lead_id: lead.id,
    client_id: lead.client_id,
    assigned_user_id: assigned,
    type: "CALL",
    title: "Relance commerciale à effectuer",
    description: "Relance obligatoire liée au passage du dossier en étape FOLLOW_UP.",
    due_at: dueAt,
    priority: "HIGH",
    created_from: "STAGE_RULE",
    automation_key: `lead_follow_up:${lead.id}:${dateKey(dueAt)}`,
    created_by_user_id: userId || assigned,
    updated_by_user_id: userId || assigned,
  });
}

export async function runLeadInactivityTaskAutomation({ organizationId = null, limit = 500 } = {}) {
  const params = [];
  let whereOrg = "";
  if (organizationId) {
    params.push(organizationId);
    whereOrg = `AND l.organization_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT l.id, l.organization_id, l.client_id, l.assigned_user_id, l.full_name, l.last_activity_at
     FROM leads l
     WHERE l.archived_at IS NULL
       AND l.status <> 'CLIENT'
       AND l.last_activity_at IS NOT NULL
       AND l.last_activity_at < now() - interval '3 days'
       ${whereOrg}
     ORDER BY l.last_activity_at ASC
     LIMIT $${params.length}`,
    params
  );

  const results = [];
  for (const lead of rows) {
    if (!lead.assigned_user_id) continue;
    const inactiveSince = new Date(lead.last_activity_at).toISOString();
    const result = await createAutomatedTask({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      client_id: lead.client_id,
      assigned_user_id: lead.assigned_user_id,
      type: "CALL",
      title: "Lead inactif à relancer",
      description: `Aucune activité depuis le ${inactiveSince.slice(0, 10)}.`,
      due_at: new Date().toISOString(),
      priority: "HIGH",
      created_from: "INACTIVITY_RULE",
      automation_key: `lead_inactivity:${lead.id}:${inactiveSince}`,
      created_by_user_id: lead.assigned_user_id,
      updated_by_user_id: lead.assigned_user_id,
    });
    results.push(result);
  }
  return results;
}

export async function runMissingMissionReportAutomation({ organizationId = null, limit = 500 } = {}) {
  const params = [];
  let whereOrg = "";
  if (organizationId) {
    params.push(organizationId);
    whereOrg = `AND m.organization_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT m.id, m.organization_id, m.lead_id, m.client_id, m.title, m.end_at, m.created_by,
            COALESCE(
              (SELECT ma.user_id FROM mission_assignments ma WHERE ma.mission_id = m.id LIMIT 1),
              l.assigned_user_id,
              m.created_by
            ) AS assigned_user_id
     FROM missions m
     LEFT JOIN leads l ON l.id = m.lead_id AND l.organization_id = m.organization_id
     WHERE m.end_at < now()
       AND m.lead_id IS NOT NULL
       AND m.status NOT IN ('cancelled', 'canceled')
       ${whereOrg}
       AND NOT EXISTS (
         SELECT 1 FROM lead_activities a
         WHERE a.organization_id = m.organization_id
           AND a.lead_id = m.lead_id
           AND a.mission_id = m.id
           AND a.is_deleted IS NOT TRUE
           AND a.type IN ('NOTE', 'MEETING', 'CALL', 'EMAIL')
       )
     ORDER BY m.end_at ASC
     LIMIT $${params.length}`,
    params
  );

  const results = [];
  for (const mission of rows) {
    if (!mission.assigned_user_id) continue;
    const result = await createAutomatedTask({
      organization_id: mission.organization_id,
      lead_id: mission.lead_id,
      client_id: mission.client_id,
      assigned_user_id: mission.assigned_user_id,
      type: "ADMIN",
      title: "Compte rendu RDV à saisir",
      description: `Le RDV « ${mission.title || "sans titre"} » est passé sans note liée.`,
      due_at: new Date().toISOString(),
      priority: "HIGH",
      created_from: "PROJECT_RULE",
      automation_key: `mission_report:${mission.id}`,
      created_by_user_id: mission.created_by || mission.assigned_user_id,
      updated_by_user_id: mission.created_by || mission.assigned_user_id,
    });
    results.push(result);
  }
  return results;
}

export async function recordProjectStatusTransition({
  organizationId,
  leadId,
  fromProjectStatus,
  toProjectStatus,
  userId = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO lead_project_status_transitions (
       organization_id, lead_id, from_project_status, to_project_status, changed_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [organizationId, leadId, fromProjectStatus || null, toProjectStatus, userId]
  );
  return rows[0] || null;
}

export async function createPvFollowUpTasksForTransition(transition) {
  if (!transition) return [];
  const { rows } = await pool.query(
    `SELECT l.id, l.organization_id, l.client_id, l.assigned_user_id, l.full_name
     FROM leads l
     WHERE l.id = $1 AND l.organization_id = $2 AND l.status = 'CLIENT' AND l.archived_at IS NULL`,
    [transition.lead_id, transition.organization_id]
  );
  const lead = rows[0];
  if (!lead?.assigned_user_id) return [];

  const base = transition.changed_at;
  const rules =
    transition.to_project_status === "INSTALLATION_REALISEE"
      ? [
          {
            key: "install-j3",
            due_at: addDays(base, 3),
            title: "Appel satisfaction après installation",
            description: "Vérifier la satisfaction client à J+3 après installation réalisée.",
            priority: "HIGH",
          },
        ]
      : transition.to_project_status === "MISE_EN_SERVICE"
        ? [
            {
              key: "mes-j30",
              due_at: addDays(base, 30),
              title: "Contrôle production J+30",
              description: "Vérifier la production après mise en service.",
              priority: "HIGH",
            },
            {
              key: "mes-m3",
              due_at: addMonths(base, 3),
              title: "Point client production M+3",
              description: "Faire le point sur production, questions et usage.",
              priority: "NORMAL",
            },
            {
              key: "mes-m6",
              due_at: addMonths(base, 6),
              title: "Bilan M+6 et demande d'avis",
              description: "Faire le bilan client et demander un avis.",
              priority: "NORMAL",
            },
            {
              key: "mes-m12",
              due_at: addMonths(base, 12),
              title: "Bilan annuel et parrainage",
              description: "Bilan annuel, parrainage et opportunités batterie ou pilotage.",
              priority: "NORMAL",
            },
          ]
        : [];

  const results = [];
  for (const rule of rules) {
    const result = await createAutomatedTask({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      client_id: lead.client_id,
      assigned_user_id: lead.assigned_user_id,
      type: rule.key === "install-j3" ? "POST_INSTALL" : "PARRAINAGE",
      title: rule.title,
      description: rule.description,
      due_at: rule.due_at,
      priority: rule.priority,
      created_from: "PROJECT_RULE",
      automation_key: `pv_followup:${transition.id}:${rule.key}`,
      created_by_user_id: transition.changed_by_user_id || lead.assigned_user_id,
      updated_by_user_id: transition.changed_by_user_id || lead.assigned_user_id,
    });
    results.push(result);
  }
  return results;
}

export async function runDailyCrmTaskAutomations() {
  const startedAt = Date.now();
  try {
    const [inactivity, missionReports] = await Promise.all([
      runLeadInactivityTaskAutomation(),
      runMissingMissionReportAutomation(),
    ]);
    logger.info("CRM_TASK_AUTOMATIONS_DONE", {
      inactivity: inactivity.length,
      missionReports: missionReports.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    logger.error("CRM_TASK_AUTOMATIONS_ERROR", { error: err?.message || String(err) });
  }
}
