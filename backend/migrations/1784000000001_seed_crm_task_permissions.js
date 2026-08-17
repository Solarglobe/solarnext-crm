/**
 * CRM Tasks V1 — Permissions RBAC tâches / relances.
 */

export const shorthands = undefined;

const PERMISSIONS = [
  ["crm_task.read.self", "crm_task", "Voir ses propres tâches et relances CRM"],
  ["crm_task.read.all", "crm_task", "Voir toutes les tâches et relances de l'organisation"],
  ["crm_task.create", "crm_task", "Créer des tâches et relances CRM"],
  ["crm_task.update.self", "crm_task", "Modifier ses propres tâches et relances CRM"],
  ["crm_task.update.all", "crm_task", "Modifier toutes les tâches et relances CRM"],
];

const ROLE_PERM_MAP = {
  SUPER_ADMIN: ["crm_task.read.all", "crm_task.update.all", "crm_task.create"],
  ADMIN: ["crm_task.read.all", "crm_task.update.all", "crm_task.create"],
  SALES_MANAGER: ["crm_task.read.all", "crm_task.update.all", "crm_task.create"],
  SALES: ["crm_task.read.self", "crm_task.update.self", "crm_task.create"],
  TECHNICIEN: ["crm_task.read.self", "crm_task.update.self", "crm_task.create"],
  ASSISTANTE: ["crm_task.read.all", "crm_task.update.all", "crm_task.create"],
  APPORTEUR: ["crm_task.read.self"],
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

    const roleId = roleRes.rows[0].id;
    for (const permCode of permCodes) {
      const permRes = await pgm.db.query(`SELECT id FROM rbac_permissions WHERE code = $1`, [permCode]);
      if (permRes.rows.length === 0) continue;

      await pgm.db.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleId, permRes.rows[0].id]
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
