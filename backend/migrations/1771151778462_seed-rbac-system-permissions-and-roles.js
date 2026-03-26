/**
 * CP-026 RBAC — Seed idempotent des permissions et rôles système
 */

export const shorthands = undefined;

const PERMISSIONS = [
  ["rbac.manage", "rbac", "Manage roles & permissions"],
  ["org.settings.manage", "org", "Manage organization settings"],
  ["lead.read.self", "lead", null],
  ["lead.read.all", "lead", null],
  ["lead.create", "lead", null],
  ["lead.update.self", "lead", null],
  ["lead.update.all", "lead", null],
  ["client.read.self", "client", null],
  ["client.read.all", "client", null],
  ["client.update.self", "client", null],
  ["client.update.all", "client", null],
  ["quote.manage", "quote", null],
  ["invoice.manage", "invoice", null],
  ["calendar.view.self", "calendar", null],
  ["calendar.view.all", "calendar", null]
];

const SYSTEM_ROLES = [
  ["SUPER_ADMIN", "Super Admin"],
  ["ADMIN", "Admin"],
  ["SALES_MANAGER", "Sales Manager"],
  ["SALES", "Sales"],
  ["TECHNICIEN", "Technicien"],
  ["ASSISTANTE", "Assistante"],
  ["APPORTEUR", "Apporteur"]
];

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = async (pgm) => {
  // 1) Permissions (INSERT ON CONFLICT DO NOTHING)
  for (const [code, module, description] of PERMISSIONS) {
    await pgm.db.query(
      `INSERT INTO rbac_permissions (code, module, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [code, module, description]
    );
  }

  // 2) Rôles système (organization_id = NULL)
  for (const [code, name] of SYSTEM_ROLES) {
    await pgm.db.query(
      `INSERT INTO rbac_roles (organization_id, code, name, is_system)
       VALUES (NULL, $1, $2, true)
       ON CONFLICT ((COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), code) DO NOTHING`,
      [code, name]
    );
  }

  // 3) Role permissions — via requêtes avec les IDs
  const rolePermMap = {
    SUPER_ADMIN: ["rbac.manage", "org.settings.manage"],
    ADMIN: [
      "rbac.manage",
      "org.settings.manage",
      "lead.read.self",
      "lead.read.all",
      "lead.create",
      "lead.update.self",
      "lead.update.all",
      "client.read.self",
      "client.read.all",
      "client.update.self",
      "client.update.all",
      "quote.manage",
      "invoice.manage",
      "calendar.view.self",
      "calendar.view.all"
    ],
    SALES_MANAGER: [
      "lead.read.all",
      "lead.update.all",
      "client.read.all",
      "client.update.all",
      "calendar.view.all"
    ],
    SALES: [
      "lead.create",
      "lead.read.self",
      "lead.update.self",
      "client.read.self",
      "client.update.self",
      "calendar.view.self"
    ],
    TECHNICIEN: ["client.read.self", "calendar.view.self"],
    ASSISTANTE: [
      "lead.read.all",
      "lead.update.all",
      "client.read.all",
      "client.update.all",
      "quote.manage",
      "invoice.manage",
      "calendar.view.all"
    ],
    APPORTEUR: ["lead.create", "lead.read.self"]
  };

  for (const [roleCode, permCodes] of Object.entries(rolePermMap)) {
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

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = async (pgm) => {
  await pgm.db.query("DELETE FROM rbac_role_permissions");
  await pgm.db.query("DELETE FROM rbac_user_roles");
  await pgm.db.query("DELETE FROM rbac_roles");
  await pgm.db.query("DELETE FROM rbac_permissions");
};
