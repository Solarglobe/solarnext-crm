import test from "node:test";
import assert from "node:assert/strict";
import { encryptJson, decryptJson } from "../services/security/encryption.service.js";
import {
  MICROSOFT_OAUTH_SCOPES,
  __test,
  consumeMicrosoftOAuthCallback,
  refreshMicrosoftOAuthTokenForAccount,
} from "../services/mail/mailMicrosoftOAuth.service.js";

process.env.MAIL_ENCRYPTION_KEY ||= "0000000000000000000000000000000000000000000000000000000000000000";
process.env.MICROSOFT_CLIENT_ID = "client-id";
process.env.MICROSOFT_REDIRECT_URI = "https://crm.example.com/api/mail/accounts/oauth/microsoft/callback";
process.env.FRONTEND_URL = "https://crm.example.com";

function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.x`;
}

function fakePool(handler) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return handler(String(sql), params, calls.length);
    },
    release() {},
  };
  return { calls, client, async connect() { return client; } };
}

test("OAuth callback valide: state lie, PKCE utilise, tokens chiffres, state invalide et redirect interne", async () => {
  const rawState = "state-secret";
  const verifier = "pkce-verifier";
  let encryptedCredentials = null;
  const pool = fakePool((sql, params) => {
    if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
    if (sql.includes("FROM mail_account_oauth_states")) {
      assert.equal(params[0], __test.sha256(rawState));
      return {
        rows: [{
          id: "state-1",
          organization_id: "org-1",
          user_id: "user-1",
          mail_account_id: null,
          state_hash: __test.sha256(rawState),
          code_verifier_encrypted: encryptJson({ codeVerifier: verifier }),
          redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
          requested_email: "user@example.com",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          consumed_at: null,
        }],
      };
    }
    if (sql.includes("lower(email)")) return { rows: [] };
    if (sql.includes("INSERT INTO mail_accounts")) {
      encryptedCredentials = params[3];
      return { rows: [{ id: "acc-1" }] };
    }
    if (sql.includes("UPDATE mail_account_oauth_states")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const fetchCalls = [];
  const out = await consumeMicrosoftOAuthCallback({
    pool,
    state: rawState,
    code: "auth-code",
    cookieStateHash: __test.sha256(rawState),
    canConfigureMailAccountsImpl: async () => true,
    fetchImpl: async (_url, opts) => {
      fetchCalls.push(opts);
      const body = opts.body;
      assert.equal(body.get("code_verifier"), verifier);
      return {
        ok: true,
        async json() {
          return {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: MICROSOFT_OAUTH_SCOPES.join(" "),
            id_token: jwt({ preferred_username: "user@example.com" }),
          };
        },
      };
    },
  });
  assert.deepEqual(out, { success: true, mailAccountId: "acc-1", email: "user@example.com" });
  assert.equal(fetchCalls.length, 1);
  const clear = decryptJson(encryptedCredentials);
  assert.equal(clear.oauth_access_token, "access-token");
  assert.equal(clear.oauth_refresh_token, "refresh-token");
});

test("OAuth callback refuse replay, state expire, autre session et permission retiree", async () => {
  const cases = [
    { row: null, code: "MICROSOFT_OAUTH_STATE_INVALID" },
    { row: { consumed_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() }, code: "MICROSOFT_OAUTH_STATE_INVALID" },
    { row: { consumed_at: null, expires_at: new Date(Date.now() - 60_000).toISOString() }, code: "MICROSOFT_OAUTH_STATE_INVALID" },
    { row: { consumed_at: null, expires_at: new Date(Date.now() + 60_000).toISOString(), cookie: "bad" }, code: "MICROSOFT_OAUTH_SESSION_MISMATCH" },
    { row: { consumed_at: null, expires_at: new Date(Date.now() + 60_000).toISOString(), permission: false }, code: "MICROSOFT_OAUTH_PERMISSION_REVOKED" },
  ];
  for (const c of cases) {
    const state = "s";
    const pool = fakePool((sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM mail_account_oauth_states")) {
        if (!c.row) return { rows: [] };
        return { rows: [{
          id: "state",
          organization_id: "org",
          user_id: "user",
          mail_account_id: null,
          state_hash: __test.sha256(state),
          code_verifier_encrypted: encryptJson({ codeVerifier: "v" }),
          redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
          requested_email: "user@example.com",
          expires_at: c.row.expires_at,
          consumed_at: c.row.consumed_at,
        }] };
      }
      throw new Error(`Unexpected SQL ${sql}`);
    });
    await assert.rejects(
      consumeMicrosoftOAuthCallback({
        pool,
        state,
        code: "code",
        cookieStateHash: c.row?.cookie === "bad" ? "bad" : __test.sha256(state),
        canConfigureMailAccountsImpl: async () => c.row?.permission !== false,
        fetchImpl: async () => { throw new Error("fetch must not run"); },
      }),
      (e) => e.code === c.code
    );
  }
});

test("OAuth callback refuse token sans refresh, scopes insuffisants et identite inattendue", () => {
  assert.throws(
    () => __test.assertMicrosoftTokenPayload({ access_token: "a", scope: MICROSOFT_OAUTH_SCOPES.join(" "), id_token: jwt({ preferred_username: "a@example.com" }) }),
    /Refresh token/
  );
  assert.throws(
    () => __test.assertMicrosoftTokenPayload({ access_token: "a", refresh_token: "r", scope: "openid offline_access", id_token: jwt({ preferred_username: "a@example.com" }) }),
    /Scopes/
  );
  assert.throws(
    () => __test.assertMicrosoftTokenPayload({ access_token: "a", refresh_token: "r", scope: MICROSOFT_OAUTH_SCOPES.join(" "), id_token: jwt({ preferred_username: "b@example.com" }) }, "a@example.com"),
    /Identite/
  );
});

test("OAuth refresh remplace atomiquement le refresh token sous FOR UPDATE", async () => {
  const updates = [];
  const db = {
    async query(sql, params) {
      if (sql.includes("FOR UPDATE")) {
        assert.match(sql, /FOR UPDATE/);
        return {
          rows: [{
            id: "acc",
            organization_id: "org",
            email: "user@example.com",
            provider: "MICROSOFT",
            auth_method: "MICROSOFT_OAUTH",
            token_expires_at: new Date(Date.now() - 1000).toISOString(),
            encrypted_credentials: encryptJson({ oauth_refresh_token: "old-refresh", oauth_expires_at: new Date(Date.now() - 1000).toISOString() }),
          }],
        };
      }
      if (sql.includes("UPDATE mail_accounts SET")) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL ${sql}`);
    },
  };
  const result = await refreshMicrosoftOAuthTokenForAccount(db, {
    organizationId: "org",
    mailAccountId: "acc",
    fetchImpl: async (_url, opts) => {
      assert.equal(opts.body.get("refresh_token"), "old-refresh");
      return {
        ok: true,
        async json() {
          return {
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
            scope: MICROSOFT_OAUTH_SCOPES.join(" "),
            id_token: jwt({ preferred_username: "user@example.com" }),
          };
        },
      };
    },
  });
  assert.equal(result.refreshed, true);
  const stored = decryptJson(updates[0].params[2]);
  assert.equal(stored.oauth_access_token, "new-access");
  assert.equal(stored.oauth_refresh_token, "new-refresh");
});

