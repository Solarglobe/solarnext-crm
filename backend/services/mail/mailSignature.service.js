/**
 * CP-080 — Signatures mail : scopes org / utilisateur / compte, priorité compte > user > org.
 */

import { pool } from "../../config/db.js";
import { getAccessibleMailAccountIds } from "../mailAccess.service.js";

const SOLARGLOBE_ROBUST_SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:12px;line-height:1.4;max-width:640px;">
  <tbody>
    <tr>
      <td width="148" style="vertical-align:middle;padding:0 16px 0 0;width:148px;">
        <img src="https://solarnext-crm.fr/assets/branding/logo-solarglobe-rect-pdf.png" width="142" height="46" alt="SolarGlobe" style="display:block;border:0;outline:none;text-decoration:none;width:142px;height:auto;max-width:142px;">
      </td>
      <td width="2" bgcolor="#C39847" style="width:2px;min-width:2px;background:#C39847;font-size:0;line-height:0;">&nbsp;</td>
      <td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="vertical-align:middle;padding:0;">
        <div style="font-size:12px;color:#3f4652;line-height:1.35;margin:0 0 8px 0;">Bureau d'etude &amp; coordination photovoltaique</div>
        <div style="font-size:15px;line-height:1.35;color:#111827;margin:0 0 8px 0;">
          <strong>Benoit LETREN</strong> <span style="color:#C39847;">- President</span>
        </div>
        <div style="font-size:12px;line-height:1.65;color:#1f2933;margin:0;">
          <span style="color:#C39847;">Tel.</span> <a href="tel:+33669188403" style="color:#1f2933 !important;text-decoration:none !important;"><span style="color:#1f2933;text-decoration:none;">06 69 18 84 03</span></a>
          &nbsp;&nbsp;<span style="color:#C39847;">Email</span> <a href="mailto:contact@solarglobe.fr" style="color:#1f2933 !important;text-decoration:none !important;"><span style="color:#1f2933;text-decoration:none;">contact@solarglobe.fr</span></a><br>
          <span style="color:#C39847;">Web</span> <a href="https://www.solarglobe.fr" style="color:#1f2933 !important;text-decoration:none !important;"><span style="color:#1f2933;text-decoration:none;">www.solarglobe.fr</span></a>
          &nbsp;&nbsp;<span style="color:#C39847;">Social</span>&nbsp;
          <a href="https://www.facebook.com/people/Solarglobe/61578264284164/" style="color:#1f2933 !important;text-decoration:none !important;white-space:nowrap;"><img src="https://solarnext-crm.fr/assets/branding/facebook-signature.png" width="14" height="14" alt="Facebook" style="display:inline-block;border:0;vertical-align:-2px;width:14px;height:14px;"></a>
          <span style="color:#c8a35a;">&nbsp;|&nbsp;</span>
          <a href="https://www.instagram.com/solarglobe.fr/" style="color:#1f2933 !important;text-decoration:none !important;white-space:nowrap;"><img src="https://solarnext-crm.fr/assets/branding/instagram-signature.png" width="14" height="14" alt="Instagram" style="display:inline-block;border:0;vertical-align:-2px;width:14px;height:14px;"></a>
        </div>
        <div style="margin-top:8px;font-size:11px;line-height:1.35;color:#667085;">Solutions photovoltaiques haut rendement - Ile-de-France</div>
      </td>
    </tr>
  </tbody>
