/**
 * Supprime toutes les factures et dépendances (base de test / staging Railway).
 *
 * Schéma réel : invoice_lines, payments, credit_notes / credit_note_lines,
 * invoice_reminders, entity_documents (entity_type = 'invoice'). Pas de invoice_items.
 *
 * Résolution URL (ordre) :
 *   process.env.DATABASE_URL = process.env.DATABASE_URL_OVERRIDE || process.env.DATABASE_URL
 *   Option CLI : --database-url=... → équivaut à DATABASE_URL_OVERRIDE pour un tir ponctuel.
 *
 * Usage (depuis la racine du repo, service backend Railway) :
 *   railway run --service <backend-service> node backend/scripts/purge-all-invoices-test.js --dry-run
 *   $env:PURGE_ALL_INVOICES_CONFIRM="YES"
 *   railway run --service <backend-service> node backend/scripts/purge-all-invoices-test.js --execute
 *
 * Depuis backend/ :
 *   railway run --service <backend-service> node scripts/purge-all-invoices-test.js --dry-run
 *
 * Sur Railway tu peux aussi définir DATABASE_URL_OVERRIDE = même valeur que DATABASE_URL du service
 * pour forcer explicitement la cible (logs « OVERRIDE utilisé : oui »).
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Ne jamais écraser DATABASE_URL déjà défini (ex. injection Railway via `railway run`).
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
  dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });
}

const argvEarly = process.argv.slice(2);
const dbUrlArg = argvEarly.find((a) => a.startsWith("--database-url="));
if (dbUrlArg) {
  process.env.DATABASE_URL_OVERRIDE = dbUrlArg.slice("--database-url=".length).trim();
}

const overrideRaw = process.env.DATABASE_URL_OVERRIDE;
const baseRaw = process.env.DATABASE_URL;
// Même logique que : const DATABASE_URL = process.env.DATABASE_URL_OVERRIDE || process.env.DATABASE_URL;
process.env.DATABASE_URL =
  (overrideRaw && String(overrideRaw).trim()) || (baseRaw && String(baseRaw).trim()) || "";

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL manquant après résolution.\n" +
      "  Définir DATABASE_URL (fichier .env / Railway) ou DATABASE_URL_OVERRIDE pour pointer vers la base de l’API."
  );
  process.exit(1);
}

const { applyResolvedDatabaseUrl, getConnectionString } = await import("../config/database-url.js");
applyResolvedDatabaseUrl();

const { pool } = await import("../config/db.js");

/** Masque user/mot de passe pour les logs (ne jamais imprimer le secret en clair). */
function redactConnectionUrl(raw) {
  if (!raw) return "(vide)";
  try {
    const u = new URL(raw);
    const user = u.username ? "***" : "";
    const auth = user ? `${user}:***@` : "";
    const port = u.port || (u.protocol === "postgresql:" || u.protocol === "postgres:" ? "5432" : "");
    const host = u.hostname || "?";
    const path = u.pathname || "/";
    return `${u.protocol}//${auth}${host}${port ? `:${port}` : ""}${path}`;
  } catch {
    return "(URL non analysable — identifiants non affichés)";
  }
}

