import "./config/load-env.js";

// DEBUG_CALC_TRACE=1 : logs structurés [TRACE_*] (conso, PV, agrégation, scénarios, finance).

// CP-ADMIN-ARCH-01 : En prod, RBAC_ENFORCE doit être explicite (1)
if (process.env.NODE_ENV === "production" && process.env.RBAC_ENFORCE === undefined) {
  process.env.RBAC_ENFORCE = "1";
}

console.log("RBAC_ENFORCE =", process.env.RBAC_ENFORCE);

// Migrations + garde schéma + HTTP : tout est chaîné dans server.js (évite double exécution migrate / bootstrap).
await import("./server.js");
