/**
 * Forgot password - tokens opaques a usage unique.
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ NULL
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
      ON password_reset_tokens (user_id);

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active_expiry
      ON password_reset_tokens (expires_at)
      WHERE used_at IS NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_password_reset_tokens_active_expiry;
    DROP INDEX IF EXISTS idx_password_reset_tokens_user;
    DROP TABLE IF EXISTS password_reset_tokens;
  `);
};
