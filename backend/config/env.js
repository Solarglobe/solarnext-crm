/**
 * CP-ENV-01 — Validation centralisée des variables d'environnement.
 *
 * Importé dans script-env-tail.js, après dotenv et les validateurs
 * spécifiques (auth.js, mailEncryptionKey.js).
 *
 * Règles d'arrêt :
 *   - NODE_ENV=production  → process.exit(1) pour les vars critiques manquantes/invalides
 *   - SMTP                 → warning uniquement (jamais fatal sauf si SMTP_REQUIRED=1)
 *   - NODE_ENV=development → warning coloré, pas d'arrêt pour les vars optionnelles
 *
 * Ce module sera enrichi en :
 *   - Phase 5  (moteur financier) : FINANCIAL_ENGINE_URL
 *   - Phase 9  (Stripe)          : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   - Phase 11 (Enedis)          : ENEDIS_CLIENT_ID, ENEDIS_CLIENT_SECRET
 */

const IS_PROD = process.env.NODE_ENV === "production";
const IS_TEST = process.env.NODE_ENV === "test";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN  = "\x1b[32m";
const RESET  = "\x1b[0m";

function fatal(varName, reason) {
  console.error(`\n${RED}❌  [ENV] ${varName} — ${reason}${RESET}\n`);
  process.exit(1);
}

function warn(varName, reason) {
  if (!IS_TEST) {
    console.warn(`${YELLOW}⚠️   [ENV] ${varName} — ${reason}${RESET}`);
  }
}

function check({ name, value, required, validate, hint }) {
  const val = String(value ?? "").trim();

  if (!val) {
    if (required) {
      fatal(name, `variable obligatoire manquante.${hint ? `\n       ► ${hint}` : ""}`);
    } else {
      warn(name, `non définie (optionnelle en développement).`);
    }
    return;
  }

  if (validate) {
    const error = validate(val);
    if (error) {
      if (required) {
        fatal(name, error);
      } else {
        warn(name, error);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Règles de validation
// ─────────────────────────────────────────────────────────────────────────────

// NODE_ENV — enum strict (toujours fatal, quelle que soit l'env)
const nodeEnv = String(process.env.NODE_ENV ?? "").trim();
if (!["development", "production", "test"].includes(nodeEnv)) {
  fatal(
    "NODE_ENV",
    `valeur invalide : "${nodeEnv}". Valeurs acceptées : development | production | test`
  );
}

// DATABASE_URL — format postgresql:// ou postgres://
check({
  name: "DATABASE_URL",
  value: process.env.DATABASE_URL,
  required: IS_PROD,
  validate: (v) => {
    if (!/^postgres(ql)?:\/\//.test(v)) {
      return `doit commencer par postgresql:// ou postgres:// — reçu : "${v.slice(0, 40)}…"`;
    }
    return null;
  },
  hint: "Exemple : postgresql://user:pass@host:5432/dbname",
});

// JWT_SECRET — longueur minimale 32 caractères
// Note : la présence seule est déjà vérifiée par auth.js (process.exit si absent)
const jwtRaw = String(process.env.JWT_SECRET ?? process.env.JWT_SECRET_KEY ?? "").trim();
if (jwtRaw && jwtRaw.length < 32) {
  fatal(
    "JWT_SECRET",
    `trop court (${jwtRaw.length} caractères). Minimum requis : 32 caractères.\n` +
    '       ► Générer un secret robuste :\n' +
    '         node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}

// PDF_RENDERER_BASE_URL — URL http/https valide, obligatoire en production
check({
  name: "PDF_RENDERER_BASE_URL",
  value: process.env.PDF_RENDERER_BASE_URL ?? process.env.FRONTEND_URL,
  required: IS_PROD,
  validate: (v) => {
    try {
      const url = new URL(v);
      if (!["http:", "https:"].includes(url.protocol)) {
        return `protocole invalide ("${url.protocol}") — http ou https attendu`;
      }
      return null;
    } catch {
      return `URL invalide : "${v}"`;
    }
  },
  hint: "Exemple : https://solarnext-crm.vercel.app",
});

// SMTP — warning uniquement (jamais fatal sauf si SMTP_REQUIRED=1 sur Railway).
// Logique : si aucune var SMTP n'est définie → warning global "mail désactivé".
//           Si partiellement défini → warning par var manquante.
//           Ajouter SMTP_REQUIRED=1 dans Railway pour rendre le bloc bloquant.
const SMTP_REQUIRED = IS_PROD && process.env.SMTP_REQUIRED === "1";
const smtpVarNames = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
const smtpDefined = smtpVarNames.filter((k) => String(process.env[k] ?? "").trim());

if (smtpDefined.length === 0) {
  if (!IS_TEST) {
    warn("SMTP", "aucune variable SMTP définie — envoi mail désactivé. (Définir SMTP_REQUIRED=1 pour bloquer au démarrage.)");
  }
} else {
  for (const name of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    check({ name, value: process.env[name], required: SMTP_REQUIRED });
  }
  check({
    name: "SMTP_PORT",
    value: process.env.SMTP_PORT,
    required: SMTP_REQUIRED,
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return `doit être un entier entre 1 et 65535 — reçu : "${v}"`;
      }
      return null;
    },
    hint: "Valeurs courantes : 587 (STARTTLS), 465 (SSL), 25",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation en fin de validation
// ─────────────────────────────────────────────────────────────────────────────
if (!IS_TEST) {
  const label = IS_PROD ? "production" : "development";
  console.log(`${GREEN}[ENV] ✓ Variables validées (${label})${RESET}`);
}