</table>
`.trim();

export function hardenSignatureHtml(html) {
  const raw = String(html || "");
  if (!raw.trim()) return "";
  const hasFragileRemoteAsset = /placehold\.co|icons8\.com|logo-solarglobe-rect\.png/i.test(raw);
  const hasLegacySolarGlobeContent = /Nicolas\s+BRUNET|01\s*72\s*99\s*47\s*53/i.test(raw);
  const looksLikeSolarGlobeSignature = /solarglobe|contact@solarglobe\.fr|01\s*72\s*99\s*47\s*53|06\s*69\s*18\s*84\s*03/i.test(raw);
  if ((hasFragileRemoteAsset || hasLegacySolarGlobeContent) && looksLikeSolarGlobeSignature) return SOLARGLOBE_ROBUST_SIGNATURE_HTML;
  return raw;
}

function normalizeSignatureRow(row) {
  if (!row) return row;
  return {
    ...row,
    signature_html: hardenSignatureHtml(row.signature_html),
    scope: scopeFromRow(row),
  };
}

/** @param {string} html */
export function sanitizeSignatureHtml(html) {
  if (html == null || typeof html !== "string") return "";
  let s = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  s = s.replace(/\s(on\w+|javascript:)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return hardenSignatureHtml(s).trim();
}

/**
 * @param {{ mail_account_id: string | null, user_id: string | null }} row
 */
export function scopeFromRow(row) {
  if (row.mail_account_id) return "account";
  if (row.user_id) return "user";
  return "organization";
}

/**
 * @param {{ mail_account_id: string | null, user_id: string | null }} row
 * @param {string | null | undefined} mailAccountId
 */
export function signaturePriority(row, mailAccountId) {
  if (row.mail_account_id && mailAccountId && row.mail_account_id === mailAccountId) return 3;
  if (row.user_id && !row.mail_account_id) return 2;
  if (!row.user_id && !row.mail_account_id) return 1;
  return 0;
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} organizationId
 * @param {{ user_id: string | null, mail_account_id: string | null }} scope
 */
async function clearDefaultInScope(client, organizationId, scope) {
  const { user_id, mail_account_id } = scope;
  if (mail_account_id) {
    await client.query(
      `UPDATE mail_signatures SET is_default = false, updated_at = now()
       WHERE organization_id = $1 AND mail_account_id = $2`,
      [organizationId, mail_account_id]
    );
    return;
  }
  if (user_id) {
    await client.query(
      `UPDATE mail_signatures SET is_default = false, updated_at = now()
       WHERE organization_id = $1 AND user_id = $2 AND mail_account_id IS NULL`,
      [organizationId, user_id]
    );
    return;
  }
  await client.query(
    `UPDATE mail_signatures SET is_default = false, updated_at = now()
     WHERE organization_id = $1 AND user_id IS NULL AND mail_account_id IS NULL`,
    [organizationId]
  );
}

/**
 * @param {{ userId: string, organizationId: string, mailAccountId?: string | null, forSettings?: boolean }} p
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function getAvailableSignatures(p) {
  const { userId, organizationId, mailAccountId, forSettings = false } = p;
  const accIds = await getAccessibleMailAccountIds({ userId, organizationId });
  const accList = [...accIds];

  const r = await pool.query(
    `SELECT *
     FROM mail_signatures
     WHERE organization_id = $1
       AND is_active = true
       AND (
         (user_id IS NULL AND mail_account_id IS NULL)
         OR (user_id = $2 AND mail_account_id IS NULL)
         OR (mail_account_id IS NOT NULL AND mail_account_id = ANY($3::uuid[]))
       )
     ORDER BY updated_at DESC`,
    [organizationId, userId, accList]
  );

  let rows = r.rows;
  if (!forSettings) {
    if (mailAccountId) {
      rows = rows.filter((row) => {
        if (!row.mail_account_id) return true;
        return row.mail_account_id === mailAccountId;
      });
    } else {
      rows = rows.filter((row) => !row.mail_account_id);
    }
  }

  rows.sort((a, b) => {
    const pa = signaturePriority(a, mailAccountId);
    const pb = signaturePriority(b, mailAccountId);
    if (pb !== pa) return pb - pa;
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return rows.map(normalizeSignatureRow);
}

/**
 * @param {{ userId: string, organizationId: string, mailAccountId?: string | null }} p
 */
export async function getDefaultSignature(p) {
  const { userId, organizationId, mailAccountId } = p;
  const accIds = await getAccessibleMailAccountIds({ userId, organizationId });
  const canUseAccount = mailAccountId && accIds.has(mailAccountId);

  async function pickWithDefault(mailAcc, userScope, orgScope) {
    if (mailAcc) {
      const r1 = await pool.query(
        `SELECT * FROM mail_signatures
         WHERE organization_id = $1 AND is_active = true AND mail_account_id = $2 AND is_default = true
         LIMIT 1`,
        [organizationId, mailAcc]
      );
      if (r1.rows[0]) return r1.rows[0];
    }
    if (userScope) {
      const r2 = await pool.query(
        `SELECT * FROM mail_signatures
         WHERE organization_id = $1 AND is_active = true AND user_id = $2 AND mail_account_id IS NULL AND is_default = true
         LIMIT 1`,
        [organizationId, userId]
      );
      if (r2.rows[0]) return r2.rows[0];
    }
    const r3 = await pool.query(
      `SELECT * FROM mail_signatures
       WHERE organization_id = $1 AND is_active = true AND user_id IS NULL AND mail_account_id IS NULL AND is_default = true
       LIMIT 1`,
      [organizationId]
    );
    return r3.rows[0] || null;
  }

  async function pickFallback(mailAcc) {
    if (mailAcc) {
      const r1 = await pool.query(
        `SELECT * FROM mail_signatures
         WHERE organization_id = $1 AND is_active = true AND mail_account_id = $2
         ORDER BY updated_at DESC
         LIMIT 1`,
        [organizationId, mailAcc]
      );
      if (r1.rows[0]) return r1.rows[0];
    }
    const r2 = await pool.query(
      `SELECT * FROM mail_signatures
       WHERE organization_id = $1 AND is_active = true AND user_id = $2 AND mail_account_id IS NULL
       ORDER BY updated_at DESC
       LIMIT 1`,
      [organizationId, userId]
    );
    if (r2.rows[0]) return r2.rows[0];
    const r3 = await pool.query(
      `SELECT * FROM mail_signatures
       WHERE organization_id = $1 AND is_active = true AND user_id IS NULL AND mail_account_id IS NULL
       ORDER BY updated_at DESC
       LIMIT 1`,
      [organizationId]
    );
    return r3.rows[0] || null;
  }

  const primaryAccount = canUseAccount ? mailAccountId : null;
  let row =
    (await pickWithDefault(primaryAccount, true, true)) || (await pickFallback(primaryAccount));
  if (!row) return null;
  return normalizeSignatureRow(row);
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} q
 * @param {string} id
 * @param {string} organizationId
 */
async function getSignatureById(q, id, organizationId) {
  const r = await q.query(`SELECT * FROM mail_signatures WHERE id = $1 AND organization_id = $2`, [
    id,
    organizationId,
  ]);
  return r.rows[0] || null;
}

/**
 * @param {{
 *   organizationId: string,
 *   userId: string,
 *   kind: 'organization' | 'user' | 'account',
 *   name: string,
 *   signatureHtml: string,
 *   mailAccountId?: string | null,
 *   isDefault?: boolean,
 * }} p
 */
export async function createSignature(p) {
  const {
    organizationId,
    userId,
    kind,
    name,
    signatureHtml,
    mailAccountId = null,
    isDefault = false,
  } = p;
  const html = sanitizeSignatureHtml(signatureHtml);
  if (!name?.trim()) {
    const err = new Error("name requis");
    err.code = "VALIDATION";
    throw err;
  }
  if (!html) {
    const err = new Error("signature_html requis");
    err.code = "VALIDATION";
    throw err;
  }

  let rowUserId = null;
  let rowMailAccountId = null;
  if (kind === "organization") {
    rowUserId = null;
    rowMailAccountId = null;
  } else if (kind === "user") {
    rowUserId = userId;
    rowMailAccountId = null;
  } else if (kind === "account") {
    rowUserId = null;
    rowMailAccountId = mailAccountId || null;
    if (!rowMailAccountId) {
      const err = new Error("mailAccountId requis pour une signature compte");
      err.code = "VALIDATION";
      throw err;
    }
  } else {
    const err = new Error("kind invalide");
    err.code = "VALIDATION";
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isDefault) {
      await clearDefaultInScope(client, organizationId, {
        user_id: rowUserId,
        mail_account_id: rowMailAccountId,
      });
    }
    const ins = await client.query(
      `INSERT INTO mail_signatures (
         organization_id, user_id, mail_account_id, name, signature_html, is_default, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING *`,
      [organizationId, rowUserId, rowMailAccountId, name.trim(), html, !!isDefault]
    );
    await client.query("COMMIT");
    const row = ins.rows[0];
    return normalizeSignatureRow(row);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {{
 *   signatureId: string,
 *   organizationId: string,
 *   name?: string,
 *   signatureHtml?: string,
 *   isActive?: boolean,
 * }} p
 */
export async function updateSignature(p) {
  const { signatureId, organizationId, name, signatureHtml, isActive } = p;
  const row = await getSignatureById(pool, signatureId, organizationId);
  if (!row) {
    const err = new Error("Signature introuvable");
    err.code = "NOT_FOUND";
    throw err;
  }
  const patches = [];
  const vals = [];
  let n = 1;
  if (name !== undefined) {
    patches.push(`name = $${n++}`);
    vals.push(String(name).trim());
  }
  if (signatureHtml !== undefined) {
    const h = sanitizeSignatureHtml(signatureHtml);
    if (!h) {
      const err = new Error("signature_html invalide");
      err.code = "VALIDATION";
      throw err;
    }
    patches.push(`signature_html = $${n++}`);
    vals.push(h);
  }
  if (isActive !== undefined) {
    patches.push(`is_active = $${n++}`);
    vals.push(!!isActive);
  }
  if (patches.length === 0) {
    return normalizeSignatureRow(row);
  }
  patches.push(`updated_at = now()`);
  vals.push(signatureId, organizationId);
  const q = `UPDATE mail_signatures SET ${patches.join(", ")} WHERE id = $${n++} AND organization_id = $${n} RETURNING *`;
  const r = await pool.query(q, vals);
  const out = r.rows[0];
  return normalizeSignatureRow(out);
}

/**
 * Désactivation (DELETE logique).
 * @param {{ signatureId: string, organizationId: string }} p
 */
export async function deleteSignature(p) {
  const { signatureId, organizationId } = p;
  return updateSignature({ signatureId, organizationId, isActive: false });
}

/**
 * @param {{ signatureId: string, organizationId: string, userId: string }} p
 */
export async function setDefaultSignature(p) {
  const { signatureId, organizationId, userId } = p;
  const row = await getSignatureById(pool, signatureId, organizationId);
  if (!row || !row.is_active) {
    const err = new Error("Signature introuvable ou inactive");
    err.code = "NOT_FOUND";
    throw err;
  }

  const scope = scopeFromRow(row);
  if (scope === "organization") {
    /* réservé admin — vérifié par la route */
  } else if (scope === "user" && row.user_id !== userId) {
    const err = new Error("Interdit");
    err.code = "FORBIDDEN";
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await clearDefaultInScope(client, organizationId, {
      user_id: row.user_id,
      mail_account_id: row.mail_account_id,
    });
    await client.query(
      `UPDATE mail_signatures SET is_default = true, updated_at = now() WHERE id = $1 AND organization_id = $2`,
      [signatureId, organizationId]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const out = await getSignatureById(pool, signatureId, organizationId);
  return normalizeSignatureRow(out);
}

export { getSignatureById };
