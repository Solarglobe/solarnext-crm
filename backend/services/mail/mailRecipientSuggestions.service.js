import { pool } from "../../config/db.js";
import { getUserPermissions } from "../../rbac/rbac.service.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function displayName(parts) {
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join(" ").trim();
}

function scoreForSource(source, usageCount = 0) {
  const base = source === "client" ? 400 : source === "contact" ? 360 : source === "lead" ? 320 : 120;
  return base + Math.min(Number(usageCount) || 0, 80);
}

function addSuggestion(map, item) {
  const email = normalizeEmail(item.email);
  if (!email || !email.includes("@")) return;
  const next = {
    email,
    name: item.name || null,
    source: item.source,
    crmId: item.crmId || null,
    score: scoreForSource(item.source, item.usageCount),
    lastUsedAt: item.lastUsedAt || null,
  };
  const prev = map.get(email);
  if (!prev || next.score > prev.score || (!prev.lastUsedAt && next.lastUsedAt)) {
    map.set(email, next);
  }
}

export async function listMailRecipientSuggestions({
  organizationId,
  userId,
  query,
  accessibleMailAccountIds,
  limit = 8,
}) {
  const q = String(query || "").trim();
  if (!organizationId || !userId || q.length < 2) return [];
  const effectiveLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const pattern = `%${q.replace(/[!%_]/g, (m) => `!${m}`)}%`;
  const perms = await getUserPermissions({ userId, organizationId });
  const canReadAllClients = perms.has("client.read.all") || perms.has("lead.read.all");
  const leadAccessSql = canReadAllClients ? "" : "AND l.assigned_user_id = $3";
  const clientAccessSql = canReadAllClients
    ? ""
    : `AND EXISTS (
         SELECT 1 FROM leads lx
         WHERE lx.organization_id = c.organization_id
           AND lx.client_id = c.id
           AND lx.assigned_user_id = $3
           AND (lx.archived_at IS NULL)
       )`;

  const params = canReadAllClients ? [organizationId, pattern] : [organizationId, pattern, userId];
  const out = new Map();

  const clients = await pool.query(
    `SELECT c.id, c.email, c.company_name, c.first_name, c.last_name, c.updated_at
     FROM clients c
     WHERE c.organization_id = $1
       AND (c.archived_at IS NULL)
       AND c.email IS NOT NULL
       AND c.email <> ''
       AND (c.email ILIKE $2 ESCAPE '!' OR c.company_name ILIKE $2 ESCAPE '!'
            OR c.first_name ILIKE $2 ESCAPE '!' OR c.last_name ILIKE $2 ESCAPE '!')
       ${clientAccessSql}
     ORDER BY c.updated_at DESC NULLS LAST
     LIMIT ${effectiveLimit}`,
    params
  );
  clients.rows.forEach((r) =>
    addSuggestion(out, {
      email: r.email,
      name: r.company_name || displayName([r.first_name, r.last_name]),
      source: "client",
      crmId: r.id,
      lastUsedAt: r.updated_at,
    })
  );

  const contacts = await pool.query(
    `SELECT cc.id, cc.email, cc.first_name, cc.last_name, cc.updated_at
     FROM client_contacts cc
     INNER JOIN clients c ON c.id = cc.client_id AND c.organization_id = cc.organization_id
     WHERE cc.organization_id = $1
       AND (c.archived_at IS NULL)
       AND cc.email IS NOT NULL
       AND cc.email <> ''
       AND (cc.email ILIKE $2 ESCAPE '!' OR cc.first_name ILIKE $2 ESCAPE '!' OR cc.last_name ILIKE $2 ESCAPE '!')
       ${clientAccessSql}
     ORDER BY cc.updated_at DESC NULLS LAST
     LIMIT ${effectiveLimit}`,
    params
  );
  contacts.rows.forEach((r) =>
    addSuggestion(out, {
      email: r.email,
      name: displayName([r.first_name, r.last_name]),
      source: "contact",
      crmId: r.id,
      lastUsedAt: r.updated_at,
    })
  );

  const leads = await pool.query(
    `SELECT l.id, l.email, l.first_name, l.last_name, l.full_name, l.company_name, l.updated_at
     FROM leads l
     WHERE l.organization_id = $1
       AND (l.archived_at IS NULL)
       AND l.email IS NOT NULL
       AND l.email <> ''
       AND (l.email ILIKE $2 ESCAPE '!' OR l.first_name ILIKE $2 ESCAPE '!'
            OR l.last_name ILIKE $2 ESCAPE '!' OR l.full_name ILIKE $2 ESCAPE '!'
            OR l.company_name ILIKE $2 ESCAPE '!')
       ${leadAccessSql}
     ORDER BY l.updated_at DESC NULLS LAST
     LIMIT ${effectiveLimit}`,
    params
  );
  leads.rows.forEach((r) =>
    addSuggestion(out, {
      email: r.email,
      name: r.full_name || displayName([r.first_name, r.last_name]) || r.company_name,
      source: "lead",
      crmId: r.id,
      lastUsedAt: r.updated_at,
    })
  );

  if (accessibleMailAccountIds?.size) {
    const participants = await pool.query(
      `SELECT lower(p.email) AS email_key, max(p.email) AS email, max(NULLIF(p.name, '')) AS name,
              count(*)::int AS usage_count, max(m.sent_at) AS last_seen_at
       FROM mail_participants p
       INNER JOIN mail_messages m
          ON m.id = p.mail_message_id
         AND m.organization_id = $1
         AND m.mail_account_id = ANY($2::uuid[])
         AND m.remote_missing_at IS NULL
         AND m.remote_deleted_at IS NULL
       WHERE p.email IS NOT NULL
         AND p.email <> ''
         AND (p.email ILIKE $3 ESCAPE '!' OR COALESCE(p.name, '') ILIKE $3 ESCAPE '!')
       GROUP BY lower(p.email)
       ORDER BY usage_count DESC, last_seen_at DESC NULLS LAST
       LIMIT $4`,
      [organizationId, Array.from(accessibleMailAccountIds), pattern, effectiveLimit]
    );
    participants.rows.forEach((r) =>
      addSuggestion(out, {
        email: r.email,
        name: r.name,
        source: "mail_participant",
        usageCount: r.usage_count,
        lastUsedAt: r.last_seen_at,
      })
    );
  }

  return Array.from(out.values())
    .sort((a, b) => b.score - a.score || String(b.lastUsedAt || "").localeCompare(String(a.lastUsedAt || "")))
    .slice(0, effectiveLimit);
}
