export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE refresh_tokens
      ADD COLUMN IF NOT EXISTS device_hint varchar(255) NULL,
      ADD COLUMN IF NOT EXISTS ip_address varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS country_hint varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS last_used_at timestamp NULL;

    UPDATE refresh_tokens
    SET last_used_at = COALESCE(last_used_at, created_at),
        ip_address = COALESCE(ip_address, ip_hint)
    WHERE last_used_at IS NULL OR ip_address IS NULL;
  `);

  pgm.createIndex("refresh_tokens", ["user_id", "revoked_at", "expires_at"], {
    name: "idx_refresh_tokens_user_active",
    ifNotExists: true,
  });
};

export const down = (pgm) => {
  pgm.dropIndex("refresh_tokens", ["user_id", "revoked_at", "expires_at"], {
    name: "idx_refresh_tokens_user_active",
    ifExists: true,
  });
  pgm.sql(`
    ALTER TABLE refresh_tokens
      DROP COLUMN IF EXISTS last_used_at,
      DROP COLUMN IF EXISTS country_hint,
      DROP COLUMN IF EXISTS ip_address,
      DROP COLUMN IF EXISTS device_hint;
  `);
};
