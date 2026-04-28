/**
 * Backfill CLIENT leads sans client_id.
 *
 * Cible:
 * - leads.status = 'CLIENT'
 * - leads.client_id IS NULL
 * - leads.archived_at IS NULL
 *
 * Modes:
 * - DRY-RUN par défaut (aucune écriture)
 * - --apply pour exécuter les écritures
 *
 * Usage:
 *   node backend/scripts/backfill-client-ids-for-client-leads.mjs
 *   node backend/scripts/backfill-client-ids-for-client-leads.mjs --apply
 */

import "../config/register-local-env.js";
import { pool } from "../config/db.js";
import { createClientAndLinkLead } from "../services/leadClientConversion.service.js";

const APPLY = process.argv.includes("--apply");

function s(v) {
  return v != null ? String(v).trim() : "";
}

function normLower(v) {
  return s(v).toLowerCase();
}

async function listTargetLeads() {
  const r = await pool.query(
    `SELECT id, organization_id, full_name, first_name, last_name, email, phone, phone_mobile
     FROM leads
     WHERE UPPER(COALESCE(status, '')) = 'CLIENT'
       AND client_id IS NULL
       AND archived_at IS NULL
     ORDER BY organization_id, updated_at DESC NULLS LAST, id`
  );
  return r.rows;
}

