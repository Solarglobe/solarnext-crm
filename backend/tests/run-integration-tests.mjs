/**
 * Runner — tests d'intégration (avec DB PostgreSQL).
 *
 * Exécute tous les tests qui nécessitent une connexion PostgreSQL active.
 * Requiert DATABASE_URL dans l'environnement (ou un service postgres CI).
 *
 * Usage :
 *   DATABASE_URL=postgresql://... node backend/tests/run-integration-tests.mjs
 *   npm run test:integration                         (depuis backend/, avec DATABASE_URL)
 *
 * CI : voir job "integration-tests" dans .github/workflows/ci.yml.
 *
 * Maintenance :
 *   Quand un nouveau fichier de test importe pool/DATABASE_URL → l'ajouter ici.
 *   Sinon (test pur) → l'ajouter dans run-unit-tests.mjs.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

// ─── Garde : DATABASE_URL obligatoire ─────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error(
    '✗  DATABASE_URL manquant.\n' +
    '   Les tests d\'intégration nécessitent une base PostgreSQL joignable.\n' +
    '   Ex : DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/solarnext_ci npm run test:integration',
  );
  process.exit(1);
}

// ─── Liste exhaustive des tests nécessitant une DB ───────────────────────────

const INTEGRATION_TEST_FILES = [
  'tests/backfill-client-ids-for-client-leads.test.mjs',
  'tests/calpinage-concurrency.integration.test.js',
  'tests/calpinage-geometry-hash-snapshot.test.js',
  'tests/calpinage-layout-snapshot-preserve.test.js',
  'tests/calpinage-snapshot-geometry-override.test.js',
  'tests/calpinage-validate-endpoint-equivalence.test.js',
  'tests/calpinage-validate-snapshot-html2canvas.test.js',
  'tests/calpinage-validate.integration.test.js',
  'tests/consumptionCsvResolver.e2e.test.js',
  'tests/core/clients-leads.test.js',
  'tests/core/rgpd.test.js',
  'tests/documentSequence.concurrency.test.js',
  'tests/ensure-client-from-quote.test.mjs',
  'tests/impersonation.http.integration.test.mjs',
  'tests/invoice-billing-ux-e2e-validation.test.mjs',
  'tests/invoice-flexible-payments.test.mjs',
  'tests/invoice-preparation-dashboard.test.mjs',
  'tests/invoice-quote-billing-flex.test.mjs',
  'tests/leadMairie.cp004.integration.test.js',
  'tests/mairies.api.integration.test.js',
  'tests/pdf-pipeline/pdf-pipeline.concurrent.test.js',
  'tests/pdf-pipeline/pdf-pipeline.e2e.test.js',
  'tests/pdf-pipeline/pdf-pipeline.failure.test.js',
  'tests/pdf-pipeline/pdf-pipeline.performance.test.js',
  'tests/pdf-pipeline/pdf-pipeline.validation.test.js',
  'tests/pdf-pipeline/pdf-render-token.test.js',
  'tests/publicInvertersModulesPerInverter.test.js',
  'tests/quote-create-global-discount.test.js',
  'tests/quote-discount-multi-vat.test.js',
  'tests/quote-engine-missing-discount-guard.test.mjs',
  'tests/quote-prep.test.js',
  'tests/quote-without-client.test.js',
  'tests/run-study.test.js',
  'tests/scenariosGenerationFromQuoteConfig.test.js',
];

// ─── Exécution ────────────────────────────────────────────────────────────────

console.log(`▶  test:integration — ${INTEGRATION_TEST_FILES.length} fichiers (DB requise)\n`);

const proc = spawn(
  process.execPath,
  ['--test', ...INTEGRATION_TEST_FILES],
  { cwd: backendRoot, stdio: 'inherit' },
);

proc.on('exit', (code) => process.exit(code ?? 1));