/** host, port, database pour contrôle visuel obligatoire avant connexion. */
function parseDbTarget(raw) {
  if (!raw) return { host: "", port: "", database: "", redacted: "(vide)" };
  try {
    const u = new URL(raw);
    const db = (u.pathname || "").replace(/^\//, "") || "(sans nom)";
    const port = u.port || "5432";
    return {
      host: u.hostname || "?",
      port: String(port),
      database: db,
      redacted: redactConnectionUrl(raw),
    };
  } catch {
    return { host: "?", port: "?", database: "?", redacted: redactConnectionUrl(raw) };
  }
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const execute = argv.includes("--execute");
  const dryRun = argv.includes("--dry-run") || !execute;
  return { execute, dryRun };
}

async function counts(client) {
  const q = async (sql) => (await client.query(sql)).rows[0].c;
  return {
    invoices: await q("SELECT COUNT(*)::int AS c FROM invoices"),
    invoice_lines: await q("SELECT COUNT(*)::int AS c FROM invoice_lines"),
    payments: await q("SELECT COUNT(*)::int AS c FROM payments"),
    credit_notes: await q("SELECT COUNT(*)::int AS c FROM credit_notes"),
    credit_note_lines: await q("SELECT COUNT(*)::int AS c FROM credit_note_lines"),
    invoice_reminders: await q("SELECT COUNT(*)::int AS c FROM invoice_reminders"),
    entity_documents_invoice: await q(
      "SELECT COUNT(*)::int AS c FROM entity_documents WHERE entity_type = 'invoice'"
    ),
  };
}

function logMandatoryTargetBeforeActions() {
  const resolved = getConnectionString();
  const t = parseDbTarget(resolved);
  const usingOverride = Boolean(overrideRaw && String(overrideRaw).trim());

  console.log("────────── Cible PostgreSQL (obligatoire avant toute action) ──────────");
  console.log("  NODE_ENV              :", process.env.NODE_ENV || "(non défini)");
  console.log("  OVERRIDE utilisé      :", usingOverride ? "oui (DATABASE_URL_OVERRIDE ou --database-url=)" : "non (DATABASE_URL fichier / Railway)");
  console.log("  host                  :", t.host);
  console.log("  port                  :", t.port);
  console.log("  database              :", t.database);
  console.log("  Connected to DB       :", t.redacted, "(identifiants masqués)");
  console.log("──────────────────────────────────────────────────────────────────────");

  if (process.env.NODE_ENV === "production") {
    console.log("⚠️  PROD (ou NODE_ENV=production) DÉTECTÉ — confirmation explicite requise pour --execute (PURGE_ALL_INVOICES_CONFIRM=YES).");
  }

  if (t.host === "localhost" || t.host === "127.0.0.1") {
    console.log(
      "Astuce : si l’UI parle à une API Railway, un dry-run sur localhost ne reflète pas cette base.\n" +
        "  → `railway run --service <backend> node backend/scripts/purge-all-invoices-test.js --dry-run`"
    );
  }
}

async function main() {
  const { execute, dryRun } = parseArgs();

  logMandatoryTargetBeforeActions();

  if (execute && process.env.PURGE_ALL_INVOICES_CONFIRM !== "YES") {
    console.error(
      "Pour exécuter la purge, définissez PURGE_ALL_INVOICES_CONFIRM=YES (confirmation explicite, y compris si NODE_ENV=production sous Railway)."
    );
    process.exit(1);
  }

  let client;
  try {
    client = await pool.connect();
    console.log("Connexion OK.");

    const before = await counts(client);
    console.log("Comptages actuels (lignes) :", before);
    console.log("→ Vérifier que « invoices » = nombre de factures visibles dans l’UI (filtre « tous »).");

    if (dryRun) {
      console.log(
        "\nMode --dry-run : aucune suppression. Si le total « invoices » ne colle pas à l’UI, ce n’est pas la bonne base."
      );
      console.log(
        "Exécution réelle : PURGE_ALL_INVOICES_CONFIRM=YES puis railway run ... --execute"
      );
      return;
    }

    await client.query("BEGIN");
    await client.query(`DELETE FROM entity_documents WHERE entity_type = 'invoice'`);
    await client.query(`DELETE FROM invoice_reminders`);
    await client.query(`DELETE FROM payments`);
    await client.query(`DELETE FROM credit_note_lines`);
    await client.query(`DELETE FROM credit_notes`);
    await client.query(`DELETE FROM invoice_lines`);
    await client.query(`DELETE FROM invoices`);
    await client.query("COMMIT");

    const after = await counts(client);
    console.log("Comptages après purge :", after);
    const ok =
      after.invoices === 0 &&
      after.invoice_lines === 0 &&
      after.payments === 0 &&
      after.credit_notes === 0 &&
      after.credit_note_lines === 0 &&
      after.invoice_reminders === 0 &&
      after.entity_documents_invoice === 0;
    if (!ok) {
      console.error("Attention : des lignes subsistent (vérifiez d’autres schémas / tables personnalisées).");
      process.exit(2);
    }
    console.log("Purge factures OK. Recharger l’UI : liste vide attendue.");
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main();
