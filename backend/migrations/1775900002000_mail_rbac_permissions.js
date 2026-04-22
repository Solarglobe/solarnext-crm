/**
 * CP-069 — Permissions RBAC mail (module + vue globale + gestion comptes / délégations).
 * Idempotent : INSERT … ON CONFLICT, rattachement à tous les rôles (système + par org).
 */

export const shorthands = undefined;

const PERMISSIONS = [
  ["mail.use", "mail", "Accéder au module mail (API / synchro)"],
  ["mail.view.all", "mail", "Voir et envoyer depuis tous les comptes mail de l'organisation"],
  [
    "mail.accounts.manage",
    "mail",
    "Configurer les comptes IMAP/SMTP et les délégations (mail_account_permissions)",
  ],
];

/** @type {Record<string, string[]>} */
const ROLE_PERM_MAP = {
  SUPER_ADMIN: ["mail.use", "mail.view.all", "mail.accounts.manage"],
  ADMIN: ["mail.use", "mail.view.all", "mail.accounts.manage"],
  SALES_MANAGER: ["mail.use"],
  SALES: ["mail.use"],
  TECHNICIEN: [],
  ASSISTANTE: ["mail.use"],
  APPORTEUR: [],
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = async (pgm) => {
  for (const [code, module, description] of PERMISSIONS) {
    await pgm.db.query(
      `INSERT INTO rbac_permissions (code, module, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [code, module, description]
    );
  }

  const permIds = new Map();
  for (const [code] of PERMISSIONS) {
    const pr = await pgm.db.query(`SELECT id FROM rbac_permissions WHERE code = $1`, [code]);
    if (pr.rows.length > 0) permIds.set(code, pr.rows[0].id);
  }

  const rolesRes = await pgm.db.query(
    `SELECT id, code FROM rbac_roles WHERE code = ANY($1::text[])`,
    [Object.keys(ROLE_PERM_MAP)]
  );

  for (const row of rolesRes.rows) {
    const codes = ROLE_PERM_MAP[row.code];
    if (!codes?.length) continue;
    for (const pCode of codes) {
      const pid = permIds.get(pCode);
      if (!pid) continue;
      await pgm.db.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [row.id, pid]
      );
    }
  }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = async (pgm) => {
  const codes = PERMISSIONS.map((p) => p[0]);
  for (const code of codes) {
    await pgm.db.query(
      `DELETE FROM rbac_role_permissions WHERE permission_id IN (SELECT id FROM rbac_permissions WHERE code = $1)`,
      [code]
    );
    await pgm.db.query(`DELETE FROM rbac_permissions WHERE code = $1`, [code]);
  }
};
