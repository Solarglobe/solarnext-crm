import "../config/register-local-env.js";
import { pool } from "../config/db.js";

const SOLARGLOBE_EMAILS = ["b.letren@solarglobe.fr", "n.brunet@solarglobe.fr"];

function bool(v) {
  return v === true || v === "true" || v === 1 ? "OK" : "NON";
}

function isInternalSettings(settings) {
  const planCode = settings?.plan?.code;
  const billing = settings?.billing;
  return planCode === "INTERNAL_FREE" || billing?.status === "FREE" || billing?.limited === false;
}

async function main() {
  const orgs = await pool.query(
    `SELECT id, name, onboarding_completed, onboarding_step_completed, settings_json, created_at
       FROM organizations
      WHERE LOWER(COALESCE(name, '')) LIKE '%solarglobe%'
         OR id IN (
           SELECT organization_id
             FROM users
            WHERE LOWER(COALESCE(email, '')) LIKE '%@solarglobe.fr'
         )
      ORDER BY created_at ASC NULLS LAST`
  );

  console.log("=== Organisations Solarglobe detectees ===");
  if (orgs.rows.length === 0) {
    console.log("ALERTE: aucune organisation Solarglobe trouvee.");
  }
  for (const org of orgs.rows) {
    const settings = org.settings_json ?? {};
    console.log({
      id: org.id,
      name: org.name,
      onboarding_completed: bool(org.onboarding_completed),
      completed_steps: org.onboarding_step_completed ?? [],
      internal_free_settings: bool(isInternalSettings(settings)),
      plan: settings.plan ?? null,
      billing: settings.billing ?? null,
      signup: settings.signup ?? null,
      created_at: org.created_at,
    });
  }

  console.log("\n=== Comptes Solarglobe attendus ===");
  const users = await pool.query(
    `SELECT u.id, u.email, u.status, u.organization_id, o.name AS organization_name,
            COALESCE(u.email_verified, false) AS email_verified,
            COALESCE(o.onboarding_completed, false) AS onboarding_completed,
            o.settings_json
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE LOWER(TRIM(u.email)) = ANY($1::text[])
      ORDER BY u.email, u.created_at ASC`,
    [SOLARGLOBE_EMAILS]
  );

  for (const email of SOLARGLOBE_EMAILS) {
    const matches = users.rows.filter((u) => String(u.email).toLowerCase() === email);
    if (matches.length === 0) {
      console.log({ email, status: "MANQUANT" });
      continue;
    }
    for (const user of matches) {
      const settings = user.settings_json ?? {};
      console.log({
        email,
        user_id: user.id,
        status: user.status,
        organization_id: user.organization_id,
        organization_name: user.organization_name,
        email_verified: bool(user.email_verified),
        onboarding_completed: bool(user.onboarding_completed),
        internal_free_settings: bool(isInternalSettings(settings)),
      });
    }
  }

  console.log("\n=== Doublons @solarglobe.fr hors organisation Solarglobe ===");
  const duplicates = await pool.query(
    `SELECT u.email, u.organization_id, o.name AS organization_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE LOWER(COALESCE(u.email, '')) LIKE '%@solarglobe.fr'
        AND LOWER(COALESCE(o.name, '')) NOT LIKE '%solarglobe%'
      ORDER BY u.email`
  );
  if (duplicates.rows.length === 0) {
    console.log("OK: aucun compte @solarglobe.fr rattache a une organisation cliente.");
  } else {
    for (const row of duplicates.rows) console.log(row);
  }
}

main()
  .catch((err) => {
    console.error("AUDIT_SOLARGLOBE_AUTH_FAILED", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
