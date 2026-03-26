/**
 * Mission Engine V1 — Permissions RBAC missions
 */

export const shorthands = undefined;

const PERMISSIONS = [
  ["mission.read.self", "mission", "Voir ses propres missions"],
  ["mission.read.all", "mission", "Voir toutes les missions de l'organisation"],
  ["mission.update.self", "mission", "Modifier ses propres missions"],
  ["mission.update.all", "mission", "Modifier toutes les missions"],
  ["mission.create", "mission", "Créer des missions"],
];

const ROLE_PERM_MAP = {
  SUPER_ADMIN: ["mission.read.all", "mission.update.all", "mission.create"],
  ADMIN: ["mission.read.all", "mission.update.all", "mission.create"],
  SALES_MANAGER: ["mission.read.all", "mission.update.all", "mission.create"],
  SALES: ["mission.read.self", "mission.update.self", "mission.create"],
  TECHNICIEN: ["mission.read.self", "mission.update.self", "mission.create"],
  ASSISTANTE: ["mission.read.all", "mission.update.all", "mission.create"],
  APPORTEUR: ["mission.read.self"],
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
      const permRes = await pgm.db.query(
        `SELECT id FROM rbac_permissions WHERE code = $1`,
        [permCode]
      );
      if (permRes.rows.length === 0) continue;

      const permId = permRes.rows[0].id;

      await pgm.db.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleId, permId]
      );
    }
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  const permCodes = PERMISSIONS.map((p) => p[0]);
  for (const code of permCodes) {
    await pgm.db.query(
      `DELETE FROM rbac_role_permissions WHERE permission_id IN (SELECT id FROM rbac_permissions WHERE code = $1)`,
      [code]
    );
    await pgm.db.query(`DELETE FROM rbac_permissions WHERE code = $1`, [code]);
  }
};
