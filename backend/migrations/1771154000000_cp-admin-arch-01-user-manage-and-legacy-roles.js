/**
 * CP-ADMIN-ARCH-01 — Verrouillage sécurité Auth/RBAC
 *
 * 1) Permission user.manage : insert + assignation à ADMIN (toutes orgs)
 * 2) Rôles legacy manquants : SALES, SALES_MANAGER, TECHNICIEN, ASSISTANTE, APPORTEUR, SUPER_ADMIN
 *    (nécessaires pour cohérence JWT.role vs rbac_user_roles — le login lit user_roles/roles)
 *
 * Idempotent : ON CONFLICT DO NOTHING / upsert safe.
 */

export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = async (pgm) => {
  // 1) Insert permission user.manage
  await pgm.db.query(
    `INSERT INTO rbac_permissions (code, module, description)
     VALUES ('user.manage', 'user', 'Manage users in organization')
     ON CONFLICT (code) DO NOTHING`
  );

  const permRes = await pgm.db.query(
    "SELECT id FROM rbac_permissions WHERE code = 'user.manage'"
  );
  if (permRes.rows.length === 0) return;

  const permId = permRes.rows[0].id;

  // 2) Assigner user.manage à tous les rôles ADMIN (système + org)
  const adminRoles = await pgm.db.query(
    "SELECT id FROM rbac_roles WHERE code = 'ADMIN'"
  );
  for (const { id: roleId } of adminRoles.rows) {
    await pgm.db.query(
      `INSERT INTO rbac_role_permissions (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, permId]
    );
  }

  // 3) Rôles legacy manquants (pour cohérence JWT.role — login lit user_roles/roles)
  const legacyRolesToAdd = [
    ["SALES", "Commercial"],
    ["SALES_MANAGER", "Sales Manager"],
    ["TECHNICIEN", "Technicien"],
    ["ASSISTANTE", "Assistante"],
    ["APPORTEUR", "Apporteur"],
    ["SUPER_ADMIN", "Super Admin"]
  ];

  for (const [name, description] of legacyRolesToAdd) {
    await pgm.db.query(
      `INSERT INTO roles (id, name, description)
       SELECT gen_random_uuid(), $1::varchar, $2::varchar
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = $1::varchar)`,
      [name, description]
    );
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = async (pgm) => {
  // Retirer user.manage des rbac_role_permissions
  const permRes = await pgm.db.query(
    "SELECT id FROM rbac_permissions WHERE code = 'user.manage'"
  );
  if (permRes.rows.length > 0) {
    await pgm.db.query(
      "DELETE FROM rbac_role_permissions WHERE permission_id = $1",
      [permRes.rows[0].id]
    );
  }

  // Supprimer la permission
  await pgm.db.query("DELETE FROM rbac_permissions WHERE code = 'user.manage'");

  // Note: on ne supprime pas les rôles legacy ajoutés (SALES, etc.) car des user_roles
  // peuvent y référencer. Un down propre nécessiterait de migrer ces users d'abord.
};
