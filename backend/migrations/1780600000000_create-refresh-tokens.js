/**
 * Auth sessions — refresh tokens opaques rotatifs.
 *
 * Les access tokens restent des JWT courts (15 min). Le refresh token brut ne
 * quitte jamais le cookie HttpOnly ; seule son empreinte SHA-256 est stockee.
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash      VARCHAR(64) NOT NULL UNIQUE,
      session_id      UUID        NOT NULL,
      ip_hint         TEXT        NULL,
      user_agent_hint TEXT        NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      revoked_at      TIMESTAMPTZ NULL
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_session
      ON refresh_tokens (user_id, session_id);

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active_expiry
      ON refresh_tokens (expires_at)
      WHERE revoked_at IS NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_refresh_tokens_active_expiry;
    DROP INDEX IF EXISTS idx_refresh_tokens_user_session;
    DROP TABLE IF EXISTS refresh_tokens;
  `);
};