async function findExistingClientForLead(client, lead) {
  const email = normLower(lead.email);
  if (email) {
    const byEmail = await client.query(
      `SELECT id
       FROM clients
       WHERE organization_id = $1
         AND archived_at IS NULL
         AND LOWER(TRIM(email)) = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [lead.organization_id, email]
    );
    if (byEmail.rows[0]?.id) {
      return { id: byEmail.rows[0].id, source: "email" };
    }
  }

  const phones = [];
  const pm = s(lead.phone_mobile);
  const p = s(lead.phone);
  if (pm) phones.push(pm);
  if (p && p !== pm) phones.push(p);

  for (const phone of phones) {
    const byPhone = await client.query(
      `SELECT id
       FROM clients
       WHERE organization_id = $1
         AND archived_at IS NULL
         AND (
           (NULLIF(TRIM(phone), '') IS NOT NULL AND TRIM(phone) = $2)
           OR (NULLIF(TRIM(mobile), '') IS NOT NULL AND TRIM(mobile) = $2)
         )
       ORDER BY created_at ASC
       LIMIT 1`,
      [lead.organization_id, phone]
    );
    if (byPhone.rows[0]?.id) {
      return { id: byPhone.rows[0].id, source: "phone" };
    }
  }

  return null;
}

async function countQuotesToUpdate(client, leadId, orgId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM quotes
     WHERE organization_id = $1
       AND lead_id = $2
       AND client_id IS NULL`,
    [orgId, leadId]
  );
  return Number(r.rows[0]?.c || 0);
}

async function attachLeadAndQuotes(client, leadId, orgId, clientId) {
  await client.query(
    `UPDATE leads
     SET client_id = $1, status = 'CLIENT', updated_at = now()
     WHERE id = $2 AND organization_id = $3 AND archived_at IS NULL`,
    [clientId, leadId, orgId]
  );
  const uq = await client.query(
    `UPDATE quotes
     SET client_id = $1, updated_at = now()
     WHERE organization_id = $2
       AND lead_id = $3
       AND client_id IS NULL`,
    [clientId, orgId, leadId]
  );
  return Number(uq.rowCount || 0);
}

async function processLead(lead) {
  const who = `${lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "—"}`;
  const email = s(lead.email) || "—";
  const phone = s(lead.phone_mobile) || s(lead.phone) || "—";

  if (!APPLY) {
    const dryClient = await pool.connect();
    try {
      const existing = await findExistingClientForLead(dryClient, lead);
      const quotesCount = await countQuotesToUpdate(dryClient, lead.id, lead.organization_id);
      const action = existing ? "LINK_EXISTING_CLIENT" : "CREATE_CLIENT";
      console.log(
        `[DRY_RUN] lead_id=${lead.id} name="${who}" email="${email}" phone="${phone}" action=${action} client_id=${existing?.id || "NEW"} quotes_updated=${quotesCount}`
      );
      return { processed: 1, linked_existing: existing ? 1 : 0, created_clients: existing ? 0 : 1, quotes_updated: 0, skipped: 0, errors: 0 };
    } catch (e) {
      console.error(
        `[DRY_RUN] lead_id=${lead.id} name="${who}" email="${email}" phone="${phone}" action=ERROR client_id=— quotes_updated=0 error=${e?.message || e}`
      );
      return { processed: 1, linked_existing: 0, created_clients: 0, quotes_updated: 0, skipped: 0, errors: 1 };
    } finally {
      dryClient.release();
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockRes = await client.query(
      `SELECT id, organization_id, status, client_id, archived_at, full_name, first_name, last_name, email, phone, phone_mobile
       FROM leads
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [lead.id, lead.organization_id]
    );
    const locked = lockRes.rows[0];
    if (!locked || locked.archived_at != null) {
      await client.query("ROLLBACK");
      console.log(
        `[APPLY] lead_id=${lead.id} name="${who}" email="${email}" phone="${phone}" action=SKIP client_id=— quotes_updated=0`
      );
      return { processed: 1, linked_existing: 0, created_clients: 0, quotes_updated: 0, skipped: 1, errors: 0 };
    }
    if (String(locked.status || "").toUpperCase() !== "CLIENT") {
      await client.query("ROLLBACK");
      console.log(
        `[APPLY] lead_id=${lead.id} name="${who}" email="${email}" phone="${phone}" action=SKIP client_id=— quotes_updated=0`
      );
      return { processed: 1, linked_existing: 0, created_clients: 0, quotes_updated: 0, skipped: 1, errors: 0 };
    }
    if (locked.client_id) {
      await client.query("ROLLBACK");
      console.log(
        `[APPLY] lead_id=${lead.id} name="${who}" email="${email}" phone="${phone}" action=SKIP client_id=${locked.client_id} quotes_updated=0`
      );
      return { processed: 1, linked_existing: 0, created_clients: 0, quotes_updated: 0, skipped: 1, errors: 0 };
    }

    const existing = await findExistingClientForLead(client, locked);
    if (existing?.id) {
      const quotesUpdated = await attachLeadAndQuotes(client, locked.id, locked.organization_id, existing.id);
      await client.query("COMMIT");
      console.log(
        `[APPLY] lead_id=${locked.id} name="${who}" email="${email}" phone="${phone}" action=LINK_EXISTING_CLIENT client_id=${existing.id} quotes_updated=${quotesUpdated}`
      );
      return { processed: 1, linked_existing: 1, created_clients: 0, quotes_updated: quotesUpdated, skipped: 0, errors: 0 };
    }

    const { client: newClient } = await createClientAndLinkLead(client, locked, locked.organization_id, {});
    const quotesUpdated = await attachLeadAndQuotes(client, locked.id, locked.organization_id, newClient.id);
    await client.query("COMMIT");
    console.log(
      `[APPLY] lead_id=${locked.id} name="${who}" email="${email}" phone="${phone}" action=CREATE_CLIENT client_id=${newClient.id} quotes_updated=${quotesUpdated}`
    );
    return { processed: 1, linked_existing: 0, created_clients: 1, quotes_updated: quotesUpdated, skipped: 0, errors: 0 };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(
      `[APPLY] lead_id=${lead.id} name="${who}" email="${email}" phone="${phone}" action=ERROR client_id=— quotes_updated=0 error=${e?.message || e}`
    );
    return { processed: 1, linked_existing: 0, created_clients: 0, quotes_updated: 0, skipped: 0, errors: 1 };
  } finally {
    client.release();
  }
}

function addStats(total, delta) {
  total.processed += delta.processed;
  total.linked_existing += delta.linked_existing;
  total.created_clients += delta.created_clients;
  total.quotes_updated += delta.quotes_updated;
  total.skipped += delta.skipped;
  total.errors += delta.errors;
}

async function main() {
  console.log(
    "DATABASE_URL source:",
    process.env.DATABASE_URL?.includes("railway") ? "RAILWAY" : "LOCAL"
  );
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL absent.");
  }
  console.log(`[backfill-client-ids-for-client-leads] mode=${APPLY ? "APPLY" : "DRY_RUN"}`);
  const targets = await listTargetLeads();
  console.log(`[backfill-client-ids-for-client-leads] targets=${targets.length}`);

  const stats = {
    processed: 0,
    linked_existing: 0,
    created_clients: 0,
    quotes_updated: 0,
    skipped: 0,
    errors: 0,
  };

  for (const lead of targets) {
    const delta = await processLead(lead);
    addStats(stats, delta);
  }

  console.log(
    `[backfill-client-ids-for-client-leads] summary processed=${stats.processed} linked_existing=${stats.linked_existing} created_clients=${stats.created_clients} quotes_updated=${stats.quotes_updated} skipped=${stats.skipped} errors=${stats.errors}`
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});

