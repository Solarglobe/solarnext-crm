/**
 * CP-031 — Studies + versioning strict
 * Ajoute colonnes manquantes : title, current_version
 * Ajoute permission study.manage
 * Non-destructif
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  // 1) studies : ajouter title (text) si absent
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'studies' AND column_name = 'title'
      ) THEN
        ALTER TABLE studies ADD COLUMN title text;
      END IF;
    END $$;
  `);

  // 2) studies : ajouter current_version (int default 1) si absent
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'studies' AND column_name = 'current_version'
      ) THEN
        ALTER TABLE studies ADD COLUMN current_version integer NOT NULL DEFAULT 1;
      END IF;
    END $$;
  `);

  // 3) Mettre à jour current_version pour les études existantes ayant des versions
  pgm.sql(`
    UPDATE studies s
    SET current_version = COALESCE(
      (SELECT MAX(version_number) FROM study_versions sv WHERE sv.study_id = s.id),
      1
    )
    WHERE s.current_version IS NULL OR s.current_version < (
      SELECT COALESCE(MAX(version_number), 1) FROM study_versions WHERE study_id = s.id
    );
  `);

  // 4) Permission study.manage
  await pgm.db.query(
    `INSERT INTO rbac_permissions (code, module, description)
     VALUES ('study.manage', 'study', 'Manage studies and versions')
     ON CONFLICT (code) DO NOTHING`
  );

  // 5) Assigner study.manage à ADMIN et SUPER_ADMIN
  const permRes = await pgm.db.query(
    `SELECT id FROM rbac_permissions WHERE code = 'study.manage'`
  );
  if (permRes.rows.length > 0) {
    const permId = permRes.rows[0].id;
    for (const roleCode of ['ADMIN', 'SUPER_ADMIN']) {
      const roleRes = await pgm.db.query(
        `SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1`,
        [roleCode]
      );
      if (roleRes.rows.length > 0) {
        await pgm.db.query(
          `INSERT INTO rbac_role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT (role_id, permission_id) DO NOTHING`,
          [roleRes.rows[0].id, permId]
        );
      }
    }
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  // Retirer permission des rôles
  const permRes = await pgm.db.query(
    `SELECT id FROM rbac_permissions WHERE code = 'study.manage'`
  );
  if (permRes.rows.length > 0) {
    await pgm.db.query(
      `DELETE FROM rbac_role_permissions WHERE permission_id = $1`,
      [permRes.rows[0].id]
    );
    await pgm.db.query(`DELETE FROM rbac_permissions WHERE code = 'study.manage'`);
  }

  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'studies' AND column_name = 'current_version') THEN
        ALTER TABLE studies DROP COLUMN current_version;
      END IF;
    END $$;
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'studies' AND column_name = 'title') THEN
        ALTER TABLE studies DROP COLUMN title;
      END IF;
    END $$;
  `);
};
