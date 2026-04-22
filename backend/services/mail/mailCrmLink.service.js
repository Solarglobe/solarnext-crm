/**
 * CP-074 — Rattachement CRM automatique (clients / leads) pour le mail.
 *
 * Priorité : email client exact → email lead (ou lead déjà converti → client) → domaine entreprise (hors webmails).
 * Pas d’écrasement automatique d’un client déjà posé sur le fil ; upgrade lead → client autorisé.
 */

import { pool } from "../../config/db.js";
import { emitEventAsync } from "../core/eventBus.service.js";

/** Domaines grand public : pas de matching « entreprise » par domaine. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "laposte.net",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
]);

/**
 * @param {string | null | undefined} email
 */
export function normalizeEmailForLookup(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} email
 * @returns {string | null}
 */
export function extractDomainFromEmail(email) {
  const n = normalizeEmailForLookup(email);
  const at = n.lastIndexOf("@");
  if (at < 1 || at === n.length - 1) return null;
  return n.slice(at + 1);
}

/**
 * @param {Array<{ email?: string | null }>} participants
 * @param {string} accountEmail
 * @returns {string[]}
 */
export function extractRelevantEmailsFromParticipants(participants, accountEmail) {
  const acc = normalizeEmailForLookup(accountEmail);
  const out = new Set();
  for (const p of participants || []) {
    const e = normalizeEmailForLookup(p?.email);
    if (!e || !e.includes("@")) continue;
    if (e === acc) continue;
    out.add(e);
  }
  return [...out].sort();
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, email: string }} p
 */
export async function findClientByEmail(client, p) {
  const e = normalizeEmailForLookup(p.email);
  if (!e.includes("@")) return null;
  const r = await client.query(
    `SELECT id FROM clients
     WHERE organization_id = $1 AND LOWER(TRIM(email)) = $2
       AND (archived_at IS NULL)
     LIMIT 2`,
    [p.organizationId, e]
  );
  if (r.rows.length !== 1) return null;
  return { id: r.rows[0].id };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, email: string }} p
 * @returns {Promise<{ id: string, client_id: string | null } | null>}
 */
export async function findLeadRowByEmail(client, p) {
  const e = normalizeEmailForLookup(p.email);
  if (!e.includes("@")) return null;
  const r = await client.query(
    `SELECT id, client_id FROM leads
     WHERE organization_id = $1 AND LOWER(TRIM(email)) = $2
       AND (archived_at IS NULL)
     LIMIT 3`,
    [p.organizationId, e]
  );
  if (r.rows.length !== 1) return null;
  return { id: r.rows[0].id, client_id: r.rows[0].client_id ?? null };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, email: string }} p
 */
export async function findClientByDomain(client, p) {
  const domain = extractDomainFromEmail(p.email);
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) return null;

  const r = await client.query(
    `SELECT id FROM clients
     WHERE organization_id = $1
       AND (archived_at IS NULL)
       AND company_domain IS NOT NULL
       AND TRIM(company_domain) <> ''
       AND LOWER(TRIM(company_domain)) = $2
     LIMIT 2`,
    [p.organizationId, domain]
  );
  if (r.rows.length !== 1) return null;
  return { id: r.rows[0].id };
}

/**
 * @typedef {'CLIENT_EMAIL' | 'LEAD_EMAIL' | 'DOMAIN' | 'NONE'} CrmLinkResolution
 */

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, participants: Array<{ email?: string | null }>, accountEmail: string }} p
 * @returns {Promise<{ clientId: string | null, leadId: string | null, resolution: CrmLinkResolution }>}
 */
export async function resolveCrmLinkForMessage(client, p) {
  const { organizationId, participants, accountEmail } = p;
  const external = extractRelevantEmailsFromParticipants(participants, accountEmail);
  if (external.length === 0) {
    return { clientId: null, leadId: null, resolution: "NONE" };
  }

  const clientIds = new Set();
  for (const em of external) {
    const c = await findClientByEmail(client, { organizationId, email: em });
    if (c?.id) clientIds.add(c.id);
  }
  if (clientIds.size > 1) {
    return { clientId: null, leadId: null, resolution: "NONE" };
  }
  if (clientIds.size === 1) {
    return { clientId: [...clientIds][0], leadId: null, resolution: "CLIENT_EMAIL" };
  }

  const leadIds = new Set();
  let upgradedClientId = null;
  for (const em of external) {
    const row = await findLeadRowByEmail(client, { organizationId, email: em });
    if (!row) continue;
    if (row.client_id) {
      upgradedClientId = row.client_id;
      break;
    }
    leadIds.add(row.id);
  }
  if (upgradedClientId) {
    return { clientId: upgradedClientId, leadId: null, resolution: "CLIENT_EMAIL" };
  }
  if (leadIds.size > 1) {
    return { clientId: null, leadId: null, resolution: "NONE" };
  }
  if (leadIds.size === 1) {
    return { clientId: null, leadId: [...leadIds][0], resolution: "LEAD_EMAIL" };
  }

  const domainClientIds = new Set();
  for (const em of external) {
    const cd = await findClientByDomain(client, { organizationId, email: em });
    if (cd?.id) domainClientIds.add(cd.id);
  }
  if (domainClientIds.size === 1) {
    return { clientId: [...domainClientIds][0], leadId: null, resolution: "DOMAIN" };
  }
  if (domainClientIds.size > 1) {
    return { clientId: null, leadId: null, resolution: "NONE" };
  }

  return { clientId: null, leadId: null, resolution: "NONE" };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   threadId: string,
 *   clientId: string | null,
 *   leadId: string | null,
 *   force?: boolean,
 * }} p
 */
