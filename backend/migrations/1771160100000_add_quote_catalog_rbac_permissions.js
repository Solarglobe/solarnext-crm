/**
 * CP-QUOTE-002 — Permissions RBAC Catalogue devis
 * QUOTE_CATALOG:READ (list), QUOTE_CATALOG:WRITE (create/update/activate/deactivate)
 * Assignées aux rôles ADMIN (système + org).
 */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = async (pgm) => {
  await pgm.db.query(
    `INSERT INTO rbac_permissions (code, module, description)
     VALUES 
       ('QUOTE_CATALOG:READ', 'quote', 'List quote catalog items'),
       ('QUOTE_CATALOG:WRITE', 'quote', 'Create/update/activate/deactivate quote catalog items')
     ON CONFLICT (code) DO NOTHING`
  );

  const permRead = await pgm.db.query(
    "SELECT id FROM rbac_permissions WHERE code = 'QUOTE_CATALOG:READ'"
  );
  const permWrite = await pgm.db.query(
    "SELECT id FROM rbac_permissions WHERE code = 'QUOTE_CATALOG:WRITE'"
  );
  if (permRead.rows.length === 0 || permWrite.rows.length === 0) return;

  const readId = permRead.rows[0].id;
  const writeId = permWrite.rows[0].id;

  const adminRoles = await pgm.db.query(
    "SELECT id FROM rbac_roles WHERE code = 'ADMIN'"
  );
  for (const { id: roleId } of adminRoles.rows) {
    await pgm.db.query(
      `INSERT INTO rbac_role_permissions (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, readId]
    );
    await pgm.db.query(
      `INSERT INTO rbac_role_permissions (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, writeId]
    );
  }
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = async (pgm) => {
  for (const code of ["QUOTE_CATALOG:READ", "QUOTE_CATALOG:WRITE"]) {
    const perm = await pgm.db.query(
      "SELECT id FROM rbac_permissions WHERE code = $1",
      [code]
    );
    if (perm.rows.length > 0) {
      await pgm.db.query(
        "DELETE FROM rbac_role_permissions WHERE permission_id = $1",
        [perm.rows[0].id]
      );
    }
    await pgm.db.query("DELETE FROM rbac_permissions WHERE code = $1", [code]);
  }
};
