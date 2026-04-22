/**
 * CP-026 RBAC — Tables pour permissions fines
 * Tables: rbac_roles, rbac_permissions, rbac_role_permissions, rbac_user_roles
 * (préfixe rbac_ pour éviter conflit avec roles/user_roles existants)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("rbac_roles", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    organization_id: {
      type: "uuid",
      references: "organizations",
      onDelete: "SET NULL"
    },
    code: {
      type: "text",
      notNull: true
    },
    name: {
      type: "text",
      notNull: true
    },
    is_system: {
      type: "boolean",
      notNull: true,
      default: false
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  // UNIQUE(org, code) — COALESCE pour que NULL soit traité (rôles système)
  pgm.sql(`
    CREATE UNIQUE INDEX rbac_roles_org_code_unique
    ON rbac_roles (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code)
  `);
  pgm.createIndex("rbac_roles", ["organization_id"]);

  pgm.createTable("rbac_permissions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    code: {
      type: "text",
      notNull: true,
      unique: true
    },
    module: {
      type: "text",
      notNull: true
    },
    description: {
      type: "text"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.createIndex("rbac_permissions", ["module"]);

  pgm.createTable("rbac_role_permissions", {
    role_id: {
      type: "uuid",
      notNull: true,
      references: "rbac_roles",
      onDelete: "CASCADE"
    },
    permission_id: {
      type: "uuid",
      notNull: true,
      references: "rbac_permissions",
      onDelete: "CASCADE"
    }
  });

  addConstraintIdempotent(
    pgm,
    "rbac_role_permissions",
    "rbac_role_permissions_pk",
    "PRIMARY KEY (role_id, permission_id)"
  );
  pgm.createIndex("rbac_role_permissions", ["permission_id"]);

  pgm.createTable("rbac_user_roles", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE"
    },
    role_id: {
      type: "uuid",
      notNull: true,
      references: "rbac_roles",
      onDelete: "CASCADE"
    }
  });

  addConstraintIdempotent(
    pgm,
    "rbac_user_roles",
    "rbac_user_roles_pk",
    "PRIMARY KEY (user_id, role_id)"
  );
  pgm.createIndex("rbac_user_roles", ["role_id"]);

  // Trigger: auto-seed rbac roles quand une org est créée (après seed migration)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_seed_rbac_roles_for_org(p_org_id uuid)
    RETURNS void AS $$
    DECLARE
      sys_rec RECORD;
      org_role_id uuid;
    BEGIN
      FOR sys_rec IN SELECT id, code, name FROM rbac_roles WHERE organization_id IS NULL
      LOOP
        INSERT INTO rbac_roles (organization_id, code, name, is_system)
        VALUES (p_org_id, sys_rec.code, sys_rec.name, false)
        ON CONFLICT ((COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), code) DO NOTHING;

        SELECT id INTO org_role_id FROM rbac_roles WHERE organization_id = p_org_id AND code = sys_rec.code LIMIT 1;

        INSERT INTO rbac_role_permissions (role_id, permission_id)
        SELECT org_role_id, permission_id FROM rbac_role_permissions WHERE role_id = sys_rec.id
        ON CONFLICT (role_id, permission_id) DO NOTHING;
      END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_organizations_after_insert_seed_rbac()
    RETURNS trigger AS $$
    BEGIN
      PERFORM sg_seed_rbac_roles_for_org(NEW.id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS organizations_seed_rbac ON organizations;
  `);
  pgm.sql(`
    CREATE TRIGGER organizations_seed_rbac
    AFTER INSERT ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION sg_organizations_after_insert_seed_rbac();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS organizations_seed_rbac ON organizations;`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_organizations_after_insert_seed_rbac();`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_seed_rbac_roles_for_org(uuid);`);

  pgm.dropTable("rbac_user_roles");
  pgm.dropTable("rbac_role_permissions");
  pgm.dropTable("rbac_permissions");
  pgm.dropTable("rbac_roles");
};
