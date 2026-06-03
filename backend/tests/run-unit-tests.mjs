/**
 * Runner — tests unitaires purs (sans DB).
 *
 * Exécute tous les tests qui ne nécessitent pas de connexion PostgreSQL.
 * Aucune variable DATABASE_URL requise.
 *
 * Usage :
 *   node backend/tests/run-unit-tests.mjs          (depuis la racine du projet)
 *   npm run test:unit                               (depuis backend/)
 *
 * Maintenance :
 *   Quand un nouveau fichier de test est ajouté :
 *   - S'il n'importe pas de pool/DATABASE_URL → l'ajouter ici.
 *   - S'il nécessite une DB → l'ajouter dans run-integration-tests.mjs.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

// ─── Liste exhaustive des tests purs (pas de connexion DB) ───────────────────

const UNIT_TEST_FILES = [
  'tests/antiOversellGuards.test.mjs',
  'tests/antiOversellRisk.test.mjs',
  'tests/assertOrgOwnership.test.js',
  'tests/authLogin.controller.regression.test.js',
  'tests/authRefreshTokens.test.mjs',
  'tests/batteryServicePhysicalMetrics.test.js',
  'tests/billing-select-sql-shape.test.mjs',
  'tests/billingSelectSql.clientNumber.test.js',
  'tests/calcResponseBuilder.test.js',
  'tests/calculationConfidence.test.mjs',
  'tests/calculationConfidenceOversell.test.mjs',
  'tests/calpinage-data-consumers.test.js',
  'tests/calpinage-data-idempotence.test.js',
  'tests/calpinage-data-numeric-coherence.test.js',
  'tests/calpinage-data-versioning-integrity.test.js',
  'tests/calpinage-near-canonical3d-passthrough.test.js',
  'tests/calpinage-persist-shading-critical.e2e.test.js',
  'tests/calpinage-shading-no-gps.test.js',
  'tests/calpinage-shading-v2-structure.test.js',
  'tests/calpinage-shading-versioning.test.js',
  'tests/calpinageSnapshot.shadingGate.test.js',
  'tests/clientPortal.service.test.js',
  'tests/clientRequestAccessRules.test.js',
  'tests/consumptionCsvActuelReshape.test.js',
  'tests/core/auth.test.js',
  'tests/core/mail.test.js',
  'tests/core/quotes.test.js',
  'tests/core/rateLimit.test.js',
  'tests/cors.http.test.mjs',
  'tests/cp080-document-prefix.test.js',
  'tests/dashboardOverview.kpi.test.js',
  'tests/documentMetadata.service.test.js',
  'tests/dpPdfFileNames.test.js',
  'tests/dsm-decode-geotiff.test.js',
  'tests/dsm-grid-sampler.test.js',
  'tests/dsm-pdf-commercial-copy.test.js',
  'tests/dsm-provider-http.test.js',
  'tests/economicsResolve.test.js',
  'tests/electricityGrowthSource.test.js',
  'tests/enedisEnergyService.test.js',
  'tests/enedisNormalizer.test.js',
  'tests/energyCoherence.test.js',
  'tests/energyKpiDefinitions.test.mjs',
  'tests/energyKpisNormalize.test.js',
  'tests/energyProfileBuilder.test.js',
  'tests/entityDocumentsDpPdf.migration-alignment.test.js',
  'tests/entityDocumentsMetadataBackfill.test.js',
  'tests/entityDocumentsOrgLegalComplementary.migration-alignment.test.js',
  'tests/entityDocumentsQuoteSignedTypes.migration-alignment.test.js',
  'tests/equipmentV2Chain.test.js',
  'tests/equipmentV2Normalize.test.js',
  'tests/far-confidence-model.test.js',
  'tests/finalStudyJson.e2e.test.js',
  'tests/finalizeSignedApproval.test.js',
  'tests/finance-inverter-replacement.test.js',
  'tests/financialEngine.test.js',
  'tests/financialEngineRegression.test.mjs',
  'tests/financialInvoicePdfBankMerge.test.js',
  'tests/financialScenariosLocking.test.mjs',
  'tests/horizon-confidence-integration.test.js',
  'tests/horizon-directional-c12.test.js',
  'tests/horizon-dsm-gate.test.js',
  'tests/horizon-hd-nonreg.test.js',
  'tests/horizon-premium-chart-c11.test.js',
  'tests/horizon-raycast-hd-core.test.js',
  'tests/http-geotiff-priority-and-fallback.test.js',
  'tests/inverterCatalogTruth.test.js',
  'tests/leadRequestAccessRules.test.js',
  'tests/leadScoringInactivity.test.js',
  'tests/mailAccess.service.test.js',
  'tests/mailOutboxBackoff.test.js',
  'tests/mailSyncJsonbSerialization.test.mjs',
  'tests/mairies.routes.rbac.regression.test.js',
  'tests/mairies.validation.test.js',
  'tests/mandatSignatureStamp.validation.test.js',
  'tests/meterRowToListItem.pdl.test.js',
  'tests/multipartFilenameUtf8.test.js',
  'tests/near-shading-front-back-parity.test.js',
  'tests/near-shading-physics-invariants.test.js',
  'tests/officialShadingTruth.test.js',
  'tests/panelCatalogTruth.test.js',
  'tests/pdfVirtualBatteryPage.test.js',
  'tests/pilotageBudgetFromEquipment.test.js',
  'tests/productionMultiPan.test.js',
  'tests/pvHourlyScaling.test.js',
  'tests/quote-deposit-snapshot.test.js',
  'tests/quotePdfStorageName.test.js',
  'tests/quoteSignatureMetadataTimestamp.test.js',
  'tests/rateLimit.http.test.mjs',
  'tests/rateLimiter.memory.test.js',
  'tests/rbacHardening.test.js',
  'tests/resolveBatteryFromDb.test.js',
  'tests/resolvePanelPowerWc.test.js',
  'tests/resolveShadingTotalLossPct.test.js',
  'tests/scripts/cleanup-test-clients-cli.test.mjs',
  'tests/securityHeaders.http.test.mjs',
  'tests/shading-commercial-guards.test.mjs',
  'tests/shading-engine-single-source.test.js',
  'tests/shading-horizon-alignment-no-frontend-engine.test.js',
  'tests/shading-kpi-contract.test.js',
  'tests/shading-near-core-backend-dependency-audit.test.js',
  'tests/shading-near-core-public-bytes.test.js',
  'tests/shading-near-core-shared-regression.test.js',
  'tests/shading-premium-lock.test.js',
  'tests/shading-quality-integration.test.js',
  'tests/shading-quality-model.test.js',
  'tests/shading-resolve-display-truth.test.js',
  'tests/shading-solar-backend-shared-parity.test.js',
  'tests/shadingGovernance.test.js',
  'tests/studyPdfFileName.util.test.js',
  'tests/studyScenariosRoute.rbac.regression.test.js',
  'tests/superAdminUserGuards.test.js',
  'tests/superAdminWriteAccess.test.js',
  'tests/userImpersonation.test.js',
  'tests/validation/stress-scenarios.test.js',
  'tests/virtualBattery8760.test.js',
  'tests/virtualBatteryGridResolve.test.js',
  'tests/virtualBatteryP2CapacityResolve.test.mjs',
  'tests/virtualBatteryP2Finance.test.js',
  'tests/weightedShadingKpi.test.js',
  'tests/electrical.stringSizing.test.js',
];

// ─── Tests nécessitant --experimental-test-module-mocks ──────────────────────
//
// mock.module() (ES module mocking) requiert ce flag en Node 22.
// Ces fichiers sont exécutés dans un second spawn pour ne pas impacter
// les tests standards.

const MODULE_MOCK_TEST_FILES = [
  'tests/controllers/calc.controller.test.js',
];

// ─── Exécution ────────────────────────────────────────────────────────────────

const total = UNIT_TEST_FILES.length + MODULE_MOCK_TEST_FILES.length;
console.log(`▶  test:unit — ${total} fichiers (sans DB)\n`);

function runTests(nodeArgs, files, label) {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [...nodeArgs, '--test', ...files],
      {
        cwd: backendRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          SOLARNEXT_UNIT_HORIZON_FIXTURE: 'true',
        },
      },
    );
    proc.on('exit', (code) => {
      if (code !== 0) console.error(`\n✗ ${label} : ${code} test(s) en échec`);
      resolve(code ?? 1);
    });
  });
}

const code1 = await runTests([], UNIT_TEST_FILES, 'tests standard');
const code2 = await runTests(
  ['--experimental-test-module-mocks'],
  MODULE_MOCK_TEST_FILES,
  'tests mock.module',
);

process.exit(code1 !== 0 || code2 !== 0 ? 1 : 0);
