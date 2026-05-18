/**
 * Email verification - active accounts already present are trusted.
 * New users default to email_verified=false until they click a 24h token.
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

    UPDATE users
       SET email_verified = true
     WHERE status = 'active'
       AND email_verified = false;

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_email_verification_tokens_user
      ON email_verification_tokens (user_id);

    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expiry
      ON email_verification_tokens (expires_at);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_email_verification_tokens_expiry;
    DROP INDEX IF EXISTS uq_email_verification_tokens_user;
    DROP TABLE IF EXISTS email_verification_tokens;
    ALTER TABLE users DROP COLUMN IF EXISTS email_verified;
  `);
};
