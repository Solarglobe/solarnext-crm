/**
 * Credentials IMAP/SMTP dans encrypted_credentials (jsonb).
 * Rétrocompat : champ legacy `password` utilisé si imap_password / smtp_password absents.
 */

/**
 * @param {string} accountEmail
 * @param {Record<string, unknown> | null | undefined} cred
 * @returns {{ user: string, password: string }}
 */
export function resolveImapCredentials(accountEmail, cred) {
  const c = cred && typeof cred === "object" ? cred : {};
  const password = String(c.imap_password ?? c.password ?? "").trim();
  const rawUser = c.imap_user != null ? String(c.imap_user).trim() : "";
  const user = rawUser || String(accountEmail || "").trim();
  return { user, password };
}

/**
 * @param {string} accountEmail
 * @param {Record<string, unknown> | null | undefined} cred
 * @returns {{ user: string, password: string }}
 */
export function resolveSmtpCredentials(accountEmail, cred) {
  const c = cred && typeof cred === "object" ? cred : {};
  const password = String(c.smtp_password ?? c.password ?? "").trim();
  const rawUser = c.smtp_user != null ? String(c.smtp_user).trim() : "";
  const user = rawUser || String(accountEmail || "").trim();
  return { user, password };
}
