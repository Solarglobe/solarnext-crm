/**
 * CP-ADMIN-STRUCT-02 — Tables user_team et user_agency
 * Affectation users ↔ équipes / agences avec contraintes cross-org.
 *
 * Contraintes :
 * - user.organization_id = team.organization_id
 * - user.organization_id = agency.organization_id
 * (via triggers)
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  // Permission structure.manage (optionnelle, pour cohérence avec spec)
  await pgm.db.query(
    `INSERT INTO rbac_permissions (code, module, description)
     VALUES ('structure.manage', 'org', 'Manage teams and agencies')
     ON CONFLICT (code) DO NOTHING`
  );

  const permRes = await pgm.db.query(
    "SELECT id FROM rbac_permissions WHERE code = 'structure.manage'"
  );
  if (permRes.rows.length > 0) {
    const permId = permRes.rows[0].id;
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
  }

  // Table user_team
  pgm.createTable("user_team", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    team_id: {
      type: "uuid",
      notNull: true,
      references: "teams",
      onDelete: "CASCADE",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint("user_team", "user_team_unique_user_team", {
    unique: ["user_id", "team_id"],
  });
  pgm.createIndex("user_team", ["organization_id"]);
  pgm.createIndex("user_team", ["user_id"]);
  pgm.createIndex("user_team", ["team_id"]);

  // Table user_agency
  pgm.createTable("user_agency", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    agency_id: {
      type: "uuid",
      notNull: true,
      references: "agencies",
      onDelete: "CASCADE",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint("user_agency", "user_agency_unique_user_agency", {
    unique: ["user_id", "agency_id"],
  });
  pgm.createIndex("user_agency", ["organization_id"]);
  pgm.createIndex("user_agency", ["user_id"]);
  pgm.createIndex("user_agency", ["agency_id"]);

  // Trigger : user_team — vérifier user.organization_id = team.organization_id
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cp_admin_struct_02_check_user_team_org()
    RETURNS trigger AS $$
    DECLARE
      u_org uuid;
      t_org uuid;
    BEGIN
      SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
      SELECT organization_id INTO t_org FROM teams WHERE id = NEW.team_id;
      IF u_org IS NULL OR t_org IS NULL OR u_org != t_org THEN
        RAISE EXCEPTION 'user_team: user et team doivent appartenir à la même organisation (cross-org interdit)';
      END IF;
      NEW.organization_id := u_org;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS user_team_check_org ON user_team;
    CREATE TRIGGER user_team_check_org
    BEFORE INSERT OR UPDATE ON user_team
    FOR EACH ROW
    EXECUTE FUNCTION cp_admin_struct_02_check_user_team_org();
  `);

  // Trigger : user_agency — vérifier user.organization_id = agency.organization_id
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cp_admin_struct_02_check_user_agency_org()
    RETURNS trigger AS $$
    DECLARE
      u_org uuid;
      a_org uuid;
    BEGIN
      SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
      SELECT organization_id INTO a_org FROM agencies WHERE id = NEW.agency_id;
      IF u_org IS NULL OR a_org IS NULL OR u_org != a_org THEN
        RAISE EXCEPTION 'user_agency: user et agency doivent appartenir à la même organisation (cross-org interdit)';
      END IF;
      NEW.organization_id := u_org;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS user_agency_check_org ON user_agency;
    CREATE TRIGGER user_agency_check_org
    BEFORE INSERT OR UPDATE ON user_agency
    FOR EACH ROW
    EXECUTE FUNCTION cp_admin_struct_02_check_user_agency_org();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS user_team_check_org ON user_team`);
  pgm.sql(`DROP FUNCTION IF EXISTS cp_admin_struct_02_check_user_team_org()`);
  pgm.sql(`DROP TRIGGER IF EXISTS user_agency_check_org ON user_agency`);
  pgm.sql(`DROP FUNCTION IF EXISTS cp_admin_struct_02_check_user_agency_org()`);

  pgm.dropTable("user_agency");
  pgm.dropTable("user_team");

  // Retirer structure.manage des rbac_role_permissions
  const permRes = await pgm.db.query(
    "SELECT id FROM rbac_permissions WHERE code = 'structure.manage'"
  );
  if (permRes.rows.length > 0) {
    await pgm.db.query(
      "DELETE FROM rbac_role_permissions WHERE permission_id = $1",
      [permRes.rows[0].id]
    );
  }
  await pgm.db.query("DELETE FROM rbac_permissions WHERE code = 'structure.manage'");
};
