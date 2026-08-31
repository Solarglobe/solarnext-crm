/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  pgm.sql(`
    INSERT INTO installer_options (
      organization_id, tariff_version_id, code, label, category, amount_ht_cents,
      is_selectable_for_installation, is_amount_overridable, incompatible_group, sort_order
    )
    SELECT
      v.organization_id,
      v.id,
      'GRID_CONNECTION_CONSUEL',
      'Raccordement et Consuel',
      'ELECTRICAL',
      35000,
      true,
      false,
      null,
      80
    FROM installer_tariff_versions v
    JOIN installers i ON i.organization_id = v.organization_id AND i.id = v.installer_id
    WHERE i.name = 'OHELEC'
      AND v.version_label = 'OHELEC HT V1'
    ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
      label = EXCLUDED.label,
      category = EXCLUDED.category,
      amount_ht_cents = EXCLUDED.amount_ht_cents,
      is_selectable_for_installation = EXCLUDED.is_selectable_for_installation,
      is_amount_overridable = EXCLUDED.is_amount_overridable,
      incompatible_group = EXCLUDED.incompatible_group,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  pgm.sql(`
    DELETE FROM installer_options
    WHERE code = 'GRID_CONNECTION_CONSUEL'
      AND tariff_version_id IN (
        SELECT v.id
        FROM installer_tariff_versions v
        JOIN installers i ON i.organization_id = v.organization_id AND i.id = v.installer_id
        WHERE i.name = 'OHELEC'
          AND v.version_label = 'OHELEC HT V1'
      );
  `);
};
