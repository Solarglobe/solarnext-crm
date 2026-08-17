/**
 * Synchronise les permissions Installateurs vers les rôles RBAC déjà clonés par organisation.
 *
 * La migration initiale 1784100000001 ajoutait les permissions aux rôles système
 * uniquement. Les organisations déjà existantes avaient donc des rôles scopés sans
 * ces nouveaux droits. Cette migration ajoute seulement les droits manquants, sans
 * supprimer ni écraser les personnalisations RBAC existantes.
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
       ON CONFLICT (code) DO UPDATE
       SET module = EXCLUDED.module,
           description = EXCLUDED.description`,
      [code, module, description]
    );
  }

  for (const [roleCode, permCodes] of Object.entries(ROLE_PERM_MAP)) {
    for (const permCode of permCodes) {
      await pgm.db.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id)
         SELECT r.id, p.id
         FROM rbac_roles r
         JOIN rbac_permissions p ON p.code = $2
         WHERE r.code = $1
           AND EXISTS (
             SELECT 1
             FROM rbac_roles system_role
             WHERE system_role.organization_id IS NULL
               AND system_role.code = r.code
           )
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleCode, permCode]
      );
    }
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  for (const [roleCode, permCodes] of Object.entries(ROLE_PERM_MAP)) {
    for (const permCode of permCodes) {
      await pgm.db.query(
        `DELETE FROM rbac_role_permissions rp
         USING rbac_roles r, rbac_permissions p
         WHERE rp.role_id = r.id
           AND rp.permission_id = p.id
           AND r.code = $1
           AND r.organization_id IS NOT NULL
           AND p.code = $2`,
        [roleCode, permCode]
      );
    }
  }
};
