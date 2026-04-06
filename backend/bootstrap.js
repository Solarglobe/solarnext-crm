import "./config/load-env.js";

// DEBUG_CALC_TRACE=1 : active les logs structurés [TRACE_*] (conso, PV, agrégation, scénarios, finance) pour preuve runtime.
// Accessible via process.env.DEBUG_CALC_TRACE après chargement dotenv ci-dessus.

// CP-ADMIN-ARCH-01 : En prod, RBAC_ENFORCE doit être explicite (1) pour éviter "ça passe tout seul"
if (process.env.NODE_ENV === "production" && process.env.RBAC_ENFORCE === undefined) {
  process.env.RBAC_ENFORCE = "1";
}

console.log("RBAC_ENFORCE =", process.env.RBAC_ENFORCE);

// Migration Manager : appliquer les migrations manquantes et vérifier les checksums
const { runMigrationsSafely } = await import("./services/system/migrationManager.service.js");
await runMigrationsSafely();

// Schema Guard : bloquer le démarrage si le schéma DB ne correspond pas au code (migrations manquantes)
const { verifyDatabaseSchema } = await import("./services/system/schemaGuard.service.js");
await verifyDatabaseSchema();

// Import dynamique pour éviter le hoisting ES modules
await import("./server.js");