export async function applyCrmLinkToThread(client, p) {
  const { threadId, force = false } = p;
  let { clientId, leadId } = p;

  const th = await client.query(`SELECT organization_id, client_id, lead_id FROM mail_threads WHERE id = $1`, [threadId]);
  if (!th.rows.length) return { applied: false, reason: "thread_not_found" };

  const curC = th.rows[0].client_id;
  const curL = th.rows[0].lead_id;

  if (force) {
    await client.query(
      `UPDATE mail_threads SET client_id = $2, lead_id = $3, updated_at = now() WHERE id = $1`,
      [threadId, clientId ?? null, leadId ?? null]
    );
    await client.query(
      `UPDATE mail_messages SET client_id = $2, lead_id = $3 WHERE mail_thread_id = $1`,
      [threadId, clientId ?? null, leadId ?? null]
    );
    return { applied: true, mode: "force" };
  }

  if (curC) {
    await client.query(
      `UPDATE mail_messages SET client_id = $2, lead_id = NULL
       WHERE mail_thread_id = $1 AND (client_id IS DISTINCT FROM $2 OR lead_id IS NOT NULL)`,
      [threadId, curC]
    );
    return { applied: false, reason: "client_locked", keptClientId: curC };
  }

  if (clientId) {
    await client.query(
      `UPDATE mail_threads SET client_id = $2, lead_id = NULL, updated_at = now() WHERE id = $1`,
      [threadId, clientId]
    );
    await client.query(
      `UPDATE mail_messages SET client_id = $2, lead_id = NULL WHERE mail_thread_id = $1`,
      [threadId, clientId]
    );
    return { applied: true, mode: "auto_client" };
  }

  if (leadId) {
    if (curL && curL !== leadId) {
      return { applied: false, reason: "lead_conflict" };
    }
    await client.query(
      `UPDATE mail_threads SET lead_id = $2, updated_at = now() WHERE id = $1`,
      [threadId, leadId]
    );
    await client.query(
      `UPDATE mail_messages SET lead_id = $2 WHERE mail_thread_id = $1`,
      [threadId, leadId]
    );
    return { applied: true, mode: "auto_lead" };
  }

  return { applied: false, reason: "nothing_to_apply" };
}

/**
 * @param {{ messageId: string, dbClient?: import('pg').PoolClient }} p
 */
export async function syncCrmLinkForNewMessage(p) {
  const { messageId, dbClient } = p;
  const runner = dbClient ?? (await pool.connect());
  const ownClient = !dbClient;
  try {
    if (ownClient) await runner.query("BEGIN");

    const msg = await runner.query(
      `SELECT m.id, m.organization_id, m.mail_thread_id, ma.email AS account_email
       FROM mail_messages m
       INNER JOIN mail_accounts ma ON ma.id = m.mail_account_id
       WHERE m.id = $1`,
      [messageId]
    );
    if (!msg.rows[0]) {
      if (ownClient) await runner.query("ROLLBACK");
      return { ok: false, reason: "message_not_found" };
    }

    const { organization_id: organizationId, mail_thread_id: threadId, account_email: accountEmail } = msg.rows[0];

    const parts = await runner.query(
      `SELECT email, email_normalized FROM mail_participants WHERE mail_message_id = $1`,
      [messageId]
    );

    const resolved = await resolveCrmLinkForMessage(runner, {
      organizationId,
      participants: parts.rows,
      accountEmail,
    });

    if (!resolved.clientId && !resolved.leadId) {
      if (ownClient) await runner.query("COMMIT");
      return { ...resolved, ok: true };
    }

    const applyResult = await applyCrmLinkToThread(runner, {
      threadId,
      clientId: resolved.clientId,
      leadId: resolved.leadId,
      force: false,
    });

    if (ownClient) await runner.query("COMMIT");

    if (applyResult.applied) {
      emitEventAsync("THREAD_LINKED_TO_CLIENT", {
        organizationId,
        messageId,
        threadId,
        clientId: resolved.clientId,
        leadId: resolved.leadId,
        resolution: resolved.resolution,
        mode: applyResult.mode,
      });
    }

    return { ...resolved, ok: true };
  } catch (e) {
    if (ownClient) await runner.query("ROLLBACK");
    throw e;
  } finally {
    if (ownClient) runner.release();
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ threadId: string, clientId: string | null, leadId: string | null }} p
 */
export async function manualOverrideThreadCrmLink(client, p) {
  const { threadId, clientId, leadId } = p;
  return applyCrmLinkToThread(client, { threadId, clientId, leadId, force: true });
}

/** Alias explicite (spec CP-074) — même logique que `findLeadRowByEmail`. */
export { findLeadRowByEmail as findLeadByEmail };
