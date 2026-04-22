/**
 * CP-072 — Vérifie colonnes audit_logs + insertion résiliente (optionnel).
 * Usage : node --env-file=.env scripts/cp072-audit-verify.mjs
 */
import "../config/load-env.js";
import { pool } from "../config/db.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

async function main() {
  const col = await pool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_name = 'audit_logs'
     ORDER BY ordinal_position`
  );
  console.log("Colonnes audit_logs:", col.rows.map((r) => `${r.column_name} (${r.data_type}, null=${r.is_nullable})`).join("\n"));

  const hasTarget = col.rows.some((r) => r.column_name === "target_label");
  console.log("target_label présent:", hasTarget);

  await logAuditEvent({
    action: "CP072_SMOKE_TEST",
    entityType: "system",
    organizationId: null,
    userId: null,
    metadata: { ok: true },
    statusCode: 200,
  });

  const last = await pool.query(
    `SELECT action, organization_id IS NULL AS org_null, target_label, method, route
     FROM audit_logs WHERE action = 'CP072_SMOKE_TEST' ORDER BY created_at DESC LIMIT 1`
  );
  console.log("Dernière ligne smoke:", last.rows[0] || "(aucune)");

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
