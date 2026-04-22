/**
 * Permission lead.delete (suppression définitive) — ADMIN & SUPER_ADMIN
 */

export const shorthands = undefined;

export const up = async (pgm) => {
  await pgm.db.query(
    `INSERT INTO rbac_permissions (code, module, description)
     VALUES ('lead.delete', 'lead', 'Supprimer définitivement un lead')
     ON CONFLICT (code) DO NOTHING`
  );

  const permRes = await pgm.db.query(
    `SELECT id FROM rbac_permissions WHERE code = 'lead.delete'`
  );
  if (permRes.rows.length === 0) return;

  const permId = permRes.rows[0].id;

  for (const roleCode of ["SUPER_ADMIN", "ADMIN"]) {
    const roleRes = await pgm.db.query(
      `SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1`,
      [roleCode]
    );
    if (roleRes.rows.length === 0) continue;
    await pgm.db.query(
      `INSERT INTO rbac_role_permissions (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleRes.rows[0].id, permId]
    );
  }
};

export const down = async (pgm) => {
  const pr = await pgm.db.query(`SELECT id FROM rbac_permissions WHERE code = 'lead.delete'`);
  if (pr.rows.length === 0) return;
  await pgm.db.query(`DELETE FROM rbac_role_permissions WHERE permission_id = $1`, [
    pr.rows[0].id,
  ]);
  await pgm.db.query(`DELETE FROM rbac_permissions WHERE id = $1`, [pr.rows[0].id]);
};
