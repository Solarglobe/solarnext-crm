/**
 * Préserve geometry_json.layout_snapshot lors des saves calpinage (POST upsert)
 * lorsque le client n'envoie pas une nouvelle image (évite d'écraser la capture post-validate).
 *
 * L’invalidation du snapshot si la géométrie change (geometry_hash) est faite dans
 * calpinage.controller.js **avant** cet appel : le `existingGeometryJson` passé ici peut
 * déjà avoir layout_snapshot / geometry_hash retirés pour éviter de réinjecter un snapshot périmé.
 *
 * Règles :
 * - Si le payload entrant contient un layout_snapshot non vide (string) → il remplace l'ancien.
 * - Sinon, si une valeur existait en base → on la recopie sur l'objet à persister.
 * - Pas de clear implicite du snapshot ici (la suppression explicite est gérée par le controller).
 *
 * @param {object} incoming - geometry_json issu du body (déjà cloné / mutable)
 * @param {object|null|undefined} existingGeometryJson - geometry_json actuel en base (ou null)
 * @returns {object}
 */
export function mergeLayoutSnapshotForUpsert(incoming, existingGeometryJson) {
  if (!incoming || typeof incoming !== "object") {
    return incoming;
  }
  const existing =
    existingGeometryJson && typeof existingGeometryJson === "object" ? existingGeometryJson : {};
  const out = { ...incoming };
  const incSnap = out.layout_snapshot;
  const hasNewSnapshot = typeof incSnap === "string" && incSnap.length > 0;
  if (hasNewSnapshot) {
    return out;
  }
  const exSnap = existing.layout_snapshot;
  if (typeof exSnap === "string" && exSnap.length > 0) {
    out.layout_snapshot = exSnap;
  }
  return out;
}
