/**
 * Permissions RBAC installateurs / tarification installateur.
 */

export const shorthands = undefined;

const PERMISSIONS = [
  ["installer.read", "installer", "Voir les installateurs"],
  ["installer.write", "installer", "Créer et modifier les installateurs"],
  ["installer.pricing.read", "installer", "Voir et calculer la tarification installateur"],
  ["installer.pricing.write", "installer", "Modifier les grilles tarifaires installateur"],
];

const ROLE_PERM_MAP = {
  SUPER_ADMIN: PERMISSIONS.map(([code]) => code),
  ADMIN: PERMISSIONS.map(([code]) => code),
  SALES_MANAGER: ["installer.read", "installer.pricing.read"],
  SALES: ["installer.read", "installer.pricing.read"],
  TECHNICIEN: ["installer.read", "installer.pricing.read"],
  ASSISTANTE: ["installer.read", "installer.pricing.read"],
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  for (const [code, module, description] of PERMISSIONS) {
    await pgm.db.query(
      `INSERT INTO rbac_permissions (code, module, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [code, module, description]
    );
  }

  for (const [roleCode, permCodes] of Object.entries(ROLE_PERM_MAP)) {
    const roleRes = await pgm.db.query(
      `SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1`,
      [roleCode]
    );
    if (roleRes.rows.length === 0) continue;

    for (const permCode of permCodes) {
      const permRes = await pgm.db.query(`SELECT id FROM rbac_permissions WHERE code = $1`, [permCode]);
      if (permRes.rows.length === 0) continue;
      await pgm.db.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleRes.rows[0].id, permRes.rows[0].id]
      );
    }
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  for (const [code] of PERMISSIONS) {
    await pgm.db.query(
      `DELETE FROM rbac_role_permissions WHERE permission_id IN (SELECT id FROM rbac_permissions WHERE code = $1)`,
      [code]
    );
    await pgm.db.query(`DELETE FROM rbac_permissions WHERE code = $1`, [code]);
  }
};
