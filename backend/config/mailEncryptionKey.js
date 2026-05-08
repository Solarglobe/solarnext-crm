/**
 * CP-070 — Validation MAIL_ENCRYPTION_KEY au démarrage.
 * Doit être importé après register-local-env.js (dotenv appliqué).
 *
 * Format accepté (deux seuls formats valides) :
 *   - 64 caractères hexadécimaux  → 32 octets AES-256
 *   - Base64 décodant vers 32 octets exactement
 *
 * Génération d'une clé robuste (à faire UNE FOIS, résultat à stocker dans Railway) :
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Ajout dans Railway :
 *   Variables → Add → MAIL_ENCRYPTION_KEY = <sortie de la commande ci-dessus>
 */

const KEY_LEN = 32;
const raw = String(process.env.MAIL_ENCRYPTION_KEY ?? "").trim();

if (!raw) {
  console.error(
    "\n❌  MAIL_ENCRYPTION_KEY manquante — le chiffrement AES-256-GCM des credentials mail est impossible.\n" +
    "\n   ► Générer une clé :\n" +
    '     node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
    "\n   ► Puis ajouter dans Railway (ou .env.dev / backend/.env en local) :\n" +
    "     MAIL_ENCRYPTION_KEY=<64 caractères hexadécimaux>\n"
  );
  process.exit(1);
}

let valid = false;

// Format hex : exactement 64 chars hexadécimaux → 32 octets
if (/^[0-9a-fA-F]{64}$/.test(raw)) {
  valid = true;
} else {
  // Format base64 : doit décoder vers exactement KEY_LEN octets
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === KEY_LEN) valid = true;
  } catch {
    // ignore — restera invalide
  }
}

if (!valid) {
  console.error(
    "\n❌  MAIL_ENCRYPTION_KEY invalide.\n" +
    "   La clé doit être l'un de ces deux formats :\n" +
    "     • 64 caractères hexadécimaux (32 octets)  ← format recommandé\n" +
    "     • Base64 décodant vers exactement 32 octets\n" +
    "\n   ► Générer une nouvelle clé valide :\n" +
    '     node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

console.log("[MAIL] ✓ MAIL_ENCRYPTION_KEY chargée — AES-256-GCM opérationnel");
