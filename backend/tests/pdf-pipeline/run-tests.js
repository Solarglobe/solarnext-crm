#!/usr/bin/env node
/**
 * PDF V2 — Industrial End-to-End Reliability Test Suite
 * Exécute tous les tests du pipeline PDF.
 *
 * Usage: npm run test:pdf-pipeline
 *        node backend/tests/pdf-pipeline/run-tests.js
 *
 * Prérequis: DATABASE_URL (.env ou .env.dev)
 */
import { runE2ETests } from "./pdf-pipeline.e2e.test.js";
import { runFailureTests } from "./pdf-pipeline.failure.test.js";
import { runConcurrentTests } from "./pdf-pipeline.concurrent.test.js";
import { runPerformanceTests } from "./pdf-pipeline.performance.test.js";
import { runUrlTests } from "./pdf-renderer-url.test.js";
import { runValidationTests } from "./pdf-pipeline.validation.test.js";
import { runRenderTokenTests } from "./pdf-render-token.test.js";

async function main() {
  console.log("=== PDF Pipeline — Industrial Reliability Tests (CP-PDF-V2-018/019) ===\n");

  let totalPassed = 0;
  let totalFailed = 0;

  const suites = [
    { name: "Renderer URL (studyId+versionId)", run: runUrlTests },
    { name: "RenderToken CP-PDF-V2-019", run: runRenderTokenTests },
    { name: "E2E", run: runE2ETests },
    { name: "Failure", run: runFailureTests },
    { name: "Validation CP-PDF-V2-018", run: runValidationTests },
    { name: "Concurrent", run: runConcurrentTests },
    { name: "Performance", run: runPerformanceTests },
  ];

  for (const suite of suites) {
    console.log(`\n--- ${suite.name} ---`);
    try {
      const { passed, failed } = await suite.run();
      totalPassed += passed;
      totalFailed += failed;
    } catch (e) {
      console.error(`Suite ${suite.name} crashed:`, e.message);
      totalFailed += 1;
    }
  }

  console.log("\n=== Résultat final ===");
  console.log(`✔ ${totalPassed} passés`);
  if (totalFailed > 0) {
    console.log(`✖ ${totalFailed} échoués`);
    process.exit(1);
  }
  console.log("Tous les tests passent.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
