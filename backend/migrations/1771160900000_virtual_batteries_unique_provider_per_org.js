/**
 * pv_virtual_batteries — unicité provider_code par organisation
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createIndex(
    "pv_virtual_batteries",
    ["organization_id", "provider_code"],
    {
      name: "uq_virtual_battery_provider_per_org",
      unique: true,
    }
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropIndex("pv_virtual_batteries", ["organization_id", "provider_code"], {
    name: "uq_virtual_battery_provider_per_org",
  });
};
