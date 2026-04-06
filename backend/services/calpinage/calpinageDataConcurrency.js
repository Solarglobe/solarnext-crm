/**
 * Sérialise les écritures sur calpinage_data pour une même version (study_version_id).
 * — pg_advisory_xact_lock : même clé que save / validate / capture snapshot (pas de course à l'insert).
 * — SELECT … FOR UPDATE : base de merge lue sur la ligne réellement verrouillée.
 */

/**
 * Verrou transactionnel (libéré au COMMIT / ROLLBACK).
 * Préfixe dédié pour limiter les collisions avec d’autres usages d’advisory locks.
 * @param {import("pg").PoolClient} client
 * @param {string} organizationId
 * @param {string} studyVersionId
 */
export async function lockCalpinageVersion(client, organizationId, studyVersionId) {
  await client.query(`SELECT pg_advisory_xact_lock(abs(hashtext($1::text))::integer)`, [
    `calpinage|${organizationId}|${studyVersionId}`,
  ]);
}
