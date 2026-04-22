/**
 * Secret JWT : une seule lecture, aucun fallback ni valeur implicite.
 * Importer uniquement après config/load-env.js (dotenv appliqué).
 */

const fromPrimary = String(process.env.JWT_SECRET ?? "").trim();
const fromLegacyKey = String(process.env.JWT_SECRET_KEY ?? "").trim();
const resolved = fromPrimary || fromLegacyKey;

if (!resolved) {
  console.error("❌ JWT_SECRET manquant");
  process.exit(1);
}

/** Secret sign/verify JWT (auth utilisateur + render tokens PDF). */
export const JWT_SECRET = resolved;