test("OAuth refresh: invalid_grant passe AUTH_REQUIRED, erreur temporaire passe DEGRADED", async () => {
  for (const [providerError, expectedState, expectedCode] of [
    ["invalid_grant", "AUTH_REQUIRED", "MICROSOFT_REFRESH_REVOKED"],
    ["temporarily_unavailable", "DEGRADED", "MICROSOFT_REFRESH_TEMPORARY_ERROR"],
  ]) {
    const updates = [];
    const db = {
      async query(sql, params) {
        if (sql.includes("FOR UPDATE")) {
          return { rows: [{
            id: "acc",
            organization_id: "org",
            email: "user@example.com",
            provider: "MICROSOFT",
            auth_method: "MICROSOFT_OAUTH",
            encrypted_credentials: encryptJson({ oauth_refresh_token: "refresh", oauth_expires_at: new Date(Date.now() - 1000).toISOString() }),
          }] };
        }
        if (sql.includes("UPDATE mail_accounts SET")) {
          updates.push({ sql, params });
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL ${sql}`);
      },
    };
    await assert.rejects(
      refreshMicrosoftOAuthTokenForAccount(db, {
        organizationId: "org",
        mailAccountId: "acc",
        fetchImpl: async () => ({ ok: false, async json() { return { error: providerError }; } }),
      }),
      (e) => e.code === expectedCode
    );
    assert.match(updates.at(-1).sql, new RegExp(expectedState));
  }
});
