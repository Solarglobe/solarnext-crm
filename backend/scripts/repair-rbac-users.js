/**
 * RBAC-HARDENING — Réparation globale : liaison rbac_user_roles ADMIN manquante
 * pour les comptes dont le rôle effectif est ADMIN (idempotent, non destructif).
 *
 * Usage :
 *   node scripts/repair-rbac-users.js
 */
async function main() {
  await import("../config/load-env.js");
  const { pool } = await import("../config/db.js");
  const { repairAllUsersAdminRbac } = await import("../rbac/rbac.service.js");

  console.log("RBAC repair — démarrage…");
  const report = await repairAllUsersAdminRbac(pool);
  console.log("--- Rapport ---");
  console.log("Utilisateurs corrigés (liaison ADMIN ajoutée) :", report.fixed);
  console.log("Déjà OK (ADMIN + RBAC) :", report.alreadyOk);
  console.log("Ignorés (rôle effectif ≠ ADMIN) :", report.skippedNonAdmin);
  if (report.errors.length > 0) {
    console.log("Erreurs / non résolus :", report.errors.length);
    for (const e of report.errors) {
      console.warn(`  user ${e.userId}: ${e.message}`);
    }
  } else {
    console.log("Erreurs : aucune");
  }
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
