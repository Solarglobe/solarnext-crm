/**
 * Lance les tests E2E de la page PDF preview.
 * Tests : route accessible, chargement OK, erreur API 404, marqueur #pdf-ready
 *
 * Usage (depuis frontend/) : node scripts/test-pdf-page.js
 * ou : npx playwright test tests/e2e/pdf-preview.spec.ts --reporter=list
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const child = spawn("npx", ["playwright", "test", "tests/e2e/pdf-preview.spec.ts", "--reporter=list"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
